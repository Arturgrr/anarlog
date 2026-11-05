import { describe, expect, it } from "vitest";

import { getLiveTranscriptPausedMessage } from "./live-transcript-interrupted";

describe("getLiveTranscriptPausedMessage", () => {
  it("names the provider when it reports an outage", () => {
    expect(
      getLiveTranscriptPausedMessage({
        degraded: { type: "stream_error", message: "deepgram: overloaded" },
        sttProvider: "deepgram",
        online: true,
      }),
    ).toMatch(/because Deepgram is having an outage\./);
  });

  it("blames the connection when offline", () => {
    expect(
      getLiveTranscriptPausedMessage({
        degraded: { type: "connection_timeout" },
        sttProvider: "deepgram",
        online: false,
      }),
    ).toMatch(/because you're offline\./);
  });

  it("reports unreachable direct providers", () => {
    expect(
      getLiveTranscriptPausedMessage({
        degraded: { type: "connection_timeout" },
        sttProvider: "deepgram",
        online: true,
      }),
    ).toMatch(/Anarlog can't reach Deepgram/);
  });

  it("does not blame the network for on-device models", () => {
    expect(
      getLiveTranscriptPausedMessage({
        degraded: { type: "connection_timeout" },
        sttProvider: "soniqo",
        online: false,
      }),
    ).toMatch(/the local transcription model stopped responding/);
  });
});
