import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { Streamdown } from "streamdown";

import {
  ProviderCredentialError,
  providerCredentialIdentity,
  verifyProviderCredentials,
} from "@anlg/provider-validation";
import { streamdownIcons } from "@anlg/ui/components/streamdown-icons";
import { cn } from "@anlg/utils";

import {
  getProviderSelectionBlockers,
  type ProviderRequirement,
} from "./eligibility";
import { providerRowId } from "./provider-connection";
import { requiresKeyVerification } from "./provider-setup";

import { providerFetch } from "~/ai/provider-fetch";
import { useAiProviders } from "~/settings/providers";

export * from "./provider-icons";
export * from "./provider-search";
export { ProviderConnectionForm, providerRowId } from "./provider-connection";
export { requiresKeyVerification } from "./provider-setup";

type ProviderType = "stt" | "llm";

type AvailabilityProvider = {
  id: string;
  baseUrl?: string;
  authKind?: "api" | "subscription";
  requirements: readonly ProviderRequirement[];
  checkAvailability?: (baseUrl: string, apiKey: string) => Promise<boolean>;
};

export function useProviderAvailability<T extends AvailabilityProvider>(
  providerType: ProviderType,
  providers: readonly T[],
): Record<string, boolean | undefined> {
  const configuredProviders = useAiProviders(providerType);

  const inputs = providers
    .filter(
      (provider) =>
        provider.checkAvailability || requiresKeyVerification(provider),
    )
    .map((provider) => {
      const config =
        configuredProviders[providerRowId(providerType, provider.id)];
      const baseUrl = String(config?.base_url || provider.baseUrl || "").trim();
      const apiKey = String(config?.api_key || "").trim();
      const isConfigured =
        getProviderSelectionBlockers(provider.requirements, {
          config: { base_url: baseUrl, api_key: apiKey },
        }).length === 0;

      return { provider, baseUrl, apiKey, isConfigured };
    });

  const queries = useQueries({
    queries: inputs.map(({ provider, baseUrl, apiKey, isConfigured }) => ({
      queryKey: [
        "ai-provider-availability",
        providerType,
        provider.id,
        baseUrl,
        providerCredentialIdentity({ provider: provider.id, baseUrl, apiKey }),
      ],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        if (provider.checkAvailability)
          return provider.checkAvailability(baseUrl, apiKey);
        try {
          await verifyProviderCredentials(
            { type: providerType, provider: provider.id, baseUrl, apiKey },
            providerFetch,
            signal,
          );
        } catch (error) {
          if (error instanceof ProviderCredentialError && !error.retryable)
            return false;
          throw error;
        }
        return true;
      },
      enabled: isConfigured,
      retry: false,
      staleTime: provider.checkAvailability ? 0 : 5 * 60_000,
      gcTime: 0,
      refetchInterval: provider.checkAvailability ? 5_000 : (false as const),
    })),
  });

  const entries = inputs.map(
    ({ provider, isConfigured }, index) =>
      [provider.id, !isConfigured ? false : queries[index]?.data] as const,
  );

  // Callers put this record in memo dependency lists, so its identity has to
  // stay stable while the values do; a fresh object each render would recompute
  // those memos and churn the derived listModels closures used as query keys.
  const signature = entries.map(([id, value]) => `${id}=${value}`).join("|");

  return useMemo(() => Object.fromEntries(entries), [signature]);
}

const streamdownComponents = {
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => {
    return (
      <ul className="relative mb-1 block list-disc pl-6">
        {props.children as React.ReactNode}
      </ul>
    );
  },
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => {
    return (
      <ol className="relative mb-1 block list-decimal pl-6">
        {props.children as React.ReactNode}
      </ol>
    );
  },
  li: (props: React.HTMLAttributes<HTMLLIElement>) => {
    return <li className="mb-1">{props.children as React.ReactNode}</li>;
  },
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => {
    return <p className="mb-1">{props.children as React.ReactNode}</p>;
  },
  a: ({
    children,
    className,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    return (
      <a
        {...props}
        className={cn([
          "text-foreground font-medium underline underline-offset-2",
          "decoration-foreground/50 hover:decoration-foreground",
          className,
        ])}
      >
        {children as React.ReactNode}
      </a>
    );
  },
} as const;

export function StyledStreamdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <Streamdown
      icons={streamdownIcons}
      components={streamdownComponents}
      className={cn(["text-muted-foreground text-sm", className])}
      isAnimating={false}
    >
      {children}
    </Streamdown>
  );
}
