import { useLingui } from "@lingui/react/macro";
import React, { useCallback } from "react";

import { Buildings, PushPin } from "@anlg/ui/components/icons";
import { cn } from "@anlg/utils";

import { ContactImage } from "~/contacts/contact-avatar";
import { type OrganizationRecord, toggleContactPin } from "~/contacts/queries";
import { useNativeContextMenu } from "~/shared/hooks/useNativeContextMenu";

export function OrganizationItem({
  organization,
  active,
  onClick,
  onDelete,
  readOnly = false,
}: {
  readOnly?: boolean;
  organization: OrganizationRecord;
  active: boolean;
  onClick: () => void;
  onDelete?: (id: string) => void;
}) {
  const { t } = useLingui();
  const isPinned = readOnly || Boolean(organization.pinned);

  const togglePin = useCallback(() => {
    void toggleContactPin("organization", organization.id).catch((error) => {
      console.error("[contacts] failed to toggle organization pin", error);
    });
  }, [organization.id]);

  const showContextMenu = useNativeContextMenu([
    {
      id: "toggle-pin-org",
      text: isPinned ? t`Unpin Organization` : t`Pin Organization`,
      action: togglePin,
    },
    {
      id: "delete-org",
      text: t`Delete Organization`,
      action: () => onDelete?.(organization.id),
    },
  ]);

  const handleTogglePin = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      togglePin();
    },
    [togglePin],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onContextMenu={readOnly ? undefined : showContextMenu}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn([
        "group flex w-full items-center gap-2 overflow-hidden rounded-md px-2.5 py-2 text-left text-sm select-none",
        active ? "bg-layer-2" : "hover:bg-hover active:bg-pressed",
      ])}
    >
      {organization.avatarDataUrl ? (
        <ContactImage src={organization.avatarDataUrl} size={32} />
      ) : (
        <div className="bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
          <Buildings className="text-muted-foreground h-4 w-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="font-ui-medium truncate">{organization.name}</div>
      </div>
      {readOnly ? (
        <span
          role="img"
          aria-label={t`Pinned organization`}
          className="text-icon shrink-0 p-1"
        >
          <PushPin className="size-3.5" weight="bold" />
        </span>
      ) : (
        <button
          onClick={handleTogglePin}
          className={cn([
            "shrink-0 rounded-xs p-1 transition-colors",
            isPinned
              ? "text-icon hover:text-foreground"
              : "text-icon-faint hover:text-icon-muted opacity-0 group-hover:opacity-100",
          ])}
          aria-label={isPinned ? t`Unpin organization` : t`Pin organization`}
        >
          <PushPin
            className="size-3.5"
            weight={isPinned ? "bold" : "regular"}
          />
        </button>
      )}
    </div>
  );
}
