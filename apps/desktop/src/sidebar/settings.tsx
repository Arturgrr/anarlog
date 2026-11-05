import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";

import { MagnifyingGlass, X } from "@anlg/ui/components/icons";
import { cn } from "@anlg/utils";

import { CustomSidebarHeader } from "./custom-sidebar-header";
import { useSettingsNavGroups } from "./settings-nav-groups";

import { type SettingsTab, useTabs } from "~/store/zustand/tabs";

export function SettingsNav() {
  const { t } = useLingui();
  const groups = useSettingsNavGroups();
  const [search, setSearch] = useState("");
  const currentTab = useTabs((state) => state.currentTab);
  const updateSettingsTabState = useTabs(
    (state) => state.updateSettingsTabState,
  );
  const openNew = useTabs((state) => state.openNew);

  const requestedTab =
    currentTab?.type === "settings" ? (currentTab.state.tab ?? "app") : "app";
  const activeTab =
    requestedTab === "audio"
      ? "meetings"
      : requestedTab === "stats"
        ? "insights"
        : requestedTab;

  const setActiveTab = useCallback(
    (tab: SettingsTab) => {
      if (currentTab?.type === "settings") {
        updateSettingsTabState(currentTab, { tab });
      }
    },
    [currentTab, updateSettingsTabState],
  );

  const query = search.trim().toLowerCase();
  const visibleGroups = query
    ? groups
        .map((group) =>
          group.label.toLowerCase().includes(query)
            ? group
            : {
                ...group,
                items: group.items.filter((item) =>
                  item.label.toLowerCase().includes(query),
                ),
              },
        )
        .filter((group) => group.items.length > 0)
    : groups;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <CustomSidebarHeader />
      <div className="pb-2">
        <div
          className={cn([
            "bg-card shadow-button-neutral flex h-7 w-full shrink-0 items-center gap-2 rounded-md px-2",
            "focus-within:outline-ring transition-[box-shadow,outline-color] duration-200 ease-out focus-within:shadow-none focus-within:outline-1",
          ])}
        >
          <MagnifyingGlass className="text-icon-muted h-4 w-4 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearch("");
              }
            }}
            placeholder={t`Search settings...`}
            className="placeholder:text-faint text-ui-compact min-w-0 flex-1 bg-transparent focus:outline-hidden"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className={cn([
                "size-4 shrink-0",
                "text-muted-foreground hover:text-foreground",
                "transition-colors",
              ])}
              aria-label={t`Clear search`}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="scrollbar-hide flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 pb-6">
          {visibleGroups.length === 0 ? (
            <div className="text-muted-foreground px-3 py-8 text-center">
              <MagnifyingGlass
                size={32}
                className="text-muted-foreground/70 mx-auto mb-2"
              />
              <p className="text-sm">
                <Trans>No results found.</Trans>
              </p>
            </div>
          ) : null}
          {visibleGroups.map((group) => (
            <div key={group.label} className="flex flex-col gap-0.5">
              <span className="text-faint text-small font-ui-medium px-1.5 pt-1 pb-1.5">
                {group.label}
              </span>
              {group.items.map((item) => (
                <div key={item.id} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      if ("destination" in item) {
                        openNew(item.destination);
                        return;
                      }

                      setActiveTab(item.id);
                    }}
                    className={cn([
                      "group/nav text-ui flex h-7 w-full items-center gap-2 rounded-sm px-1.5 text-left",
                      activeTab === item.id
                        ? "bg-layer-2 text-foreground"
                        : "text-muted-foreground hover:bg-hover active:bg-pressed hover:text-foreground",
                    ])}
                  >
                    <item.icon
                      size={16}
                      className={cn([
                        "shrink-0",
                        activeTab === item.id
                          ? "text-icon"
                          : "text-icon-muted group-hover/nav:text-icon",
                      ])}
                      data-testid={`settings-nav-icon-${item.id}`}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
