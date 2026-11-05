import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getVersion } from "@tauri-apps/api/app";
import { version as osVersion, platform } from "@tauri-apps/plugin-os";

import { commands as analyticsCommands } from "@anlg/plugin-analytics";

import { setErrorReportingUser } from "~/error-reporting";

let trackedIdentifySignature: string | null = null;
let trackedSignedInUserId: string | null = null;

export function resetTrackedAuthIdentity() {
  trackedIdentifySignature = null;
  trackedSignedInUserId = null;
  setErrorReportingUser(null);
}

export async function clearAuthAnalyticsGroups() {
  await analyticsCommands.clearGroups();
}

export async function trackAuthEvent(
  event: AuthChangeEvent,
  session: Session | null,
): Promise<void> {
  if (
    (event === "SIGNED_IN" ||
      event === "INITIAL_SESSION" ||
      event === "TOKEN_REFRESHED") &&
    session
  ) {
    setErrorReportingUser(session.user.id);
    const appVersion = await getVersion();
    const identifySignature = JSON.stringify({
      userId: session.user.id,
      appVersion,
    });

    if (identifySignature !== trackedIdentifySignature) {
      trackedIdentifySignature = identifySignature;

      await analyticsCommands.identify(session.user.id, {
        set: {
          account_created_date: session.user.created_at,
          is_signed_up: true,
          app_version: appVersion,
          os_version: osVersion(),
          platform: platform(),
        },
        group: {
          type: "account",
          key: session.user.id,
          properties: {
            created_at: session.user.created_at,
          },
        },
      });
    }

    if (event === "SIGNED_IN" && trackedSignedInUserId !== session.user.id) {
      trackedSignedInUserId = session.user.id;
      await analyticsCommands.event({ event: "user_signed_in" });
    }
  }
}
