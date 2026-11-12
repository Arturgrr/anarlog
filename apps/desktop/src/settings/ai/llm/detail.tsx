import { Trans, useLingui } from "@lingui/react/macro";

import { Button } from "@anlg/ui/components/ui/button";

import type { LlmEntry } from "./browse";
import { BuiltinModels } from "./builtin";
import { LlmModels, ReasoningEffortControl } from "./models";
import { LLM_PROVIDER_CONTEXT } from "./provider-context";
import { type ProviderId, PROVIDERS } from "./shared";
import { apiTwinId, subscriptionTwinId } from "./subscriptions";

import { ProviderConnectionForm, StyledStreamdown } from "~/settings/ai/shared";
import {
  DetailSection,
  ProviderBadgeChip,
  ProviderDetailHeader,
} from "~/settings/ai/shared/provider-detail";
import { providerDisplayName } from "~/settings/ai/shared/provider-labels";
import type { ProviderSetup } from "~/settings/ai/shared/provider-setup";

export function LlmProviderDetail({
  entry,
  setup,
  current,
  filtering,
  promptToSelect,
  onSelect,
  onConnect,
  onFocusProvider,
}: {
  entry: LlmEntry;
  setup: ProviderSetup;
  current: { provider: string; model: string } | null;
  filtering: boolean;
  promptToSelect: boolean;
  onSelect: (provider: string, model: string) => void;
  onConnect: (providerId: string) => void;
  onFocusProvider: (providerId: string) => void;
}) {
  const { i18n } = useLingui();
  const { provider } = entry;
  const name = providerDisplayName(provider, i18n);
  const context = LLM_PROVIDER_CONTEXT[provider.id as ProviderId];
  const isSubscription = provider.authKind === "subscription";
  const twin = PROVIDERS.find(
    ({ id }) =>
      id ===
      (isSubscription
        ? apiTwinId(provider.id)
        : subscriptionTwinId(provider.id)),
  );
  const twinName = twin ? providerDisplayName(twin, i18n) : "";
  const checkedModel =
    current?.provider === provider.id ? current.model : undefined;

  return (
    <>
      <ProviderDetailHeader
        icon={provider.icon}
        name={name}
        badges={
          provider.badge ? <ProviderBadgeChip badge={provider.badge} /> : null
        }
      >
        {context ? (
          <StyledStreamdown>{i18n._(context)}</StyledStreamdown>
        ) : null}
        {twin ? (
          <p className="text-faint text-xs">
            {isSubscription ? (
              <Trans>Prefer to pay per use?</Trans>
            ) : (
              <Trans>Have a {twinName} plan?</Trans>
            )}{" "}
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-xs"
              onClick={() => onFocusProvider(twin.id)}
            >
              {isSubscription ? (
                <Trans>Use a {twinName} API key</Trans>
              ) : (
                <Trans>Sign in with {twinName}</Trans>
              )}
            </Button>
          </p>
        ) : null}
      </ProviderDetailHeader>

      {provider.id === "builtin" ? (
        <BuiltinModels
          checkedModel={checkedModel}
          onSelect={(model) => onSelect(provider.id, model)}
        />
      ) : (
        <>
          <DetailSection title={<Trans>Connection</Trans>}>
            <ProviderConnectionForm
              key={provider.id}
              config={provider}
              providerType="llm"
              currentProvider={current?.provider}
              promptToSelect={promptToSelect}
              onConnect={
                isSubscription ? () => onConnect(provider.id) : undefined
              }
            />
          </DetailSection>

          <LlmModels
            entry={entry}
            setup={setup}
            isSubscription={isSubscription}
            providerName={name}
            checkedModel={checkedModel}
            filtering={filtering}
            onSelect={(model) => onSelect(provider.id, model)}
          />
        </>
      )}

      {checkedModel ? (
        <ReasoningEffortControl
          providerId={provider.id}
          modelId={checkedModel}
        />
      ) : null}
    </>
  );
}
