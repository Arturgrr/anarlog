import { i18n } from "@lingui/core";
import { afterEach, describe, expect, it } from "vitest";

import { localizeExternalMessage } from "./external-messages";
import { messages as en } from "./locales/en/messages";
import { messages as pt } from "./locales/pt/messages";

afterEach(() => {
  i18n.load("en", en);
  i18n.activate("en");
});

describe("localizeExternalMessage", () => {
  it("translates Capture's messages that carry paths mid-sentence, keeping the paths", () => {
    i18n.load("pt", pt);
    i18n.activate("pt");

    expect(
      localizeExternalMessage(
        "The recording could not be finished (stream ended). What was recorded is kept at /Library/a b.mp4, and Librelog adds it to your captures later.",
      ),
    ).toBe(
      "Não foi possível concluir a gravação (stream ended). O que foi gravado está mantido em /Library/a b.mp4, e o Librelog o adiciona às suas capturas depois.",
    );
    expect(
      localizeExternalMessage(
        "Could not save the capture in /Volumes/USB: Permission denied (os error 13). It was kept at /Library/x.png.",
      ),
    ).toBe(
      "Não foi possível salvar a captura em /Volumes/USB: Permission denied (os error 13). Ela foi mantida em /Library/x.png.",
    );
    expect(
      localizeExternalMessage(
        "The capture was kept at /Library/x.png, but This capture is no longer in the list.",
      ),
    ).toBe(
      "A captura foi mantida em /Library/x.png, mas Esta captura não está mais na lista.",
    );
  });
});
