import { Effect, pipe, Schema } from "effect";

import {
  DEFAULT_RESULT,
  listModelsFailure,
  fetchJson,
  isDateSnapshot,
  isNonChatModel,
  isOldModel,
  type ListModelsResult,
  type ModelIgnoreReason,
  partition,
  REQUEST_TIMEOUT,
  shouldIgnoreCommonKeywords,
  sortModelsByRecency,
} from "./list-common";

const GoogleModelSchema = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      supportedGenerationMethods: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
});

type GoogleModel = Schema.Schema.Type<
  typeof GoogleModelSchema
>["models"][number];

export async function listGoogleModels(
  baseUrl: string,
  apiKey: string,
): Promise<ListModelsResult> {
  if (!baseUrl) {
    return DEFAULT_RESULT;
  }

  const supportsGeneration = (model: GoogleModel): boolean =>
    !model.supportedGenerationMethods ||
    model.supportedGenerationMethods.includes("generateContent");

  const extractModelId = (model: GoogleModel): string => {
    return model.name.replace(/^models\//, "");
  };

  const getIgnoreReasons = (model: GoogleModel): ModelIgnoreReason[] | null => {
    const reasons: ModelIgnoreReason[] = [];
    if (shouldIgnoreCommonKeywords(model.name)) {
      reasons.push("common_keyword");
    }
    if (isNonChatModel(extractModelId(model))) {
      reasons.push("not_chat_model");
    }
    if (isOldModel(extractModelId(model))) {
      reasons.push("old_model");
    }
    if (!supportsGeneration(model)) {
      reasons.push("no_completion");
    }
    if (isDateSnapshot(extractModelId(model))) {
      reasons.push("date_snapshot");
    }
    return reasons.length > 0 ? reasons : null;
  };

  return pipe(
    fetchJson(`${baseUrl}/models`, { "x-goog-api-key": apiKey }),
    Effect.andThen((json) => Schema.decodeUnknown(GoogleModelSchema)(json)),
    Effect.map(({ models }) => {
      const result = partition(models, getIgnoreReasons, extractModelId);

      return {
        models: sortModelsByRecency(result.models),
        ignored: result.ignored,
        metadata: {},
      };
    }),
    Effect.timeout(REQUEST_TIMEOUT),
    Effect.catchAll((error) => Effect.succeed(listModelsFailure(error))),
    Effect.runPromise,
  );
}
