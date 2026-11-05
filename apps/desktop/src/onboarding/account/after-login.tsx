import { Trans } from "@lingui/react/macro";

import { CheckCircle } from "@anlg/ui/components/icons";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";

export function AfterLogin({ onContinue }: { onContinue: () => void }) {
  useMountEffect(() => {
    const timeout = setTimeout(onContinue, 1500);
    return () => clearTimeout(timeout);
  });

  return (
    <div className="flex items-center gap-2 text-sm text-emerald-600">
      <CheckCircle className="size-4" />
      <span>
        <Trans>Signed in</Trans>
      </span>
    </div>
  );
}
