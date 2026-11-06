import type { MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import { type AnyFieldApi, useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useId } from "react";

import { usesDeferredProviderAuthentication } from "@anlg/provider-validation";
import type { AIProvider } from "@anlg/store";
import { aiProviderSchema } from "@anlg/store";
import {
  ArrowSquareOut,
  CircleNotch,
  WarningCircle,
} from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import {
  InputGroup,
  InputGroupInput,
} from "@anlg/ui/components/ui/input-group";

import {
  getRequiredConfigFields,
  type ProviderRequirement,
} from "./eligibility";
import { providerDisplayName } from "./provider-labels";
import { useProviderSelectionPrompt } from "./provider-selection-prompt";
import {
  hasStoredProviderConfig,
  requiresKeyVerification,
} from "./provider-setup";

import {
  isKeychainAccessError,
  repairKeychainAccess,
  useAiProvidersState,
  useClearAiProvider,
  useSetAiProvider,
} from "~/settings/providers";
import { setSettingValues } from "~/settings/queries";

type ProviderType = "stt" | "llm";

type ConnectionProvider = {
  id: string;
  displayName: string;
  icon: ReactNode;
  baseUrl?: string;
  authKind?: "api" | "subscription";
  requirements: readonly ProviderRequirement[];
  checkAvailability?: (baseUrl: string, apiKey: string) => Promise<boolean>;
  hideAdvanced?: boolean;
  links?: {
    download?: { label: MessageDescriptor; url: string };
    models?: { label: MessageDescriptor; url: string };
    setup?: { label: MessageDescriptor; url: string };
  };
};

export function providerRowId(providerType: ProviderType, providerId: string) {
  return `${providerType}:${providerId}`;
}

export function ProviderConnectionForm({
  config,
  providerType,
  currentProvider,
  promptToSelect,
  onConnect,
}: {
  config: ConnectionProvider;
  providerType: ProviderType;
  currentProvider?: string;
  promptToSelect: boolean;
  onConnect?: () => void;
}) {
  const { t, i18n } = useLingui();
  const displayName = providerDisplayName(config, i18n);
  const { providers, isReady: providerStateReady } =
    useAiProvidersState(providerType);
  const parsedProvider = aiProviderSchema.safeParse(
    providers[providerRowId(providerType, config.id)],
  ).data;
  const providerMutation = useSetAiProvider(providerType, config.id, {
    verifyCredentials: requiresKeyVerification(config),
    defaultBaseUrl: config.baseUrl,
  });
  const clearProvider = useClearAiProvider(providerType, config.id);

  const requiredFields = getRequiredConfigFields(config.requirements);
  const isSubscription = config.authKind === "subscription";
  const showApiKey = requiredFields.includes("api_key") && !isSubscription;
  const showBaseUrl = requiredFields.includes("base_url") && !isSubscription;
  const hasStoredConfig = hasStoredProviderConfig(config, parsedProvider);
  const notifyProviderSelection = useProviderSelectionPrompt({
    enabled: promptToSelect,
    providerType,
    providerId: config.id,
    providerName: displayName,
    currentProvider,
    providerStateReady,
    storedApiKey: parsedProvider?.api_key,
  });
  const emptyValues = {
    type: providerType,
    base_url: config.baseUrl ?? "",
    api_key: "",
  } satisfies AIProvider;

  const form = useForm({
    onSubmit: async ({ value }) => {
      try {
        await providerMutation.mutateAsync(value);
      } catch {
        return;
      }

      notifyProviderSelection(value.api_key);
    },
    defaultValues: parsedProvider ?? emptyValues,
    listeners: {
      onChangeDebounceMs: 500,
      onChange: ({ formApi }) => {
        providerMutation.reset();
        queueMicrotask(() => {
          void formApi.handleSubmit();
        });
      },
    },
    validators: { onChange: aiProviderSchema },
  });
  const repairMutation = useMutation<void, Error>({
    mutationFn: repairKeychainAccess,
    onSuccess: async () => {
      await form.handleSubmit();
    },
  });
  const resetMutation = useMutation({
    mutationFn: async () => {
      await clearProvider.mutateAsync();
      if (currentProvider === config.id) {
        await setSettingValues(
          providerType === "llm"
            ? { current_llm_provider: "", current_llm_model: "" }
            : { current_stt_provider: "", current_stt_model: "" },
        );
      }
    },
    onSuccess: () => {
      form.reset(emptyValues);
      providerMutation.reset();
      repairMutation.reset();
    },
  });

  const hasKeychainError = isKeychainAccessError(providerMutation.error);
  const keychainDescription = repairMutation.isPending
    ? t`Unlock your login Keychain in the macOS prompt. Librelog will retry saving this API key automatically.`
    : (repairMutation.error?.message ??
      t`macOS cannot access your login Keychain. Repairing briefly locks it and asks for your Mac password before Librelog retries this API key.`);
  const hasAdvancedFields = (!showBaseUrl && !!config.baseUrl) || !showApiKey;
  const showAdvanced = !config.hideAdvanced && hasAdvancedFields;
  const links = config.links
    ? [config.links.download, config.links.models, config.links.setup].filter(
        (link) => !!link,
      )
    : [];

  return (
    <div className="flex flex-col gap-4">
      {isSubscription ? (
        hasStoredConfig ? (
          <p className="text-muted-foreground text-xs">
            <Trans>Connected with your existing subscription.</Trans>
          </p>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={onConnect}
          >
            {t`Connect ${displayName}`}
          </Button>
        )
      ) : null}
      {hasStoredConfig &&
      usesDeferredProviderAuthentication(providerType, config.id) ? (
        <p className="text-muted-foreground text-xs">
          <Trans>Credentials will be checked when transcription starts.</Trans>
        </p>
      ) : null}

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {showBaseUrl ? (
          <form.Field name="base_url">
            {(field) => <FormField field={field} label={t`Base URL`} />}
          </form.Field>
        ) : null}
        {showApiKey ? (
          <form.Field name="api_key">
            {(field) => (
              <FormField
                field={field}
                label={t`API key`}
                placeholder={t`Enter your API key`}
                type="password"
              />
            )}
          </form.Field>
        ) : null}
        {providerMutation.isPending ? (
          <p
            role="status"
            className="text-muted-foreground flex items-center gap-1.5 text-xs"
          >
            <CircleNotch className="size-3 animate-spin" aria-hidden />
            {requiresKeyVerification(config) ? (
              <Trans>Checking the key…</Trans>
            ) : (
              <Trans>Saving…</Trans>
            )}
          </p>
        ) : null}
        {providerMutation.error && !hasKeychainError ? (
          <ErrorLine>{providerMutation.error.message}</ErrorLine>
        ) : null}
        {hasKeychainError ? (
          <div role="alert" className="flex flex-col items-start gap-2">
            <ErrorLine>{keychainDescription}</ErrorLine>
            {repairMutation.isPending ? null : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => repairMutation.mutate()}
              >
                <Trans>Repair Keychain access</Trans>
              </Button>
            )}
          </div>
        ) : null}
        {showAdvanced ? (
          <details className="group">
            <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer text-xs">
              <Trans>Advanced</Trans>
            </summary>
            <div className="mt-3 flex flex-col gap-4">
              {!showBaseUrl && config.baseUrl ? (
                <form.Field name="base_url">
                  {(field) => <FormField field={field} label={t`Base URL`} />}
                </form.Field>
              ) : null}
              {!showApiKey ? (
                <form.Field name="api_key">
                  {(field) => (
                    <FormField
                      field={field}
                      label={t`API key (optional)`}
                      placeholder={t`Enter your API key (optional)`}
                      type="password"
                    />
                  )}
                </form.Field>
              ) : null}
            </div>
          </details>
        ) : null}
      </form>

      {links.length > 0 || hasStoredConfig ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          {links.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 hover:underline"
            >
              {i18n._(link.label)}
              <ArrowSquareOut size={12} aria-hidden />
            </a>
          ))}
          <span className="flex-1" />
          {hasStoredConfig ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
            >
              {resetMutation.isPending ? (
                <CircleNotch className="size-3 animate-spin" aria-hidden />
              ) : null}
              {isSubscription ? (
                <Trans>Disconnect</Trans>
              ) : (
                <Trans>Reset</Trans>
              )}
            </Button>
          ) : null}
        </div>
      ) : null}
      {resetMutation.error ? (
        <ErrorLine>{resetMutation.error.message}</ErrorLine>
      ) : null}
    </div>
  );
}

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p className="text-danger flex items-start gap-1.5 text-xs">
      <WarningCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

function FormField({
  field,
  label,
  placeholder,
  type,
}: {
  field: AnyFieldApi;
  label: string;
  placeholder?: string;
  type?: string;
}) {
  const inputId = useId();
  const {
    meta: { errors, isTouched },
  } = field.state;
  const hasError = isTouched && errors && errors.length > 0;
  const errorMessage = hasError
    ? typeof errors[0] === "string"
      ? errors[0]
      : "message" in errors[0]
        ? errors[0].message
        : JSON.stringify(errors[0])
    : null;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="block text-xs font-medium">
        {label}
      </label>
      <InputGroup className="bg-card">
        <InputGroupInput
          id={inputId}
          name={field.name}
          type={type}
          value={field.state.value}
          onChange={(event) => field.handleChange(event.target.value)}
          placeholder={placeholder}
          aria-invalid={hasError}
        />
      </InputGroup>
      {errorMessage ? <ErrorLine>{errorMessage}</ErrorLine> : null}
    </div>
  );
}
