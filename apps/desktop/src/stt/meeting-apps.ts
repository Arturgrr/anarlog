import { plural, t } from "@lingui/core/macro";
import { resolveResource } from "@tauri-apps/api/path";

import type { NotificationIcon } from "@anlg/plugin-notification";

export const BROWSER_AUTO_STOP_APP_IDS = new Set([
  "at.studio.AsideBrowser",
  "app.zen-browser.zen",
  "ai.perplexity.comet",
  "com.apple.Safari",
  "com.apple.SafariTechnologyPreview",
  "com.browseros.BrowserOS",
  "com.brave.Browser",
  "com.brave.Browser.beta",
  "com.brave.Browser.nightly",
  "com.brave.Browser.origin",
  "com.duckduckgo.macos.browser",
  "chrome",
  "comet",
  "chromium",
  "chromium-browser",
  "com.google.Chrome",
  "com.google.Chrome.canary",
  "firefox",
  "google-chrome",
  "google-chrome-beta",
  "google-chrome-stable",
  "microsoft-edge",
  "msedge",
  "helium",
  "com.kagi.kagimacOS",
  "com.kagi.kagimacOS.RC",
  "com.microsoft.edgemac",
  "com.microsoft.edgemac.Beta",
  "com.microsoft.edgemac.Canary",
  "com.microsoft.edgemac.Dev",
  "com.operasoftware.Opera",
  "com.operasoftware.OperaDeveloper",
  "com.operasoftware.OperaGX",
  "com.operasoftware.OperaNext",
  "opera",
  "com.nousresearch.hermes",
  "com.sigmaos.sigmaos.macos",
  "com.vivaldi.Vivaldi",
  "vivaldi",
  "company.thebrowser.Browser",
  "company.thebrowser.dia",
  "net.imput.helium",
  "net.mullvad.mullvadbrowser",
  "net.waterfox.waterfox",
  "org.chromium.Chromium",
  "org.mozilla.firefox",
  "org.mozilla.firefoxdeveloperedition",
  "org.mozilla.librewolf",
  "org.mozilla.nightly",
  "org.torproject.torbrowser",
  "zen",
]);

export type MicApp = { id: string; name: string };
export type MeetingPlatform = {
  displayName: string;
  iconResource: NotificationIconResource;
};

const NOTIFICATION_ICON_RESOURCES = {
  calCom: "notification-icons/cal-com.png",
  calVideo: "notification-icons/cal-video.png",
  daily: "notification-icons/daily.png",
  discord: "notification-icons/discord.png",
  googleMeet: "notification-icons/google-meet.svg",
  gotomeeting: "notification-icons/gotomeeting.png",
  jitsi: "notification-icons/jitsi.png",
  kakaotalk: "notification-icons/kakaotalk.png",
  line: "notification-icons/line.png",
  messenger: "notification-icons/messenger.png",
  microsoftTeams: "notification-icons/microsoft-teams.svg",
  phone: "notification-icons/phone.png",
  signal: "notification-icons/signal.png",
  slack: "notification-icons/slack.svg",
  telegram: "notification-icons/telegram.png",
  webex: "notification-icons/webex.svg",
  whatsapp: "notification-icons/whatsapp.png",
  whereby: "notification-icons/whereby.png",
  xCalls: "notification-icons/x-calls.svg",
  zoom: "notification-icons/zoom.svg",
} as const;

type NotificationIconResource = keyof typeof NOTIFICATION_ICON_RESOURCES;

const notificationIconResourceCache = new Map<
  NotificationIconResource,
  Promise<NotificationIcon | null>
>();

