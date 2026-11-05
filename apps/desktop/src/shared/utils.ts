import { getIdentifier } from "@tauri-apps/api/app";

// export * from "../shared/config/configure-pro-settings";
// export * from "~/sidebar/timeline/utils";
// export * from "~/stt/segment";

export const id = () => crypto.randomUUID() as string;

export type DesktopScheme =
  | "librelog"
  | "librelog-staging"
  | "librelog-nightly"
  | "librelog-dev";

export const getScheme = async (): Promise<DesktopScheme> => {
  const id = await getIdentifier();
  const schemes: Record<string, DesktopScheme> = {
    "com.arturgrr.librelog": "librelog",
    "com.arturgrr.librelog.desktop": "librelog",
    "com.arturgrr.librelog.staging": "librelog-staging",
    "com.arturgrr.librelog.nightly": "librelog-nightly",
    "com.arturgrr.librelog.dev": "librelog-dev",
    "io.github.arturgrr.Librelog": "librelog",
  };
  return schemes[id] ?? "librelog";
};

// https://www.rfc-editor.org/rfc/rfc4122#section-4.1.7
export const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000000";
