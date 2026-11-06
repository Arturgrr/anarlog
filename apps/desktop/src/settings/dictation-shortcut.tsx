import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { platform } from "@tauri-apps/plugin-os";
import { useRef, useState } from "react";

import { commands as shortcuts } from "@anlg/plugin-shortcut";
import { Button } from "@anlg/ui/components/ui/button";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";

import { waitForDictationCleanup } from "~/dictation/lifecycle";
import { useDictationStatus } from "~/dictation/state";
import { localizeExternalMessage } from "~/i18n/external-messages";
import { setSettingValue } from "~/settings/queries";

const DOUBLE_TAP_PREFIX = "DoubleTap+";
const DOUBLE_TAP_CODES = [
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
];

export function isDoubleTapShortcut(shortcut: string) {
  return shortcut.startsWith(DOUBLE_TAP_PREFIX);
}

function shortcutKeys(shortcut: string) {
  return isDoubleTapShortcut(shortcut)
    ? [shortcut.slice(DOUBLE_TAP_PREFIX.length), "DoubleTap"]
    : shortcut.split("+");
}

export function DictationShortcut({ shortcut }: { shortcut: string }) {
  const { t } = useLingui();
  const mac = platform() === "macos";
  const [recording, setRecording] = useState(false);
  const attempt = useRef(0);
  const persisting = useRef(false);
  const lastModifierPress = useRef<{ code: string; at: number } | null>(null);
  const prepare = useMutation({ mutationFn: waitForDictationCleanup });
  const save = useMutation({
    mutationFn: async ({ value, token }: { value: string; token: number }) => {
      const result = await shortcuts.validate(value);
      if (token !== attempt.current) return;
      if (result.status === "error")
        throw new Error(localizeExternalMessage(result.error));
      persisting.current = true;
      setRecording(false);
      useDictationStatus.setState({ capturingShortcut: false });
      try {
        await setSettingValue("dictation_shortcut", value);
      } finally {
        persisting.current = false;
      }
    },
    onError: (_, { token }) => {
      if (token !== attempt.current) return;
      setRecording(false);
      useDictationStatus.setState({ capturingShortcut: false });
    },
    onSuccess: (_, { token }) => {
      if (token === attempt.current) finish();
    },
  });

  function finish() {
    if (persisting.current) return;
    attempt.current += 1;
    setRecording(false);
    useDictationStatus.setState({ capturingShortcut: false });
    save.reset();
  }

  useMountEffect(() => () => {
    attempt.current += 1;
    useDictationStatus.setState({ capturingShortcut: false });
  });

  const labels: Record<string, string> = {
    Control: mac ? "⌃" : "Ctrl",
    Alt: mac ? "⌥" : "Alt",
    Shift: mac ? "⇧" : "Shift",
    Super: mac ? "⌘" : "Super",
    Meta: mac ? "⌘" : "Super",
    Fn: t`Fn / Globe`,
    RightCommand: t`Right Command`,
    DoubleTap: "×2",
    AltLeft: t`Left ⌥`,
    AltRight: t`Right ⌥`,
    MetaLeft: t`Left ⌘`,
    MetaRight: t`Right ⌘`,
    ControlLeft: t`Left ⌃`,
    ControlRight: t`Right ⌃`,
    ShiftLeft: t`Left ⇧`,
    ShiftRight: t`Right ⇧`,
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <span id="dictation-shortcut-label" className="text-sm font-medium">
          <Trans>Dictation shortcut</Trans>
        </span>
        <Button
          type="button"
          variant="outline"
          aria-labelledby="dictation-shortcut-label"
          aria-pressed={recording}
          disabled={save.isPending && !recording}
          aria-busy={save.isPending && !recording}
          onClick={() => {
            if (recording) return finish();
            attempt.current += 1;
            lastModifierPress.current = null;
            save.reset();
            useDictationStatus.setState({ capturingShortcut: true });
            prepare.mutate();
            setRecording(true);
          }}
          onBlur={finish}
          onKeyDown={(event) => {
            if (!recording) return;
            event.stopPropagation();
            if (event.key === "Tab") {
              finish();
              return;
            }
            event.preventDefault();
            if (event.key === "Escape") return finish();
            if (event.repeat || !prepare.isSuccess || save.isPending) return;
            if (["Control", "Alt", "Meta", "Shift", "Fn"].includes(event.key)) {
              // On macOS, two quick presses of one modifier key on its own
              // record a double-tap shortcut.
              const previous = lastModifierPress.current;
              const alone =
                [
                  event.ctrlKey,
                  event.altKey,
                  event.shiftKey,
                  event.metaKey,
                ].filter(Boolean).length === 1;
              lastModifierPress.current =
                mac && alone && DOUBLE_TAP_CODES.includes(event.code)
                  ? { code: event.code, at: performance.now() }
                  : null;
              if (
                lastModifierPress.current &&
                previous?.code === event.code &&
                lastModifierPress.current.at - previous.at < 500
              ) {
                lastModifierPress.current = null;
                save.mutate({
                  value: `${DOUBLE_TAP_PREFIX}${event.code}`,
                  token: attempt.current,
                });
              }
              return;
            }
            lastModifierPress.current = null;
            const modifiers = [
              event.ctrlKey && "Control",
              event.altKey && "Alt",
              event.shiftKey && "Shift",
              event.metaKey && "Super",
            ].filter(Boolean);
            save.mutate({
              value: [...modifiers, event.code].join("+"),
              token: attempt.current,
            });
          }}
        >
          {recording ? (
            !prepare.isSuccess ? (
              <Trans>Preparing…</Trans>
            ) : (
              <Trans>Press shortcut…</Trans>
            )
          ) : (
            <span className="inline-flex items-center gap-1">
              {shortcutKeys(shortcut).map((key) => (
                <kbd
                  key={key}
                  className="bg-muted rounded border px-1.5 py-0.5 font-sans text-xs"
                >
                  {labels[key] ?? key.replace(/^(Key|Digit)/, "")}
                </kbd>
              ))}
            </span>
          )}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        {mac ? (
          <Trans>
            Click the shortcut to record a new key combination, or press one
            modifier key twice quickly. Press Escape to cancel.
          </Trans>
        ) : (
          <Trans>
            Click the shortcut to record a new key combination. Press Escape to
            cancel.
          </Trans>
        )}
      </p>
      {save.error && (
        <p role="alert" className="text-destructive text-sm">
          {save.error.message}
        </p>
      )}
      {mac && (
        <div className="flex gap-2">
          {[
            [`${DOUBLE_TAP_PREFIX}AltLeft`, t`Left ⌥ twice`],
            ["Fn", t`Fn / Globe`],
            ["RightCommand", t`Right Command`],
          ].map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant="outline"
              disabled={save.isPending}
              onClick={() => save.mutate({ value, token: attempt.current })}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
