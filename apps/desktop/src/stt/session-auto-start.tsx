import { useRef } from "react";

import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";

import { isLockedFlag } from "~/lock/flag";
import { useAppLock } from "~/lock/store";
import { useSession } from "~/session/queries";
import { useLatestRef } from "~/shared/hooks/useLatestRef";
import { type Tab, useTabs } from "~/store/zustand/tabs";
import {
  AUTO_START_TIMEOUT_MS,
  notifyAutoStartSettled,
} from "~/stt/auto-start-events";
import { useListener } from "~/stt/contexts";
import { useStartListeningState } from "~/stt/useStartListening";

export function SessionAutoStart({ sessionId }: { sessionId: string }) {
  const canStartLiveSession = useListener((state) =>
    state.canStartLiveSession(sessionId),
  );
  const recordingActive = useListener(
    (state) => state.live.status === "active",
  );
  const session = useSession(sessionId);
  const revealed = useAppLock((state) =>
    Boolean(state.revealedNoteIds[sessionId]),
  );
  const locked = isLockedFlag(session?.locked) && !revealed;

  if (recordingActive || (session && locked)) {
    return <AbandonedSessionAutoStart sessionId={sessionId} />;
  }

  return canStartLiveSession && session ? (
    <ReadySessionAutoStart key={sessionId} sessionId={sessionId} />
  ) : (
    <PendingSessionAutoStart sessionId={sessionId} />
  );
}

function AbandonedSessionAutoStart({ sessionId }: { sessionId: string }) {
  useMountEffect(() => {
    clearPendingAutoStart(sessionId);
    notifyAutoStartSettled(sessionId);
  });

  return null;
}

function PendingSessionAutoStart({ sessionId }: { sessionId: string }) {
  useMountEffect(() => {
    const timeout = setTimeout(
      () => clearPendingAutoStart(sessionId),
      AUTO_START_TIMEOUT_MS,
    );
    return () => clearTimeout(timeout);
  });

  return null;
}

function ReadySessionAutoStart({ sessionId }: { sessionId: string }) {
  const { connectionReady, startListening } = useStartListeningState(
    sessionId,
    { automatic: true },
  );
  const attemptedRef = useRef(false);

  useMountEffect(() => {
    const timeout = setTimeout(
      () => clearPendingAutoStart(sessionId),
      AUTO_START_TIMEOUT_MS,
    );
    return () => clearTimeout(timeout);
  });

  return connectionReady ? (
    <StartSessionAutoStart
      attemptedRef={attemptedRef}
      sessionId={sessionId}
      startListening={startListening}
    />
  ) : null;
}

function StartSessionAutoStart({
  attemptedRef,
  sessionId,
  startListening,
}: {
  attemptedRef: { current: boolean };
  sessionId: string;
  startListening: () => Promise<void>;
}) {
  const startListeningRef = useLatestRef(startListening);

  useMountEffect(() => {
    if (attemptedRef.current) {
      return;
    }
    attemptedRef.current = true;
    let cancelled = false;
    let captureStarted = false;

    void Promise.resolve()
      .then(() => {
        if (cancelled) return;
        clearPendingAutoStart(sessionId);
        captureStarted = true;
        return startListeningRef.current();
      })
      .catch((error) => {
        if (cancelled) return;
        clearPendingAutoStart(sessionId);
        console.error("[listener] failed to auto-start session", error);
      })
      .finally(() => {
        if (captureStarted) notifyAutoStartSettled(sessionId);
      });

    return () => {
      cancelled = true;
      if (!captureStarted) {
        attemptedRef.current = false;
      }
    };
  });

  return null;
}

function clearPendingAutoStart(sessionId: string) {
  const tabsState = useTabs.getState();
  const currentTab = tabsState.tabs.find(
    (candidate): candidate is Extract<Tab, { type: "sessions" }> =>
      candidate.type === "sessions" && candidate.id === sessionId,
  );
  if (!currentTab?.state.autoStart) {
    return;
  }

  tabsState.updateSessionTabState(currentTab, {
    ...currentTab.state,
    autoStart: null,
  });
}
