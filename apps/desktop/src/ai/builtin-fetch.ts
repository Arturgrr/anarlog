import { t } from "@lingui/core/macro";

import {
  commands,
  type Endpoint,
  type LlmError,
  type LlmModel,
} from "@anlg/plugin-local-llm";

import { providerFetch } from "./provider-fetch";

// The SDK needs a base URL; each request goes to the server the app starts,
// whose port and key change with every launch.
export const BUILTIN_PLACEHOLDER_BASE_URL = "http://127.0.0.1/v1";

export class BuiltinModelError extends Error {
  readonly kind: LlmError["kind"];

  constructor(error: LlmError) {
    super(builtinErrorMessage(error));
    this.name = "BuiltinModelError";
    this.kind = error.kind;
  }
}

export async function ensureBuiltinServer(model: string): Promise<Endpoint> {
  const result = await commands.ensureServer(model as LlmModel);
  if (result.status === "error") {
    throw new BuiltinModelError(result.error);
  }
  return result.data;
}

export function createBuiltinFetch(
  model: string,
  deps: {
    ensureServer: (model: string) => Promise<Endpoint>;
    fetch: typeof fetch;
  } = { ensureServer: ensureBuiltinServer, fetch: providerFetch },
): typeof fetch {
  return async (input, init) => {
    const endpoint = await deps.ensureServer(model);
    const requested = new URL(
      input instanceof Request ? input.url : String(input),
    );
    const url = new URL(
      requested.pathname + requested.search,
      new URL(endpoint.baseUrl).origin,
    );
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set("Authorization", `Bearer ${endpoint.apiKey}`);

    const response = await deps.fetch(url, { ...init, headers });
    return response.ok ? response : await explainFailure(response);
  };
}

// The app sends a whole transcript in one request. When it does not fit the
// model's context, say so instead of llama.cpp's token arithmetic.
async function explainFailure(response: Response): Promise<Response> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const error = (body as { error?: Record<string, unknown> } | undefined)
    ?.error;
  const message =
    error?.type === "exceed_context_size_error"
      ? tooLongMessage(error.n_prompt_tokens, error.n_ctx)
      : undefined;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(
    message ? JSON.stringify({ error: { ...error, message } }) : text,
    { status: response.status, statusText: response.statusText, headers },
  );
}

function tooLongMessage(prompt: unknown, context: unknown): string {
  if (typeof prompt === "number" && typeof context === "number") {
    return t`This meeting is too long for this model: it needs ${prompt} tokens and the model holds ${context} on this computer. Built-in models read the whole meeting at once, so choose a cloud model or a computer with more memory for meetings this long.`;
  }
  return t`This meeting is too long for this model. Built-in models read the whole meeting at once, so choose a cloud model or a computer with more memory for meetings this long.`;
}

export function builtinErrorMessage(error: LlmError): string {
  switch (error.kind) {
    case "unavailable":
      return t`Built-in models aren’t available in this version of Librelog.`;
    case "intelligence_disabled":
      return t`Intelligence is turned off by your organization.`;
    case "not_downloaded":
      return t`This built-in model isn’t downloaded. Download it in Settings › Intelligence.`;
    case "too_large":
      return t`This model needs more memory than this computer has. Choose a smaller built-in model.`;
    case "capture_active":
      return t`This Mac needs its memory for transcription while it records. The built-in model starts after the recording ends.`;
    case "gave_up":
      return t`The built-in model failed to start three times in a row. Open Settings › Intelligence to try again.`;
    case "start_failed":
      return t`The built-in model couldn’t start: ${error.message}`;
    case "disk_space":
      return t`There isn’t enough free disk space for this model.`;
    default:
      return error.message;
  }
}
