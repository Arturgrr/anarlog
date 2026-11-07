import {
  type ConfigField,
  getProviderSelectionBlockers,
  getRequiredConfigFields,
  type ProviderRequirement,
} from "./eligibility";

export type ProviderSetup =
  | { kind: "ready" }
  | { kind: "checking" }
  | { kind: "rejected" }
  | { kind: "stopped" }
  | { kind: "unavailable" }
  | { kind: "missing"; fields: ConfigField[] };

type SetupProvider = {
  baseUrl?: string;
  authKind?: "api" | "subscription";
  requirements: readonly ProviderRequirement[];
  checkAvailability?: (baseUrl: string, apiKey: string) => Promise<boolean>;
};

export function requiresKeyVerification(
  provider: Pick<
    SetupProvider,
    "requirements" | "authKind" | "checkAvailability"
  >,
) {
  return (
    provider.authKind !== "subscription" &&
    !provider.checkAvailability &&
    getRequiredConfigFields(provider.requirements).includes("api_key")
  );
}

export function getProviderSetup({
  provider,
  config,
  availability,
}: {
  provider: SetupProvider;
  config?: { base_url?: unknown; api_key?: unknown };
  availability: boolean | undefined;
}): ProviderSetup {
  const baseUrl = String(config?.base_url || provider.baseUrl || "").trim();
  const apiKey = String(config?.api_key || "").trim();
  const missing = getProviderSelectionBlockers(provider.requirements, {
    config: { base_url: baseUrl, api_key: apiKey },
  }).find((blocker) => blocker.code === "missing_config");

  if (missing?.code === "missing_config") {
    return { kind: "missing", fields: missing.fields };
  }

  if (provider.checkAvailability || requiresKeyVerification(provider)) {
    if (availability === undefined) {
      return { kind: "checking" };
    }
    if (!availability) {
      return { kind: provider.checkAvailability ? "stopped" : "rejected" };
    }
  }

  return { kind: "ready" };
}

export function hasStoredProviderConfig(
  provider: { baseUrl?: string },
  config?: { base_url?: unknown; api_key?: unknown },
) {
  const baseUrl = String(config?.base_url ?? "").trim();
  return (
    !!String(config?.api_key ?? "").trim() ||
    (!!baseUrl && baseUrl !== (provider.baseUrl ?? "").trim())
  );
}
