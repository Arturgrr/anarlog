import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";

import { TextAlignLeft } from "@anlg/ui/components/icons";

import {
  IconHeaderView,
  copyTextToClipboard,
  getStoredNoteMarkdown,
} from "./header-shared";

import { useSession } from "~/session/queries";
import {
  type MenuItemDef,
  useNativeContextMenu,
} from "~/shared/hooks/useNativeContextMenu";

export function HeaderViewRaw({
  isActive,
  onClick = () => {},
  sessionId,
  standalone = false,
}: {
  isActive: boolean;
  onClick?: () => void;
  sessionId: string;
  standalone?: boolean;
}) {
  const session = useSession(sessionId);
  const standaloneLabel = standalone ? session?.title.trim() : undefined;

  if (!isActive) {
    return (
      <HeaderViewRawButton
        isActive={isActive}
        label={standaloneLabel}
        onClick={onClick}
        standalone={standalone}
      />
    );
  }

  return (
    <HeaderViewRawActive
      isActive={isActive}
      label={standaloneLabel}
      onClick={onClick}
      rawMd={session?.raw_md}
      sessionId={sessionId}
      standalone={standalone}
    />
  );
}

function HeaderViewRawButton({
  isActive,
  label,
  onClick,
  onContextMenu,
  standalone,
}: {
  isActive: boolean;
  label?: string;
  onClick?: () => void;
  onContextMenu?: React.MouseEventHandler<HTMLButtonElement>;
  standalone: boolean;
}) {
  const { t } = useLingui();

  return (
    <IconHeaderView
      isActive={isActive}
      label={label || t`Memos`}
      icon={<TextAlignLeft className="size-3.5" />}
      onClick={onClick}
      onContextMenu={onContextMenu}
      size={standalone ? "standalone" : "tray"}
      title={label}
      className={standalone ? "border-0 shadow-none" : undefined}
    />
  );
}

function HeaderViewRawActive({
  isActive,
  label,
  onClick,
  rawMd,
  sessionId,
  standalone,
}: {
  isActive: boolean;
  label?: string;
  onClick?: () => void;
  rawMd?: string;
  sessionId: string;
  standalone: boolean;
}) {
  const { t } = useLingui();
  const memoMarkdown = useMemo(() => getStoredNoteMarkdown(rawMd), [rawMd]);
  const contextMenu = useMemo<MenuItemDef[]>(
    () => [
      {
        id: `copy-memo-${sessionId}`,
        text: t`Copy`,
        action: () => {
          void copyTextToClipboard(memoMarkdown, {
            success: t`Memo copied to clipboard`,
            error: t`Failed to copy memo`,
          });
        },
        disabled: memoMarkdown.length === 0,
      },
    ],
    [memoMarkdown, sessionId, t],
  );
  const showContextMenu = useNativeContextMenu(contextMenu);

  return (
    <HeaderViewRawButton
      isActive={isActive}
      label={label}
      onClick={onClick}
      onContextMenu={showContextMenu}
      standalone={standalone}
    />
  );
}
