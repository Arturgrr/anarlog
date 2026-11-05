import { createFileRoute } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback } from "react";

import { dismissInstruction } from "@anlg/plugin-windows";

import { InstructionScreen, type InstructionType } from "~/instruction";

export const Route = createFileRoute("/app/instruction")({
  validateSearch: (search): { type: InstructionType; url?: string } => ({
    type: ((search as { type?: string }).type ?? "sign-in") as InstructionType,
    url: (search as { url?: string }).url,
  }),
  component: InstructionRoute,
});

function useHandleBack() {
  return useCallback(() => dismissInstruction(), []);
}

function InstructionRoute() {
  const handleBack = useHandleBack();
  const onBack = useCallback(() => void handleBack(), [handleBack]);
  const onClose = useCallback(
    () => void handleBack().then(() => getCurrentWindow().close()),
    [handleBack],
  );
  return <InstructionScreen onBack={onBack} onClose={onClose} />;
}
