import { describe, expect, test, vi } from "vitest";

import type { LlmModelEntry } from "@anlg/plugin-local-llm";

import { PROVIDERS } from "./shared";
import { getLlmProviderStatus } from "./status";

import { SUBSCRIPTION_BADGE } from "~/settings/ai/shared/provider-labels";

const builtinCatalog = vi.hoisted(() => ({
  entries: [] as LlmModelEntry[],
}));

vi.mock("@anlg/plugin-local-llm", () => ({
  commands: {
    listModels: async () => ({ status: "ok", data: builtinCatalog.entries }),
  },
}));

function catalogEntry(
  id: LlmModelEntry["id"],
  downloaded: boolean,
  fit: LlmModelEntry["admission"]["fit"],
): LlmModelEntry {
  return {
    id,
    displayName: id,
    sizeBytes: 1,
    contextLength: 40960,
    license: { name: "Apache License 2.0", url: "https://x", attribution: "" },
    sourceUrl: "https://huggingface.co",
    downloaded,
    downloading: false,
    admission: {
      fit,
      context: fit === "tooLarge" ? null : 8192,
      estimateBytes: 1,
    },
    best: false,
    default: false,
  };
}

function provider(id: string) {
  const provider = PROVIDERS.find((p) => p.id === id);
  if (!provider) {
    throw new Error(`Provider not found: ${id}`);
  }
  return provider;
}

describe("getLlmProviderStatus", () => {
  test("does not configure API-key providers without a saved key", () => {
    const status = getLlmProviderStatus({
      provider: provider("openai"),
      config: { api_key: "" },
    });

    expect(status.configured).toBe(false);
    expect(status.listModels).toBeUndefined();
  });

  test("configures API-key providers only after their saved key is verified", () => {
    const status = getLlmProviderStatus({
      provider: provider("openai"),
      config: { api_key: "sk-test" },
      isAvailable: true,
    });

    expect(status.configured).toBe(true);
    expect(status.listModels).toBeTypeOf("function");
  });

  test.each([undefined, false])(
    "does not expose a saved but unverified key (%s)",
    (isAvailable) => {
      const status = getLlmProviderStatus({
        provider: provider("openai"),
        config: { api_key: "nonempty-invalid-key" },
        isAvailable,
      });
      expect(status.configured).toBe(false);
      expect(status.listModels).toBeUndefined();
    },
  );

  test.each(["claude", "chatgpt", "grok", "github_copilot", "kimi_code"])(
    "treats %s as a subscription provider that needs a saved credential",
    (id) => {
      const definition = provider(id);
      const missing = getLlmProviderStatus({
        provider: definition,
        config: { api_key: "" },
      });
      const configured = getLlmProviderStatus({
        provider: definition,
        config: {
          api_key: '{"type":"oauth","refresh":"r","access":"a","expires":1}',
        },
      });

      expect(definition.authKind).toBe("subscription");
      expect(definition.badge).toBe(SUBSCRIPTION_BADGE);
      expect(missing.configured).toBe(false);
      expect(configured.configured).toBe(true);
      expect(configured.listModels).toBeTypeOf("function");
    },
  );

  test("routes ChatGPT subscriptions through the Codex backend", () => {
    expect(provider("chatgpt").baseUrl).toBe(
      "https://chatgpt.com/backend-api/codex",
    );
  });

  test.each([
    ["moonshot", "https://api.moonshot.ai/v1"],
    ["zai", "https://api.z.ai/api/paas/v4"],
    ["deepseek", "https://api.deepseek.com"],
    ["alibaba_cloud", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"],
    ["siliconflow", "https://api.siliconflow.com/v1"],
    ["cohere", "https://api.cohere.ai/compatibility/v1"],
    ["groq", "https://api.groq.com/openai/v1"],
    ["xai", "https://api.x.ai/v1"],
    ["together", "https://api.together.xyz/v1"],
    ["meta", "https://api.meta.ai/v1"],
    ["fireworks", "https://api.fireworks.ai/inference/v1"],
    ["cerebras", "https://api.cerebras.ai/v1"],
  ])("configures %s through its OpenAI-compatible endpoint", (id, baseUrl) => {
    const definition = provider(id);
    const status = getLlmProviderStatus({
      provider: definition,
      config: { api_key: "test-key" },
      isAvailable: true,
    });

    expect(definition.baseUrl).toBe(baseUrl);
    expect(status.configured).toBe(true);
    expect(status.listModels).toBeTypeOf("function");
  });

  test.each(["amazon_bedrock", "google_vertex_ai"])(
    "requires both an endpoint and credentials for %s",
    (id) => {
      const definition = provider(id);
      const missingEndpoint = getLlmProviderStatus({
        provider: definition,
        config: { api_key: "test-key" },
        isAvailable: true,
      });
      const configured = getLlmProviderStatus({
        provider: definition,
        config: {
          base_url: "https://provider.example.com/v1",
          api_key: "test-key",
        },
        isAvailable: true,
      });

      expect(missingEndpoint.configured).toBe(false);
      expect(configured.configured).toBe(true);
      expect(configured.listModels).toBeTypeOf("function");
    },
  );

  test("uses curated models for Google Vertex AI", async () => {
    const status = getLlmProviderStatus({
      provider: provider("google_vertex_ai"),
      config: {
        base_url:
          "https://aiplatform.googleapis.com/v1/projects/project/locations/global/endpoints/openapi",
        api_key: "test-key",
      },
      isAvailable: true,
    });

    const result = await status.listModels?.();

    expect(result?.models.slice(0, 3)).toEqual([
      "google/gemini-3.8-flash",
      "google/gemini-3.7-flash",
      "google/gemini-3.6-flash",
    ]);
  });

  // A model not yet downloaded, or one this computer cannot load, must not
  // become the selection.
  test("offers only downloaded built-in models that fit this computer", async () => {
    builtinCatalog.entries = [
      catalogEntry("qwen3-4b", true, "fits"),
      catalogEntry("qwen3-8b", false, "fits"),
      catalogEntry("granite-4.0-micro", true, "tight"),
      catalogEntry("ministral-3-8b", true, "tooLarge"),
    ];
    const status = getLlmProviderStatus({
      provider: provider("builtin"),
      isAvailable: true,
    });

    const result = await status.listModels?.();

    expect(result?.models).toEqual(["qwen3-4b", "granite-4.0-micro"]);
  });

  test.each(["ollama", "lmstudio", "apple_foundation", "builtin"])(
    "only configures %s when its runtime is reachable, without an API key",
    (id) => {
      const pending = getLlmProviderStatus({
        provider: provider(id),
      });
      const unavailable = getLlmProviderStatus({
        provider: provider(id),
        isAvailable: false,
      });
      const available = getLlmProviderStatus({
        provider: provider(id),
        isAvailable: true,
      });

      expect(pending.configured).toBe(false);
      expect(pending.availabilityPending).toBe(true);
      expect(unavailable.configured).toBe(false);
      expect(unavailable.availabilityPending).toBeUndefined();
      expect(unavailable.listModels).toBeUndefined();
      expect(available.configured).toBe(true);
      expect(available.availabilityPending).toBeUndefined();
      expect(available.listModels).toBeTypeOf("function");
    },
  );
});
