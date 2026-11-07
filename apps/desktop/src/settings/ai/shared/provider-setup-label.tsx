import { Trans } from "@lingui/react/macro";

import type { ConfigField } from "./eligibility";

export function MissingSetupLabel({
  fields,
  subscription = false,
}: {
  fields: readonly ConfigField[];
  subscription?: boolean;
}) {
  if (subscription) {
    return <Trans>Not signed in</Trans>;
  }
  if (fields.length > 1) {
    return <Trans>Needs an address and a key</Trans>;
  }
  if (fields[0] === "base_url") {
    return <Trans>Needs a server address</Trans>;
  }
  return <Trans>No key</Trans>;
}
