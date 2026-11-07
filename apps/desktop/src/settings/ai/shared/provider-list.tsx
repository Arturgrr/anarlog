import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useState } from "react";

import { focusRingClassName } from "@anlg/ui/lib/focus-ring";
import { cn } from "@anlg/utils";

import { ProviderIconSlot } from "./provider-icons";

type ProviderListStatus =
  | "in_use"
  | "connected"
  | "checking"
  | "error"
  | "inactive";

export type ProviderListItem = {
  id: string;
  name: string;
  icon: ReactNode;
  subtitle: ReactNode;
  status: ProviderListStatus;
  statusLabel?: string;
};

type ProviderListGroup = {
  id: string;
  label: string;
  items: ProviderListItem[];
  collapsible?: boolean;
};

const COLLAPSED_VISIBLE_COUNT = 5;

export function ProviderList({
  label,
  groups,
  focusedId,
  onFocus,
  expandAll,
}: {
  label: string;
  groups: ProviderListGroup[];
  focusedId: string | undefined;
  onFocus: (providerId: string) => void;
  expandAll: boolean;
}) {
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);

  const toggleGroup = (groupId: string) =>
    setExpandedGroups((groups) =>
      groups.includes(groupId)
        ? groups.filter((id) => id !== groupId)
        : [...groups, groupId],
    );

  return (
    <nav aria-label={label} className="flex flex-col">
      {groups.map((group) => {
        const canCollapse =
          group.collapsible &&
          !expandAll &&
          group.items.length > COLLAPSED_VISIBLE_COUNT + 1;
        const expanded = expandedGroups.includes(group.id);
        // Set-up, failing and focused providers stay visible when collapsed so
        // the list never hides the provider someone is working with.
        const visibleItems =
          canCollapse && !expanded
            ? group.items.filter(
                (item, index) =>
                  index < COLLAPSED_VISIBLE_COUNT ||
                  item.status !== "inactive" ||
                  item.id === focusedId,
              )
            : group.items;
        const hiddenCount = group.items.length - visibleItems.length;
        const headingId = `provider-group-${group.id}`;

        return (
          <section key={group.id} aria-labelledby={headingId}>
            <h3
              id={headingId}
              className="text-small text-faint flex items-center gap-1.5 px-2 pt-3 pb-1 font-medium"
            >
              {group.label}
              <span className="flex-1" />
              <span className="font-mono">{group.items.length}</span>
            </h3>
            <ul className="flex flex-col">
              {visibleItems.map((item) => (
                <li key={item.id}>
                  <ProviderRow
                    item={item}
                    focused={item.id === focusedId}
                    onFocus={() => onFocus(item.id)}
                  />
                </li>
              ))}
            </ul>
            {canCollapse && (hiddenCount > 0 || expanded) ? (
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => toggleGroup(group.id)}
                className={cn([
                  focusRingClassName,
                  "text-muted-foreground hover:text-foreground hover:bg-hover w-full rounded-md py-1.5 pr-2 pl-[46px] text-left",
                ])}
              >
                {expanded ? (
                  <Trans>Show fewer</Trans>
                ) : (
                  <Plural
                    value={hiddenCount}
                    one="Show # more provider"
                    other="Show # more providers"
                  />
                )}
              </button>
            ) : null}
          </section>
        );
      })}
    </nav>
  );
}

function ProviderRow({
  item,
  focused,
  onFocus,
}: {
  item: ProviderListItem;
  focused: boolean;
  onFocus: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={focused ? "true" : undefined}
      onClick={onFocus}
      className={cn([
        focusRingClassName,
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left",
        focused ? "bg-hover" : "hover:bg-hover",
      ])}
    >
      <ProviderTile>{item.icon}</ProviderTile>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{item.name}</span>
        <span className="text-small text-faint truncate">{item.subtitle}</span>
      </span>
      <ProviderStatus status={item.status} label={item.statusLabel} />
    </button>
  );
}

function ProviderStatus({
  status,
  label,
}: {
  status: ProviderListStatus;
  label?: string;
}) {
  const { t } = useLingui();
  const text =
    label ??
    (status === "in_use"
      ? t`In use`
      : status === "error"
        ? t`Error`
        : undefined);

  return (
    <span
      className={cn([
        "text-small inline-flex shrink-0 items-center gap-1.5",
        status === "in_use" && "text-foreground",
        status === "connected" && "text-muted-foreground",
        (status === "checking" || status === "inactive") && "text-faint",
        status === "error" && "text-danger",
      ])}
    >
      {text}
      <span
        aria-hidden
        className={cn([
          "size-2 shrink-0 rounded-full",
          status === "in_use" && "bg-foreground",
          status === "connected" && "border-muted-foreground border-[1.5px]",
          status === "checking" &&
            "border-faint animate-status-pulse border-[1.5px]",
          status === "error" && "bg-danger",
          status === "inactive" && "border-faint border border-dashed",
        ])}
      />
    </span>
  );
}

export function ProviderTile({
  children,
  size = "md",
}: {
  children?: ReactNode;
  size?: "md" | "lg";
}) {
  return (
    <span
      aria-hidden
      className={cn([
        "bg-layer-2 border-border flex shrink-0 items-center justify-center border-[0.5px]",
        size === "lg" ? "size-10 rounded-lg" : "size-7 rounded-md",
      ])}
    >
      {children ? <ProviderIconSlot>{children}</ProviderIconSlot> : null}
    </span>
  );
}
