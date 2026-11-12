import { describe, expect, it, vi } from "vitest";

import type { Endpoint } from "@anlg/plugin-local-llm";

import { BuiltinModelError, createBuiltinFetch } from "./builtin-fetch";

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
});
