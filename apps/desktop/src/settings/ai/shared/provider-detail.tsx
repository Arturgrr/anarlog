import type { MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";
import { type ReactNode, useId } from "react";

import { Chip } from "./chip";
import { AFTER_RECORDING_BADGE } from "./provider-labels";
import { ProviderTile } from "./provider-list";

export function ProviderDetailHeader({
  icon,
  name,
  badges,
  children,
  actions,
}: {
  icon: ReactNode;
  name: string;
  badges?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <ProviderTile size="lg">{icon}</ProviderTile>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-medium">{name}</h3>
          {badges}
        </div>
        {children}
      </div>
      {actions ? <div className="flex shrink-0 gap-1">{actions}</div> : null}
    </div>
  );
}

export function ProviderBadgeChip({ badge }: { badge: MessageDescriptor }) {
  const { i18n, t } = useLingui();
  return (
    <Chip
      title={
        badge.id === AFTER_RECORDING_BADGE.id
          ? t`Runs after the recording finishes, not during the meeting.`
          : undefined
      }
    >
      {i18n._(badge)}
    </Chip>
  );
}

export function DetailSection({
  title,
  actions,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex min-h-6 items-center gap-2">
        <h4 id={headingId} className="text-small text-faint font-medium">
          {title}
        </h4>
        <span className="flex-1" />
        {actions}
      </div>
      {children}
    </section>
  );
}
