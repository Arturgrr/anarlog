import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { platform } from "@tauri-apps/plugin-os";
import { useId, useRef, useState } from "react";

import { commands as shortcutCommands } from "@anlg/plugin-shortcut";
import { Plus, X } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";
import { cn } from "@anlg/utils";

import { waitForDictationCleanup } from "~/dictation/lifecycle";
import { waitForPasteLastCleanup } from "~/dictation/paste-last";
import { useDictationStatus } from "~/dictation/state";
import { localizeExternalMessage } from "~/i18n/external-messages";
import { setSettingValues } from "~/settings/queries";
import { useConfigValue } from "~/shared/config";

const MAX_SHORTCUTS = 4;
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
const MODIFIER_KEYS = ["Control", "Alt", "Meta", "Shift", "Fn"];
const MODIFIER_ALIASES: Record<string, string> = {
  ctrl: "control",
  option: "alt",
  meta: "super",
  command: "super",
  cmd: "super",
};

export function isDoubleTapShortcut(shortcut: string) {
  return shortcut.startsWith(DOUBLE_TAP_PREFIX);
}

export function shortcutKeys(shortcut: string) {
  return isDoubleTapShortcut(shortcut)
    ? [shortcut.slice(DOUBLE_TAP_PREFIX.length), "DoubleTap"]
    : shortcut.split("+");
}

// Shortcuts that differ only in the order or spelling of their modifiers are
// the same shortcut.
function shortcutIdentity(shortcut: string) {
  if (isDoubleTapShortcut(shortcut)) return shortcut;
  const parts = shortcut.toLowerCase().split("+");
  const key = parts.pop();
  const modifiers = new Set(
    parts.map((part) => MODIFIER_ALIASES[part] ?? part),
  );
  return [...[...modifiers].sort(), key].join("+");
}

function heldModifiers(event: KeyboardEvent) {
  return [
    event.ctrlKey && "Control",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.metaKey && "Super",
  ].filter((modifier): modifier is string => Boolean(modifier));
}

function persist(shortcuts: string[]) {
  return setSettingValues({
    dictation_shortcuts: JSON.stringify(shortcuts),
    dictation_shortcut: shortcuts[0],
  });
}

export function useKeyLabel() {
  const { t } = useLingui();
  const mac = platform() === "macos";
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
  return (key: string) => labels[key] ?? key.replace(/^(Key|Digit)/, "");
}

export function ShortcutKeys({ keys }: { keys: string[] }) {
  const label = useKeyLabel();
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key) => (
        <kbd
          key={key}
          className="bg-muted rounded border px-1.5 py-0.5 font-sans text-xs"
        >
          {label(key)}
        </kbd>
      ))}
    </span>
  );
}

// Records one shortcut at a time into `slot`. While recording, every global
// shortcut is released so the keys reach the page; a validation result that
// arrives after the recording ended is dropped.
export function useShortcutRecorder<Slot>({
  validate,
  persist,
}: {
  validate: (value: string, slot: Slot) => Promise<string | null>;
  persist: (value: string, slot: Slot) => Promise<void>;
}) {
  const [editing, setEditing] = useState<Slot | null>(null);
  const attempt = useRef(0);
  const persisting = useRef(false);
  const save = useMutation({
    mutationFn: async ({
      value,
      slot,
      token,
    }: {
      value: string;
      slot: Slot;
      token: number;
    }) => {
      const problem = await validate(value, slot);
      if (token !== attempt.current) return;
      if (problem) throw new Error(problem);
      persisting.current = true;
      try {
        await persist(value, slot);
      } finally {
        persisting.current = false;
      }
    },
    onSuccess: (_, { token }) => {
      if (token === attempt.current) finish();
    },
  });

  function start(slot: Slot) {
    attempt.current += 1;
    save.reset();
    useDictationStatus.setState({ capturingShortcut: true });
    setEditing(slot);
  }

  function finish() {
    if (persisting.current) return;
    attempt.current += 1;
    setEditing(null);
    useDictationStatus.setState({ capturingShortcut: false });
    save.reset();
  }

  useMountEffect(() => () => {
    attempt.current += 1;
    useDictationStatus.setState({ capturingShortcut: false });
  });

  return {
    editing,
    start,
    finish,
    saving: save.isPending,
    error: save.error,
    save: (value: string, slot: Slot) =>
      save.mutate({ value, slot, token: attempt.current }),
    input: () => {
      if (!save.isPending) save.reset();
    },
  };
}

