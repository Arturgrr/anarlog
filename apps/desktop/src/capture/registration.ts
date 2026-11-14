let registration: Promise<void> = Promise.resolve();

/** Resolves once Capture's shortcuts are released, for a shortcut recorder. */
export function waitForCaptureCleanup() {
  return registration;
}

/** Runs `step` after the registration steps before it, failed or not. */
export function chainRegistration(step: () => Promise<void>) {
  const done = registration.then(step);
  registration = done.catch(() => {});
  return done;
}
