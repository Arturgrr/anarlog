import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  validate: vi.fn(),
  save: vi.fn(),
  cleanup: vi.fn(),
}));
vi.mock("@anlg/plugin-shortcut", () => ({
  commands: { validate: mocks.validate },
}));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "macos" }));
vi.mock("~/settings/queries", () => ({ setSettingValues: mocks.save }));
vi.mock("~/dictation/lifecycle", () => ({
  waitForDictationCleanup: mocks.cleanup,
}));
vi.mock("~/dictation/paste-last", () => ({
  waitForPasteLastCleanup: () => Promise.resolve(),
}));
vi.mock("~/shared/config", () => ({
  useConfigValue: (key: string) =>
    ({
      dictation_paste_last_enabled: true,
      dictation_paste_last_shortcut: "Alt+Shift+KeyV",
    })[key],
}));

import { DictationShortcuts } from "./dictation-shortcut";

import { useDictationStatus } from "~/dictation/state";

function setup(shortcuts = ["Control+Alt+Space"]) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <DictationShortcuts shortcuts={shortcuts} />
    </QueryClientProvider>,
  );
}

async function start(name: string | RegExp = /^Change shortcut/) {
  fireEvent.click(screen.getByRole("button", { name }));
  await screen.findByText("Press the shortcut…");
}

// Keys go to the page, not to the clicked button: WebKit does not focus a
// button on click.
function press(init: KeyboardEventInit) {
  fireEvent.keyDown(document.body, init);
  fireEvent.keyUp(document.body, { ...init, ctrlKey: false, altKey: false });
}

const enter = () => press({ key: "Enter", code: "Enter" });

function saved(shortcuts: string[]) {
  return {
    dictation_shortcuts: JSON.stringify(shortcuts),
    dictation_shortcut: shortcuts[0],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.validate.mockResolvedValue({ status: "ok", data: null });
  mocks.save.mockResolvedValue(undefined);
  mocks.cleanup.mockResolvedValue(undefined);
  useDictationStatus.setState({ capturingShortcut: false });
});
afterEach(cleanup);

describe("dictation shortcut recorder", () => {
  it("captures keys pressed anywhere on the page and saves only on Enter", async () => {
    setup();
    await start();
    expect(useDictationStatus.getState().capturingShortcut).toBe(true);
    press({ key: "k", code: "KeyK", ctrlKey: true, altKey: true });
    press({ key: "Backspace", code: "Backspace" });
    enter();
    expect(mocks.validate).not.toHaveBeenCalled();

    press({ key: "d", code: "KeyD", ctrlKey: true, altKey: true });
    expect(screen.getByRole("textbox").textContent).toBe("⌃⌥D");
    expect(mocks.validate).not.toHaveBeenCalled();
    enter();
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(saved(["Control+Alt+KeyD"])),
    );
    expect(mocks.validate).toHaveBeenCalledWith(
      "Control+Alt+KeyD",
      "Alt+Shift+KeyV",
    );
    await waitFor(() =>
      expect(useDictationStatus.getState().capturingShortcut).toBe(false),
    );
  });

  it("adds a double tap of the left Option key as a second shortcut", async () => {
    setup();
    await start("Add shortcut");
    const option = { key: "Alt", code: "AltLeft", altKey: true };
    press(option);
    press(option);
    enter();
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        saved(["Control+Alt+Space", "DoubleTap+AltLeft"]),
      ),
    );
  });

  it.each(["Escape", "click outside", "unmount"])(
    "cancels on %s without saving",
    async (action) => {
      const view = setup();
      await start();
      press({ key: "d", code: "KeyD", ctrlKey: true, altKey: true });
      if (action === "unmount") view.unmount();
      else if (action === "click outside") fireEvent.pointerDown(document.body);
      else press({ key: "Escape", code: "Escape" });
      expect(useDictationStatus.getState().capturingShortcut).toBe(false);
      expect(screen.queryByRole("textbox")).toBeNull();
      enter();
      expect(mocks.validate).not.toHaveBeenCalled();
    },
  );

  it("rejects a shortcut already in the list in another modifier order", async () => {
    setup(["Alt+Control+Space"]);
    await start("Add shortcut");
    press({ key: " ", code: "Space", ctrlKey: true, altKey: true });
    enter();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "This shortcut is already in your list.",
    );
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(useDictationStatus.getState().capturingShortcut).toBe(true);
  });

  it("keeps capturing with the error shown when validation fails", async () => {
    mocks.validate.mockResolvedValue({
      status: "error",
      error: "Choose a modifier.",
    });
    setup();
    await start();
    press({ key: "d", code: "KeyD" });
    enter();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Choose a modifier.",
    );
    expect(useDictationStatus.getState().capturingShortcut).toBe(true);
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("removes a shortcut but never the last one", async () => {
    const view = setup(["Fn"]);
    expect(
      (
        screen.getByRole("button", {
          name: /^Remove shortcut/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Fn / Globe" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    view.unmount();

    setup(["Fn", "Control+Alt+Space"]);
    fireEvent.click(screen.getAllByRole("button", { name: /^Remove/ })[0]);
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(saved(["Control+Alt+Space"])),
    );
  });

  it("ignores keys until the registered dictation shortcuts are released", async () => {
    let finish!: () => void;
    mocks.cleanup.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    setup();
    fireEvent.click(screen.getByRole("button", { name: /^Change shortcut/ }));
    await screen.findByText("Preparing…");
    press({ key: "d", code: "KeyD", ctrlKey: true });
    finish();
    await screen.findByText("Press the shortcut…");
    enter();
    expect(mocks.validate).not.toHaveBeenCalled();
  });

  it("does not cancel once the new list is being saved", async () => {
    let complete!: () => void;
    mocks.save.mockReturnValue(
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    );
    setup();
    await start();
    press({ key: "d", code: "KeyD", ctrlKey: true });
    enter();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    press({ key: "Escape", code: "Escape" });
    expect(useDictationStatus.getState().capturingShortcut).toBe(true);
    complete();
    await waitFor(() =>
      expect(useDictationStatus.getState().capturingShortcut).toBe(false),
    );
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it("does not save a validation result after capture is cancelled", async () => {
    let finish!: (result: { status: string; data: null }) => void;
    mocks.validate.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    setup();
    await start();
    press({ key: "d", code: "KeyD", ctrlKey: true });
    enter();
    await waitFor(() => expect(mocks.validate).toHaveBeenCalled());
    press({ key: "Escape", code: "Escape" });
    finish({ status: "ok", data: null });
    await waitFor(() =>
      expect(useDictationStatus.getState().capturingShortcut).toBe(false),
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
