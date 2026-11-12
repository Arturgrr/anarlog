import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import type { ProviderId } from "./shared";

export const STT_PROVIDER_CONTEXT: Partial<
  Record<ProviderId, MessageDescriptor>
> = {
  soniqo: msg`Runs entirely on your Mac. Audio never leaves this computer.`,
  apple_speech: msg`Uses the speech recognition built into macOS. Audio stays on this Mac.`,
  gguf: msg`Download an open speech model and run it with transcribe.cpp on this computer, so audio never leaves it. During a meeting, text appears a minute at a time; the full transcript follows after the recording. Models download from Hugging Face only when you ask, under the license shown with each.`,
  local_file: msg`Use a whisper.cpp \`.bin\` or GGUF \`.gguf\` model file you already have. It runs on this computer after each recording.`,
  inworld: msg`Use [Inworld Realtime STT](https://docs.inworld.ai/stt/overview) for live transcription. Paste the Base64 API credentials from Inworld Portal as-is; do not encode them again.`,
  gradium: msg`Use [Gradium STT](https://docs.gradium.ai/guides/speech-to-text) for live transcription in English, French, Spanish, Portuguese, or German.`,
  modulate: msg`Use [Modulate](https://docs.modulate.ai/get-started/stt) for live transcription. The multilingual model supports 25 European languages; the English model supports English only. Speaker labels identify up to four speakers with the multilingual model.`,
  alebex: msg`Use [Alebex STT](https://www.alebex.ai/models-speech-to-text) with the speech-to-text token from your developer account.`,
  nvidia: msg`Connect to your [NVIDIA Speech NIM](https://docs.nvidia.com/nim/speech/latest/get-started/tutorials/asr.html) WebSocket server, for example \`http://localhost:9000\`. Choose the model served by your deployment. The API key is optional for servers without authentication. This requires a deployed NIM server; NVIDIA's hosted gRPC endpoint is not supported here.`,
  amazon_bedrock: msg`Enter an OpenAI-compatible transcription gateway URL and its token. The gateway must expose \`/audio/transcriptions\` and translate file audio into Nova Sonic's AWS bidirectional stream. Native Bedrock endpoints and Bedrock API keys do not work here.`,
  deepgram: msg`Use [Deepgram](https://deepgram.com) for transcriptions. If you want to use a [Dedicated](https://developers.deepgram.com/reference/custom-endpoints#deepgram-dedicated-endpoints) or [EU](https://developers.deepgram.com/reference/custom-endpoints#eu-endpoints) endpoint, or a Deepgram-compatible server on this computer or your local network, you can do that in the **advanced** section.`,
  soniox: msg`Use [Soniox](https://soniox.com) for transcriptions.`,
  assemblyai: msg`Use [AssemblyAI](https://www.assemblyai.com) for transcriptions.`,
  gladia: msg`Use [Gladia](https://www.gladia.io) for transcriptions.`,
  openai: msg`Use [OpenAI](https://openai.com) for transcriptions.`,
  openrouter: msg`Use [OpenRouter](https://openrouter.ai) to transcribe with supported speech-to-text models through one API key. OpenRouter transcription runs after recording.`,
  dashscope: msg`Use Alibaba Cloud Model Studio's Qwen ASR for **live transcription**. The default endpoint is the Singapore region; change it under Advanced when your API key belongs to another region.`,
  zai: msg`Use [Z.AI GLM ASR](https://docs.z.ai/guides/audio/glm-asr-2512) for batch transcription. Librelog automatically splits recordings to fit Z.AI's 30-second upload limit.`,
  siliconflow: msg`Use [SiliconFlow](https://docs.siliconflow.com/en/api-reference/audio/create-audio-transcriptions) for batch transcription. The default endpoint is the international service; use \`https://api.siliconflow.cn/v1\` under Advanced for a China-region API key.`,
  cloudflare_workers_ai: msg`Use a [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) endpoint that exposes Deepgram-compatible Nova-3 transcription.`,
  mistral: msg`Use [Mistral](https://mistral.ai) for transcriptions. Keep the Base URL as \`https://api.mistral.ai/v1\` (change it under Advanced if you pasted a transcriptions endpoint). **Voxtral Mini Transcribe 2** transcribes after recording; the realtime model is for live captions.`,
  cohere: msg`Use [Cohere Transcribe](https://docs.cohere.com/docs/transcribe) for batch transcription. Files must be 25 MB or smaller and use one selected language. Cohere does not return timestamps or speaker labels, so Librelog estimates word timing.`,
  google_generative_ai: msg`Use [Gemini 3.5 Transcribe](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-5-transcribe/) with a Google AI Studio API key. **3.5 Transcribe Live** captions during recording (preview sessions last up to 10 minutes). **3.5 Transcribe** runs after recording with speaker labels and word timestamps; Librelog splits files past 15 minutes.`,
  google_cloud: msg`Use [Google Cloud Speech-to-Text](https://cloud.google.com/speech-to-text) to transcribe after recording. Long recordings are split automatically and combined into one transcript. Paste an OAuth access token in the API key field; refresh it when it expires.`,
  azure_speech: msg`Use [Azure AI Speech](https://learn.microsoft.com/azure/ai-services/speech-service/rest-speech-to-text) fast transcription. Enter the regional Speech resource endpoint as the Base URL and its subscription key as the API key.`,
  aws_transcribe: msg`Amazon Transcribe's native file API requires SigV4 plus an S3 object. Enter an OpenAI-compatible gateway URL that performs that AWS authentication and upload, then paste the gateway token as the API key.`,
  speechmatics: msg`Use [Speechmatics](https://docs.speechmatics.com/speech-to-text/batch/quickstart) enhanced batch transcription. The default endpoint uses the EU region and can be changed under Advanced.`,
  revai: msg`Use [Rev AI](https://docs.rev.ai/api/asynchronous/get-started) asynchronous transcription. Librelog uploads the recording, waits for the job, and retrieves word timestamps and speaker labels.`,
  custom: msg`Point this at any **Deepgram-compatible** endpoint, including a server on this computer or your local network.`,
};
