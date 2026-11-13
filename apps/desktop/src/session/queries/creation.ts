import { commands } from "@anlg/plugin-session";

import type { SessionChanges } from "./types";

import { ensureFolderCatalog } from "~/session/folder-catalog";
import { normalizeFolderPath } from "~/session/folders";
import { DEFAULT_USER_ID } from "~/shared/utils";

export async function createSession(
  title = "",
  userId = DEFAULT_USER_ID,
  initial?: Pick<SessionChanges, "folder_id" | "raw_md"> & {
    event_json?: string;
  },
): Promise<string> {
  const { sessionId, folderError } = await createSessionReportingFolder(
    title,
    userId,
    initial,
  );
  if (folderError) throw folderError;
  return sessionId;
}

// The note exists once the command commits, even if its folder then fails
// to reach the folder catalog, so that failure is returned, not thrown.
export async function createSessionReportingFolder(
  title = "",
  userId = DEFAULT_USER_ID,
  initial?: Pick<SessionChanges, "folder_id" | "raw_md"> & {
    event_json?: string;
  },
): Promise<{ sessionId: string; folderError: unknown }> {
  const folderPath = normalizeFolderPath(initial?.folder_id ?? "") ?? "";

  const result = await commands.createSession({
    title,
    user_id: userId,
    event_json: initial?.event_json ?? "",
    folder_path: folderPath,
    raw_md: initial?.raw_md ?? "",
  });
  if (result.status === "error") throw new Error(result.error);
  const sessionId = result.data;

  const folderError = folderPath
    ? await ensureFolderCatalog(folderPath).then(
        () => null,
        (error: unknown) => error,
      )
    : null;

  return { sessionId, folderError };
}
