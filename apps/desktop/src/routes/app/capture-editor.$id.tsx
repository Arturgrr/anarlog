import { createFileRoute } from "@tanstack/react-router";

import { CaptureEditorWindow } from "~/capture/editor-window";

export const Route = createFileRoute("/app/capture-editor/$id")({
  component: Component,
});

function Component() {
  const { id } = Route.useParams();
  return <CaptureEditorWindow id={id} />;
}
