let registration: Promise<void> = Promise.resolve();

/** Resolves once Annotate's shortcuts are released, for a shortcut recorder. */
export function waitForAnnotateCleanup() {
  return registration;
}

/** Runs `step` after the registration steps before it, failed or not. */
export function chainRegistration(step: () => Promise<void>) {
  const done = registration.then(step);
  registration = done.catch(() => {});
  return done;
}
