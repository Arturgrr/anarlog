import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EditorView } from "~/store/zustand/tabs/schema";

const mocks = vi.hoisted(() => ({
  leftsidebar: { expanded: true },
  sessionModes: {} as Record<string, string>,
  startListening: vi.fn(),
  stopListening: vi.fn(),
  requestMainListenerControl: vi.fn(),
  isMainWebviewWindow: true,
  audioExists: false,
  hasTranscriptBySession: {} as Record<string, boolean>,
  renameSession: vi.fn((_sessionId: string, _title: string) =>
    Promise.resolve(),
  ),
}));

vi.mock("~/ai/hooks", () => ({
  useTitleGenerating: () => false,
}));

vi.mock("~/session/rename", () => ({
  renameSession: mocks.renameSession,
}));

vi.mock("~/session/queries", () => ({
  useSession: () => ({ folder_id: "" }),
  useFolderIcons: () => ({}),
  useFolderPaths: () => [],
  useUpdateSession: () => vi.fn(),
}));

vi.mock("./overflow", () => ({
  OverflowButton: () => <button type="button">More</button>,
}));

vi.mock("../shared", () => ({
  RecordingIcon: () => <div />,
  useHasTranscript: (sessionId: string) =>
    mocks.hasTranscriptBySession[sessionId] ?? false,
}));

vi.mock("~/audio-player", () => ({
  useAudioPlayer: () => ({ audioExists: mocks.audioExists }),
}));

vi.mock("~/contexts/shell", () => ({
  useShell: () => ({ leftsidebar: mocks.leftsidebar }),
}));

vi.mock("~/store/zustand/tabs", () => ({
  useTabs: vi.fn((selector: (state: unknown) => unknown) => selector({})),
}));

vi.mock("~/stt/contexts", () => ({
  useListener: vi.fn((selector: (state: unknown) => unknown) =>
    selector({
      getSessionMode: (sessionId: string) =>
        mocks.sessionModes[sessionId] ?? "inactive",
      stop: mocks.stopListening,
    }),
  ),
}));

vi.mock("~/stt/useStartListening", () => ({
  useStartListening: () => mocks.startListening,
}));

vi.mock("~/stt/window-control", () => ({
  isMainWebviewWindow: () => mocks.isMainWebviewWindow,
  requestMainListenerControl: mocks.requestMainListenerControl,
}));

import { OuterHeader } from "./index";

import { useLiveTitle } from "~/store/zustand/live-title";

type Scenario = {
  mode?: string;
  transcript?: boolean;
  audio?: boolean;
};

function arrange({ mode, transcript, audio }: Scenario) {
  if (mode) mocks.sessionModes = { "session-1": mode };
  mocks.hasTranscriptBySession = { "session-1": !!transcript };
  mocks.audioExists = !!audio;
}

function renderHeader(
  props: {
    view?: EditorView;
    withTab?: boolean;
    viewSwitcher?: ReactNode;
    standaloneWindow?: boolean;
  } = {},
) {
  const view = props.view ?? ({ type: "raw" } as EditorView);
  return render(
    <OuterHeader
      sessionId="session-1"
      currentView={view}
      standaloneWindow={props.standaloneWindow}
      viewSwitcher={props.viewSwitcher}
      tab={
        props.withTab
          ? {
              active: true,
              id: "session-1",
              pinned: false,
              slotId: "slot-1",
              state: { autoStart: null, view },
              type: "sessions",
            }
          : undefined
      }
    />,
  );
}

const ACTIONS = ["Record", "Stop"] as const;

function visibleAction() {
  const visible = ACTIONS.filter((name) =>
    screen.queryByRole("button", { name }),
  );
  expect(visible.length).toBeLessThanOrEqual(1);
  return visible[0] ?? null;
}

describe("OuterHeader", () => {
  beforeEach(() => {
    mocks.leftsidebar.expanded = true;
    mocks.sessionModes = {};
    mocks.startListening.mockClear();
    mocks.stopListening.mockClear();
    mocks.requestMainListenerControl.mockClear();
    mocks.isMainWebviewWindow = true;
    mocks.audioExists = false;
    mocks.hasTranscriptBySession = {};
  });

  afterEach(() => {
    cleanup();
  });

  it.each<[string, Scenario, (typeof ACTIONS)[number] | null]>([
    ["new note", {}, "Record"],
    ["active recording", { mode: "active" }, "Stop"],
    ["post-meeting transcription", { mode: "running_batch" }, null],
    ["finalizing", { mode: "finalizing" }, null],
    ["inactive with transcript", { transcript: true }, null],
    ["inactive with audio", { audio: true }, null],
  ])("shows the right meeting action for %s", (_label, scenario, expected) => {
    arrange(scenario);
    renderHeader();

    expect(visibleAction()).toBe(expected);
    expect(screen.getByRole("button", { name: "More" })).not.toBeNull();
  });

  it("starts listening from record", () => {
    arrange({});
    renderHeader();

    fireEvent.click(screen.getByRole("button", { name: "Record" }));

    expect(mocks.startListening).toHaveBeenCalledTimes(1);
  });

  it("stops listening from the stop button", () => {
    arrange({ mode: "active" });
    renderHeader();

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(mocks.stopListening).toHaveBeenCalledTimes(1);
  });

  it("delegates stop to the main window from standalone windows", () => {
    arrange({ mode: "active" });
    mocks.isMainWebviewWindow = false;
    renderHeader({ standaloneWindow: true });

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(mocks.requestMainListenerControl).toHaveBeenCalledWith(
      "stop",
      "session-1",
    );
    expect(mocks.stopListening).not.toHaveBeenCalled();
  });

  it.each<[string, Scenario, { view?: EditorView; tabs?: boolean }]>([
    [
      "summary tab before recording",
      {},
      { view: { type: "enhanced", id: "n" } as EditorView },
    ],
    ["memo tab before recording", {}, {}],
    ["view switcher is shown", {}, { tabs: true }],
    ["transcript exists", { transcript: true }, { tabs: true }],
    ["listening", { mode: "active" }, { tabs: true }],
    ["finalizing", { mode: "finalizing" }, { tabs: true }],
  ])("keeps the title editable when %s", (_label, scenario, { view, tabs }) => {
    arrange(scenario);
    renderHeader({
      view,
      withTab: true,
      viewSwitcher: tabs ? <div>Tabs</div> : undefined,
    });

    expect(
      screen.getByRole("textbox", { name: "Session title" }),
    ).not.toBeNull();
  });

  it("persists a title typed during a live meeting through the live draft", async () => {
    useLiveTitle.setState({ titles: {} });
    arrange({ mode: "active" });
    renderHeader({ withTab: true, viewSwitcher: <div>Tabs</div> });

    const input = screen.getByRole("textbox", { name: "Session title" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Board review" } });

    expect(useLiveTitle.getState().titles["session-1"]).toMatchObject({
      value: "Board review",
      persisted: false,
    });

    fireEvent.blur(input);

    expect(mocks.renameSession).toHaveBeenCalledWith(
      "session-1",
      "Board review",
    );
    await waitFor(() => {
      expect(useLiveTitle.getState().titles["session-1"]).toMatchObject({
        value: "Board review",
        persisted: true,
      });
    });
  });
});
