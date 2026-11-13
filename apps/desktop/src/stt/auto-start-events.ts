export const AUTO_START_TIMEOUT_MS = 30_000;

const settledListeners = new Set<(sessionId: string) => void>();

// Fires when a session's auto-start has made its attempt or given it up. It
// says nothing about the outcome: a failed start usually resolves after
// showing a toast, so callers check the listener state afterwards.
export function onAutoStartSettled(listener: (sessionId: string) => void) {
  settledListeners.add(listener);
  return () => {
    settledListeners.delete(listener);
  };
}

export function notifyAutoStartSettled(sessionId: string) {
  for (const listener of settledListeners) listener(sessionId);
}
