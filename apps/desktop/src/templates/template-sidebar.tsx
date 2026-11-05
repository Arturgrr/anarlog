import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ArrowsDownUp,
  BookOpenText,
  MagnifyingGlass,
  Plus,
  Sparkle,
  X,
} from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import {
  AppFloatingPanel,
  appFloatingMenuPanelClassName,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@anlg/ui/components/ui/dropdown-menu";
import { cn } from "@anlg/utils";

import { getTemplateCopyTitle, type UserTemplate } from "./queries";
import { TemplateIconGlyph } from "./template-icon";
import { AUTO_TEMPLATE_ID, useTemplateTab } from "./utils";

import { useConfigValue } from "~/shared/config";
import { useNativeContextMenu } from "~/shared/hooks/useNativeContextMenu";
import { CustomSidebarHeader } from "~/sidebar/custom-sidebar-header";
import { type Tab } from "~/store/zustand/tabs";

type SortOption = "alphabetical" | "reverse-alphabetical";

export function TemplatesSidebarContent({
  tab,
}: {
  tab: Extract<Tab, { type: "templates" }>;
}) {
  const { t } = useLingui();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("alphabetical");
  const autoPrompt = useConfigValue("auto_summary_prompt");

  const {
    userTemplates,
    selectedMineId: effectiveSelectedMineId,
    setSelectedMineId,
    createTemplate,
    createDefaultTemplate,
    deleteTemplate,
    toggleTemplateFavorite,
  } = useTemplateTab(tab);

  const handleDuplicateTemplate = useCallback(
    async (template: UserTemplate) => {
      const id = await createTemplate({
        title: getTemplateCopyTitle(template.title),
        description: template.description ?? "",
        category: template.category,
        icon: template.icon,
        targets: template.targets,
        sections: template.sections.map((section) => ({ ...section })),
      });

      if (id) {
        setSelectedMineId(id);
      }
    },
    [createTemplate, setSelectedMineId],
  );

  const handleDeleteTemplate = useCallback(
    async (id: string) => {
      await deleteTemplate(id);

      if (effectiveSelectedMineId === id) {
        setSelectedMineId(null);
      }
    },
    [deleteTemplate, effectiveSelectedMineId, setSelectedMineId],
  );

  const handleToggleFavorite = useCallback(
    async (id: string) => {
      await toggleTemplateFavorite(id);
    },
    [toggleTemplateFavorite],
  );

  const sortedUserTemplates = useMemo(() => {
    const favorites = userTemplates
      .filter((template) => template.pinned)
      .sort((a, b) => {
        const orderA = a.pinOrder ?? Infinity;
        const orderB = b.pinOrder ?? Infinity;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return (a.title || "").localeCompare(b.title || "");
      });

    const others = userTemplates.filter((template) => !template.pinned);
    switch (sortOption) {
      case "alphabetical":
        others.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
        break;
      case "reverse-alphabetical":
      default:
        others.sort((a, b) => (b.title || "").localeCompare(a.title || ""));
        break;
    }

    return [...favorites, ...others];
  }, [userTemplates, sortOption]);

  const filteredMine = useMemo(() => {
    if (!search.trim()) return sortedUserTemplates;
    const q = search.toLowerCase();
    return sortedUserTemplates.filter(
      (template) =>
        template.title?.toLowerCase().includes(q) ||
        template.description?.toLowerCase().includes(q) ||
        template.category?.toLowerCase().includes(q) ||
        template.targets?.some((target) => target.toLowerCase().includes(q)),
    );
  }, [sortedUserTemplates, search]);

  const combinedTemplates = useMemo<
    Array<
      | {
          key: typeof AUTO_TEMPLATE_ID;
          title: "Auto";
          selected: boolean;
          source: "auto";
          customized: boolean;
        }
      | {
          key: string;
          title: string;
          selected: boolean;
          pinned: boolean;
          source: "user";
          template: UserTemplate;
        }
    >
  >(() => {
    const query = search.trim().toLowerCase();
    const auto =
      !query || "auto".includes(query)
        ? [
            {
              key: AUTO_TEMPLATE_ID as typeof AUTO_TEMPLATE_ID,
              title: "Auto" as const,
              selected: effectiveSelectedMineId === AUTO_TEMPLATE_ID,
              source: "auto" as const,
              customized: Boolean(autoPrompt.trim()),
            },
          ]
        : [];
    const mine = filteredMine.map((template) => ({
      key: template.id,
      title: template.title?.trim() || "Untitled",
      selected: effectiveSelectedMineId === template.id,
      pinned: Boolean(template.pinned),
      source: "user" as const,
      template,
    }));

    return [...auto, ...mine];
  }, [autoPrompt, effectiveSelectedMineId, filteredMine, search]);

  const hasResults = combinedTemplates.length > 0;

  const selectCombinedTemplate = useCallback(
    (
      item:
        | {
            source: "auto";
          }
        | {
            source: "user";
            template: UserTemplate;
          },
    ) => {
      setSelectedMineId(
        item.source === "auto" ? AUTO_TEMPLATE_ID : item.template.id,
      );
    },
    [setSelectedMineId],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !event.altKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        (event.key !== "ArrowUp" && event.key !== "ArrowDown")
      ) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select, [contenteditable='true']"))
      ) {
        return;
      }

      if (combinedTemplates.length === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const currentIndex = combinedTemplates.findIndex((item) => item.selected);
      const nextIndex =
        currentIndex === -1
          ? event.key === "ArrowDown"
            ? 0
            : combinedTemplates.length - 1
          : Math.max(
              0,
              Math.min(
                combinedTemplates.length - 1,
                currentIndex + (event.key === "ArrowDown" ? 1 : -1),
              ),
            );

      const nextItem = combinedTemplates[nextIndex];
      if (!nextItem || nextIndex === currentIndex) {
        return;
      }

      selectCombinedTemplate(nextItem);
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [combinedTemplates, selectCombinedTemplate]);

  useEffect(() => {
    const selectedElement = scrollContainerRef.current?.querySelector(
      "[data-template-selected='true']",
    );

    if (!(selectedElement instanceof HTMLElement)) {
      return;
    }

    selectedElement.scrollIntoView({
      block: "nearest",
    });
  }, [effectiveSelectedMineId]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div>
        <CustomSidebarHeader>
          {userTemplates.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground relative z-[60]"
                >
                  <ArrowsDownUp size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent variant="app" align="end">
                <AppFloatingPanel className={appFloatingMenuPanelClassName}>
                  <DropdownMenuItem
                    onClick={() => setSortOption("alphabetical")}
                  >
                    <Trans>A to Z</Trans>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setSortOption("reverse-alphabetical")}
                  >
                    <Trans>Z to A</Trans>
                  </DropdownMenuItem>
                </AppFloatingPanel>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button
            size="icon"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground relative z-[60]"
            onClick={createDefaultTemplate}
          >
            <Plus size={16} />
          </Button>
        </CustomSidebarHeader>

        <div className="pb-2">
          <div
            className={cn([
              "bg-card shadow-button-neutral flex h-7 w-full shrink-0 items-center gap-2 rounded-md px-2",
              "focus-within:outline-ring focus-within:outline focus-within:outline-1",
            ])}
          >
            <MagnifyingGlass className="text-muted-foreground h-4 w-4 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearch("");
                }
              }}
              placeholder={t`Search templates...`}
              className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm placeholder:text-sm focus:outline-hidden"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className={cn([
                  "h-4 w-4 shrink-0",
                  "text-muted-foreground hover:text-muted-foreground",
                  "transition-colors",
                ])}
                aria-label={t`Clear search`}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        className="scrollbar-hide flex-1 overflow-y-auto"
      >
        {!hasResults ? (
          <div className="text-muted-foreground px-3 py-8 text-center">
            <BookOpenText
              size={32}
              className="text-muted-foreground/70 mx-auto mb-2"
            />
            <p className="text-sm">
              {search ? "No templates found" : "No templates yet"}
            </p>
            {!search && (
              <button
                onClick={createDefaultTemplate}
                className="text-muted-foreground hover:text-foreground mt-3 text-sm underline"
              >
                Create my first template
              </button>
            )}
          </div>
        ) : (
          <>
            {hasResults && (
              <div className="pt-1">
                {combinedTemplates.map((item) =>
                  item.source === "auto" ? (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setSelectedMineId(AUTO_TEMPLATE_ID)}
                      data-template-selected={item.selected}
                      className={cn([
                        "w-full rounded-md px-2.5 py-2 text-left text-sm select-none",
                        item.selected ? "bg-layer-2" : "hover:bg-layer-2",
                      ])}
                    >
                      <div className="flex items-center gap-2">
                        <Sparkle className="text-icon size-4" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">
                            {item.title}
                          </div>
                          {item.customized ? (
                            <div className="text-muted-foreground truncate text-xs">
                              <Trans>Customized</Trans>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  ) : (
                    <TemplateListItem
                      key={item.key}
                      template={item.template}
                      selected={item.selected}
                      onSelect={setSelectedMineId}
                      onToggleFavorite={handleToggleFavorite}
                      onDuplicate={handleDuplicateTemplate}
                      onDelete={handleDeleteTemplate}
                    />
                  ),
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TemplateListItem({
  template,
  selected,
  onSelect,
  onToggleFavorite,
  onDuplicate,
  onDelete,
}: {
  template: UserTemplate;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onDuplicate: (template: UserTemplate) => void;
  onDelete: (id: string) => void;
}) {
  const contextMenu = useMemo(
    () => [
      {
        id: `favorite-template-${template.id}`,
        text: template.pinned ? "Unfavorite" : "Favorite",
        action: () => onToggleFavorite(template.id),
      },
      { separator: true as const },
      {
        id: `duplicate-template-${template.id}`,
        text: "Duplicate",
        action: () => onDuplicate(template),
      },
      {
        id: `delete-template-${template.id}`,
        text: "Delete",
        action: () => onDelete(template.id),
      },
    ],
    [onDelete, onDuplicate, onToggleFavorite, template],
  );
  const showContextMenu = useNativeContextMenu(contextMenu);

  return (
    <button
      onClick={() => onSelect(template.id)}
      onContextMenu={(e) => {
        onSelect(template.id);
        void showContextMenu(e);
      }}
      data-template-selected={selected}
      className={cn([
        "w-full rounded-md px-2.5 py-2 text-left text-sm select-none",
        selected ? "bg-layer-2" : "hover:bg-layer-2",
      ])}
    >
      <div className="flex items-center gap-2">
        <TemplateIconGlyph icon={template.icon} className="size-4 text-sm" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">
            {template.title?.trim() || "Untitled"}
          </div>
        </div>
      </div>
    </button>
  );
}
