//! Whether a model fits this computer's memory, and with how much context.
//!
//! The estimate is the model file, its f16 KV cache at the chosen context and
//! a fixed allowance for llama.cpp's compute buffers and the server itself.
//! A model is loaded only into at most half of the computer's memory, or up
//! to 65% at the smallest context, so transcription and the rest of the
//! system keep room. These are estimates, not measurements.

use crate::LlmModel;

pub const GIB: u64 = 1024 * 1024 * 1024;

/// llama.cpp's compute buffers, the output buffer and the server process.
pub const RUNTIME_OVERHEAD_BYTES: u64 = GIB / 2;

/// The smallest context the built-in models run with; about 30 minutes of a
/// meeting's transcript.
pub const MIN_CONTEXT: u32 = 8_192;
const CONTEXT_STEPS: [u32; 3] = [MIN_CONTEXT, 16_384, 32_768];

/// Share of total memory a model may use and still count as fitting.
const FIT_PERCENT: u64 = 50;
/// Share it may use at the smallest context and still load, as "tight".
const TIGHT_PERCENT: u64 = 65;

/// On Macs with this much memory or less, a model does not load while a
/// meeting is being recorded: transcription needs the room.
pub const SMALL_MEMORY_BYTES: u64 = 8 * GIB;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Fit {
    Fits,
    Tight,
    TooLarge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Admission {
    pub fit: Fit,
    /// The context the server starts with; `None` when the model is too large.
    pub context: Option<u32>,
    /// The estimate at `context`, or at the smallest context when too large.
    pub estimate_bytes: u64,
}

pub fn estimate_bytes(model: LlmModel, context: u32) -> u64 {
    let info = model.info();
    info.artifact.bytes + info.kv_bytes_per_token * u64::from(context) + RUNTIME_OVERHEAD_BYTES
}

/// The contexts tried for a model, smallest first: 8k, 16k, 32k and the
/// model's own maximum.
pub fn context_steps(model: LlmModel) -> Vec<u32> {
    let max = model.info().context_length;
    let mut steps: Vec<u32> = CONTEXT_STEPS
        .into_iter()
        .filter(|step| *step <= max)
        .collect();
    if steps.last() != Some(&max) {
        steps.push(max);
    }
    steps
}

pub fn admit(model: LlmModel, total_memory: u64) -> Admission {
    let fits = total_memory / 100 * FIT_PERCENT;
    let tight = total_memory / 100 * TIGHT_PERCENT;

    if let Some(context) = context_steps(model)
        .into_iter()
        .rev()
        .find(|context| estimate_bytes(model, *context) <= fits)
    {
        return Admission {
            fit: Fit::Fits,
            context: Some(context),
            estimate_bytes: estimate_bytes(model, context),
        };
    }

    let smallest = estimate_bytes(model, MIN_CONTEXT);
    if smallest <= tight {
        Admission {
            fit: Fit::Tight,
            context: Some(MIN_CONTEXT),
            estimate_bytes: smallest,
        }
    } else {
        Admission {
            fit: Fit::TooLarge,
            context: None,
            estimate_bytes: smallest,
        }
    }
}

/// The model Settings marks "best for this Mac": Qwen3 8B when it fits with
/// at least 32k of context (about an hour of meeting), otherwise the first
/// of Qwen3 4B, Ministral 3 3B and Granite 4.0 Micro that fits.
pub fn best_for(total_memory: u64) -> Option<LlmModel> {
    const PREFERENCE: [(LlmModel, u32); 4] = [
        (LlmModel::Qwen3_8B, 32_768),
        (LlmModel::Qwen3_4B, MIN_CONTEXT),
        (LlmModel::Ministral3_3B, MIN_CONTEXT),
        (LlmModel::Granite4Micro, MIN_CONTEXT),
    ];
    PREFERENCE.into_iter().find_map(|(model, min_context)| {
        let admission = admit(model, total_memory);
        (admission.fit == Fit::Fits && admission.context >= Some(min_context)).then_some(model)
    })
}

/// Whether a model may load now, given a recording in progress.
pub fn blocked_by_capture(total_memory: u64, capture_active: bool) -> bool {
    capture_active && total_memory <= SMALL_MEMORY_BYTES
}

pub fn total_memory_bytes() -> u64 {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    system.total_memory()
}

#[cfg(test)]
mod tests {
    use super::*;

    // The table the owner reviewed: which context each model gets on 8, 16,
    // 24 and 64 GB, and where it is tight or refused.
    #[test]
    fn contexts_follow_the_memory_policy() {
        use Fit::*;
        let cases: &[(LlmModel, u64, Fit, Option<u32>)] = &[
            (LlmModel::Qwen3_4B, 8, Fits, Some(8_192)),
            (LlmModel::Qwen3_4B, 16, Fits, Some(32_768)),
            (LlmModel::Qwen3_4B, 24, Fits, Some(40_960)),
            (LlmModel::Qwen3_8B, 8, TooLarge, None),
            (LlmModel::Qwen3_8B, 16, Fits, Some(16_384)),
            (LlmModel::Qwen3_8B, 24, Fits, Some(40_960)),
            (LlmModel::Granite4Micro, 8, Fits, Some(16_384)),
            (LlmModel::Granite4Micro, 16, Fits, Some(32_768)),
            (LlmModel::Ministral3_8B, 8, TooLarge, None),
            (LlmModel::Ministral3_8B, 16, Fits, Some(16_384)),
            (LlmModel::Ministral3_8B, 64, Fits, Some(32_768)),
            (LlmModel::Ministral3_3B, 8, Fits, Some(8_192)),
            (LlmModel::Ministral3_3B, 6, Tight, Some(8_192)),
            (LlmModel::Qwen3_4B, 7, Tight, Some(8_192)),
            (LlmModel::Qwen3_4B, 6, TooLarge, None),
            (LlmModel::Qwen3_4B, 4, TooLarge, None),
        ];
        for (model, gib, fit, context) in cases {
            let admission = admit(*model, gib * GIB);
            assert_eq!(
                (admission.fit, admission.context),
                (*fit, *context),
                "{model} on {gib} GB"
            );
        }
    }

    #[test]
    fn best_model_moves_up_with_memory() {
        assert_eq!(best_for(4 * GIB), None);
        assert_eq!(best_for(8 * GIB), Some(LlmModel::Qwen3_4B));
        assert_eq!(best_for(16 * GIB), Some(LlmModel::Qwen3_4B));
        assert_eq!(best_for(24 * GIB), Some(LlmModel::Qwen3_8B));
    }
}
