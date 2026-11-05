import { cn } from "@anlg/utils";

import { SyncProvider } from "~/calendar/components/context";

export type MainSurfaceChrome = "default" | "top" | "top-borderless" | "left";

export function MainShellScaffold({
  children,
  edgeToEdge = false,
  mainSurfaceChrome,
}: {
  children: React.ReactNode;
  edgeToEdge?: boolean;
  mainSurfaceChrome?: MainSurfaceChrome;
}) {
  const resolvedMainSurfaceChrome =
    mainSurfaceChrome ?? (edgeToEdge ? "top" : "default");
  // The content panel floats on the window chrome with an 8px gutter; rows
  // that already reserve a top chrome strip skip the top gutter.
  const hasTopChromeRow =
    resolvedMainSurfaceChrome === "top" ||
    resolvedMainSurfaceChrome === "default";

  return (
    <SyncProvider>
      <div
        className={cn([
          "bg-background flex h-full overflow-hidden",
          edgeToEdge
            ? [
                "[&_[data-chat-floating-anchor]]:rounded-none",
                "[&_[data-chat-floating-anchor]]:border-0",
              ]
            : [
                "[&_[data-chat-floating-anchor]]:mr-2",
                "[&_[data-chat-floating-anchor]]:mb-2",
                !hasTopChromeRow && "[&_[data-chat-floating-anchor]]:mt-2",
                resolvedMainSurfaceChrome !== "left" &&
                  "[&_[data-chat-floating-anchor]]:ml-2",
              ],
        ])}
        data-testid="main-app-shell"
      >
        {children}
      </div>
    </SyncProvider>
  );
}
