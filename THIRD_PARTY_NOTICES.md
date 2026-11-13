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
| Tremor Raw Tracker                                                       | `apps/desktop/src/settings/stats/tremor`                                    | Apache-2.0 (`LICENSE` in that directory) | [tremorlabs/tremor](https://github.com/tremorlabs/tremor) at `ca4d588`, modified                          |
| Lucide AudioLines icon, Copyright (c) 2026 Lucide Icons and Contributors | `apps/desktop/src/session/components/note-input/header-transcript-icon.tsx` | ISC (notice in the file)                 | [lucide-icons/lucide](https://github.com/lucide-icons/lucide)                                             |
| LobeHub icons, Copyright (c) 2023 LobeHub                                | AI provider icons (copied images and the `@lobehub/icons` package)          | MIT                                      | [lobehub/lobe-icons](https://github.com/lobehub/lobe-icons)                                               |
| Mintlify starter, Copyright (c) 2026 Mintlify                            | `docs/`                                                                     | MIT (`docs/LICENSE`)                     | [mintlify/starter](https://github.com/mintlify/starter)                                                   |
| transcribe.cpp 0.4.1, Copyright (c) 2026 The transcribe.cpp authors | `transcribe-cpp` and `transcribe-cpp-sys` 0.4.1 from crates.io, built from source and linked into the desktop app by `crates/transcribe-gguf` | MIT | [handy-computer/transcribe.cpp](https://github.com/handy-computer/transcribe.cpp) at tag `v0.4.1` (`4d7c1cce`) |
| ggml, Copyright (c) 2023-2026 The ggml authors | vendored in `transcribe-cpp-sys` 0.4.1 (`ggml/`) | MIT | [ggml-org/ggml](https://github.com/ggml-org/ggml), as pinned by transcribe.cpp `v0.4.1` |
| miniz 3.1.1, Copyright 2013-2014 RAD Game Tools and Valve Software, Copyright 2010-2014 Rich Geldreich and Tenacious Software LLC | vendored in `transcribe-cpp-sys` 0.4.1 (`src/third_party/miniz`) | MIT | [richgel999/miniz](https://github.com/richgel999/miniz) at `3.1.1` (`d10b03cc`) |
| Silero VAD speech-timestamp logic, Copyright (c) 2020-present Silero Team | translated into `transcribe-cpp-sys` 0.4.1 (`src/transcribe-vad.cpp`) | MIT | [snakers4/silero-vad](https://github.com/snakers4/silero-vad) at `v6.2.3` (`5cd7945`) |

transcribe.cpp's crates carry `THIRD-PARTY-LICENSES.md` with the ggml, miniz and Silero license texts; each is the MIT text in `licenses/MIT.txt` with the copyright line above.

### llama.cpp server

The macOS Apple silicon build outside the App Store bundles `librelog-llama-server`, the `llama-server` program of [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) at tag `b12110` (v0.9.0, `cd959bae`), built unmodified and statically linked by `cargo xtask prepare-binaries` (`crates/xtask/src/llama_server.rs`) without the web UI, RPC, HTTPS or subprocess support. It runs the built-in language models. It contains this code, whose license texts are in `licenses/llama.cpp/`:

| Material | License | License file |
| --- | --- | --- |
| llama.cpp and ggml, Copyright (c) 2023-2026 The ggml authors | MIT | `licenses/llama.cpp/LICENSE` |
| cpp-httplib 0.64.0, Copyright (c) 2017 yhirose | MIT | `licenses/llama.cpp/cpp-httplib-LICENSE` |
| nlohmann/json 3.12.0, Copyright (c) 2013-2025 Niels Lohmann | MIT | `licenses/llama.cpp/nlohmann-json-LICENSE` |
| xxHash, Copyright (c) 2012-2021 Yann Collet | BSD-2-Clause | `licenses/llama.cpp/xxhash-LICENSE` |
| rotate-bits, Copyright (c) 2021 William Casarin | MIT | `licenses/llama.cpp/rotate-bits-LICENSE` |
| SHA-1 in C by Steve Reid; SHA-256 by Igor Pavlov | Public domain | `licenses/llama.cpp/sha1-LICENSE`, `licenses/llama.cpp/sha256-LICENSE` |
| stb_image 2.30, Copyright (c) 2017 Sean Barrett | MIT or public domain | `licenses/llama.cpp/stb_image-LICENSE` |
| miniaudio 0.11.26, Copyright 2026 David Reid | Public domain or MIT-0 | `licenses/llama.cpp/miniaudio-LICENSE` |

llama.cpp's `common/base64.hpp` is public domain (notice in the file).

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
| `crates/tcc/swift-lib/src/lib.swift`                                                        | [insidegui/AudioCap](https://github.com/insidegui/AudioCap), Copyright (c) 2024 Guilherme Rambo                                                                 | BSD-2-Clause           |
| `crates/audio-actual/src/speaker/mod.rs`                                                    | [floneum/floneum](https://github.com/floneum/floneum)                                                                                                           | MIT OR Apache-2.0      |
| `crates/dictation-ui-macos/swift-lib/src/{DictationHud,HudModel,HudScope,HudShader,HudViews,HudPlacement,HudEarsView}.swift`, `crates/dictation-ui-macos/swift-lib/tests/HudPlacementTests.swift`, `apps/desktop/src/dictation/hud/{model,scope,shader,spring}.ts` | [anomalyco/hex](https://github.com/anomalyco/hex) at `3dc7f538` (the dictation indicator's lifecycle, springs, plate and trace motion from Dot scope; the traces are drawn as lines instead of Hex's dot field; from `src/rune_hud/hud_placement.rs`, `src/rune_hud/macos.rs`, `src/rune_hud.rs`, `src/rune_hud.wgsl` and `src/dictation/indicator.rs`: the top and bottom placement, notch detection, the window level over the menu bar, and the notch indicator's geometry, glyphs, colours and timings, drawn with Core Animation instead of Hex's shader), Copyright (c) 2026 Christopher Langton | MIT |
| `crates/dictation-ui-macos/swift-lib/src/{TextInsertion,InsertionRoute,KeyboardInput}.swift` | [anomalyco/hex](https://github.com/anomalyco/hex) at `3dc7f538` (from `src/keyboard.rs` and `src/paste.rs`: resolving the paste key from the active layout's Command layer, typing instead of pasting into Chromium 155 and 156 found from the bundle's framework versions, and splitting typed text into 20-unit events with Shift-Return line breaks), Copyright (c) 2026 Christopher Langton | MIT |
| `crates/recording-environment/src/{coordinator,ramp,browser,mute,media}.rs`, `crates/recording-environment/src/native/` | [anomalyco/hex](https://github.com/anomalyco/hex) at `3dc7f538` (from `src/audio/{recording_environment,output_ducking,browser_media,idle_sleep}.rs`, `src/audio/recording_environment/ducking.rs`, `src/{linux,windows}/audio_control.rs` and `src/meeting/macos.rs`: changes held from the first overlapping recording to the last, the channel-preserving volume ramp that yields to manual changes, muting and pausing only what was audible and resuming only what was paused, the browser pause confirmed by listening to the browsers' own output, and the idle-sleep assertion, inhibitor and power request), Copyright (c) 2026 Christopher Langton | MIT |
| `apps/desktop/src/dictation/history/store.ts`, `plugins/dictation/src/history.rs` | [anomalyco/hex](https://github.com/anomalyco/hex) at `3dc7f538` (from `src/history.rs`, `src/history/versions.rs` and `src/history/recordings.rs`: the retention choices with Off keeping saved entries, replacing and restoring a transcript through at most five newest-first versions, and keeping recordings as owner-only 16-bit WAV files swept once no entry refers to them), Copyright (c) 2026 Christopher Langton | MIT |
| `crates/transcribe-gguf/src/{session,credits,gpu_health,placement}.rs`, `crates/transcribe-gguf/src/backends.rs` (the Windows GPU start-up marker), `crates/gguf-model/src/catalog.rs` | [anomalyco/hex](https://github.com/anomalyco/hex) at `3dc7f538` (from `src/transcription/{gguf_session,subtitle_credits,gpu_health,local_transcriber,artifacts,models}.rs`: recreating the transcribe.cpp session around every run, keeping the text of a decode stopped for repeating itself, dropping segments that echo the prompt and subtitle credits invented at the end of a clip, the GPU failure record per device and driver with Auto falling back to another GPU and then the CPU, and the catalog's pinned files, language lists and language-hint rules), Copyright (c) 2026 Christopher Langton | MIT |
| `packages/design-system/src/{tokens,theme}.css`, `packages/design-system/src/index.ts`, `packages/ui` component styles | Colour, elevation, radius and type values from the "opencode" theme of [anomalyco/rune](https://github.com/anomalyco/rune) at `386b2fd3`, and component specs from [anomalyco/hex](https://github.com/anomalyco/hex), Copyright (c) 2026 Christopher Langton | MIT |

## Models downloaded on request

Settings › Transcription offers these transcribe.cpp models. They are not shipped with Librelog: each is downloaded from its publisher's Hugging Face repository only when you ask, pinned to the revision, size and SHA-256 below, and used unmodified on your device. Each keeps its own license, which Settings shows with the model.

| Model | License | File (repository at revision) | Attribution |
| --- | --- | --- | --- |
| Whisper large-v3-turbo | MIT (OpenAI's [model card](https://huggingface.co/openai/whisper-large-v3-turbo) at `41f01f3`; the GGUF card says Apache-2.0) | [handy-computer/whisper-large-v3-turbo-gguf](https://huggingface.co/handy-computer/whisper-large-v3-turbo-gguf/tree/d222c9f621c1128299248f2ded4d8a1820519780) `whisper-large-v3-turbo-Q8_0.gguf` | Whisper large-v3-turbo by OpenAI, MIT License. GGUF conversion and Q8_0 quantization by handy-computer for transcribe.cpp. |
| Parakeet TDT 0.6B v3 | CC-BY-4.0 | [handy-computer/parakeet-tdt-0.6b-v3-gguf](https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v3-gguf/tree/85ac09ea12fc4b1112fa76810059364bc6adc9de) `parakeet-tdt-0.6b-v3-Q8_0.gguf` | Parakeet TDT 0.6B v3 by NVIDIA, licensed under CC BY 4.0. Converted to GGUF and quantized to Q8_0 by handy-computer; the weights were not retrained. |
| Parakeet Ultra | CC-BY-4.0 | [handy-computer/parakeet-ultra-gguf](https://huggingface.co/handy-computer/parakeet-ultra-gguf/tree/a1539be1b849ea7463b88343e5277b373d0c4ea9) `parakeet-ultra-Q8_0.gguf` | Parakeet Ultra by Moondream, based on NVIDIA Parakeet TDT 0.6B v3. GGUF conversion and quantization by handy-computer. Creative Commons Attribution 4.0 International (CC BY 4.0). |
| Qwen3-ASR 0.6B | Apache-2.0 | [handy-computer/Qwen3-ASR-0.6B-gguf](https://huggingface.co/handy-computer/Qwen3-ASR-0.6B-gguf/tree/e4e16599b900eb0cb36e524514756bb92eb092b7) `Qwen3-ASR-0.6B-Q8_0.gguf` | Qwen3-ASR 0.6B by the Qwen team, Alibaba Cloud, licensed under the Apache License 2.0. GGUF conversion by handy-computer. |
| Cohere Transcribe (03-2026) | Apache-2.0 | [handy-computer/cohere-transcribe-03-2026-gguf](https://huggingface.co/handy-computer/cohere-transcribe-03-2026-gguf/tree/dfa4adebb64f3076b7b6b90b721275cc069cb421) `cohere-transcribe-03-2026-Q8_0.gguf` | Cohere Transcribe (03-2026) by Cohere Labs, licensed under the Apache License 2.0. GGUF conversion by handy-computer. |
| GigaAM v3 (e2e RNN-T) | MIT | [handy-computer/gigaam-v3-e2e-rnnt-gguf](https://huggingface.co/handy-computer/gigaam-v3-e2e-rnnt-gguf/tree/3efd5b39882ceadca5570a8fb9fa1a2c801d6d6d) `gigaam-v3-e2e-rnnt-Q8_0.gguf` | GigaAM v3 (e2e RNN-T) by the GigaChat Team, MIT License, Copyright (c) 2024 GigaChat Team. GGUF conversion by handy-computer. |
| NB-Whisper Medium | Apache-2.0 | [NbAiLab/nb-whisper-medium](https://huggingface.co/NbAiLab/nb-whisper-medium/tree/0ed074d5985bd56ca4140159a9dbffbc3fb5117e) `ggml-model-q5_0.bin` | NB-Whisper Medium by the National Library of Norway, licensed under the Apache License 2.0, fine-tuned from OpenAI Whisper medium (MIT). whisper.cpp file published by NbAiLab. |
| ivrit.ai Whisper large-v3-turbo | Apache-2.0 | [adolan/ivrit-whisper-large-v3-turbo-gguf](https://huggingface.co/adolan/ivrit-whisper-large-v3-turbo-gguf/tree/a12befaff80add995ac6a8fe10cbb7f38438c7b5) `ivrit-whisper-large-v3-turbo-Q8_0.gguf` | ivrit.ai Whisper large-v3-turbo by ivrit.ai, licensed under the Apache License 2.0, fine-tuned from OpenAI Whisper large-v3-turbo (MIT). GGUF conversion by adolan. |
| Nemotron 3.5 ASR Streaming 0.6B | OpenMDW-1.1 (`LICENSE` in the repository) | [handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf](https://huggingface.co/handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/tree/53ce288f69326b415aeef030cfcb02a08a8096dd) `nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf` | Nemotron 3.5 ASR Streaming 0.6B by NVIDIA, licensed under OpenMDW-1.1. Converted to GGUF and quantized to Q8_0 by handy-computer; the weights were not retrained. |

Settings › Intelligence › Built-in models offers these language models, on the same terms: downloaded from the publisher's own repository only when you ask, pinned to the revision, size and SHA-256 below, and run unmodified by the bundled llama.cpp server.

| Model | License | File (repository at revision) | Attribution |
| --- | --- | --- | --- |
| Qwen3 4B | Apache-2.0 (`LICENSE` in the repository) | [Qwen/Qwen3-4B-GGUF](https://huggingface.co/Qwen/Qwen3-4B-GGUF/tree/bc640142c66e1fdd12af0bd68f40445458f3869b) `Qwen3-4B-Q4_K_M.gguf` | Qwen3 4B by the Qwen team, Alibaba Cloud, licensed under the Apache License 2.0. GGUF file published by Qwen. |
| Qwen3 8B | Apache-2.0 (`LICENSE` in the repository) | [Qwen/Qwen3-8B-GGUF](https://huggingface.co/Qwen/Qwen3-8B-GGUF/tree/7c41481f57cb95916b40956ab2f0b139b296d974) `Qwen3-8B-Q4_K_M.gguf` | Qwen3 8B by the Qwen team, Alibaba Cloud, licensed under the Apache License 2.0. GGUF file published by Qwen. |
| Granite 4.0 Micro | Apache-2.0 | [ibm-granite/granite-4.0-micro-GGUF](https://huggingface.co/ibm-granite/granite-4.0-micro-GGUF/tree/ec48475f0c811d812fbfb61975717a9c36eeb652) `granite-4.0-micro-Q4_K_M.gguf` | Granite 4.0 Micro by IBM, licensed under the Apache License 2.0. GGUF file published by IBM Granite. |
| Ministral 3 8B Instruct (2512) | Apache-2.0 | [mistralai/Ministral-3-8B-Instruct-2512-GGUF](https://huggingface.co/mistralai/Ministral-3-8B-Instruct-2512-GGUF/tree/0102285ad796bd99af90f58de616092e5630e970) `Ministral-3-8B-Instruct-2512-Q4_K_M.gguf` | Ministral 3 8B Instruct (2512) by Mistral AI, licensed under the Apache License 2.0. GGUF file published by Mistral AI. |
| Ministral 3 3B Instruct (2512) | Apache-2.0 | [mistralai/Ministral-3-3B-Instruct-2512-GGUF](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF/tree/eb599d408350ea2bb60452cb86be7c7b2fc28227) `Ministral-3-3B-Instruct-2512-Q4_K_M.gguf` | Ministral 3 3B Instruct (2512) by Mistral AI, licensed under the Apache License 2.0. GGUF file published by Mistral AI. |

The catalogs' data lives in `crates/gguf-model/src/catalog.rs` and `crates/local-llm/src/catalog.rs`. SenseVoice Small and Parakeet Unified English are not offered because their licenses restrict how they may be used: SenseVoice Small's FunASR Model License limits it to reference and learning purposes, and Parakeet Unified English comes under the NVIDIA Open Model License, a custom license with its own conditions on use that the project has not been able to review.

## Other material

- `patches/` holds changes to npm packages. Each patch stays under the license of the package it modifies.
- Company and product logos in `apps/desktop/public/assets` identify the services they represent. They remain trademarks of their owners and are not covered by the MIT License.

## License texts

The desktop app bundles this file, `LICENSE`, and the full license texts it requires under `licenses/` in its resources:

- `licenses/MIT.txt`: applies to each MIT-licensed item above, with that item's copyright line.
- `licenses/llama.cpp/`: llama.cpp, ggml and the code built into the bundled llama.cpp server.
- `licenses/Apache-2.0.txt`: Tremor and the code adapted from vercel/ai.
- `licenses/BSD-2-Clause-AudioCap.txt`: code adapted from AudioCap.
- `crates/mp3/LICENSE-LAME.txt`: LAME.
- `crates/export-core/fonts/OFL.txt`, `licenses/OFL-1.1-Inter.txt` and `licenses/OFL-1.1-IBM-Plex-Mono.txt`: Pretendard, Inter and IBM Plex Mono.

The models in "Models downloaded on request" are not distributed with Librelog, so their license texts are not bundled; each row links its license, and Settings shows it with the model.

The WeSpeaker attribution above satisfies CC-BY-4.0, whose full text is at https://creativecommons.org/licenses/by/4.0/legalcode. Licenses of npm and Cargo dependencies are not reproduced here; generate them with a license tool such as `cargo about` before publishing a release.
