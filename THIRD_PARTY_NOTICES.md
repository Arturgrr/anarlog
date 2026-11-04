# Third-party notices

Anarlog's own code is available under the [MIT License](LICENSE). This repository also contains third-party material that keeps its original license. This file lists that material, where it lives, and where it came from.

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
| Cabin Sketch, Copyright 2011 The Cabin Project Authors | `plugins/windows/swift-lib/src/Resources/CabinSketch-Regular.ttf` | OFL-1.1 | `plugins/windows/swift-lib/src/Resources/OFL.txt` |

Pretendard includes glyphs from Inter, Source Han Sans, and M PLUS 1; their copyright lines are in `OFL.txt`.

## Adapted code

These files link to the upstream code they were adapted from or written against. The upstream licenses apply to the adapted portions.

| Path                                                                                        | Upstream                                                                                                                                                        | License                |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `apps/desktop/src/store/zustand/ai-task/shared/transform_infra.ts`                          | [vercel/ai](https://github.com/vercel/ai), Copyright 2023 Vercel, Inc.                                                                                          | Apache-2.0             |
| `crates/owhisper-interface/src/{lib,batch,stream}.rs`                                       | [deepgram/deepgram-rust-sdk](https://github.com/deepgram/deepgram-rust-sdk), Copyright (c) 2022 Deepgram                                                        | MIT                    |
| `crates/whisper/src/lib.rs`                                                                 | [openai/whisper](https://github.com/openai/whisper), Copyright (c) 2022 OpenAI                                                                                  | MIT                    |
| `crates/gguf/src/template.rs`, `crates/whisper-local/src/ggml.rs`, `scripts/gguf_writer.py` | [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp), Copyright (c) 2023-2026 The ggml authors                                                           | MIT                    |
| `crates/tcc/swift-lib/src/lib.swift`                                                        | [insidegui/AudioCap](https://github.com/insidegui/AudioCap), Copyright (c) 2024 Guilherme Rambo                                                                 | BSD-2-Clause           |
| `crates/audio-actual/src/speaker/mod.rs`                                                    | [floneum/floneum](https://github.com/floneum/floneum)                                                                                                           | MIT OR Apache-2.0      |
| `crates/whisper-local/src/model/actual.rs`                                                  | [tazz4843/whisper-rs](https://github.com/tazz4843/whisper-rs)                                                                                                   | Unlicense              |
| `scripts/pre_build.py`                                                                      | [thewh1teagle/vibe](https://github.com/thewh1teagle/vibe), Copyright (c) 2024 thewh1teagle; [utilityai/llama-cpp-rs](https://github.com/utilityai/llama-cpp-rs) | MIT; MIT OR Apache-2.0 |

## Other material

- `patches/` holds changes to npm packages. Each patch stays under the license of the package it modifies.
- Company and product logos in `apps/desktop/public/assets` identify the services they represent. They remain trademarks of their owners and are not covered by the MIT License.
