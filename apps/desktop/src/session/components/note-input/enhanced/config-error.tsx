import { Trans } from "@lingui/react/macro";

import { Button } from "@anlg/ui/components/ui/button";

import { useTabs } from "~/store/zustand/tabs";

export function ConfigError() {
  const openNew = useTabs((state) => state.openNew);

  return (
    <div
      role="alert"
      className="flex h-full min-h-[400px] flex-col items-center justify-center px-6"
    >
      <div className="mb-6 flex max-w-md flex-col gap-2 text-center">
        <p className="text-base font-medium">
          <Trans>Set up AI summaries</Trans>
        </p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          <Trans>
            Choose an AI provider to generate a summary from this transcript.
          </Trans>
        </p>
      </div>
      <Button
        onClick={() =>
          openNew({ type: "settings", state: { tab: "intelligence" } })
        }
      >
        <Trans>Set up AI</Trans>
      </Button>
    </div>
  );
}
