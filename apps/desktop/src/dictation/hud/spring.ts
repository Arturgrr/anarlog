// Frame-rate independent springs, ported from Hex's `src/rune_hud/spring.rs`
// (MIT, © 2026 Christopher Langton).

const CRITICAL_DAMPING_TOLERANCE = 1e-4;

/** Duration + bounce, SwiftUI's mapping (ω = 2π / duration, ζ = 1 − bounce). */
export type SpringSpec = { duration: number; bounce: number };

/** The short crossfade kept with Reduce Motion. */
export const REDUCED_FADE: SpringSpec = { duration: 0.16, bounce: 0 };

export function omega(spec: SpringSpec) {
  return (2 * Math.PI) / Math.max(spec.duration, 0.01);
}

export function zeta(spec: SpringSpec) {
  return spec.bounce >= 0
    ? Math.max(1 - spec.bounce, 0)
    : 1 / Math.max(1 + spec.bounce, 0.01);
}

/** An exact damped harmonic oscillator, stable at any step. */
export class Spring {
  v = 0;
  target: number;

  constructor(public x: number) {
    this.target = x;
  }

  jump(x: number) {
    this.x = x;
    this.v = 0;
    this.target = x;
  }

  stepTo(target: number, spec: SpringSpec, dt: number) {
    this.target = target;
    if (dt <= 0 || !Number.isFinite(dt)) return;
    const w = omega(spec);
    const z = zeta(spec);
    const x0 = this.x - target;
    const v0 = this.v;
    if (z < 1 - CRITICAL_DAMPING_TOLERANCE) {
      const decay = z * w;
      const wd = w * Math.sqrt(1 - z * z);
      const e = Math.exp(-decay * dt);
      const sinOverD = Math.sin(wd * dt) / wd;
      const cos = Math.cos(wd * dt);
      this.x = target + e * (x0 * (cos + decay * sinOverD) + v0 * sinOverD);
      this.v = e * (-x0 * w * w * sinOverD + v0 * (cos - decay * sinOverD));
    } else if (z > 1 + CRITICAL_DAMPING_TOLERANCE) {
      const root = Math.sqrt(z * z - 1);
      const slow = -w / (z + root);
      const fast = -w * (z + root);
      const denom = slow - fast;
      const slowExp = Math.exp(slow * dt);
      const fastExp = Math.exp(fast * dt);
      this.x =
        target +
        ((-fast * slowExp + slow * fastExp) / denom) * x0 +
        ((slowExp - fastExp) / denom) * v0;
      this.v =
        ((slow * fast * (fastExp - slowExp)) / denom) * x0 +
        ((slow * slowExp - fast * fastExp) / denom) * v0;
    } else {
      const e = Math.exp(-w * dt);
      const c = v0 + w * x0;
      this.x = target + (x0 + c * dt) * e;
      this.v = (v0 - w * c * dt) * e;
    }
  }
}
