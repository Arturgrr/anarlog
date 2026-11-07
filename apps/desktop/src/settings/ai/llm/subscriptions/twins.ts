import { type SubscriptionProviderId } from "./oauth";

const API_SUBSCRIPTION_TWINS = {
  openai: "chatgpt",
  anthropic: "claude",
  xai: "grok",
  moonshot: "kimi_code",
} as const satisfies Record<string, SubscriptionProviderId>;

export function subscriptionTwinId(
  providerId: string,
): SubscriptionProviderId | undefined {
  if (providerId in API_SUBSCRIPTION_TWINS) {
    return API_SUBSCRIPTION_TWINS[
      providerId as keyof typeof API_SUBSCRIPTION_TWINS
    ];
  }
}

export function apiTwinId(providerId: string): string | undefined {
  return Object.entries(API_SUBSCRIPTION_TWINS).find(
    ([, subscriptionId]) => subscriptionId === providerId,
  )?.[0];
}
