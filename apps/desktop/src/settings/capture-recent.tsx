import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useState } from "react";

import {
  commands as capture,
  events as captureEvents,
  type CaptureEntry,
} from "@anlg/plugin-capture";
import {
  Copy,
  FolderOpen,
  Image,
  PencilSimple,
  Trash,
  VideoCamera,
} from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";
import { cn } from "@anlg/utils";

import { CAPTURE_EDITED_EVENT } from "~/capture/editor-window";
import { openCaptureEditor, revealCapture, unwrap } from "~/capture/lifecycle";
import { localizeExternalMessage } from "~/i18n/external-messages";

const RECENT = 12;
const QUERY_KEY = ["captures"];

export function RecentCaptures({ onShowFolder }: { onShowFolder: () => void }) {
  const client = useQueryClient();
  // Bumped whenever a file may have been rewritten in place, so thumbnails
  // with an unchanged path are fetched again.
  const [version, setVersion] = useState(0);
  const captures = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => unwrap(await capture.listCaptures()),
    refetchOnWindowFocus: true,
  });

  useMountEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const refresh = () => {
      setVersion((current) => current + 1);
      void client.invalidateQueries({ queryKey: QUERY_KEY });
    };
    const keep = (stop: () => void) =>
      disposed ? stop() : unlisteners.push(stop);
    void captureEvents.captureEvent
      .listen(({ payload }) => {
        if (payload.type === "captured") refresh();
      })
      .then(keep);
    void listen(CAPTURE_EDITED_EVENT, refresh).then(keep);
    return () => {
      disposed = true;
      for (const stop of unlisteners) stop();
    };
  });

  const entries = captures.data?.slice(0, RECENT) ?? [];

  return (
    <div className="flex flex-col gap-3">
      {captures.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {localizeExternalMessage(captures.error.message)}
        </p>
      ) : captures.isPending ? null : entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          <Trans>
            Nothing captured yet. Your screenshots and recordings appear here.
          </Trans>
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
          {entries.map((entry) => (
            <CaptureItem key={entry.id} entry={entry} version={version} />
          ))}
        </ul>
      )}
      <div>
        <Button variant="outline" onClick={onShowFolder}>
          <FolderOpen className="size-4" />
          <Trans>Show captures folder</Trans>
        </Button>
      </div>
    </div>
  );
}

function CaptureItem({
  entry,
  version,
}: {
  entry: CaptureEntry;
  version: number;
}) {
  const { t, i18n } = useLingui();
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const action = useMutation({
    mutationFn: async (kind: "edit" | "copy" | "show" | "delete") => {
      if (kind === "edit") return openCaptureEditor(entry.id);
      if (kind === "show") return revealCapture(entry.path);
      if (kind === "copy") return unwrap(await capture.copyCapture(entry.id));
      unwrap(await capture.deleteCapture(entry.id));
      await client.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
  const name = entry.path.split("/").pop() ?? entry.path;
  const when = i18n.date(new Date(entry.createdMs), {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const thumbnail = entry.thumbnailPath
    ? `${convertFileSrc(entry.thumbnailPath)}?v=${entry.bytes}-${version}`
    : null;
  const iconButton = cn(["text-muted-foreground hover:text-foreground size-6"]);

  return (
    <li className="flex min-w-0 flex-col gap-1.5">
      <div className="bg-muted relative flex aspect-video items-center justify-center overflow-hidden rounded-md border">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={name}
            className="size-full object-contain"
            loading="lazy"
          />
        ) : entry.kind === "screenshot" ? (
          <Image className="text-muted-foreground size-6" />
        ) : (
          <VideoCamera className="text-muted-foreground size-6" />
        )}
        {entry.kind !== "screenshot" && (
          <span className="bg-background/80 absolute right-1 bottom-1 rounded px-1 text-[10px] font-medium uppercase">
            {entry.kind === "gif" ? "GIF" : "MP4"}
          </span>
        )}
      </div>
      <p className="text-muted-foreground truncate text-xs" title={name}>
        {when}
      </p>
      {confirming ? (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="destructive"
            disabled={action.isPending}
            onClick={() => action.mutate("delete")}
          >
            <Trans>Delete</Trans>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirming(false)}
          >
            <Trans>Cancel</Trans>
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-0.5">
          {entry.kind === "screenshot" && (
            <Button
              size="icon"
              variant="ghost"
              className={iconButton}
              aria-label={t`Edit`}
              title={t`Edit`}
              onClick={() => action.mutate("edit")}
            >
              <PencilSimple className="size-3.5" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className={iconButton}
            aria-label={t`Copy`}
            title={t`Copy`}
            onClick={() => action.mutate("copy")}
          >
            <Copy className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className={iconButton}
            aria-label={t`Show in Finder`}
            title={t`Show in Finder`}
            onClick={() => action.mutate("show")}
          >
            <FolderOpen className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className={iconButton}
            aria-label={t`Delete ${name}`}
            title={t`Delete`}
            onClick={() => setConfirming(true)}
          >
            <Trash className="size-3.5" />
          </Button>
        </div>
      )}
      {action.isError && (
        <p role="alert" className="text-destructive text-xs">
          {localizeExternalMessage(action.error.message)}
        </p>
      )}
    </li>
  );
}
