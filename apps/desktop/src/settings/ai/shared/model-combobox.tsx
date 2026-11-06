import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useMemo, useState } from "react";

import {
  ArrowsCounterClockwise,
  CaretDown,
  Check,
  Eye,
  EyeSlash,
  PlusCircle,
} from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@anlg/ui/components/ui/command";
import {
  AppFloatingPanel,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@anlg/ui/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@anlg/ui/components/ui/tooltip";
import { cn } from "@anlg/utils";

import type { ListModelsResult, ModelIgnoreReason } from "./list-common";
import { displayLlmModelId } from "./model-display";

import { useModelMetadata } from "~/ai/hooks";

const filterFunction = (value: string, search: string) => {
  const v = value.toLocaleLowerCase();
  const s = search.toLocaleLowerCase();
  if (v.includes(s)) {
    return 1;
  }
  return 0;
};

const formatIgnoreReason = (reason: ModelIgnoreReason, i18n: I18n): string => {
  switch (reason) {
    case "common_keyword":
      return i18n._(msg`Contains common ignore keyword`);
    case "old_model":
      return i18n._(msg`Old or deprecated model`);
    case "date_snapshot":
      return i18n._(msg`Date-specific snapshot`);
    case "no_tool":
      return i18n._(msg`No tool support`);
    case "no_text_input":
      return i18n._(msg`No text input support`);
    case "no_completion":
      return i18n._(msg`No completion support`);
    case "not_llm":
      return i18n._(msg`Not an LLM type`);
    case "not_chat_model":
      return i18n._(msg`Not a chat model`);
    case "context_too_small":
      return i18n._(msg`Context length too small`);
  }
};

export function ModelCombobox({
  providerId,
  value,
  onChange,
  listModels,
  disabled = false,
  placeholder,
  suffix,
  isConfigured = false,
}: {
  providerId: string;
  value: string;
  onChange: (value: string) => void;
  listModels?: () => Promise<ListModelsResult> | ListModelsResult;
  disabled?: boolean;
  placeholder?: string;
  suffix?: React.ReactNode;
  isConfigured?: boolean;
}) {
  const { t, i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showIgnored, setShowIgnored] = useState(false);

  const {
    data: fetchedResult,
    isLoading: isLoadingModels,
    refetch,
    isFetching,
  } = useModelMetadata(providerId, listModels, { enabled: !disabled });

  const options: string[] = useMemo(
    () => fetchedResult?.models ?? [],
    [fetchedResult],
  );
  const ignoredOptions = useMemo(
    () => fetchedResult?.ignored ?? [],
    [fetchedResult],
  );
  const trimmedQuery = query.trim();
  const hasExactMatch = useMemo(
    () =>
      options.some(
        (option) =>
          option.toLocaleLowerCase() === trimmedQuery.toLocaleLowerCase(),
      ),
    [options, trimmedQuery],
  );
  const canSelectFreeform = trimmedQuery.length > 0 && !hasExactMatch;
  const hasIgnoredOptions = ignoredOptions.length > 0;
  const isSelectedDeprecated = ignoredOptions.some(
    (option) => option.id === value && option.reasons.includes("old_model"),
  );

  const handleSelect = useCallback(
    (option: string) => {
      onChange(option);
      setOpen(false);
      setQuery("");
    },
    [onChange],
  );

  const toggleShowIgnored = useCallback(
    () => setShowIgnored((prev) => !prev),
    [],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled || isLoadingModels}
          aria-expanded={open}
          className={cn([
            "w-full justify-between font-normal",
            "rounded-md px-2.5",
          ])}
        >
          <span className="flex w-full min-w-0 items-center justify-between gap-2">
            {value && value.length > 0 ? (
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={cn([
                    "truncate",
                    isSelectedDeprecated && "text-muted-foreground",
                  ])}
                >
                  {displayLlmModelId(value)}
                </span>
                {isSelectedDeprecated ? <DeprecatedBadge /> : null}
              </span>
            ) : (
              <span className="text-muted-foreground truncate">
                {isLoadingModels
                  ? t`Loading models...`
                  : (placeholder ?? t`Select a model`)}
              </span>
            )}
            {suffix}
          </span>
          {isConfigured ? (
            <Check className="text-foreground -mr-1 h-4 w-4 shrink-0" />
          ) : (
            <CaretDown className="-mr-1 h-4 w-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        variant="app"
        style={{ width: "var(--radix-popover-trigger-width)" }}
      >
        <AppFloatingPanel className="overflow-hidden">
          <Command
            filter={filterFunction}
            className="rounded-[inherit] border-0 bg-transparent"
          >
            <CommandInput
              placeholder={t`Search or create new`}
              value={query}
              onValueChange={(value: string) => setQuery(value)}
              onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                }
              }}
            />
            <CommandEmpty>
              <div className="text-muted-foreground px-2 py-1.5 text-sm">
                {trimmedQuery.length > 0 ? (
                  <p>
                    <Trans>No results found.</Trans>
                  </p>
                ) : hasIgnoredOptions ? (
                  <p>
                    <Trans>No models ready to use.</Trans>
                  </p>
                ) : (
                  <p>
                    <Trans>No models available.</Trans>
                  </p>
                )}
              </div>
            </CommandEmpty>

            <CommandList>
              <CommandGroup className="overflow-y-auto">
                {options.map((option) => (
                  <CommandItem
                    key={option}
                    tabIndex={0}
                    value={`${option} ${displayLlmModelId(option)}`}
                    onSelect={() => {
                      handleSelect(option);
                    }}
                    onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
                      if (event.key === "Enter") {
                        event.stopPropagation();
                        handleSelect(option);
                      }
                    }}
                    className={cn([
                      "cursor-pointer",
                      "hover:bg-accent! focus:bg-accent! aria-selected:bg-transparent",
                    ])}
                  >
                    <span className="truncate">
                      {displayLlmModelId(option)}
                    </span>
                  </CommandItem>
                ))}

                {showIgnored &&
                  ignoredOptions.map((option) => (
                    <CommandItem
                      key={`ignored-${option.id}`}
                      tabIndex={0}
                      value={`${option.id} ${displayLlmModelId(option.id)}`}
                      onSelect={() => {
                        handleSelect(option.id);
                      }}
                      onKeyDown={(
                        event: React.KeyboardEvent<HTMLDivElement>,
                      ) => {
                        if (event.key === "Enter") {
                          event.stopPropagation();
                          handleSelect(option.id);
                        }
                      }}
                      className={cn([
                        "cursor-pointer opacity-50",
                        "hover:bg-accent! focus:bg-accent! aria-selected:bg-transparent",
                      ])}
                    >
                      <Tooltip delayDuration={10}>
                        <TooltipTrigger asChild>
                          <span className="flex w-full min-w-0 items-center gap-2">
                            <span className="truncate">
                              {displayLlmModelId(option.id)}
                            </span>
                            {option.reasons.includes("old_model") ? (
                              <DeprecatedBadge />
                            ) : null}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="text-xs">
                          <div className="flex flex-col gap-0.5">
                            {option.reasons.map((reason) => (
                              <div key={reason}>
                                • {formatIgnoreReason(reason, i18n)}
                              </div>
                            ))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </CommandItem>
                  ))}

                {canSelectFreeform && (
                  <CommandItem
                    key={`freeform-${trimmedQuery}`}
                    tabIndex={0}
                    value={trimmedQuery}
                    onSelect={() => {
                      handleSelect(trimmedQuery);
                    }}
                    onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
                      if (event.key === "Enter") {
                        event.stopPropagation();
                        handleSelect(trimmedQuery);
                      }
                    }}
                    className={cn([
                      "cursor-pointer",
                      "hover:bg-accent! focus:bg-accent! aria-selected:bg-transparent",
                    ])}
                  >
                    <PlusCircle className="mr-2 h-4 w-4" />
                    <span className="truncate">
                      <Trans>Select "{trimmedQuery}"</Trans>
                    </span>
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>

            <div className="text-muted-foreground flex items-center justify-between border-t px-2 py-1.5 text-xs">
              <button
                type="button"
                onClick={toggleShowIgnored}
                aria-label={
                  showIgnored ? t`Hide ignored models` : t`Show ignored models`
                }
                className="hover:text-foreground mr-1 flex items-center gap-1 text-xs transition-colors"
              >
                {showIgnored ? (
                  <EyeSlash className="h-3 w-3" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
              </button>

              {hasIgnoredOptions && (
                <span>
                  {showIgnored ? (
                    <Plural
                      value={options.length}
                      one="Showing total of # model."
                      other="Showing total of # models."
                    />
                  ) : (
                    <Plural
                      value={ignoredOptions.length}
                      one="# item ignored."
                      other="# items ignored."
                    />
                  )}
                </span>
              )}

              <button
                type="button"
                onClick={() => refetch()}
                disabled={isFetching}
                aria-label={t`Refresh models`}
                className="hover:text-foreground ml-auto flex items-center gap-1 text-xs transition-colors disabled:opacity-50"
              >
                <ArrowsCounterClockwise
                  className={cn(["h-3 w-3", isFetching && "animate-spin"])}
                />
              </button>
            </div>
          </Command>
        </AppFloatingPanel>
      </PopoverContent>
    </Popover>
  );
}

function DeprecatedBadge() {
  return (
    <span
      className={cn([
        "inline-flex h-[18px] shrink-0 items-center rounded-xs border-[0.5px] px-1.5",
        "border-border bg-layer-2 text-small text-muted-foreground font-medium",
      ])}
    >
      <Trans>Deprecated</Trans>
    </span>
  );
}
