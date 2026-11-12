import { describe, expect, test } from "vitest";

import {
  rankModelsForLanguages,
  recommendOnDeviceModel,
} from "./on-device-recommendation";

const GIB = 1024 * 1024 * 1024;
const models = [
  { id: "small", recommendedMemoryBytes: 8 * GIB },
  { id: "large", recommendedMemoryBytes: 16 * GIB },
];

describe("recommendOnDeviceModel", () => {
  test("chooses the most capable model that fits the available memory", () => {
    expect(recommendOnDeviceModel(models, 8 * GIB)).toBe("small");
    expect(recommendOnDeviceModel(models, 16 * GIB)).toBe("large");
    expect(recommendOnDeviceModel(models, 32 * GIB)).toBe("large");
  });

  test("uses the lightest model when memory is unknown or below the minimum", () => {
    expect(recommendOnDeviceModel(models)).toBe("small");
    expect(recommendOnDeviceModel(models, 4 * GIB)).toBe("small");
  });

  test("keeps source order when models have the same memory requirement", () => {
    expect(
      recommendOnDeviceModel(
        [
          { id: "first", recommendedMemoryBytes: 8 * GIB },
          { id: "second", recommendedMemoryBytes: 8 * GIB },
        ],
        16 * GIB,
      ),
    ).toBe("first");
  });

  test("returns null when the provider has no available models", () => {
    expect(recommendOnDeviceModel([], 16 * GIB)).toBeNull();
  });
});

describe("rankModelsForLanguages", () => {
  const EUROPEAN = ["en", "pt", "de", "es", "fr"];
  const catalog = [
    { id: "gguf-whisper-large-v3-turbo", languages: ["*"] },
    { id: "gguf-qwen3-asr-0.6b", languages: ["zh", "en", "pt", "ja"] },
    { id: "gguf-gigaam-v3", languages: ["ru"] },
    { id: "gguf-parakeet-tdt-0.6b-v3", languages: EUROPEAN },
  ];

  test("puts Parakeet v3, then Whisper turbo, first for Portuguese", () => {
    expect(rankModelsForLanguages(catalog, ["pt-BR"])).toEqual({
      recommended: "gguf-parakeet-tdt-0.6b-v3",
      order: [
        "gguf-parakeet-tdt-0.6b-v3",
        "gguf-whisper-large-v3-turbo",
        "gguf-qwen3-asr-0.6b",
        "gguf-gigaam-v3",
      ],
    });
  });

  test("skips a pick that does not cover every spoken language", () => {
    expect(rankModelsForLanguages(catalog, ["pt", "ja"]).recommended).toBe(
      "gguf-whisper-large-v3-turbo",
    );
  });
});