export function ShortcutCaptureHint({
  id,
  doubleTap,
}: {
  id: string;
  doubleTap: boolean;
}) {
  return (
    <p id={id} className="text-muted-foreground text-xs">
      {doubleTap ? (
        <Trans>
          Press the keys you want, or press one modifier key twice quickly, then
          press Enter to save. Enter can't be part of a shortcut. Press
          Backspace to clear or Escape to cancel.
        </Trans>
      ) : (
        <Trans>
          Press the keys you want, then press Enter to save. Enter can't be part
          of a shortcut. Press Backspace to clear or Escape to cancel.
        </Trans>
      )}
    </p>
  );
}

export function DictationShortcuts({ shortcuts }: { shortcuts: string[] }) {
  const { t } = useLingui();
  const mac = platform() === "macos";
  const label = useKeyLabel();
  const titleId = useId();
  const hintId = useId();
  const pasteLastEnabled = useConfigValue("dictation_paste_last_enabled");
  const pasteLast = useConfigValue("dictation_paste_last_shortcut");
  const recorder = useShortcutRecorder<number>({
    validate: async (value, index) => {
      const identity = shortcutIdentity(value);
      if (
        shortcuts.some(
          (shortcut, position) =>
            position !== index && shortcutIdentity(shortcut) === identity,
        )
      )
        return t`This shortcut is already in your list.`;
      const result = await shortcutCommands.validate(
        value,
        pasteLastEnabled ? pasteLast : null,
      );
      return result.status === "error"
        ? localizeExternalMessage(result.error)
        : null;
    },
    persist: (value, index) => {
      const next = shortcuts.slice();
      next[index] = value;
      return persist(next);
    },
  });
  const remove = useMutation({
    mutationFn: (index: number) =>
      persist(shortcuts.filter((_, position) => position !== index)),
  });
  const busy = recorder.saving || remove.isPending;
  const full = shortcuts.length >= MAX_SHORTCUTS;
  const error = recorder.error ?? remove.error;
  const editing = recorder.editing;

  function start(index: number) {
    remove.reset();
    recorder.start(index);
  }

  const describe = (shortcut: string) =>
    shortcutKeys(shortcut).map(label).join(" ");
  const capture = editing !== null && (
    <ShortcutCapture
      label={t`New dictation shortcut`}
      doubleTap={mac}
      describedBy={hintId}
      busy={recorder.saving}
      onInput={recorder.input}
      onConfirm={(value) => recorder.save(value, editing)}
      onCancel={recorder.finish}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="mb-1 text-sm font-medium">
            <Trans>Dictation shortcuts</Trans>
          </h3>
          <p className="text-muted-foreground text-xs">
            <Trans>
              Any of these shortcuts starts dictation. Click one to change it.
              You can add up to {MAX_SHORTCUTS}.
            </Trans>
          </p>
        </div>
        <ul
          aria-labelledby={titleId}
          className="flex shrink-0 flex-col items-end gap-1.5"
        >
          {shortcuts.map((shortcut, index) => {
            const keys = describe(shortcut);
            return (
              <li
                key={`${index}:${shortcut}`}
                className="flex items-center gap-1"
              >
                {editing === index ? (
                  capture
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={t`Change shortcut ${keys}`}
                    disabled={busy}
                    onClick={() => start(index)}
                  >
                    <ShortcutKeys keys={shortcutKeys(shortcut)} />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={t`Remove shortcut ${keys}`}
                  disabled={busy || shortcuts.length <= 1}
                  onClick={() => remove.mutate(index)}
                >
                  <X className="size-4" />
                </Button>
              </li>
            );
          })}
          {editing === shortcuts.length && (
            <li className="flex items-center gap-1 pr-8">{capture}</li>
          )}
        </ul>
      </div>
      {editing !== null && <ShortcutCaptureHint id={hintId} doubleTap={mac} />}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || full}
          onClick={() => start(shortcuts.length)}
        >
          <Plus className="size-3.5" />
          <Trans>Add shortcut</Trans>
        </Button>
        {mac &&
          [
            [`${DOUBLE_TAP_PREFIX}AltLeft`, t`Left ⌥ twice`],
            ["Fn", t`Fn / Globe`],
            ["RightCommand", t`Right Command`],
          ].map(([value, presetLabel]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant="outline"
              disabled={
                busy ||
                full ||
                shortcuts.some(
                  (shortcut) =>
                    shortcutIdentity(shortcut) === shortcutIdentity(value),
                )
              }
              onClick={() => recorder.save(value, shortcuts.length)}
            >
              {presetLabel}
            </Button>
          ))}
      </div>
    </div>
  );
}

// Keys are read on the window while capturing: WebKit does not focus a button
// when it is clicked, so the button would never receive them.
export function ShortcutCapture({
  label,
  doubleTap,
  describedBy,
  busy,
  onInput,
  onConfirm,
  onCancel,
}: {
  label: string;
  doubleTap: boolean;
  describedBy: string;
  busy: boolean;
  onInput: () => void;
  onConfirm: (shortcut: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Wait until the registered shortcuts are released, or pressing one would
  // start dictation or paste instead of reaching this page.
  const prepare = useMutation({
    mutationFn: () =>
      Promise.all([waitForDictationCleanup(), waitForPasteLastCleanup()]),
  });
  const [capture, setCapture] = useState<{
    pending: string | null;
    held: string[];
  }>({ pending: null, held: [] });
  const latest = useRef({
    capture,
    ready: prepare.isSuccess,
    busy,
    onInput,
    onConfirm,
    onCancel,
  });
  latest.current = {
    capture,
    ready: prepare.isSuccess,
    busy,
    onInput,
    onConfirm,
    onCancel,
  };

  useMountEffect(() => {
    prepare.mutate();
    ref.current?.focus();
    let lastModifier: { code: string; at: number } | null = null;
    const update = (next: Partial<typeof capture>) => {
      latest.current.capture = { ...latest.current.capture, ...next };
      setCapture(latest.current.capture);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const { capture, ready, busy, onInput, onConfirm, onCancel } =
        latest.current;
      const modifiers = heldModifiers(event);
      if (event.key === "Tab" && modifiers.length === 0) return onCancel();
      // Keep app hotkeys, and the page's Escape handling, out of the capture.
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") return onCancel();
      if (!ready || busy || event.repeat) return;
      if (event.key === "Enter") {
        if (capture.pending) onConfirm(capture.pending);
        return;
      }
      onInput();
      if (event.key === "Backspace" && modifiers.length === 0) {
        lastModifier = null;
        return update({ pending: null, held: [] });
      }
      if (MODIFIER_KEYS.includes(event.key)) {
        // Where double taps are allowed (macOS dictation), two quick presses of
        // one modifier key on its own record a double-tap shortcut.
        const previous = lastModifier;
        lastModifier =
          doubleTap &&
          modifiers.length === 1 &&
          DOUBLE_TAP_CODES.includes(event.code)
            ? { code: event.code, at: performance.now() }
            : null;
        if (
          lastModifier &&
          previous?.code === event.code &&
          lastModifier.at - previous.at < 500
        ) {
          lastModifier = null;
          return update({
            pending: `${DOUBLE_TAP_PREFIX}${event.code}`,
            held: [],
          });
        }
        return update({ held: modifiers });
      }
      lastModifier = null;
      update({ pending: [...modifiers, event.code].join("+"), held: [] });
    };
    const onKeyUp = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (latest.current.capture.held.length > 0)
        update({ held: heldModifiers(event) });
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node))
        latest.current.onCancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  });

  const keys =
    capture.held.length > 0
      ? capture.held
      : capture.pending && shortcutKeys(capture.pending);

  return (
    <div
      ref={ref}
      tabIndex={0}
      role="textbox"
      aria-label={label}
      aria-describedby={describedBy}
      aria-busy={busy || !prepare.isSuccess}
      className={cn([
        "bg-background flex h-7 min-w-36 items-center justify-center rounded-md border px-2 text-xs",
        "border-ring ring-ring/40 ring-2 outline-none",
      ])}
    >
      {!prepare.isSuccess ? (
        <Trans>Preparing…</Trans>
      ) : keys ? (
        <ShortcutKeys keys={keys} />
      ) : (
        <span className="text-muted-foreground">
          <Trans>Press the shortcut…</Trans>
        </span>
      )}
    </div>
  );
}