const MEETING_PLATFORMS = {
  zoom: {
    displayName: "Zoom",
    iconResource: "zoom",
  },
  googleMeet: {
    displayName: "Google Meet",
    iconResource: "googleMeet",
  },
  webex: {
    displayName: "Webex",
    iconResource: "webex",
  },
  teams: {
    displayName: "Microsoft Teams",
    iconResource: "microsoftTeams",
  },
  calCom: {
    displayName: "Cal.com",
    iconResource: "calCom",
  },
  calVideo: {
    displayName: "Cal Video",
    iconResource: "calVideo",
  },
  daily: {
    displayName: "Daily",
    iconResource: "daily",
  },
  whereby: {
    displayName: "Whereby",
    iconResource: "whereby",
  },
  jitsi: {
    displayName: "Jitsi",
    iconResource: "jitsi",
  },
  gotomeeting: {
    displayName: "GoTo Meeting",
    iconResource: "gotomeeting",
  },
  slack: {
    displayName: "Slack",
    iconResource: "slack",
  },
  discord: {
    displayName: "Discord",
    iconResource: "discord",
  },
  whatsapp: {
    displayName: "WhatsApp",
    iconResource: "whatsapp",
  },
  kakaotalk: {
    displayName: "KakaoTalk",
    iconResource: "kakaotalk",
  },
  telegram: {
    displayName: "Telegram",
    iconResource: "telegram",
  },
  signal: {
    displayName: "Signal",
    iconResource: "signal",
  },
  line: {
    displayName: "LINE",
    iconResource: "line",
  },
  messenger: {
    displayName: "Messenger",
    iconResource: "messenger",
  },
  xCalls: {
    displayName: "X Calls",
    iconResource: "xCalls",
  },
} satisfies Record<string, MeetingPlatform>;

type MicAppNotificationOverride = {
  ids: Set<string>;
  names: Set<string>;
  displayName: string;
  meetingPlatform?: MeetingPlatform;
  icon?: NotificationIcon;
  iconResource?: NotificationIconResource;
};

const MIC_APP_NOTIFICATION_OVERRIDES = [
  {
    ids: new Set([
      "/usr/libexec/avconferenced",
      "com.apple.avconferenced",
      "com.apple.TelephonyUtilities",
      "com.apple.TelephonyUtilities.callservicesd",
    ]),
    names: new Set(["av capture", "avcapture", "avconferenced", "iphone call"]),
    displayName: "iPhone Call",
    iconResource: "phone",
  },
  {
    ids: new Set(["com.apple.FaceTime"]),
    names: new Set(["facetime"]),
    displayName: "FaceTime",
    icon: {
      type: "bundle_id",
      bundle_id: "com.apple.FaceTime",
    } satisfies NotificationIcon,
  },
  {
    ids: new Set(["us.zoom.xos", "zoom", "Zoom.exe"]),
    names: new Set(["zoom", "zoom helper", "zoom workplace"]),
    displayName: "Zoom",
    meetingPlatform: MEETING_PLATFORMS.zoom,
    iconResource: "zoom",
  },
  {
    ids: new Set([
      "com.microsoft.teams",
      "com.microsoft.teams2",
      "ms-teams",
      "teams",
      "teams-for-linux",
    ]),
    names: new Set([
      "microsoft teams",
      "microsoft teams helper",
      "teams",
      "teams helper",
    ]),
    displayName: "Microsoft Teams",
    meetingPlatform: MEETING_PLATFORMS.teams,
    iconResource: "microsoftTeams",
  },
  {
    ids: new Set([
      "Cisco-Systems.Spark",
      "com.cisco.webex",
      "com.cisco.webexmeetingsapp",
    ]),
    names: new Set(["cisco webex", "webex", "webex helper", "webex meetings"]),
    displayName: "Webex",
    meetingPlatform: MEETING_PLATFORMS.webex,
    iconResource: "webex",
  },
  {
    ids: new Set([
      "com.slack.Slack",
      "com.tinyspeck.slackmacgap",
      "slack",
      "slack-desktop",
      "Slack.exe",
    ]),
    names: new Set(["slack", "slack helper"]),
    displayName: "Slack",
    meetingPlatform: MEETING_PLATFORMS.slack,
    iconResource: "slack",
  },
  {
    ids: new Set(["com.kakao.KakaoTalkMac"]),
    names: new Set(["kakaotalk", "kakaotalk helper"]),
    displayName: "KakaoTalk",
    meetingPlatform: MEETING_PLATFORMS.kakaotalk,
    iconResource: "kakaotalk",
  },
  {
    ids: new Set(["net.whatsapp.WhatsApp"]),
    names: new Set(["whatsapp", "whatsapp helper"]),
    displayName: "WhatsApp",
    meetingPlatform: MEETING_PLATFORMS.whatsapp,
    iconResource: "whatsapp",
  },
  {
    ids: new Set(["com.hnc.Discord", "com.discordapp.Discord"]),
    names: new Set(["discord", "discord helper"]),
    displayName: "Discord",
    meetingPlatform: MEETING_PLATFORMS.discord,
    iconResource: "discord",
  },
  {
    ids: new Set(["org.whispersystems.signal-desktop"]),
    names: new Set(["signal", "signal helper"]),
    displayName: "Signal",
    meetingPlatform: MEETING_PLATFORMS.signal,
    iconResource: "signal",
  },
  {
    ids: new Set(["ru.keepcoder.Telegram", "ru.keepcoder.TelegramLite"]),
    names: new Set(["telegram", "telegram helper", "telegram lite"]),
    displayName: "Telegram",
    meetingPlatform: MEETING_PLATFORMS.telegram,
    iconResource: "telegram",
  },
  {
    ids: new Set(["jp.naver.line.mac"]),
    names: new Set(["line", "line helper"]),
    displayName: "LINE",
    meetingPlatform: MEETING_PLATFORMS.line,
    iconResource: "line",
  },
  {
    ids: new Set(["com.facebook.archon"]),
    names: new Set(["messenger", "messenger helper"]),
    displayName: "Messenger",
    meetingPlatform: MEETING_PLATFORMS.messenger,
    iconResource: "messenger",
  },
] satisfies MicAppNotificationOverride[];

