import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { CaretLeft } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { Input } from "@anlg/ui/components/ui/input";
import { cn } from "@anlg/utils";

import { useAuth } from "~/auth";
import { WindowsWindowControls } from "~/main/windows-window-controls";
import { usesWindowsStyleTitleBar } from "~/shared/hooks/useWindowControlsGutter";

export type InstructionType = "sign-in";

function InstructionShell({
  title,
  description,
  icon,
  onBack,
  onClose,
  action,
  children,
}: {
  title: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  onBack: () => void;
  onClose: () => void;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="from-background via-card to-card relative flex h-full flex-col overflow-hidden bg-linear-to-b select-none">
      <div className="from-muted/40 pointer-events-none absolute inset-x-0 top-0 h-32 bg-linear-to-b to-transparent" />
      {usesWindowsStyleTitleBar() ? (
        <div
          data-tauri-drag-region
          className="absolute inset-x-0 top-0 z-20 flex h-10 justify-end"
        >
          <WindowsWindowControls onClose={onClose} />
        </div>
      ) : null}

      <div
        data-tauri-drag-region
        className="relative z-10 flex shrink-0 items-center px-3 pt-12"
      >
        <button
          type="button"
          onClick={onBack}
          className={cn([
            "text-muted-foreground hover:bg-muted/70 hover:text-muted-foreground flex h-9 items-center gap-1.5 rounded-full px-3 transition-colors",
          ])}
        >
          <CaretLeft className="h-4 w-4" />
          <span className="text-xs font-medium">
            <Trans>Back</Trans>
          </span>
        </button>
      </div>

      <div
        data-tauri-drag-region
        className="relative z-10 flex flex-1 items-center justify-center p-6"
      >
        <div className="flex w-full max-w-sm flex-col items-center gap-6 px-10 pb-10 text-center">
          {icon ?? (
            <img
              src="/assets/anarlog-icon.png"
              alt=""
              className="h-14 w-14 object-contain object-center"
            />
          )}

          <div className="flex max-w-full flex-col gap-3">
            <h2 className="text-foreground font-sans text-[22px] leading-[1.15] font-semibold break-words sm:text-[28px]">
              {title}
            </h2>
            <p className="text-muted-foreground text-sm leading-6">
              {description}
            </p>
          </div>

          {action ? <div className="w-full">{action}</div> : null}
          {children ? (
            <div className="flex w-full flex-col items-center gap-3">
              {children}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function InstructionScreen({
  onBack,
  onClose,
}: {
  onBack: () => void;
  onClose: () => void;
}) {
  return <SignInInstruction onBack={onBack} onClose={onClose} />;
}

function SignInInstruction({
  onBack,
  onClose,
}: {
  onBack: () => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const auth = useAuth();
  const [callbackUrl, setCallbackUrl] = useState("");
  const [showCallbackInput, setShowCallbackInput] = useState(false);

  useEffect(() => {
    if (!auth?.session) {
      return;
    }

    onBack();
  }, [auth?.session, onBack]);

  return (
    <InstructionShell
      title={t`Sign in to your account`}
      description={t`Complete sign-in in your browser, then return to Anarlog.`}
      onBack={onBack}
      onClose={onClose}
    >
      {showCallbackInput ? (
        <>
          <div className="flex w-full flex-col gap-2">
            <Input
              type="text"
              className="h-10 font-mono text-xs"
              placeholder="anarlog://auth/callback?access_token=..."
              value={callbackUrl}
              onChange={(e) => setCallbackUrl(e.target.value)}
            />
            <Button
              className="h-10"
              onClick={() => void auth.handleAuthCallback(callbackUrl)}
              disabled={!callbackUrl}
            >
              <Trans>Submit callback URL</Trans>
            </Button>
          </div>
          <p className="text-muted-foreground text-xs leading-5">
            <Trans>
              Paste the browser URL here if the browser button did not reopen
              Anarlog.
            </Trans>
          </p>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setShowCallbackInput(true)}
          className={cn([
            "text-muted-foreground hover:text-muted-foreground text-xs font-medium underline underline-offset-4 transition-colors",
          ])}
        >
          <Trans>
            Browser handoff not working? Paste the callback link instead
          </Trans>
        </button>
      )}
    </InstructionShell>
  );
}
