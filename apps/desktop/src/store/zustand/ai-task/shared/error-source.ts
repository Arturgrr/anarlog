import type { LanguageModel } from "ai";

export type AIErrorSource =
  | { kind: "provider"; provider?: string }
  | { kind: "openrouter" }
  | { kind: "upstream" };

const SOURCE_KEY = "aiErrorSource";

// Direct providers accept custom base URLs, so only name a provider when the
// failing request actually went to its API host.
const PROVIDER_HOSTS: ReadonlyArray<[RegExp, string]> = [
  [/(^|\.)anthropic\.com$/, "Anthropic"],
  [/(^|\.)openai\.com$/, "OpenAI"],
  [/(^|\.)chatgpt\.com$/, "OpenAI"],
  [/(^|\.)googleapis\.com$/, "Google"],
  [/(^|\.)azure\.com$/, "Azure OpenAI"],
];

export function getModelProviderId(model: LanguageModel): string {
  const provider =
    typeof model !== "string" && typeof model.provider === "string"
      ? model.provider
      : "";
  return provider.split(".", 1)[0];
}

export function getAIErrorSource(error: unknown): AIErrorSource | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  const source = error[SOURCE_KEY];
  return isAIErrorSource(source) ? source : undefined;
}

export function withAIErrorSource<E extends Error>(
  error: E,
  source: AIErrorSource | undefined,
): E {
  if (source) {
    Object.defineProperty(error, SOURCE_KEY, {
      value: source,
      enumerable: false,
      configurable: true,
    });
  }
  return error;
}

export function streamStallSource(
  providerId: string,
): AIErrorSource | undefined {
  return providerId === "openrouter" ? { kind: "upstream" } : undefined;
}

export function attributeAIError(
  error: unknown,
  providerId: string,
): AIErrorSource | undefined {
  const existing = getAIErrorSource(error);
  if (existing) {
    return existing;
  }

  const apiError = asAPICallError(error);
  // Provider SDKs surface mid-stream failures as plain error payloads.
  const isStreamPayload =
    !apiError && isRecord(error) && !(error instanceof Error);
  if (!apiError && !isStreamPayload) {
    return undefined;
  }

  if (providerId !== "openrouter") {
    const provider = providerFromUrl(apiError?.url);
    return provider ? { kind: "provider", provider } : undefined;
  }

  const payload = apiError
    ? (apiError.data ?? parseJson(apiError.responseBody))
    : error;
  const providerName = openRouterProviderName(payload);
  if (providerName) {
    return { kind: "provider", provider: providerName };
  }

  return { kind: "openrouter" };
}

type APICallErrorLike = {
  url?: string;
  responseBody?: string;
  data?: unknown;
};

function asAPICallError(error: unknown): APICallErrorLike | undefined {
  if (!(error instanceof Error) || error.name !== "AI_APICallError") {
    return undefined;
  }
  return error as Error & APICallErrorLike;
}

function providerFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    const { hostname } = new URL(url);
    return PROVIDER_HOSTS.find(([host]) => host.test(hostname))?.[1];
  } catch {
    return undefined;
  }
}

function openRouterErrorBody(payload: unknown) {
  if (!isRecord(payload)) {
    return undefined;
  }
  const inner = isRecord(payload.error) ? payload.error : payload;
  return typeof inner.message === "string" ? inner : undefined;
}

function openRouterProviderName(payload: unknown): string | undefined {
  const body = openRouterErrorBody(payload);
  const metadata = body?.metadata;
  if (!isRecord(metadata)) {
    return undefined;
  }
  const name = metadata.provider_name;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

function parseJson(value: string | undefined): unknown {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAIErrorSource(value: unknown): value is AIErrorSource {
  if (!isRecord(value)) {
    return false;
  }
  switch (value.kind) {
    case "provider":
      return value.provider === undefined || typeof value.provider === "string";
    case "openrouter":
    case "upstream":
      return true;
    default:
      return false;
  }
}
