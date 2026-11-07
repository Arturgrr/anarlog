import { resolveResource } from "@tauri-apps/api/path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { AUTO_STOP_ACCESSIBILITY_TIMEOUT_MS } from "./auto-stop";
import {
  cancelAutoStopEndedNotification,
  consumeAutoStopEndedNotificationKey,
  createAutoStopEndedNotificationKey,
  parseAutoStopEndedNotificationKey,
} from "./auto-stop-notification";
import {
  AUTO_STOP_CONFIRM_DELAY_MS,
  AUTO_STOP_NETWORK_HOLD_MS,
  AUTO_STOP_RECENT_OFFLINE_MS,
  ListenerProvider,
} from "./contexts";

import { createListenerStore } from "~/store/zustand/listener";

const {
  listMicUsingApplicationsMock,
  inspectMeetingAccessibilityMock,
  listenMock,
  clearNotificationsMock,
  showNotificationMock,
  useConfigValueMock,
} = vi.hoisted(() => ({
  listMicUsingApplicationsMock: vi.fn(),
  inspectMeetingAccessibilityMock: vi.fn(),
  listenMock: vi.fn(),
  clearNotificationsMock: vi.fn(),
  showNotificationMock: vi.fn(),
  useConfigValueMock: vi.fn((key: string) => key !== "notification_disabled"),
}));

vi.mock("@anlg/plugin-detect", () => ({
  commands: {
    inspectMeetingAccessibility: inspectMeetingAccessibilityMock,
    listMicUsingApplications: listMicUsingApplicationsMock,
  },
  events: {
    detectEvent: {
      listen: listenMock,
    },
  },
}));

vi.mock("@anlg/plugin-notification", () => ({
  commands: {
    clearNotifications: clearNotificationsMock,
    showNotification: showNotificationMock,
  },
}));

vi.mock("~/shared/config", () => ({
  useConfigValue: useConfigValueMock,
}));

function setStoreActive(
  store: ReturnType<typeof createListenerStore>,
  sessionId = "session-1",
) {
  store.setState((state) => ({
    live: { ...state.live, sessionId, status: "active" },
  }));
}

async function renderProvider(store: ReturnType<typeof createListenerStore>) {
  render(
    <ListenerProvider store={store}>
      <div>child</div>
    </ListenerProvider>,
  );
  await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));
  return listenMock.mock.calls[0]?.[0];
}

