import { getIdentifier } from "@tauri-apps/api/app";

// export * from "../shared/config/configure-pro-settings";
// export * from "~/sidebar/timeline/utils";
// export * from "~/stt/segment";

export const id = () => crypto.randomUUID() as string;

export type DesktopScheme =
  | "anarlog"
  | "anarlog-staging"
  | "anarlog-nightly"
  | "anarlog-dev";

export const getScheme = async (): Promise<DesktopScheme> => {
  const id = await getIdentifier();
  const schemes: Record<string, DesktopScheme> = {
    "com.hyprnote.stable": "anarlog",
    "com.hyprnote.Hyprnote": "anarlog",
    "com.hyprnote.staging": "anarlog-staging",
    "com.hyprnote.nightly": "anarlog-nightly",
    "com.hyprnote.dev": "anarlog-dev",
    "so.anarlog.Anarlog": "anarlog",
    "com.anarlog.stable": "anarlog",
    "com.anarlog.staging": "anarlog-staging",
    "com.anarlog.dev": "anarlog-dev",
  };
  return schemes[id] ?? "anarlog";
};

// https://www.rfc-editor.org/rfc/rfc4122#section-4.1.7
export const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000000";
