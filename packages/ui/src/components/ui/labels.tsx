import { createContext, useContext, type ReactNode } from "react";

// Built-in component text. Apps provide translated labels; English is the
// fallback for renderers without a provider.
export type UiLabels = Readonly<{
  close: string;
  previousSlide: string;
  nextSlide: string;
  dismiss: string;
  pause: string;
  resume: string;
  pauseAutoDismiss: string;
  resumeAutoDismiss: string;
  toastTimer: (
    args: Readonly<{ seconds: number; paused: boolean; count: ReactNode }>,
  ) => ReactNode;
}>;

export const DEFAULT_UI_LABELS: UiLabels = {
  close: "Close",
  previousSlide: "Previous slide",
  nextSlide: "Next slide",
  dismiss: "Dismiss",
  pause: "Pause",
  resume: "Resume",
  pauseAutoDismiss: "Pause auto-dismiss",
  resumeAutoDismiss: "Resume auto-dismiss",
  toastTimer: ({ seconds, paused, count }) => (
    <>
      {paused ? "Timer paused" : "Closing in"} {count}{" "}
      {seconds === 1 ? "second" : "seconds"}
    </>
  ),
};

const UiLabelsContext = createContext<UiLabels>(DEFAULT_UI_LABELS);

export function UiLabelsProvider({
  labels,
  children,
}: {
  labels: UiLabels;
  children: ReactNode;
}) {
  return <UiLabelsContext value={labels}>{children}</UiLabelsContext>;
}

export function useUiLabels(): UiLabels {
  return useContext(UiLabelsContext);
}
