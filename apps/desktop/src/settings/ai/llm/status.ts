import { useMemo } from "react";

import { providerCredentialIdentity } from "@anlg/provider-validation";

import { type Provider, PROVIDERS } from "./shared";
import {
  isSubscriptionProviderId,
  listSubscriptionModels,
} from "./subscriptions";

import {
  providerRowId,
  requiresKeyVerification,
  useProviderAvailability,
} from "~/settings/ai/shared";
import { getProviderSelectionBlockers } from "~/settings/ai/shared/eligibility";
import { listAnthropicModels } from "~/settings/ai/shared/list-anthropic";
import { listAppleFoundationModels } from "~/settings/ai/shared/list-apple-foundation";
import { listAzureAIModels } from "~/settings/ai/shared/list-azure-ai";
import { listAzureOpenAIModels } from "~/settings/ai/shared/list-azure-openai";
import { listBuiltinModels } from "~/settings/ai/shared/list-builtin";
import { listCloudflareWorkersAIModels } from "~/settings/ai/shared/list-cloudflare-workers-ai";
import {
  type InputModality,
  type ListModelsResult,
  removeNonStreamingModels,
} from "~/settings/ai/shared/list-common";
import { listGoogleModels } from "~/settings/ai/shared/list-google";
import { listLMStudioModels } from "~/settings/ai/shared/list-lmstudio";
import { listMistralModels } from "~/settings/ai/shared/list-mistral";
import { listOllamaModels } from "~/settings/ai/shared/list-ollama";
import {
  listGenericModels,
  listOpenAIModels,
} from "~/settings/ai/shared/list-openai";
import { listOpenRouterModels } from "~/settings/ai/shared/list-openrouter";
import { listUnslothModels } from "~/settings/ai/shared/list-unsloth";
import { listVeniceModels } from "~/settings/ai/shared/list-venice";
import {
  getProviderSetup,
  type ProviderSetup,
} from "~/settings/ai/shared/provider-setup";
import { useAiProvidersState } from "~/settings/providers";
import { useConfigValues } from "~/shared/config";

export type LlmProviderStatus = {
  configured: boolean;
  availabilityPending?: boolean;
  listModels?: () => Promise<ListModelsResult>;
  listModelsKey?: string;
};

type ProviderConfig = {
  base_url?: unknown;
  api_key?: unknown;
};

const GOOGLE_VERTEX_AI_MODELS = [
  "google/gemini-3.8-flash",
  "google/gemini-3.7-flash",
  "google/gemini-3.6-flash",
  "google/gemini-3.5-flash-lite",
  "google/gemini-3.1-pro-preview",
  "google/gemini-3.5-flash",
  "google/gemini-3.1-flash-lite",
] as const;

