import { Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode } from "react";

import {
  DotsThree,
  MinusCircle,
  PushPin,
  Trash,
} from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import {
  AppFloatingPanel,
  appFloatingMenuPanelClassName,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@anlg/ui/components/ui/dropdown-menu";

export function ContactPageHeader({
  readOnly = false,
  title,
  compactIdentity,
  showCompactIdentity,
  pinned,
  onTogglePin,
  onDelete,
  onRemoveAvatar,
  actions,
}: {
  readOnly?: boolean;
  title: string;
  actions?: ReactNode;
  compactIdentity: ReactNode;
  showCompactIdentity: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  onDelete: () => void;
  onRemoveAvatar?: () => void;
}) {
  const { t } = useLingui();

  return (
    <div
      data-tauri-drag-region
      className="flex h-12 shrink-0 items-center justify-between gap-3 pr-1 pl-3"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {showCompactIdentity && compactIdentity}
        <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>
      </div>
      {!readOnly && (
        <div
          data-tauri-drag-region="false"
          className="flex shrink-0 items-center gap-1"
        >
          {actions}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                data-tauri-drag-region="false"
                className="text-icon-muted hover:text-foreground"
                aria-label={t`Contact options`}
              >
                <DotsThree size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent variant="app" align="end" className="w-48">
              <AppFloatingPanel className={appFloatingMenuPanelClassName}>
                <DropdownMenuItem
                  onClick={onTogglePin}
                  className="cursor-pointer"
                >
                  <PushPin weight={pinned ? "bold" : "regular"} />
                  <span>
                    {pinned ? <Trans>Unpin</Trans> : <Trans>Pin</Trans>}
                  </span>
                </DropdownMenuItem>
                {onRemoveAvatar && (
                  <DropdownMenuItem
                    onClick={onRemoveAvatar}
                    className="cursor-pointer"
                  >
                    <MinusCircle />
                    <span>
                      <Trans>Remove photo</Trans>
                    </span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-danger focus:text-danger cursor-pointer"
                >
                  <Trash />
                  <span>
                    <Trans>Delete</Trans>
                  </span>
                </DropdownMenuItem>
              </AppFloatingPanel>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
