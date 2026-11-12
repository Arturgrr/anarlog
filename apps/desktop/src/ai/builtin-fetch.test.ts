import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { describe, expect, it, vi } from "vitest";

import type { Endpoint } from "@anlg/plugin-local-llm";

import {
  BUILTIN_PLACEHOLDER_BASE_URL,
  BuiltinModelError,
  createBuiltinFetch,
} from "./builtin-fetch";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

const endpoint: Endpoint = {
  baseUrl: "http://127.0.0.1:41234/v1",
  apiKey: "per-launch-key",
  model: "qwen3-4b",
  context: 32768,
};

describe("createBuiltinFetch", () => {
  it("sends the request to the running server with its key", async () => {
    const ensureServer = vi.fn().mockResolvedValue(endpoint);
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    const controller = new AbortController();

    const response = await createBuiltinFetch("qwen3-4b", {
      ensureServer,
      fetch,
    })("http://127.0.0.1/v1/chat/completions?stream=1", {
      method: "POST",
      body: '{"model":"qwen3-4b"}',
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });

    expect(ensureServer).toHaveBeenCalledWith("qwen3-4b");
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(
      "http://127.0.0.1:41234/v1/chat/completions?stream=1",
    );
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer per-launch-key");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init.body).toBe('{"model":"qwen3-4b"}');
    expect(init.signal).toBe(controller.signal);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("fails without a request when the server cannot start", async () => {
    const error = new BuiltinModelError({
      kind: "capture_active",
      message: "recording",
    });
    const fetch = vi.fn();

    await expect(
      createBuiltinFetch("qwen3-4b", {
        ensureServer: vi.fn().mockRejectedValue(error),
        fetch,
      })("http://127.0.0.1/v1/chat/completions"),
    ).rejects.toMatchObject({ kind: "capture_active" });
    expect(fetch).not.toHaveBeenCalled();
  });

  // The whole transcript goes in one request; past the context llama.cpp
  // answers 400 with token counts, which the app explains instead.
  it("explains a meeting that does not fit the context", async () => {
    const overflow = Response.json(
      {
        error: {
          code: 400,
          message:
            "request (50000 tokens) exceeds the available context size (32768 tokens), try increasing it",
          type: "exceed_context_size_error",
          n_prompt_tokens: 50000,
          n_ctx: 32768,
        },
      },
      { status: 400 },
    );

    const response = await createBuiltinFetch("qwen3-4b", {
      ensureServer: vi.fn().mockResolvedValue(endpoint),
      fetch: vi.fn().mockResolvedValue(overflow),
    })("http://127.0.0.1/v1/chat/completions");

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.type).toBe("exceed_context_size_error");
    expect(body.error.message).toMatch(/too long for this model/);
    expect(body.error.message).toMatch(/50000/);
  });

  // A summary cut off because the context filled up was saved as a finished
  // note; it must fail the generation instead.
  it("fails a summary that ran out of context instead of finishing it", async () => {
    const sse = [
      {
        choices: [
          { index: 0, delta: { role: "assistant", content: "## Decisions" } },
        ],
      },
      {
        choices: [{ index: 0, delta: {}, finish_reason: "length" }],
        timings: { cache_n: 0, prompt_n: 31000, predicted_n: 1768 },
      },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join("")
      .concat("data: [DONE]\n\n");
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/apply-template") {
        return Response.json({ prompt: "<|im_start|>user …" });
      }
      if (path === "/tokenize") {
        return Response.json({ tokens: new Array(31000).fill(1) });
      }
      return new Response(sse, {
        headers: { "content-type": "text/event-stream" },
      });
    });
    const model = createOpenAICompatible({
      name: "builtin",
      baseURL: BUILTIN_PLACEHOLDER_BASE_URL,
      fetch: createBuiltinFetch("qwen3-4b", {
        ensureServer: vi.fn().mockResolvedValue(endpoint),
        fetch,
      }),
    }).chatModel("qwen3-4b");

    const parts = [];
    for await (const part of streamText({ model, prompt: "Summarize" })
      .fullStream) {
      parts.push(part);
    }

    expect(parts.find(({ type }) => type === "finish")).toMatchObject({
      finishReason: "error",
    });
    expect(parts.find(({ type }) => type === "error")).toMatchObject({
      error: expect.stringMatching(/too long for this model/),
    });
  });

  it("refuses a meeting that leaves no room for the summary before generating", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/apply-template") {
        return Response.json({ prompt: "transcript" });
      }
      if (path === "/tokenize") {
        return Response.json({ tokens: new Array(32000).fill(1) });
      }
      throw new Error(`unexpected request to ${path}`);
    });

    const response = await createBuiltinFetch("qwen3-4b", {
      ensureServer: vi.fn().mockResolvedValue(endpoint),
      fetch,
    })("http://127.0.0.1/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "qwen3-4b", messages: [] }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toMatch(/33024 tokens/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
