import { Trans, useLingui } from "@lingui/react/macro";
import type { HTMLAttributes, ReactNode } from "react";

import { Waveform } from "@anlg/ui/components/icons";
import { cn } from "@anlg/utils";

import { AUDIO_EXTENSIONS } from "~/stt/useUploadFile";

export function AudioDropTarget({
  children,
  className,
  isActive,
  targetProps,
}: {
  children: ReactNode;
  className?: string;
  isActive: boolean;
  targetProps: HTMLAttributes<HTMLDivElement>;
}) {
  const { t } = useLingui();
  const labels = AUDIO_EXTENSIONS.map((extension) => extension.toUpperCase());
  const lastLabel = labels[labels.length - 1] ?? "";
  const leadingLabels = labels.slice(0, -1).join(", ");
  const supportedAudioFormats =
    labels.length <= 1 ? lastLabel : t`${leadingLabels}, or ${lastLabel}`;

  return (
    <div {...targetProps} className={cn(["relative min-h-full", className])}>
      {isActive && (
        <div
          role="status"
          className={cn([
            "pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-lg border border-dashed",
            "border-border/70 bg-background text-muted-foreground shadow-inner",
            "[background-image:radial-gradient(circle_at_center,_var(--border-strong)_1px,_transparent_1px)]",
            "[background-size:18px_18px]",
          ])}
        >
          <div className="border-border/70 bg-card/95 text-foreground flex items-center gap-3 rounded-md border px-4 py-3 shadow-sm">
            <Waveform className="text-muted-foreground size-5 shrink-0" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-sm font-medium">
                <Trans>Drop to upload and transcribe audio</Trans>
              </p>
              <p className="text-muted-foreground text-xs">
                <Trans>{supportedAudioFormats} audio</Trans>
              </p>
            </div>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
