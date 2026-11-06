import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";

import { Check, WarningCircle } from "@anlg/ui/components/icons";
import { Spinner } from "@anlg/ui/components/ui/spinner";
import { cn } from "@anlg/utils";

import { ProviderTile } from "./provider-list";

export type HealthDisplay = {
  kind: "ready" | "checking" | "error" | "info";
  message?: string;
};

export function InUseBar({
  icon,
  model,
  provider,
  chips,
  details,
  health,
  notice,
  emptyMessage,
}: {
  icon?: ReactNode;
  model?: ReactNode;
  provider?: ReactNode;
  chips?: ReactNode;
  details?: ReactNode;
  health?: HealthDisplay | null;
  notice?: ReactNode;
  emptyMessage: ReactNode;
}) {
  const { t } = useLingui();

  return (
    <section
      aria-label={t`In use`}
      className="bg-layer-1 border-border flex flex-col gap-2 rounded-lg border-[0.5px] px-3.5 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ProviderTile>{icon}</ProviderTile>
          <div className="flex min-w-0 flex-col">
            <span className="text-small text-faint">
              <Trans>In use</Trans>
            </span>
            {model ? (
              <span className="min-w-0 truncate font-medium">
                {model}
                {provider ? (
                  <span className="text-faint font-normal"> · {provider}</span>
                ) : null}
              </span>
            ) : (
              <span className="text-muted-foreground">{emptyMessage}</span>
            )}
          </div>
        </div>
        {chips ? <div className="flex flex-wrap gap-1.5">{chips}</div> : null}
        <div className="flex-1" />
        {details}
        {health ? <HealthLabel health={health} /> : null}
      </div>
      {notice}
    </section>
  );
}

function HealthLabel({ health }: { health: HealthDisplay }) {
  const { t } = useLingui();

  if (health.kind === "checking") {
    return (
      <span
        role="status"
        className="text-muted-foreground inline-flex items-center gap-1.5"
      >
        <Spinner size={14} className="shrink-0" />
        {health.message ?? t`Checking…`}
      </span>
    );
  }

  if (health.kind === "error") {
    return (
      <span
        role="alert"
        className="text-danger inline-flex min-w-0 items-start gap-1.5"
      >
        <WarningCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 break-words">{health.message}</span>
      </span>
    );
  }

  return (
    <span
      role="status"
      className={cn([
        "inline-flex items-center gap-1.5",
        health.kind === "ready" ? "text-foreground" : "text-muted-foreground",
      ])}
    >
      {health.kind === "ready" ? (
        <Check className="size-3.5 shrink-0" aria-hidden />
      ) : null}
      {health.message ?? t`Ready`}
    </span>
  );
}

export function InlineNotice({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <p className="text-muted-foreground flex flex-wrap items-start gap-1.5 text-xs">
      <WarningCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </p>
  );
}
