import { Effect, pipe, Schema } from "effect";

import {
  DEFAULT_RESULT,
  listModelsFailure,
  fetchJson,
  isOldModel,
  type ListModelsResult,
  type ModelIgnoreReason,
  partition,
  REQUEST_TIMEOUT,
  shouldIgnoreCommonKeywords,
  sortModelsByRecency,
} from "./list-common";

const AnthropicModelSchema = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      id: Schema.String,
      display_name: Schema.String,
      created_at: Schema.String,
    }),
  ),
  has_more: Schema.Boolean,
  first_id: Schema.String,
  last_id: Schema.String,
});

export async function listAnthropicModels(
  baseUrl: string,
  apiKey: string,
  options?: { authorization?: "x-api-key" | "bearer" },
): Promise<ListModelsResult> {
  if (!baseUrl) {
    return DEFAULT_RESULT;
  }

  const headers: Record<string, string> = {
    "anthropic-version": "2023-06-01",
  };
  if (options?.authorization === "bearer") {
    // Consumer orgs reject CORS requests; the empty Origin makes the HTTP
    // plugin drop the webview origin so this reads as a native client.
    headers.Authorization = `Bearer ${apiKey}`;
    headers["anthropic-beta"] = "oauth-2025-04-20";
    headers.Origin = "";
  } else {
    headers["anthropic-dangerous-direct-browser-access"] = "true";
    headers["x-api-key"] = apiKey;
  }

  return pipe(
    fetchJson(`${baseUrl}/models`, headers),
    Effect.andThen((json) => Schema.decodeUnknown(AnthropicModelSchema)(json)),
    Effect.map(({ data }) => {
      const result = partition(
        data,
        (model) => {
          const reasons: ModelIgnoreReason[] = [];
          if (shouldIgnoreCommonKeywords(model.id)) {
            reasons.push("common_keyword");
          }
          if (isOldModel(model.id)) {
            reasons.push("old_model");
          }
          return reasons.length > 0 ? reasons : null;
        },
        (model) => model.id,
      );

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