describe("ListenerProvider detect events", () => {
  beforeEach(() => {
    cancelAutoStopEndedNotification("session-1");
    listenMock.mockReset();
    clearNotificationsMock.mockReset();
    showNotificationMock.mockReset();
    useConfigValueMock.mockReset();
    useConfigValueMock.mockImplementation(
      (key: string) => key !== "notification_disabled",
    );
    listenMock.mockResolvedValue(() => {});
    inspectMeetingAccessibilityMock.mockReset().mockResolvedValue({
      status: "ok",
      data: [],
    });
    listMicUsingApplicationsMock.mockResolvedValue({ status: "ok", data: [] });
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  test("invalidates and clears pending notifications when listening becomes active", async () => {
    const store = createListenerStore();

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    expect(clearNotificationsMock).not.toHaveBeenCalled();
    const notificationKey = createAutoStopEndedNotificationKey("session-1");

    setStoreActive(store);

    await vi.waitFor(() =>
      expect(clearNotificationsMock).toHaveBeenCalledTimes(1),
    );
    expect(consumeAutoStopEndedNotificationKey(notificationKey)).toBeNull();
  });

  test("does not stop listening on MicStopped when no trigger apps are set (manual session — regression: #5120)", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));

    const handler = listenMock.mock.calls[0]?.[0];
    expect(handler).toBeTypeOf("function");

    handler({
      payload: {
        type: "micStopped",
        apps: [
          { id: "/opt/homebrew/bin/ffmpeg", name: "ffmpeg" },
          { id: "us.zoom.xos", name: "Zoom" },
        ],
      },
    });

    expect(stopSpy).not.toHaveBeenCalled();
  });

  test("stops listening after confirming a trigger app remains stopped", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });
    store.getState().setTriggerAppIds(["us.zoom.xos"]);
    setStoreActive(store);

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));

    const handler = listenMock.mock.calls[0]?.[0];
    expect(handler).toBeTypeOf("function");

    vi.useFakeTimers();
    listMicUsingApplicationsMock.mockClear();

    handler({
      payload: {
        type: "micStopped",
        apps: [{ id: "us.zoom.xos", name: "Zoom" }],
      },
    });

    expect(stopSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);

    expect(listMicUsingApplicationsMock).toHaveBeenCalledTimes(1);
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  test("does not stop when a trigger app resumes during the auto-stop grace period", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });
    store.getState().setTriggerAppIds(["us.zoom.xos"]);
    setStoreActive(store);
    listMicUsingApplicationsMock.mockResolvedValue({
      status: "ok",
      data: [{ id: "us.zoom.xos", name: "Zoom" }],
    });

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));

    const handler = listenMock.mock.calls[0]?.[0];
    expect(handler).toBeTypeOf("function");

    vi.useFakeTimers();
    listMicUsingApplicationsMock.mockClear();

    handler({
      payload: {
        type: "micStopped",
        apps: [{ id: "us.zoom.xos", name: "Zoom" }],
      },
    });

    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);

    expect(listMicUsingApplicationsMock).toHaveBeenCalledTimes(1);
    expect(stopSpy).not.toHaveBeenCalled();
  });

  describe("when a side app releases the mic during a call", () => {
    const teams = { id: "com.microsoft.teams2", name: "Microsoft Teams" };
    const recorder = { id: "com.example.recorder", name: "Recorder" };
    const chrome = { id: "com.google.Chrome", name: "Google Chrome" };

    async function renderActiveWithTriggers(triggerAppIds: string[]) {
      const store = createListenerStore();
      const stopSpy = vi.fn();
      store.setState({ stop: stopSpy });
      store.getState().setTriggerAppIds(triggerAppIds);
      setStoreActive(store);
      const handler = await renderProvider(store);
      vi.useFakeTimers();
      return { store, stopSpy, handler };
    }

    test("keeps listening, then stops when the meeting app ends", async () => {
      const { store, stopSpy, handler } = await renderActiveWithTriggers([
        recorder.id,
      ]);

      listMicUsingApplicationsMock.mockResolvedValue({
        status: "ok",
        data: [teams],
      });
      handler({ payload: { type: "micStopped", apps: [recorder] } });
      await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);

      expect(stopSpy).not.toHaveBeenCalled();
      expect(store.getState().live.triggerAppIds).toContain(teams.id);

      listMicUsingApplicationsMock.mockResolvedValue({
        status: "ok",
        data: [],
      });
      handler({ payload: { type: "micStopped", apps: [teams] } });
      await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);

      expect(stopSpy).toHaveBeenCalledTimes(1);
    });

    test("stops when the meeting app stops in the same event, even with a browser on the mic", async () => {
      const { stopSpy, handler } = await renderActiveWithTriggers([
        recorder.id,
      ]);

      listMicUsingApplicationsMock.mockResolvedValue({
        status: "ok",
        data: [chrome],
      });
      handler({ payload: { type: "micStopped", apps: [recorder, teams] } });
      await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);

      expect(stopSpy).toHaveBeenCalledTimes(1);
    });

    test("withdraws an open stop prompt when the call is still on the mic", async () => {
      const { stopSpy, handler } = await renderActiveWithTriggers([
        chrome.id,
        recorder.id,
      ]);

      listMicUsingApplicationsMock.mockResolvedValue({
        status: "ok",
        data: [],
      });
      handler({ payload: { type: "micStopped", apps: [chrome, recorder] } });
      await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);
      const promptKey = showNotificationMock.mock.calls[0][0].key;

      listMicUsingApplicationsMock.mockResolvedValue({
        status: "ok",
        data: [teams],
      });
      handler({ payload: { type: "micStopped", apps: [recorder] } });
      await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);

      expect(consumeAutoStopEndedNotificationKey(promptKey)).toBeNull();
      expect(stopSpy).not.toHaveBeenCalled();
    });

    test("ignores a mic snapshot that returns after the recording changed", async () => {
      const { store, stopSpy, handler } = await renderActiveWithTriggers([
        recorder.id,
      ]);
      let resolveSnapshot: (value: unknown) => void = () => {};
      listMicUsingApplicationsMock.mockReturnValue(
        new Promise((resolve) => {
          resolveSnapshot = resolve;
        }),
      );

      handler({ payload: { type: "micStopped", apps: [recorder] } });
      await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);
      setStoreActive(store, "session-2");
      resolveSnapshot({ status: "ok", data: [teams] });
      await vi.advanceTimersByTimeAsync(0);

      expect(store.getState().live.triggerAppIds).not.toContain(teams.id);
      expect(stopSpy).not.toHaveBeenCalled();
    });
  });

  test("cancels a network interruption hold when the meeting resumes", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });
    store.getState().setTriggerAppIds(["us.zoom.xos"]);
    setStoreActive(store);

    vi.useFakeTimers();

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));
    const handler = listenMock.mock.calls[0]?.[0];

    window.dispatchEvent(new Event("offline"));
    handler({
      payload: {
        type: "micStopped",
        apps: [{ id: "us.zoom.xos", name: "Zoom" }],
      },
    });

    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);
    await vi.advanceTimersByTimeAsync(AUTO_STOP_NETWORK_HOLD_MS / 2);

    window.dispatchEvent(new Event("online"));
    handler({
      payload: {
        type: "micDetected",
        key: "mic-resumed",
        apps: [{ id: "us.zoom.xos", name: "Zoom" }],
        duration_secs: 15,
      },
    });

    await vi.advanceTimersByTimeAsync(AUTO_STOP_NETWORK_HOLD_MS);
    expect(stopSpy).not.toHaveBeenCalled();
  });

  test("holds an offline ad-hoc meeting, then prompts instead of stopping", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });
    store.getState().setTriggerAppIds(["us.zoom.xos"]);
    setStoreActive(store);

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));
    const handler = listenMock.mock.calls[0]?.[0];

    vi.useFakeTimers();
    window.dispatchEvent(new Event("offline"));
    handler({
      payload: {
        type: "micStopped",
        apps: [{ id: "us.zoom.xos", name: "Zoom" }],
      },
    });

    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);
    expect(stopSpy).not.toHaveBeenCalled();
    expect(showNotificationMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(AUTO_STOP_NETWORK_HOLD_MS - 1);
    expect(stopSpy).not.toHaveBeenCalled();
    expect(showNotificationMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(stopSpy).not.toHaveBeenCalled();
    expect(showNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringContaining("auto-stop-ended:session-1"),
      }),
    );
  });

  test.each([
    { name: "coming back online", outageMs: 0 },
    {
      name: "a long outage reconnects",
      outageMs: AUTO_STOP_RECENT_OFFLINE_MS + 1,
    },
  ])(
    "holds auto-stop when micStopped arrives shortly after $name",
    async ({ outageMs }) => {
      const store = createListenerStore();
      const stopSpy = vi.fn();

      store.setState({ stop: stopSpy });
      store.getState().setTriggerAppIds(["us.zoom.xos"]);
      setStoreActive(store);

      const handler = await renderProvider(store);

      vi.useFakeTimers();
      window.dispatchEvent(new Event("offline"));
      if (outageMs > 0) {
        await vi.advanceTimersByTimeAsync(outageMs);
      }
      window.dispatchEvent(new Event("online"));
      handler({
        payload: {
          type: "micStopped",
          apps: [{ id: "us.zoom.xos", name: "Zoom" }],
        },
      });

      await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);
      expect(stopSpy).not.toHaveBeenCalled();
      expect(showNotificationMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(AUTO_STOP_NETWORK_HOLD_MS);
      expect(stopSpy).not.toHaveBeenCalled();
      expect(showNotificationMock).toHaveBeenCalledTimes(1);
    },
  );

  test("does not hold auto-stop after the recent-offline window expires", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });
    store.getState().setTriggerAppIds(["us.zoom.xos"]);
    setStoreActive(store);

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));
    const handler = listenMock.mock.calls[0]?.[0];

    vi.useFakeTimers();
    window.dispatchEvent(new Event("offline"));
    await vi.advanceTimersByTimeAsync(AUTO_STOP_RECENT_OFFLINE_MS + 1);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(AUTO_STOP_RECENT_OFFLINE_MS + 1);
    handler({
      payload: {
        type: "micStopped",
        apps: [{ id: "us.zoom.xos", name: "Zoom" }],
      },
    });

    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(showNotificationMock).not.toHaveBeenCalled();
  });

  test("does not let an interrupted meeting timer stop a replacement session", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });
    store.getState().setTriggerAppIds(["us.zoom.xos"]);
    setStoreActive(store);

    vi.useFakeTimers();

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));
    const handler = listenMock.mock.calls[0]?.[0];

    window.dispatchEvent(new Event("offline"));
    handler({
      payload: {
        type: "micStopped",
        apps: [{ id: "us.zoom.xos", name: "Zoom" }],
      },
    });
    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);

    setStoreActive(store, "session-2");
    await vi.advanceTimersByTimeAsync(AUTO_STOP_NETWORK_HOLD_MS);

    expect(stopSpy).not.toHaveBeenCalled();
  });

  test("does not stop on MicStopped when auto-stop is disabled", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });
    store.getState().setTriggerAppIds(["us.zoom.xos"]);
    useConfigValueMock.mockReturnValue(false);

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));

    const handler = listenMock.mock.calls[0]?.[0];
    expect(handler).toBeTypeOf("function");

    handler({
      payload: {
        type: "micStopped",
        apps: [{ id: "us.zoom.xos", name: "Zoom" }],
      },
    });

    expect(stopSpy).not.toHaveBeenCalled();
  });

  test("does not stop on MicStopped when only a non-trigger app stops (auto-session — regression: #4846)", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });
    store.getState().setTriggerAppIds(["us.zoom.xos"]);

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));

    const handler = listenMock.mock.calls[0]?.[0];
    expect(handler).toBeTypeOf("function");

    handler({
      payload: {
        type: "micStopped",
        apps: [{ id: "/opt/homebrew/bin/ffmpeg", name: "ffmpeg" }],
      },
    });

    expect(stopSpy).not.toHaveBeenCalled();
  });

  test("does not stop after non-trigger MicStopped when a trigger app is still active", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });
    store.getState().setTriggerAppIds(["us.zoom.xos"]);
    setStoreActive(store);
    listMicUsingApplicationsMock.mockResolvedValue({
      status: "ok",
      data: [{ id: "us.zoom.xos", name: "Zoom" }],
    });

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));

    const handler = listenMock.mock.calls[0]?.[0];
    expect(handler).toBeTypeOf("function");

    vi.useFakeTimers();
    listMicUsingApplicationsMock.mockClear();

    handler({
      payload: {
        type: "micStopped",
        apps: [{ id: "/opt/homebrew/bin/ffmpeg", name: "ffmpeg" }],
      },
    });

    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);

    expect(listMicUsingApplicationsMock).toHaveBeenCalledTimes(1);
    expect(stopSpy).not.toHaveBeenCalled();
  });

  test.each([
    [[{ id: "com.kakao.KakaoTalkMac", name: "KakaoTalk" }]],
    [[{ id: "pid:42", name: "KakaoTalk Helper" }]],
  ])(
    "does not auto-stop KakaoTalk sessions from screen-share mic transitions",
    async (stoppedApps) => {
      const store = createListenerStore();
      const stopSpy = vi.fn();

      store.setState({ stop: stopSpy });
      store.getState().setTriggerAppIds(["com.kakao.KakaoTalkMac"]);
      setStoreActive(store);

      render(
        <ListenerProvider store={store}>
          <div>child</div>
        </ListenerProvider>,
      );

      await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));

      const handler = listenMock.mock.calls[0]?.[0];
      expect(handler).toBeTypeOf("function");

      vi.useFakeTimers();
      listMicUsingApplicationsMock.mockClear();

      handler({
        payload: {
          type: "micStopped",
          apps: stoppedApps,
        },
      });

      await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);

      expect(listMicUsingApplicationsMock).not.toHaveBeenCalled();
      expect(stopSpy).not.toHaveBeenCalled();
    },
  );

  test("does not auto-stop co-trigger sessions while KakaoTalk remains active after a helper stop", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });
    store
      .getState()
      .setTriggerAppIds(["com.kakao.KakaoTalkMac", "us.zoom.xos"]);
    setStoreActive(store);
    listMicUsingApplicationsMock.mockResolvedValue({
      status: "ok",
      data: [{ id: "com.kakao.KakaoTalkMac", name: "KakaoTalk" }],
    });

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));

    const handler = listenMock.mock.calls[0]?.[0];
    expect(handler).toBeTypeOf("function");

    vi.useFakeTimers();
    listMicUsingApplicationsMock.mockClear();

    handler({
      payload: {
        type: "micStopped",
        apps: [{ id: "pid:42", name: "KakaoTalk Helper" }],
      },
    });

    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);

    expect(listMicUsingApplicationsMock).toHaveBeenCalledTimes(1);
    expect(stopSpy).not.toHaveBeenCalled();
  });

  test("auto-stops co-trigger sessions after a helper stop when no trigger app remains active", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });
    store
      .getState()
      .setTriggerAppIds(["com.kakao.KakaoTalkMac", "us.zoom.xos"]);
    setStoreActive(store);

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));

    const handler = listenMock.mock.calls[0]?.[0];
    expect(handler).toBeTypeOf("function");

    vi.useFakeTimers();
    listMicUsingApplicationsMock.mockClear();

    handler({
      payload: {
        type: "micStopped",
        apps: [{ id: "pid:42", name: "KakaoTalk Helper" }],
      },
    });

    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);

    expect(listMicUsingApplicationsMock).toHaveBeenCalledTimes(1);
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  test("auto-stops when MicStopped omits the trigger app and no trigger app remains active (regression: #5436)", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });
    store.getState().setTriggerAppIds(["com.microsoft.teams2"]);
    setStoreActive(store);

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));

    const handler = listenMock.mock.calls[0]?.[0];
    expect(handler).toBeTypeOf("function");

    vi.useFakeTimers();
    listMicUsingApplicationsMock.mockClear();

    handler({
      payload: {
        type: "micStopped",
        apps: [{ id: "pid:42", name: "Microsoft Teams Helper" }],
      },
    });

    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);

    expect(listMicUsingApplicationsMock).toHaveBeenCalledTimes(1);
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  test("asks before stopping Teams running in a browser when the browser no longer uses the mic", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });
    store.getState().setTriggerAppIds(["company.thebrowser.Browser"]);
    setStoreActive(store);

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));

    const handler = listenMock.mock.calls[0]?.[0];
    expect(handler).toBeTypeOf("function");

    vi.useFakeTimers();
    listMicUsingApplicationsMock.mockClear();

    handler({
      payload: {
        type: "micStopped",
        apps: [{ id: "company.thebrowser.Browser", name: "Arc" }],
      },
    });

    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);

    expect(listMicUsingApplicationsMock).toHaveBeenCalledTimes(1);
    expect(stopSpy).not.toHaveBeenCalled();
    expect(showNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringContaining("auto-stop-ended:session-1"),
      }),
    );
  });

  test("does not show mic-detected prompts when detection notifications are disabled", async () => {
    const store = createListenerStore();
    useConfigValueMock.mockImplementation((key: string) =>
      key === "notification_detect" ? false : true,
    );

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));

    const handler = listenMock.mock.calls[0]?.[0];
    expect(handler).toBeTypeOf("function");

    handler({
      payload: {
        type: "micDetected",
        key: "mic-1",
        apps: [{ id: "us.zoom.xos", name: "Zoom" }],
        duration_secs: 15,
      },
    });

    await Promise.resolve();

    expect(showNotificationMock).not.toHaveBeenCalled();
  });

  test("does not show a stale mic prompt when listening starts while icons resolve", async () => {
    const store = createListenerStore();
    let iconResolverReady = false;
    let resolveIcon = () => {};

    vi.mocked(resolveResource).mockImplementationOnce(
      (path: string) =>
        new Promise((resolve) => {
          resolveIcon = () => {
            resolve(`/resources/${path}`);
          };
          iconResolverReady = true;
        }),
    );
    vi.useFakeTimers();

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));

    const handler = listenMock.mock.calls[0]?.[0];
    expect(handler).toBeTypeOf("function");

    handler({
      payload: {
        type: "micDetected",
        key: "mic-1",
        apps: [{ id: "com.cisco.webex", name: "Webex" }],
        duration_secs: 15,
      },
    });

    await vi.waitFor(() => expect(iconResolverReady).toBe(true));

    setStoreActive(store);
    resolveIcon();

    await vi.waitFor(() =>
      expect(store.getState().live.triggerAppIds).toEqual(["com.cisco.webex"]),
    );
    expect(showNotificationMock).not.toHaveBeenCalled();
  });

  test("does not show duplicate mic prompts while icons resolve", async () => {
    const store = createListenerStore();
    let iconResolverReady = false;
    let resolveIcon = () => {};

    vi.mocked(resolveResource).mockImplementationOnce(
      (path: string) =>
        new Promise((resolve) => {
          resolveIcon = () => {
            resolve(`/resources/${path}`);
          };
          iconResolverReady = true;
        }),
    );
    vi.useFakeTimers();

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));

    const handler = listenMock.mock.calls[0]?.[0];
    expect(handler).toBeTypeOf("function");

    handler({
      payload: {
        type: "micDetected",
        key: "mic-1",
        apps: [{ id: "com.apple.TelephonyUtilities", name: "iPhone Call" }],
        duration_secs: 15,
      },
    });

    await vi.waitFor(() => expect(iconResolverReady).toBe(true));

    handler({
      payload: {
        type: "micDetected",
        key: "mic-2",
        apps: [{ id: "com.apple.TelephonyUtilities", name: "iPhone Call" }],
        duration_secs: 15,
      },
    });

    resolveIcon();

    await vi.waitFor(() =>
      expect(showNotificationMock).toHaveBeenCalledTimes(1),
    );
    expect(showNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "mic-1",
        source: expect.objectContaining({
          app_names: ["iPhone Call"],
        }),
      }),
    );
  });

  test.each([
    {
      name: "already listening",
      prime: (store: ReturnType<typeof createListenerStore>) =>
        setStoreActive(store),
    },
    {
      name: "listening is starting",
      prime: (store: ReturnType<typeof createListenerStore>) =>
        store.setState((state) => ({
          live: {
            ...state.live,
            loading: true,
            sessionId: "session-1",
            status: "inactive" as const,
          },
        })),
    },
  ])(
    "records trigger app ids from micDetected while $name",
    async ({ prime }) => {
      const store = createListenerStore();
      prime(store);

      const handler = await renderProvider(store);
      expect(handler).toBeTypeOf("function");

      handler({
        payload: {
          type: "micDetected",
          key: "mic-1",
          apps: [
            { id: "pid:42", name: "Chrome Helper" },
            { id: "com.google.Chrome", name: "Google Chrome" },
          ],
          duration_secs: 15,
        },
      });

      expect(showNotificationMock).not.toHaveBeenCalled();
      expect(store.getState().live.triggerAppIds).toEqual([
        "com.google.Chrome",
      ]);
    },
  );

  test("auto-stops after a trigger app learned during active listening stops", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });
    setStoreActive(store);

    const handler = await renderProvider(store);
    expect(handler).toBeTypeOf("function");

    vi.useFakeTimers();
    listMicUsingApplicationsMock.mockClear();

    handler({
      payload: {
        type: "micDetected",
        key: "mic-1",
        apps: [{ id: "us.zoom.xos", name: "Zoom" }],
        duration_secs: 15,
      },
    });

    handler({
      payload: {
        type: "micStopped",
        apps: [{ id: "us.zoom.xos", name: "Zoom" }],
      },
    });

    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);

    expect(listMicUsingApplicationsMock).toHaveBeenCalledTimes(1);
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  test.each([
    {
      name: "a browser meeting",
      browser: { id: "com.google.Chrome", name: "Google Chrome" },
    },
  ])("asks before stopping $name", async ({ browser }) => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });
    store.getState().setTriggerAppIds([browser.id]);
    setStoreActive(store);

    const handler = await renderProvider(store);
    expect(handler).toBeTypeOf("function");

    vi.useFakeTimers();
    listMicUsingApplicationsMock.mockClear();

    handler({
      payload: {
        type: "micStopped",
        apps: [browser],
      },
    });

    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);

    expect(stopSpy).not.toHaveBeenCalled();
    const notification = showNotificationMock.mock.calls[0]?.[0];
    expect(parseAutoStopEndedNotificationKey(notification?.key)).toBe(
      "session-1",
    );
    expect(notification).toEqual(
      expect.objectContaining({
        key: expect.stringContaining("auto-stop-ended:session-1"),
        action_label: "Stop",
        action_variant: "destructive",
      }),
    );
  });

  test("rechecks after accessibility confirms the meeting is active", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });
    store.getState().setTriggerAppIds(["com.google.Chrome"]);
    setStoreActive(store);
    inspectMeetingAccessibilityMock
      .mockResolvedValueOnce({
        status: "ok",
        data: [
          {
            activeCall: true,
            app: { id: "com.google.Chrome", name: "Google Chrome" },
            pid: 42,
            platform: "googleMeet",
            surface: "web",
            accessibilityTrusted: true,
            windowTitle: "Team sync - Google Meet",
            remoteScreenShare: false,
            warnings: [],
          },
        ],
      })
      .mockResolvedValue({ status: "ok", data: [] });

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );
    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));
    const handler = listenMock.mock.calls[0]?.[0];

    vi.useFakeTimers();
    handler({
      payload: {
        type: "micStopped",
        apps: [{ id: "com.google.Chrome", name: "Google Chrome" }],
      },
    });
    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);

    expect(inspectMeetingAccessibilityMock).toHaveBeenCalledTimes(1);
    expect(stopSpy).not.toHaveBeenCalled();
    expect(showNotificationMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);

    expect(inspectMeetingAccessibilityMock).toHaveBeenCalledTimes(2);
    expect(stopSpy).not.toHaveBeenCalled();
    expect(showNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringContaining("auto-stop-ended:session-1"),
      }),
    );
  });

  test("keeps recording and prompts when AX stalls without queuing duplicate inspections", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();
    const app = { id: "us.zoom.xos", name: "Zoom" };
    let resolveInspection!: (result: { status: "ok"; data: [] }) => void;
    inspectMeetingAccessibilityMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInspection = resolve;
      }),
    );
    store.setState({ stop: stopSpy });
    store.getState().setTriggerAppIds([app.id]);
    setStoreActive(store);
    const handler = await renderProvider(store);
    vi.useFakeTimers();

    const micStopped = () =>
      handler({ payload: { type: "micStopped", apps: [app] } });
    micStopped();
    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);
    expect(showNotificationMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(AUTO_STOP_ACCESSIBILITY_TIMEOUT_MS);

    expect(stopSpy).not.toHaveBeenCalled();
    expect(showNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringContaining("auto-stop-ended:session-1"),
        action_label: "Stop",
      }),
    );
    micStopped();
    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);
    expect(inspectMeetingAccessibilityMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(AUTO_STOP_ACCESSIBILITY_TIMEOUT_MS);
    resolveInspection({ status: "ok", data: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopSpy).not.toHaveBeenCalled();

    micStopped();
    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);
    expect(stopSpy).toHaveBeenCalledOnce();
  });

  test("does not recheck after the meeting resumes during accessibility inspection", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();
    let resolveInspection = (
      _result: Awaited<ReturnType<typeof inspectMeetingAccessibilityMock>>,
    ) => {};

    store.setState({ stop: stopSpy });
    store.getState().setTriggerAppIds(["com.google.Chrome"]);
    setStoreActive(store);
    inspectMeetingAccessibilityMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInspection = resolve;
        }),
    );

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );
    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));
    const handler = listenMock.mock.calls[0]?.[0];

    vi.useFakeTimers();
    handler({
      payload: {
        type: "micStopped",
        apps: [{ id: "com.google.Chrome", name: "Google Chrome" }],
      },
    });
    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);

    expect(inspectMeetingAccessibilityMock).toHaveBeenCalledTimes(1);

    handler({
      payload: {
        type: "micDetected",
        key: "mic-resumed",
        apps: [{ id: "com.google.Chrome", name: "Google Chrome" }],
        duration_secs: 15,
      },
    });
    resolveInspection({
      status: "ok",
      data: [
        {
          app: { id: "com.google.Chrome", name: "Google Chrome" },
          pid: 42,
          platform: "googleMeet",
          surface: "web",
          accessibilityTrusted: true,
          windowTitle: "Team sync - Google Meet",
          remoteScreenShare: false,
          warnings: [],
        },
      ],
    });
    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);

    expect(inspectMeetingAccessibilityMock).toHaveBeenCalledTimes(1);
    expect(stopSpy).not.toHaveBeenCalled();
    expect(showNotificationMock).not.toHaveBeenCalled();
  });

  test("cancels pending auto-stop when a browser trigger restarts", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });
    store.getState().setTriggerAppIds(["com.google.Chrome"]);
    setStoreActive(store);

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));

    const handler = listenMock.mock.calls[0]?.[0];
    expect(handler).toBeTypeOf("function");

    vi.useFakeTimers();
    listMicUsingApplicationsMock.mockClear();

    handler({
      payload: {
        type: "micStopped",
        apps: [{ id: "com.google.Chrome", name: "Google Chrome" }],
      },
    });

    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS - 1);

    handler({
      payload: {
        type: "micDetected",
        key: "mic-1",
        apps: [{ id: "com.google.Chrome", name: "Google Chrome" }],
        duration_secs: 15,
      },
    });

    await vi.advanceTimersByTimeAsync(1);

    expect(listMicUsingApplicationsMock).not.toHaveBeenCalled();
    expect(stopSpy).not.toHaveBeenCalled();
  });

  test("invalidates a browser stop prompt when the meeting resumes", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });
    store.getState().setTriggerAppIds(["com.google.Chrome"]);
    setStoreActive(store);

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );
    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));
    clearNotificationsMock.mockClear();
    const handler = listenMock.mock.calls[0]?.[0];

    vi.useFakeTimers();
    handler({
      payload: {
        type: "micStopped",
        apps: [{ id: "com.google.Chrome", name: "Google Chrome" }],
      },
    });
    await vi.advanceTimersByTimeAsync(AUTO_STOP_CONFIRM_DELAY_MS);
    const notificationKey = showNotificationMock.mock.calls[0]?.[0]?.key;

    handler({
      payload: {
        type: "micDetected",
        key: "mic-resumed",
        apps: [{ id: "com.google.Chrome", name: "Google Chrome" }],
        duration_secs: 15,
      },
    });

    expect(clearNotificationsMock).toHaveBeenCalledTimes(1);
    expect(consumeAutoStopEndedNotificationKey(notificationKey)).toBeNull();
    expect(stopSpy).not.toHaveBeenCalled();
  });

  test("stops listening when sleep starts", async () => {
    const store = createListenerStore();
    const stopSpy = vi.fn();

    store.setState({ stop: stopSpy });

    render(
      <ListenerProvider store={store}>
        <div>child</div>
      </ListenerProvider>,
    );

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));

    const handler = listenMock.mock.calls[0]?.[0];
    expect(handler).toBeTypeOf("function");

    handler({
      payload: {
        type: "sleepStateChanged",
        value: true,
      },
    });

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });
});