export function getLlmProviderStatus({
  provider,
  config,
  isAvailable,
}: {
  provider: Provider;
  config?: ProviderConfig;
  isAvailable?: boolean;
}): LlmProviderStatus {
  const baseUrl = String(config?.base_url || provider.baseUrl || "").trim();
  const apiKey = String(config?.api_key || "").trim();

  const eligible =
    getProviderSelectionBlockers(provider.requirements, {
      config: { base_url: baseUrl, api_key: apiKey },
    }).length === 0;

  if (!eligible) {
    return { configured: false };
  }

  if (provider.checkAvailability || requiresKeyVerification(provider)) {
    if (isAvailable === undefined) {
      return { configured: false, availabilityPending: true };
    }
    if (!isAvailable) {
      return { configured: false };
    }
  }

  let listModelsFunc: () => Promise<ListModelsResult>;

  switch (provider.id) {
    case "openai":
      listModelsFunc = () => listOpenAIModels(baseUrl, apiKey);
      break;
    case "cohere":
      listModelsFunc = () =>
        listGenericModels(baseUrl, apiKey, { filterDateSnapshots: false });
      break;
    case "cloudflare_workers_ai":
      listModelsFunc = () => listCloudflareWorkersAIModels(baseUrl, apiKey);
      break;
    case "anthropic":
      listModelsFunc = () => listAnthropicModels(baseUrl, apiKey);
      break;
    case "openrouter":
      listModelsFunc = () => listOpenRouterModels(baseUrl, apiKey);
      break;
    case "google_generative_ai":
      listModelsFunc = () => listGoogleModels(baseUrl, apiKey);
      break;
    case "google_vertex_ai":
      listModelsFunc = async () => ({
        models: [...GOOGLE_VERTEX_AI_MODELS],
        ignored: [],
        metadata: Object.fromEntries(
          GOOGLE_VERTEX_AI_MODELS.map((model) => [
            model,
            { input_modalities: ["text", "image"] as InputModality[] },
          ]),
        ),
      });
      break;
    case "mistral":
      listModelsFunc = () => listMistralModels(baseUrl, apiKey);
      break;
    case "azure_openai":
      listModelsFunc = () => listAzureOpenAIModels(baseUrl, apiKey);
      break;
    case "azure_ai":
      listModelsFunc = () => listAzureAIModels(baseUrl, apiKey);
      break;
    case "ollama":
      listModelsFunc = () => listOllamaModels(baseUrl, apiKey);
      break;
    case "apple_foundation":
      listModelsFunc = listAppleFoundationModels;
      break;
    case "builtin":
      listModelsFunc = listBuiltinModels;
      break;
    case "lmstudio":
      listModelsFunc = () => listLMStudioModels(baseUrl, apiKey);
      break;
    case "unsloth":
      listModelsFunc = () => listUnslothModels(baseUrl, apiKey);
      break;
    case "venice":
      listModelsFunc = () => listVeniceModels(baseUrl, apiKey);
      break;
    case "custom":
      listModelsFunc = () => listGenericModels(baseUrl, apiKey);
      break;
    default:
      if (isSubscriptionProviderId(provider.id)) {
        const subscriptionId = provider.id;
        listModelsFunc = () =>
          listSubscriptionModels(subscriptionId, baseUrl, apiKey);
      } else {
        listModelsFunc = () => listGenericModels(baseUrl, apiKey);
      }
  }

  return {
    configured: true,
    listModels: async () => removeNonStreamingModels(await listModelsFunc()),
    listModelsKey: providerCredentialIdentity({
      provider: provider.id,
      baseUrl,
      apiKey,
    }),
  };
}

export function useLlmProviderStatuses(): {
  providers: Record<string, LlmProviderStatus & { setup: ProviderSetup }>;
  isReady: boolean;
} {
  const availability = useProviderAvailability("llm", PROVIDERS);
  const { current_llm_provider } = useConfigValues([
    "current_llm_provider",
  ] as const);
  const { providers: configuredProviders, isReady } =
    useAiProvidersState("llm");

  const mapping = useMemo(() => {
    return Object.fromEntries(
      PROVIDERS.map((provider: Provider) => {
        const config = configuredProviders[providerRowId("llm", provider.id)];
        // The selected provider bypasses the reachability gate: a temporarily
        // stopped local server should surface as a connection error, not
        // silently re-persist the selection to another provider.
        const isAvailable = provider.checkAvailability
          ? provider.id === current_llm_provider || availability[provider.id]
          : requiresKeyVerification(provider)
            ? availability[provider.id]
            : undefined;
        return [
          provider.id,
          {
            ...getLlmProviderStatus({ provider, config, isAvailable }),
            setup: getProviderSetup({
              provider,
              config,
              availability: availability[provider.id],
            }),
          },
        ];
      }),
    );
  }, [configuredProviders, availability, current_llm_provider]);

  return {
    providers: mapping,
    isReady:
      isReady &&
      Object.values(mapping).every(
        (status) => status.availabilityPending !== true,
      ),
  };
}
