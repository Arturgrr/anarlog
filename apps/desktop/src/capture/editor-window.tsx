import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";

import { commands as capture } from "@anlg/plugin-capture";
import { Button } from "@anlg/ui/components/ui/button";

import { CaptureEditor, imageFromBlob } from "./editor";

import { localizeExternalMessage } from "~/i18n/external-messages";

/** Sent to every window after the editor rewrote a capture's file. */
export const CAPTURE_EDITED_EVENT = "capture-edited";

function unwrap<T>(
  result: { status: "ok"; data: T } | { status: "error"; error: string },
): T {
  if (result.status === "error") {
    throw new Error(localizeExternalMessage(result.error));
  }
  return result.data;
}

function fileName(path: string) {
  return path.split("/").pop() ?? path;
}

function asDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const close = () => void getCurrentWindow().close();

export function CaptureEditorWindow({ id }: { id: string }) {
  const { t } = useLingui();
  const loaded = useQuery({
    queryKey: ["capture-editor", id],
    queryFn: async () => {
      const entry = unwrap(await capture.listCaptures()).find(
        (candidate) => candidate.id === id,
      );
      if (!entry || entry.kind !== "screenshot") return null;
      void getCurrentWindow()
        .setTitle(fileName(entry.path))
        .catch((error) => console.error("[capture] title", error));
      // Loaded as bytes, not as an <img> from another origin, so the
      // canvas can still be exported.
      const response = await fetch(convertFileSrc(entry.path));
      if (!response.ok) throw new Error(response.statusText);
      const image = await imageFromBlob(await response.blob());
      return { entry, image };
    },
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (loaded.isPending) {
    return <div className="bg-background h-screen w-screen" />;
  }
  if (!loaded.data) {
    return (
      <div className="bg-background text-foreground flex h-screen w-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm">
          {loaded.isError ? (
            <Trans>This screenshot could not be opened.</Trans>
          ) : (
            <Trans>This screenshot is no longer in your captures.</Trans>
          )}
        </p>
        <Button variant="outline" onClick={close}>
          <Trans>Close</Trans>
        </Button>
      </div>
    );
  }

  const { entry, image } = loaded.data;
  const stem = fileName(entry.path).replace(/\.[^.]+$/u, "");
  const folder = entry.path.slice(0, entry.path.lastIndexOf("/"));

  return (
    <div className="h-screen w-screen">
      <CaptureEditor
        image={image}
        scale={entry.scale || 1}
        onCopy={async (png) => {
          await writeImage(new Uint8Array(await png.arrayBuffer()));
        }}
        onSave={async (png) => {
          unwrap(
            await capture.saveEdited(id, await asDataUrl(png), true, false),
          );
          await emit(CAPTURE_EDITED_EVENT, id);
        }}
        onSaveAs={async (png) => {
          const dest = await save({
            title: t`Save the screenshot as`,
            defaultPath: `${folder}/${stem}.png`,
            filters: [{ name: "PNG", extensions: ["png"] }],
          });
          if (!dest) return false;
          unwrap(await capture.exportPng(dest, await asDataUrl(png)));
        }}
        onClose={close}
      />
    </div>
  );
}