function getMicAppNotificationOverride(app: MicApp) {
  const normalizedName = app.name.trim().toLowerCase();
  return (
    MIC_APP_NOTIFICATION_OVERRIDES.find((override) =>
      override.names.has(normalizedName),
    ) ??
    MIC_APP_NOTIFICATION_OVERRIDES.find((override) => override.ids.has(app.id))
  );
}

export function getMeetingPlatformNameForMicApp(app: MicApp): string | null {
  return (
    getMicAppNotificationOverride(app)?.meetingPlatform?.displayName ?? null
  );
}

function getNotificationResourceIcon(
  resource: NotificationIconResource,
): Promise<NotificationIcon | null> {
  const cached = notificationIconResourceCache.get(resource);
  if (cached) {
    return cached;
  }

  const promise = resolveResource(NOTIFICATION_ICON_RESOURCES[resource])
    .then((path): NotificationIcon => ({ type: "path", path }))
    .catch(() => null);

  notificationIconResourceCache.set(resource, promise);
  return promise;
}

function getNotificationIconForAppId(appId: string): NotificationIcon | null {
  if (!appId || appId.startsWith("pid:")) {
    return null;
  }

  if (appId.startsWith("/") || appId.startsWith("~/")) {
    return { type: "path", path: appId };
  }

  return { type: "bundle_id", bundle_id: appId };
}

export async function getNotificationIconForApp(
  app: MicApp,
): Promise<NotificationIcon | null> {
  const override = getMicAppNotificationOverride(app);
  if (override?.iconResource) {
    const icon = await getNotificationResourceIcon(override.iconResource);
    if (icon) {
      return icon;
    }
  }

  return override?.icon ?? getNotificationIconForAppId(app.id);
}

export function getNotificationAppName(app: MicApp) {
  return getMicAppNotificationOverride(app)?.displayName ?? app.name;
}

function isBrowserApp(app: MicApp) {
  return BROWSER_AUTO_STOP_APP_IDS.has(app.id);
}

export function isMeetingCapableMicApp(app: MicApp) {
  return isBrowserApp(app) || getMicAppNotificationOverride(app) !== undefined;
}

export async function getNotificationIconForDetectedApps(
  apps: MicApp[],
): Promise<NotificationIcon | null> {
  for (const app of apps) {
    const icon = await getNotificationIconForApp(app);
    if (icon) {
      return icon;
    }
  }

  return null;
}

export function getIgnorableApps(apps: MicApp[]) {
  const seen = new Set<string>();

  return apps.filter((app) => {
    if (!app.id || app.id.startsWith("pid:") || seen.has(app.id)) {
      return false;
    }

    seen.add(app.id);
    return true;
  });
}

export function getIgnoreAppsFooterText(apps: MicApp[]) {
  const firstName = apps[0] ? getNotificationAppName(apps[0]).trim() : "";

  if (apps.length === 1) {
    return firstName ? t`Ignore ${firstName}?` : t`Ignore this app?`;
  }

  if (!firstName) {
    return t`Ignore these apps?`;
  }

  const secondName = apps[1] ? getNotificationAppName(apps[1]).trim() : "";
  if (apps.length === 2 && secondName) {
    return t`Ignore ${firstName} and ${secondName}?`;
  }

  const otherAppCount = apps.length - 1;
  return plural(otherAppCount, {
    one: `Ignore ${firstName} and # other app?`,
    other: `Ignore ${firstName} and # other apps?`,
  });
}
