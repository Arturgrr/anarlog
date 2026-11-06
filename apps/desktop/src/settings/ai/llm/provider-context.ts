import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import type { ProviderId } from "./shared";

import { ISSUES_URL } from "~/shared/links";

const workersAiBaseUrl =
  "`https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1`";

export const LLM_PROVIDER_CONTEXT: Partial<
  Record<ProviderId, MessageDescriptor>
> = {
  claude: msg`Uses your **Claude Pro or Max** plan. Sign in through Connect — no Anthropic API key needed.`,
  chatgpt: msg`Uses your **ChatGPT Plus or Pro** plan. Sign in through Connect — we'll finish the handshake automatically.`,
  grok: msg`Uses your **SuperGrok or X Premium+** plan through xAI's subscription login.`,
  github_copilot: msg`Uses your **GitHub Copilot** plan. Approve the device code in the browser to connect.`,
  kimi_code: msg`Uses your **Kimi Code** membership. Paste the coding API key from the Kimi Code console.`,
  apple_foundation: msg`- Uses Apple's on-device **System Language Model**.
- Requires macOS 26 or later, a Mac that supports Apple Intelligence, and Apple Intelligence turned on.
- This experiment is text-only and works best with shorter transcripts.`,
  lmstudio: msg`- Ensure LM Studio server is **running.** (Default port is 1234)
- Enable **CORS** in LM Studio config.`,
  ollama: msg`- Ensure Ollama is **running** (\`ollama serve\`)
- Pull a model first (\`ollama pull llama3.2\`)`,
  unsloth: msg`- Ensure the Unsloth server is **running.** (Default port is 8888)
- Paste the API key from Unsloth. It starts with \`sk-unsloth-\`.
- Only models **loaded** in Unsloth show up in the list.`,
  custom: msg`We only support **OpenAI-compatible** endpoints for now.`,
  openrouter: msg`Librelog hides models without **tool support** or text input. Turn on **Show ignored models** to see them.`,
  openai: msg`Paste an **API key** to pay as you go.`,
  anthropic: msg`Paste an **API key** to pay as you go.`,
  xai: msg`Paste an **API key** to pay as you go.`,
  moonshot: msg`Paste a Moonshot **API key**. The default endpoint is the international service and can be changed under Advanced.`,
  zai: msg`Uses Z.AI's **OpenAI-compatible GLM API**. The default endpoint is the international service and can be changed under Advanced.`,
  alibaba_cloud: msg`Uses Alibaba Cloud Model Studio's **OpenAI-compatible API**. The default endpoint is the Singapore region; change the Base URL under Advanced when your API key belongs to another region.`,
  siliconflow: msg`Uses SiliconFlow's **OpenAI-compatible API**. The default endpoint is the international service; use \`https://api.siliconflow.cn/v1\` under Advanced for a China-region API key.`,
  azure_openai: msg`Enter your **Azure OpenAI endpoint** (e.g. \`https://your-resource.openai.azure.com\`) as the Base URL and your **API key**. [Report issues](${ISSUES_URL})`,
  azure_ai: msg`Enter your **Azure AI Foundry endpoint** as the Base URL and your **API key**. Supports Claude and other models deployed via Azure AI Foundry. [Report issues](${ISSUES_URL})`,
  google_generative_ai: msg`Visit [AI Studio](https://aistudio.google.com/api-keys) to create an API key.`,
  amazon_bedrock: msg`Enter the regional **Bedrock Mantle OpenAI-compatible URL** (for example, \`https://bedrock-mantle.us-east-1.api.aws/v1\`) and a Bedrock long-term API key.`,
  google_vertex_ai: msg`Enter your project and location's **Vertex AI OpenAI-compatible endpoint** and a bearer access token. Vertex access tokens expire, so replace the saved token when Google Cloud refreshes it.`,
  cloudflare_workers_ai: msg`Enter the Workers AI **OpenAI-compatible base URL** as ${workersAiBaseUrl} and use a Cloudflare API token with Workers AI access.`,
};
