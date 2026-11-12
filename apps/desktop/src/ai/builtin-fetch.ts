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

// Room kept for the answer when a request names no limit, as summaries do.
const DEFAULT_ANSWER_RESERVE = 1024;

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
    throw new BuiltinModelError(asLlmError(result.error));
  }
  return result.data;
}

// A build without the plugin (the App Store's) rejects with a plain string.
export function asLlmError(error: unknown): LlmError {
  return typeof error === "object" && error !== null && "kind" in error
    ? (error as LlmError)
    : { kind: "unavailable", message: String(error) };
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
    const origin = new URL(endpoint.baseUrl).origin;
    const url = new URL(requested.pathname + requested.search, origin);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set("Authorization", `Bearer ${endpoint.apiKey}`);

    const chat = parseChatRequest(requested, init?.body);
    if (chat) {
      const promptTokens = await countPromptTokens(
        deps.fetch,
        origin,
        headers,
        chat.body,
        init?.signal ?? undefined,
      );
      const needed =
        promptTokens === null
          ? 0
          : promptTokens + (chat.maxTokens ?? DEFAULT_ANSWER_RESERVE);
      if (needed > endpoint.context) {
        return Response.json(
          {
            error: {
              message: tooLongMessage(needed, endpoint.context),
              type: "exceed_context_size_error",
              n_prompt_tokens: needed,
              n_ctx: endpoint.context,
            },
          },
          { status: 400 },
        );
      }
    }

    const response = await deps.fetch(url, { ...init, headers });
    if (!response.ok) {
      return await explainFailure(response);
    }
    return chat
      ? await guardTruncation(response, endpoint.context, chat.maxTokens)
      : response;
  };
}

function parseChatRequest(url: URL, body: unknown) {
  if (!url.pathname.endsWith("/chat/completions") || typeof body !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(body) as {
      messages?: unknown;
      max_tokens?: unknown;
    };
    if (!Array.isArray(parsed.messages)) {
      return null;
    }
    return {
      body,
      maxTokens:
        typeof parsed.max_tokens === "number" ? parsed.max_tokens : undefined,
    };
  } catch {
    return null;
  }
}

// The server renders the chat template and counts its tokens in
// milliseconds, so a meeting that leaves no room for its summary fails
// before minutes of prompt processing. Any failure skips the check.
async function countPromptTokens(
  fetch: typeof globalThis.fetch,
  origin: string,
  headers: Headers,
  body: string,
  signal: AbortSignal | undefined,
): Promise<number | null> {
  try {
    const template = await fetch(`${origin}/apply-template`, {
      method: "POST",
      headers,
      body,
      signal,
    });
    const { prompt } = template.ok
      ? ((await template.json()) as { prompt?: unknown })
      : {};
    if (typeof prompt !== "string") {
      return null;
    }
    const tokenized = await fetch(`${origin}/tokenize`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: prompt }),
      signal,
    });
    const { tokens } = tokenized.ok
      ? ((await tokenized.json()) as { tokens?: unknown })
      : {};
    return Array.isArray(tokens) ? tokens.length : null;
  } catch {
    return null;
  }
}

// A summary that stopped because the context filled up must not be saved as
// if it were complete. llama.cpp reports `length` both for that and for a
// request's own token limit; the tokens it used tell them apart.
function ranOutOfContext(
  chunk: unknown,
  context: number,
  maxTokens: number | undefined,
): boolean {
  const value = chunk as {
    choices?: Array<{ finish_reason?: unknown }>;
    usage?: { total_tokens?: unknown };
    timings?: { cache_n?: unknown; prompt_n?: unknown; predicted_n?: unknown };
  } | null;
  if (value?.choices?.[0]?.finish_reason !== "length") {
    return false;
  }
  const count = (n: unknown) => (typeof n === "number" ? n : 0);
  const used =
    typeof value.usage?.total_tokens === "number"
      ? value.usage.total_tokens
      : value.timings
        ? count(value.timings.cache_n) +
          count(value.timings.prompt_n) +
          count(value.timings.predicted_n)
        : undefined;
  return used === undefined ? maxTokens === undefined : used >= context;
}

function truncationError() {
  return {
    error: {
      message: tooLongMessage(undefined, undefined),
      type: "exceed_context_size_error",
    },
  };
}

async function guardTruncation(
  response: Response,
  context: number,
  maxTokens: number | undefined,
): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  const init = {
    status: response.status,
    statusText: response.statusText,
    headers,
  };

  if (!headers.get("content-type")?.includes("text/event-stream")) {
    const text = await response.text();
    try {
      if (ranOutOfContext(JSON.parse(text), context, maxTokens)) {
        return Response.json(truncationError(), { status: 400 });
      }
    } catch {}
    return new Response(text, init);
  }
  if (!response.body) {
    return response;
  }

  // The finishing chunk becomes an error event, which the SDK turns into a
  // failed generation instead of a finished one.
  const rewrite = (line: string) => {
    const data = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!data || data === "[DONE]") {
      return line;
    }
    try {
      if (ranOutOfContext(JSON.parse(data), context, maxTokens)) {
        return `data: ${JSON.stringify(truncationError())}`;
      }
    } catch {}
    return line;
  };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        pending += decoder.decode();
        if (pending) {
          controller.enqueue(encoder.encode(rewrite(pending)));
        }
        controller.close();
        return;
      }
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      if (lines.length > 0) {
        controller.enqueue(
          encoder.encode(`${lines.map(rewrite).join("\n")}\n`),
        );
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(body, init);
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
      return t`This Mac needs its memory for transcription while it records and transcribes a meeting. The built-in model starts once that is done.`;
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
