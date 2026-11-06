import { useQueryClient } from "@tanstack/react-query";

import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";

import { listenForCaptureCleanup } from "./audio-cleanup";
import { subscribeToSessionAudioRetention } from "./audio-retention";

export function TaskManager() {
  useMountEffect(() => {
    const unlisten = listenForCaptureCleanup();
    return () => {
      void unlisten.then((stop) => stop());
    };
  });
  const queryClient = useQueryClient();
  useMountEffect(() =>
    subscribeToSessionAudioRetention(({ phase, session_id }) => {
      if (phase !== "deleted") return;
      void queryClient.invalidateQueries({
        queryKey: ["audio", session_id, "exist"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["audio", session_id, "url"],
      });
    }),
  );
  return null;
}
