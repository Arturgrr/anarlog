import { Trans, useLingui } from "@lingui/react/macro";

import { Check } from "@anlg/ui/components/icons";
import { cn } from "@anlg/utils";

import { useSetSettingValue } from "~/settings/queries";
import { useConfigValue } from "~/shared/config";
import { normalizeAppIconPreference } from "~/shared/theme/icon";
import { applyThemePreference } from "~/shared/theme/provider";
import type { ThemePreference } from "~/shared/theme/resolve";

const THEME_OPTIONS = [
  "light",
  "dark",
  "system",
] as const satisfies readonly ThemePreference[];

export function ThemeSelector() {
  const { t } = useLingui();
  const storedValue = useConfigValue("theme") as ThemePreference;
  const value = THEME_OPTIONS.includes(storedValue) ? storedValue : "system";
  const appIcon = normalizeAppIconPreference(useConfigValue("app_icon"));
  const setTheme = useSetSettingValue("theme");
  const options = [
    { value: "light", label: t`Light`, description: t`Bright canvas` },
    { value: "dark", label: t`Dark`, description: t`Low-light canvas` },
    { value: "system", label: t`System`, description: t`Match your device` },
  ] as const satisfies readonly {
    value: ThemePreference;
    label: string;
    description: string;
  }[];

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold">
          <Trans>Theme</Trans>
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">
          <Trans>Choose how Anarlog looks on this device.</Trans>
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label={t`Color theme`}
        className="grid gap-3 sm:grid-cols-3"
      >
        {options.map((option) => {
          const selected = value === option.value;

          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={cn([
                "group bg-card text-foreground shadow-raised focus-visible:outline-ring relative cursor-pointer overflow-hidden rounded-lg text-left transition-[box-shadow,scale] duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-[2.5px] active:scale-[0.98]",
                selected && "ring-foreground ring-[1.5px]",
              ])}
              onClick={() => {
                void applyThemePreference(option.value, appIcon);
                setTheme(option.value);
              }}
            >
              <ThemePreview theme={option.value} />
              <div className="border-border-muted flex items-center gap-2 border-t p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{option.label}</div>
                  <div className="text-muted-foreground text-xs">
                    {option.description}
                  </div>
                </div>
                <span
                  aria-hidden="true"
                  className={cn([
                    "bg-foreground text-background flex size-5 shrink-0 items-center justify-center rounded-full transition-[filter,opacity,scale] duration-150",
                    selected
                      ? "scale-100 opacity-100 blur-none"
                      : "scale-25 opacity-0 blur-[4px]",
                  ])}
                >
                  <Check className="size-3" weight="bold" />
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ThemePreview({ theme }: { theme: ThemePreference }) {
  return (
    <div aria-hidden="true" className="relative h-28 overflow-hidden">
      <PreviewCanvas dark={theme === "dark"} />
      {theme === "system" ? (
        <div className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
          <PreviewCanvas dark />
        </div>
      ) : null}
    </div>
  );
}

function PreviewCanvas({ dark }: { dark: boolean }) {
  const line = dark ? "bg-[#aeaeae]/25" : "bg-[#5c5c5c]/25";

  return (
    <div
      className={cn([
        "absolute inset-0 flex flex-col p-2",
        dark ? "bg-[#080808]" : "bg-[#fafafa]",
      ])}
    >
      <div className="mb-2 flex gap-1 px-1 pt-1">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className={cn([
              "size-1.5 rounded-full",
              dark ? "bg-[#2e2e2e]" : "bg-[#dbdbdb]",
            ])}
          />
        ))}
      </div>
      <div className="flex flex-1 gap-2">
        <div className="flex w-1/4 flex-col gap-1.5 pt-1">
          <span
            className={cn([
              "h-2 w-full rounded-xs",
              dark ? "bg-[#2e2e2e]" : "bg-[#f2f2f2]",
            ])}
          />
          <span className={cn(["h-1 w-3/4 rounded-full", line])} />
          <span className={cn(["h-1 w-2/3 rounded-full", line])} />
        </div>
        <div
          className={cn([
            "flex flex-1 flex-col gap-2 rounded-md border p-2",
            dark
              ? "border-[#282828] bg-[#161616]"
              : "border-[#dbdbdb] bg-[#ffffff]",
          ])}
        >
          <span
            className={cn([
              "h-1.5 w-10 rounded-full",
              dark ? "bg-[#fafafa]" : "bg-[#161616]",
            ])}
          />
          <span className={cn(["h-1 w-4/5 rounded-full", line])} />
          <span className={cn(["h-1 w-3/5 rounded-full", line])} />
          <span className={cn(["h-1 w-2/3 rounded-full", line])} />
        </div>
      </div>
    </div>
  );
}
