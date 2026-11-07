import { Trans, useLingui } from "@lingui/react/macro";
import type { KeyboardEvent, RefObject } from "react";

import { Avatar } from "@anlg/ui/components/avatar";
import {
  ArrowsDownUp,
  MagnifyingGlass,
  Plus,
  X,
} from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import {
  AppFloatingPanel,
  appFloatingMenuPanelClassName,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@anlg/ui/components/ui/dropdown-menu";
import { cn } from "@anlg/utils";

import { usesWindowsStyleTitleBar } from "~/shared/hooks/useWindowControlsGutter";
import { CustomSidebarHeader } from "~/sidebar/custom-sidebar-header";

export function ContactFacehash({
  name,
  size = 40,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return <Avatar seed={name} label={name} size={size} className={className} />;
}

export type SortOption =
  | "alphabetical"
  | "reverse-alphabetical"
  | "oldest"
  | "newest";

function SortDropdown({
  sortOption,
  setSortOption,
}: {
  sortOption: SortOption;
  setSortOption: (option: SortOption) => void;
}) {
  const { t } = useLingui();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          aria-label={t`Sort options`}
        >
          <ArrowsDownUp size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent variant="app" align="end">
        <AppFloatingPanel className={appFloatingMenuPanelClassName}>
          <DropdownMenuRadioGroup
            value={sortOption}
            onValueChange={(value) => setSortOption(value as SortOption)}
          >
            <DropdownMenuRadioItem
              value="alphabetical"
              className="cursor-pointer text-xs"
            >
              A-Z
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="reverse-alphabetical"
              className="cursor-pointer text-xs"
            >
              Z-A
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="oldest"
              className="cursor-pointer text-xs"
            >
              <Trans>Oldest</Trans>
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="newest"
              className="cursor-pointer text-xs"
            >
              <Trans>Newest</Trans>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </AppFloatingPanel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ColumnHeader({
  sortOption,
  setSortOption,
  onAdd,
  searchValue,
  onSearchChange,
  searchInputRef,
}: {
  sortOption?: SortOption;
  setSortOption?: (option: SortOption) => void;
  onAdd: () => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useLingui();
  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      onSearchChange?.("");
    }
  };

  return (
    <div className="@container">
      <CustomSidebarHeader>
        <div className="flex shrink-0 items-center">
          {sortOption && setSortOption && (
            <div
              className={cn([
                usesWindowsStyleTitleBar() ? "block" : "hidden @[220px]:block",
              ])}
            >
              <SortDropdown
                sortOption={sortOption}
                setSortOption={setSortOption}
              />
            </div>
          )}
          <Button
            onClick={onAdd}
            size="icon"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            title={t`Add`}
          >
            <Plus size={16} />
          </Button>
        </div>
      </CustomSidebarHeader>
      {onSearchChange && (
        <div className="pb-2">
          <div className="bg-card shadow-button-neutral focus-within:outline-ring flex h-7 w-full items-center gap-2 rounded-md px-2 transition-[box-shadow,outline-color] duration-200 ease-out focus-within:shadow-none focus-within:outline-1">
            <MagnifyingGlass className="text-icon-muted h-4 w-4 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchValue || ""}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t`Search contacts...`}
              className="placeholder:text-faint text-ui-compact min-w-0 flex-1 bg-transparent focus:outline-hidden"
            />
            {searchValue && (
              <button
                onClick={() => onSearchChange("")}
                className="text-muted-foreground hover:text-foreground h-4 w-4 shrink-0 transition-colors"
                aria-label={t`Clear search`}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
