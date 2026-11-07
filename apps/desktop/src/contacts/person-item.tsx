import { useLingui } from "@lingui/react/macro";
import React, { useCallback } from "react";

import { PushPin } from "@anlg/ui/components/icons";
import { cn } from "@anlg/utils";

import { ContactImage } from "~/contacts/contact-avatar";
import { type HumanRecord, toggleContactPin } from "~/contacts/queries";
import { ContactFacehash } from "~/contacts/shared";
import { useNativeContextMenu } from "~/shared/hooks/useNativeContextMenu";

export function PersonItem({
  person,
  active,
  onClick,
  onDelete,
}: {
  person: HumanRecord;
  active: boolean;
  onClick: () => void;
  onDelete?: (id: string) => void;
}) {
  const { t } = useLingui();
  const isPinned = Boolean(person.pinned);
  const personName = person.name;
  const personEmail = person.email;
  const facehashName = personName || personEmail || person.id;

  const togglePin = useCallback(() => {
    void toggleContactPin("human", person.id).catch((error) => {
      console.error("[contacts] failed to toggle contact pin", error);
    });
  }, [person.id]);

  const showContextMenu = useNativeContextMenu([
    {
      id: "toggle-pin-person",
      text: isPinned ? t`Unpin Contact` : t`Pin Contact`,
      action: togglePin,
    },
    {
      id: "delete-person",
      text: t`Delete Contact`,
      action: () => onDelete?.(person.id),
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
      onContextMenu={showContextMenu}
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
      {person.avatarDataUrl ? (
        <ContactImage src={person.avatarDataUrl} size={32} />
      ) : (
        <ContactFacehash name={facehashName} size={32} />
      )}
      <div className="min-w-0 flex-1">
        <div className="font-ui-medium flex items-center gap-1 truncate">
          {personName || personEmail || t`Unnamed`}
        </div>
        {personEmail && personName && (
          <div className="text-muted-foreground text-small truncate">
            {personEmail}
          </div>
        )}
      </div>
      <button
        onClick={handleTogglePin}
        className={cn([
          "shrink-0 rounded-xs p-1 transition-colors",
          isPinned
            ? "text-icon hover:text-foreground"
            : "text-icon-faint hover:text-icon-muted opacity-0 group-hover:opacity-100",
        ])}
        aria-label={isPinned ? t`Unpin contact` : t`Pin contact`}
      >
        <PushPin className="size-3.5" weight={isPinned ? "bold" : "regular"} />
      </button>
    </div>
  );
}
