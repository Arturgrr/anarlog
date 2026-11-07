import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@anlg/ui/components/ui/dialog";

import { createI18n } from "./catalogs";
import { ComponentLabelsProvider } from "./component-labels";

import { FloatingBarOverlay } from "~/meeting-float/overlay/bar";

// test-setup stubs Lingui's React bindings with English passthroughs; this
// file needs the real catalogs.
vi.unmock("@lingui/react");
vi.unmock("@lingui/react/macro");

vi.mock("@anlg/ui/components/ui/dancing-sticks", () => ({
  DancingSticks: () => null,
}));

describe("pt-BR rendering", () => {
  afterEach(() => {
    cleanup();
  });

  it("translates app and shared-package chrome instead of falling back to English", async () => {
    const i18n = await createI18n("pt");

    render(
      <I18nProvider i18n={i18n}>
        <ComponentLabelsProvider>
          <Dialog open modal={false}>
            <DialogContent>
              <DialogTitle>Librelog</DialogTitle>
            </DialogContent>
          </Dialog>
          <FloatingBarOverlay
            state={{
              amplitude: 0.4,
              title: "Librelog",
              status: "recording",
              colorScheme: "light",
              opacity: 0.78,
              liveCaptionOpacity: 0.3,
              liveCaptionWidth: 440,
              liveCaptionLineCount: 1,
              liveCaptionPosition: "topCenter",
              liveCaptionMinimized: true,
              liveCaptionToggleVisible: true,
              transcriptBubbles: [],
            }}
            onStop={() => {}}
            onToggleExpanded={() => {}}
          />
        </ComponentLabelsProvider>
      </I18nProvider>,
    );

    for (const [english, descriptor] of [
      ["Close", msg`Close`],
      ["Stop listening", msg`Stop listening`],
      ["Expand live transcript", msg`Expand live transcript`],
    ] as const) {
      const translated = i18n._(descriptor);
      expect(translated).not.toBe(english);
      expect(screen.getByRole("button", { name: translated })).toBeTruthy();
      expect(screen.queryByRole("button", { name: english })).toBeNull();
    }
  });
});
