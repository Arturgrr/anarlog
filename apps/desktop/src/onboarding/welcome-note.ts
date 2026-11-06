import { t } from "@lingui/core/macro";

import { md2json } from "@anlg/editor/markdown";
import type { SessionEvent } from "@anlg/store";

import { liveQueryClient } from "~/db";
import { WELCOME_NOTE_TRACKING_ID } from "~/onboarding/welcome-note.constants";
import { createSession } from "~/session/queries";
import { DEFAULT_USER_ID } from "~/shared/utils";

const PENDING_WELCOME_SESSION_KEY = "librelog.pending-welcome-session";

function getWelcomeNoteMarkdown() {
  return t`Welcome to Librelog 👋


This note is a quick way to see how Librelog works.


Click **Record** in the top-right corner and talk for a minute, or play a video with someone speaking. Librelog saves the audio on your device. To create a transcript and notes, choose a provider in **Settings → Transcription**; if one is not ready, Librelog will show you a setup shortcut.


When you stop recording, Librelog will create your summary automatically if transcription and intelligence are configured.`;
}

let pendingWelcomeSession: Promise<string> | null = null;

export function getOrCreateWelcomeSession(): Promise<string> {
  if (!pendingWelcomeSession) {
    pendingWelcomeSession = findOrCreateWelcomeSession().finally(() => {
      pendingWelcomeSession = null;
    });
  }
  return pendingWelcomeSession;
}

export function setPendingWelcomeSession(sessionId: string | null) {
  if (sessionId) {
    localStorage.setItem(PENDING_WELCOME_SESSION_KEY, sessionId);
  } else {
    localStorage.removeItem(PENDING_WELCOME_SESSION_KEY);
  }
}

export function takePendingWelcomeSession(): string | null {
  const sessionId = localStorage.getItem(PENDING_WELCOME_SESSION_KEY);
  localStorage.removeItem(PENDING_WELCOME_SESSION_KEY);
  return sessionId;
}

async function findOrCreateWelcomeSession(): Promise<string> {
  const rows = await liveQueryClient.execute<{ id: string }>(
    `
      SELECT id
      FROM sessions
      WHERE deleted_at IS NULL
        AND CASE
          WHEN json_valid(event_json)
          THEN json_extract(event_json, '$.tracking_id')
        END = ?
      ORDER BY created_at, id
      LIMIT 1
    `,
    [WELCOME_NOTE_TRACKING_ID],
  );
  if (rows[0]) return rows[0].id;

  const now = new Date().toISOString();
  const event: SessionEvent = {
    tracking_id: WELCOME_NOTE_TRACKING_ID,
    calendar_id: "",
    title: t`Welcome to Librelog`,
    started_at: now,
    ended_at: "",
    is_all_day: false,
    has_recurrence_rules: false,
    description: t`A quick introduction to Librelog.`,
  };

  return createSession(t`Welcome to Librelog`, DEFAULT_USER_ID, {
    event_json: JSON.stringify(event),
    raw_md: JSON.stringify(md2json(getWelcomeNoteMarkdown())),
  });
}
