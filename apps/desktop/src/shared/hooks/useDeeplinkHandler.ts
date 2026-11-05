import { isTauri } from "@tauri-apps/api/core";
import { useRef } from "react";

import {
  type DeepLink,
  commands as deeplink2Commands,
  events as deeplink2Events,
} from "@anlg/plugin-deeplink2";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";

import { useAuth } from "~/auth";
import { createAuthCallbackHandler } from "~/auth/deeplink";
import { subscribeThenDrainDeepLinks } from "~/shared/deeplink";
import { useLatestRef } from "~/shared/hooks/useLatestRef";

export function useDeeplinkHandler() {
  const auth = useAuth();
  const authRef = useLatestRef(auth);
  const authCallbackHandlerRef =
    useRef<ReturnType<typeof createAuthCallbackHandler>>(null);
  if (!authCallbackHandlerRef.current) {
    authCallbackHandlerRef.current = createAuthCallbackHandler({
      setSessionFromTokens: (accessToken, refreshToken) =>
        authRef.current.setSessionFromTokens(accessToken, refreshToken),
    });
  }
  const authCallbackHandler = authCallbackHandlerRef.current;

  useMountEffect(() => {
    if (!isTauri()) {
      return;
    }

    const handleDeepLink = (payload: DeepLink) => {
      if (payload.to === "/auth/callback") {
        const { access_token, refresh_token, state } = payload.search;
        if (access_token && refresh_token) {
          void authCallbackHandler(
            access_token,
            refresh_token,
            state ?? undefined,
          ).catch((error) => {
            console.error(
              "[auth] sign-in failed; retry the callback or start sign-in again",
              error,
            );
          });
        }
      }
    };
    const deepLinkSubscription = subscribeThenDrainDeepLinks({
      listen: (handler) =>
        deeplink2Events.deepLinkEvent.listen(({ payload }) => {
          handler(payload);
        }),
      takePendingDeepLinks: deeplink2Commands.takePendingDeepLinks,
      handle: handleDeepLink,
    });

    return () => {
      void deepLinkSubscription.then((fn) => fn()).catch(() => {});
    };
  });
}
