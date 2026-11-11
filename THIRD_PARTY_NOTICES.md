# Third-party notices

Librelog's own code is available under the [MIT License](LICENSE). This repository also contains third-party material that keeps its original license. This file lists that material, where it lives, and where it came from.

Packages fetched by Cargo or pnpm carry their own license metadata. They appear here only when they need a specific notice.

## Models

| Material                                                      | Path                                               | License   | Source                                                                                                                                                                                                                                            |
| ------------------------------------------------------------- | -------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Silero VAD v6.2, Copyright (c) 2020-present Silero Team       | `crates/vad/data/models/silero_v6.2.onnx`          | MIT       | [snakers4/silero-vad](https://github.com/snakers4/silero-vad), byte-identical to `src/silero_vad/data/silero_vad.onnx`                                                                                                                            |
| pyannote segmentation-3.0                                     | `crates/pyannote-local/src/data/segmentation.onnx` | MIT       | [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0); byte-identical to the ONNX export `onnx/model.onnx` in [onnx-community/pyannote-segmentation-3.0](https://huggingface.co/onnx-community/pyannote-segmentation-3.0) |
| WeSpeaker ResNet34-LM speaker embedding (VoxCeleb)            | `crates/embedding/src/onnx/embedding.onnx`         | CC-BY-4.0 | See the attribution below                                                                                                                                                                                                                         |
| DTLN-aec, Copyright (c) 2020 Nils L. Westhausen               | `crates/aec/data/models/model_*.onnx`              | MIT       | [breizhn/DTLN-aec](https://github.com/breizhn/DTLN-aec) `pretrained_models/dtln_aec_*.tflite`, converted to ONNX with `tf2onnx`                                                                                                                   |
| DTLN-aec audio samples, Copyright (c) 2020 Nils L. Westhausen | `crates/aec/data/inputs/doubletalk_*_sample.wav`   | MIT       | [breizhn/DTLN-aec](https://github.com/breizhn/DTLN-aec) `audio_samples/`; test data only                                                                                                                                                          |

### WeSpeaker attribution

`crates/embedding/src/onnx/embedding.onnx` is an ONNX export of the `wespeaker-voxceleb-resnet34-LM` pretrained speaker embedding model from [WeSpeaker](https://github.com/wenet-e2e/wespeaker), by Hongji Wang, Chengdong Liang, Shuai Wang, Zhengyang Chen, Binbin Zhang, Xu Xiang, Yanlei Deng, and Yanmin Qian, as distributed in [pyannote/wespeaker-voxceleb-resnet34-LM](https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM). The model is licensed under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/), following the license of the VoxCeleb dataset it was trained on. It was converted from PyTorch to ONNX.

> Wang, H., Liang, C., Wang, S., Chen, Z., Zhang, B., Xiang, X., Deng, Y., and Qian, Y. "Wespeaker: A research and production oriented speaker embedding learning toolkit." ICASSP 2023.

## Libraries

| Material                                                                 | Path                                                                        | License                                  | Source                                                                                                    |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| LAME 3.100                                                               | linked by `crates/mp3`                                                      | LGPL-2.0-or-later                        | [lame.sourceforge.io](https://lame.sourceforge.io/); license text in `crates/mp3/LICENSE-LAME.txt`        |
| `mp3lame-sys` 0.1.11 and `mp3lame-encoder` 0.2.3                         | dependencies of `crates/mp3`                                                | LGPL-3.0                                 | [DoumanAsh/mp3lame-sys](https://github.com/DoumanAsh/mp3lame-sys)                                         |
| `mdast_util_to_markdown` 0.0.2, Copyright (c) 2022 Titus Wormer          | `crates/tiptap/vendor/mdast_util_to_markdown`                               | MIT                                      | [wooorm/markdown-rs](https://github.com/wooorm/markdown-rs), with local patches noted in its `Cargo.toml` |
| Tremor Raw ProgressBar and Tracker                                       | `apps/desktop/src/settings/stats/tremor`                                    | Apache-2.0 (`LICENSE` in that directory) | [tremorlabs/tremor](https://github.com/tremorlabs/tremor) at `ca4d588`, modified                          |
| Lucide AudioLines icon, Copyright (c) 2026 Lucide Icons and Contributors | `apps/desktop/src/session/components/note-input/header-transcript-icon.tsx` | ISC (notice in the file)                 | [lucide-icons/lucide](https://github.com/lucide-icons/lucide)                                             |
| LobeHub icons, Copyright (c) 2023 LobeHub                                | AI provider icons (copied images and the `@lobehub/icons` package)          | MIT                                      | [lobehub/lobe-icons](https://github.com/lobehub/lobe-icons)                                               |
| Mintlify starter, Copyright (c) 2026 Mintlify                            | `docs/`                                                                     | MIT (`docs/LICENSE`)                     | [mintlify/starter](https://github.com/mintlify/starter)                                                   |

### LAME

`mp3lame-sys` builds LAME 3.100 from the sources it ships and links it statically into the desktop app. The LAME source is published in the `mp3lame-sys` crate on crates.io (`lame-3.100/`) and at [lame.sourceforge.io](https://lame.sourceforge.io/). Because the complete application source is in this repository, you can rebuild the app against a modified LAME, for example by replacing `mp3lame-sys` with a local copy through a Cargo `[patch]` section.

## Fonts

| Font                                                   | Path                                                              | License | License file                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------- | ------- | ------------------------------------------------- |
| Pretendard 1.3.9, Copyright (c) 2021 Kil Hyung-jin     | `crates/export-core/fonts/Pretendard-*.otf`                       | OFL-1.1 | `crates/export-core/fonts/OFL.txt`                |
| Inter 4, Copyright (c) 2016 The Inter Project Authors | `@fontsource-variable/inter`, bundled into the desktop app | OFL-1.1 | `licenses/OFL-1.1-Inter.txt` |
| IBM Plex Mono, Copyright (c) 2017 IBM Corp., with Reserved Font Name "Plex" | `@fontsource/ibm-plex-mono`, bundled into the desktop app | OFL-1.1 | `licenses/OFL-1.1-IBM-Plex-Mono.txt` |

Pretendard includes glyphs from Inter, Source Han Sans, and M PLUS 1; their copyright lines are in `OFL.txt`. Inter and IBM Plex Mono are unmodified and installed through [Fontsource](https://fontsource.org) (MIT packaging). The Librelog wordmark (`crates/export-core/assets/librelog-logo.svg`, `docs/logo/*.svg`) contains Inter SemiBold glyphs converted to outlines.

## Adapted code

These files link to the upstream code they were adapted from or written against. The upstream licenses apply to the adapted portions.

| Path                                                                                        | Upstream                                                                                                                                                        | License                |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `apps/desktop/src/store/zustand/ai-task/shared/transform_infra.ts`                          | [vercel/ai](https://github.com/vercel/ai), Copyright 2023 Vercel, Inc.                                                                                          | Apache-2.0             |
| `crates/owhisper-interface/src/{lib,batch,stream}.rs`                                       | [deepgram/deepgram-rust-sdk](https://github.com/deepgram/deepgram-rust-sdk), Copyright (c) 2022 Deepgram                                                        | MIT                    |
| `crates/whisper/src/lib.rs`                                                                 | [openai/whisper](https://github.com/openai/whisper), Copyright (c) 2022 OpenAI                                                                                  | MIT                    |
| `crates/whisper-local/src/ggml.rs`                                                          | [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp), Copyright (c) 2023-2026 The ggml authors                                                           | MIT                    |
| `crates/tcc/swift-lib/src/lib.swift`                                                        | [insidegui/AudioCap](https://github.com/insidegui/AudioCap), Copyright (c) 2024 Guilherme Rambo                                                                 | BSD-2-Clause           |
| `crates/audio-actual/src/speaker/mod.rs`                                                    | [floneum/floneum](https://github.com/floneum/floneum)                                                                                                           | MIT OR Apache-2.0      |
| `crates/whisper-local/src/model/actual.rs`                                                  | [tazz4843/whisper-rs](https://github.com/tazz4843/whisper-rs)                                                                                                   | Unlicense              |
| `crates/dictation-ui-macos/swift-lib/src/{DictationHud,HudModel,HudScope,HudShader,HudViews}.swift`, `apps/desktop/src/dictation/hud/{model,scope,shader,spring}.ts` | [anomalyco/hex](https://github.com/anomalyco/hex) at `3dc7f538` (the dictation indicator's lifecycle, springs, plate and trace motion from Dot scope; the traces are drawn as lines instead of Hex's dot field), Copyright (c) 2026 Christopher Langton | MIT |
| `crates/dictation-ui-macos/swift-lib/src/{TextInsertion,InsertionRoute,KeyboardInput}.swift` | [anomalyco/hex](https://github.com/anomalyco/hex) at `3dc7f538` (from `src/keyboard.rs` and `src/paste.rs`: resolving the paste key from the active layout's Command layer, typing instead of pasting into Chromium 155 and 156 found from the bundle's framework versions, and splitting typed text into 20-unit events with Shift-Return line breaks), Copyright (c) 2026 Christopher Langton | MIT |
| `crates/recording-environment/src/{coordinator,ramp,browser,mute,media}.rs`, `crates/recording-environment/src/native/` | [anomalyco/hex](https://github.com/anomalyco/hex) at `3dc7f538` (from `src/audio/{recording_environment,output_ducking,browser_media,idle_sleep}.rs`, `src/audio/recording_environment/ducking.rs`, `src/{linux,windows}/audio_control.rs` and `src/meeting/macos.rs`: changes held from the first overlapping recording to the last, the channel-preserving volume ramp that yields to manual changes, muting and pausing only what was audible and resuming only what was paused, the browser pause confirmed by listening to the browsers' own output, and the idle-sleep assertion, inhibitor and power request), Copyright (c) 2026 Christopher Langton | MIT |
| `apps/desktop/src/dictation/history/store.ts`, `plugins/dictation/src/history.rs` | [anomalyco/hex](https://github.com/anomalyco/hex) at `3dc7f538` (from `src/history.rs`, `src/history/versions.rs` and `src/history/recordings.rs`: the retention choices with Off keeping saved entries, replacing and restoring a transcript through at most five newest-first versions, and keeping recordings as owner-only 16-bit WAV files swept once no entry refers to them), Copyright (c) 2026 Christopher Langton | MIT |
| `packages/design-system/src/{tokens,theme}.css`, `packages/design-system/src/index.ts`, `packages/ui` component styles | Colour, elevation, radius and type values from the "opencode" theme of [anomalyco/rune](https://github.com/anomalyco/rune) at `386b2fd3`, and component specs from [anomalyco/hex](https://github.com/anomalyco/hex), Copyright (c) 2026 Christopher Langton | MIT |

## Other material

- `patches/` holds changes to npm packages. Each patch stays under the license of the package it modifies.
- Company and product logos in `apps/desktop/public/assets` identify the services they represent. They remain trademarks of their owners and are not covered by the MIT License.

## License texts

The desktop app bundles this file, `LICENSE`, and the full license texts it requires under `licenses/` in its resources:

- `licenses/MIT.txt`: applies to each MIT-licensed item above, with that item's copyright line.
- `licenses/Apache-2.0.txt`: Tremor and the code adapted from vercel/ai.
- `licenses/BSD-2-Clause-AudioCap.txt`: code adapted from AudioCap.
- `crates/mp3/LICENSE-LAME.txt`: LAME.
- `crates/export-core/fonts/OFL.txt`, `licenses/OFL-1.1-Inter.txt` and `licenses/OFL-1.1-IBM-Plex-Mono.txt`: Pretendard, Inter and IBM Plex Mono.

The WeSpeaker attribution above satisfies CC-BY-4.0, whose full text is at https://creativecommons.org/licenses/by/4.0/legalcode. Licenses of npm and Cargo dependencies are not reproduced here; generate them with a license tool such as `cargo about` before publishing a release.
