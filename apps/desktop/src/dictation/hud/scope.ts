// The dictation HUD's scope: a braided pair of oscilloscope traces that follow
// the voice, drawn as smooth lines across the plate. The motion (springs, auto
// level, voices, traces and the enter/work/clear scans) is ported from Hex's
// Dot scope (MIT, © 2026 Christopher Langton): `src/rune_hud/dot_scope.rs`
// and `src/rune_hud/dot_scope/scope.rs`, with Hex's default tuning and its
// default processing look (Flow). The macOS HUD runs the same simulation in
// Swift (`crates/dictation-ui-macos`).

import { REDUCED_FADE, Spring, type SpringSpec } from "./spring";

const TAU = 2 * Math.PI;

export const TUNING = {
  /** Points sampled along each trace. */
  samples: 127,
  /** Half the sampled span, pt: a little inside the recording plate. */
  span: 54.6,
  /** The farthest a trace swings from the middle, pt. */
  swing: 9,
  /** The front trace's stroke, pt; the back one is a little thinner. */
  lineWidth: 1.5,
  width: 112,
  processingWidth: 76,
  height: 26,
  braidSpeed: 1,
  helixCycles: 1.6,
  gain: 1,
  response: 6.5,
  release: 0.15,
  historySpeed: 150,
  shimmerPass: 0.55,
  shimmer: 1,
  transition: 0.3,
  bounce: 0.15,
  autoRelease: 3,
  noiseFloor: -60,
} as const;

const STEP = 1 / 240;
const HISTORY = 512;
const SPEEDS = [0.8, 1.25, 1.85, 2.6];
const BASE = [0.55, 0.42, 0.3, 0.2];
const SPATIAL = [1.4, 2.4, 3.8, 5.6];
const START_WIDTH = 30;
const ENTER = 0.42;
const WIPE = 0.3;
const BREATH_PERIOD = 5.5;
const HIDDEN_SCALE = 0.9;
const HIDDEN_SOFTNESS = 3;
/** How much the resting helix swells while Flow works. */
const WORK_HELIX = 2.6;
/** Flow's bands sit this far apart, as a share of the processing width. */
const FLOW_SPACING = 0.7;
/** The recording carrier's slowest turn, Hz. */
const CARRIER_REST = 0.14;

/** A meter's RMS as dBFS. */
export function loudness(rms: number) {
  return 20 * Math.log10(Math.max(rms, 0) + 1e-6);
}

/**
 * A slow auto level: the loudest the speaker has recently been reads as full
 * and the room as silent, so a quiet microphone and a loud one move the scope
 * alike. The peak never sits less than 16 dB above the room or the noise
 * floor, so silence is never boosted to full.
 */
export class AutoLevel {
  peak = -30;
  room = -55;

  step(loudness: number, h: number, release: number, noiseFloor: number) {
    const db = Math.max(loudness, -120);
    const follow = (value: number, target: number, time: number) =>
      value + (target - value) * (1 - Math.exp(-h / Math.max(time, 1e-3)));
    this.room = follow(this.room, db, db < this.room ? 0.3 : 6);
    const lowest = Math.max(this.room, noiseFloor) + 16;
    this.peak =
      db > this.peak
        ? follow(this.peak, db, 0.04)
        : follow(this.peak, lowest, release);
    this.peak = Math.max(this.peak, lowest);
    const low = Math.max(Math.max(this.room, noiseFloor) + 5, this.peak - 24);
    return clamp((db - low) / Math.max(this.peak - low, 1), 0, 1);
  }
}

export type Stage = "recording" | "processing" | "done" | "failed";

class Voice {
  level = 0;
  reservoir = 0;
  energy = 0;
  band = 0;

  step(raw: number, h: number) {
    this.level +=
      (raw - this.level) *
      (1 - Math.exp(-h / (raw > this.level ? 0.035 : 0.095)));
    this.reservoir +=
      (1.75 * this.level * this.level - this.reservoir / 1.8) * h;
    this.energy = 1 - Math.exp(-this.reservoir * 1.45);
    this.band +=
      (raw - this.band) * (1 - Math.exp(-h / (raw > this.band ? 0.025 : 0.14)));
  }
}

class Trace {
  envelope = 0;
  amplitude = 0;
  amplitudeVelocity = 0;
  history = new Float64Array(HISTORY * 5);
  head = 0;

  constructor(public phases: number[]) {}

  tick(voice: Voice, live: number, speed: number, h: number) {
    const rise = voice.level > this.envelope ? 0.022 : TUNING.release;
    this.envelope += (voice.level - this.envelope) * (1 - Math.exp(-h / rise));
    const w = TAU * TUNING.response;
    const z = 0.52;
    this.amplitudeVelocity +=
      (-w * w * (this.amplitude - this.envelope) -
        2 * z * w * this.amplitudeVelocity) *
      h;
    this.amplitude += this.amplitudeVelocity * h;
    const go = 0.6 + 1.1 * Math.min(this.envelope * 1.6, 1);
    for (let lane = 0; lane < 4; lane++) {
      this.phases[lane] =
        (this.phases[lane]! + h * TAU * SPEEDS[lane]! * go * speed) % TAU;
    }
    // With flat bands each group is the mean, so the prototype's
    // `g / (mean + 0.06)` emphasis is the same for every component.
    const emphasis =
      0.35 + 0.65 * Math.min(voice.band / (voice.band + 0.06), 2);
    const offset = this.head * 5;
    const amplitude = Math.max(this.amplitude, 0) * live;
    this.history[offset] = amplitude;
    for (let c = 0; c < 4; c++) {
      this.history[offset + 1 + c] = amplitude * BASE[c]! * emphasis;
    }
    this.head = (this.head + 1) % HISTORY;
  }

  past(delay: number, channel: number) {
    const d = Math.min(delay / STEP, HISTORY - 2);
    const i = Math.floor(d);
    const k = d - i;
    const a = (this.head + 2 * HISTORY - 1 - i) % HISTORY;
    const b = (a + HISTORY - 1) % HISTORY;
    return (
      this.history[a * 5 + channel]! * (1 - k) +
      this.history[b * 5 + channel]! * k
    );
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function smoothstep(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function bump(d: number, w: number) {
  return Math.exp(-(d / w) * (d / w));
}

function remEuclid(a: number, b: number) {
  const r = a % b;
  return r < 0 ? r + Math.abs(b) : r;
}

type Envelope =
  | { kind: "enter"; reach: number; head: number; unfold: number }
  | { kind: "work"; head: number; swell: number }
  | {
      kind: "clear";
      front: number;
      head: number;
      shine: number;
      swell: number;
    };

/** The x of trace sample `s`, pt from the plate's middle. */
function sampleX(s: number) {
  return (s / (TUNING.samples - 1) - 0.5) * 2 * TUNING.span;
}

/**
 * The scope simulation, stepped at a fixed 240 Hz so any frame rate draws the
 * same picture. Yields both traces as (y, intensity) samples.
 */
export class Scope {
  stage: Stage = "recording";
  /**
   * Trace by trace, each sample's (y, intensity): y in pt from the plate's
   * middle, down; intensity 0–1 for the stroke, above 1 where a light passes.
   */
  readonly lines = new Float32Array(2 * TUNING.samples * 2);

  private elapsed = 0;
  private speedAtDone = 0;
  private flowOffset = 0;
  private flowTurn = 0;
  private auto = new AutoLevel();
  private voices = [new Voice(), new Voice()] as const;
  private traces = freshTraces();
  private live = 0;
  private carrier = 0;
  private time = 0;
  private steps = 0;
  private pending = 0;
  private reduceMotion = false;
  private width = new Spring(START_WIDTH);
  private opacity = new Spring(0);
  private scale = new Spring(HIDDEN_SCALE);
  private softness = new Spring(HIDDEN_SOFTNESS);
  private cool = new Spring(0);
  private fail = new Spring(0);

  /**
   * Starts a recording from nothing: the scanner unfolds the trace again.
   * The auto level remembers the speaker.
   */
  restart(reduceMotion: boolean) {
    const auto = this.auto;
    Object.assign(this, new Scope());
    this.auto = auto;
    if (reduceMotion) {
      this.scale.jump(1);
      this.softness.jump(0);
      this.width.jump(TUNING.width);
    }
  }

  pose() {
    return {
      width: Math.max(this.width.x, TUNING.height),
      height: TUNING.height,
      opacity: clamp(this.opacity.x, 0, 1),
      scale: Math.max(this.scale.x, 0.01),
      softness: clamp(this.softness.x, 0, HIDDEN_SOFTNESS),
      cool: clamp(this.cool.x, 0, 1),
      fail: clamp(this.fail.x, 0, 1),
    };
  }

  /** Whether the scope has faded out after being hidden. */
  settled() {
    return this.opacity.target === 0 && this.opacity.x < 0.002;
  }

  /** Advances by `dt` seconds in fixed 240 Hz steps. */
  advance(
    dt: number,
    frame: {
      stage: Stage;
      visible: boolean;
      loudness: number;
      reduceMotion: boolean;
    },
  ) {
    if (frame.stage !== this.stage) {
      if (frame.stage === "done") this.speedAtDone = 1.5 * this.pulseSpeed();
      if (frame.stage === "processing") this.flowOffset = -this.width.x / 2 - 4;
      this.stage = frame.stage;
      this.elapsed = 0;
    }
    this.reduceMotion = frame.reduceMotion;
    this.pending += clamp(dt, 0, 0.25);
    while (this.pending >= STEP) {
      this.pending -= STEP;
      this.step(frame.visible, frame.loudness, frame.reduceMotion);
    }
  }

  /** One band per this many seconds. */
  private workPeriod() {
    return 2 * Math.max(TUNING.shimmerPass, 0.05);
  }

  private flowSpacing() {
    return FLOW_SPACING * TUNING.processingWidth;
  }

  private flowSpeed() {
    return this.flowSpacing() / this.workPeriod();
  }

  /** The carrier turn that moves the helix at Flow's band speed, Hz. */
  private flowTurnHz() {
    return (this.flowSpeed() * TUNING.helixCycles) / Math.max(this.width.x, 1);
  }

  private pulseSpeed() {
    return (TUNING.processingWidth / 2 + 12) / (1.4 * this.workPeriod());
  }

  private step(visible: boolean, loudness: number, reduceMotion: boolean) {
    const h = STEP;
    const recording = this.stage === "recording" && visible;
    const level = recording
      ? clamp(
          this.auto.step(loudness, h, TUNING.autoRelease, TUNING.noiseFloor) *
            TUNING.gain,
          0,
          1,
        )
      : 0;
    this.voices[0].step(level, h);
    this.voices[1].step(level * 0.85, h);
    this.live += ((recording ? 1 : 0) - this.live) * (1 - Math.exp(-h / 0.55));
    const speed = reduceMotion ? 0 : TUNING.braidSpeed;
    this.traces[0].tick(this.voices[0], this.live, speed, h);
    this.traces[1].tick(this.voices[1], this.live, speed, h);
    const energy = Math.max(this.voices[0].energy, this.voices[1].energy);
    const working = this.stage === "processing" || this.stage === "done";
    this.flowTurn +=
      ((working ? 1 : 0) - this.flowTurn) * (1 - Math.exp(-h / 0.25));
    if (working) this.flowOffset += this.flowSpeed() * h;
    const rest = CARRIER_REST + 0.22 * energy;
    const turn = rest + (this.flowTurnHz() - rest) * this.flowTurn;
    this.carrier = (this.carrier + h * TAU * turn * speed) % TAU;

    const width =
      this.stage === "recording"
        ? TUNING.width
        : this.stage === "failed"
          ? this.width.target
          : TUNING.processingWidth;
    const cool = working ? 1 : 0;
    const fail = this.stage === "failed" ? 1 : 0;
    const shown = visible ? 1 : 0;
    const fade: SpringSpec = { duration: TUNING.transition, bounce: 0 };
    const bouncy: SpringSpec = {
      duration: TUNING.transition,
      bounce: TUNING.bounce,
    };
    if (reduceMotion) {
      this.width.jump(width);
      this.scale.jump(1);
      this.softness.jump(0);
      this.opacity.stepTo(shown, REDUCED_FADE, h);
      this.cool.stepTo(cool, REDUCED_FADE, h);
      this.fail.stepTo(fail, REDUCED_FADE, h);
    } else {
      this.width.stepTo(width, bouncy, h);
      this.opacity.stepTo(shown, fade, h);
      this.scale.stepTo(visible ? 1 : HIDDEN_SCALE, bouncy, h);
      this.softness.stepTo(visible ? 0 : HIDDEN_SOFTNESS, fade, h);
      this.cool.stepTo(cool, fade, h);
      this.fail.stepTo(fail, fade, h);
    }

    this.elapsed += h;
    this.time += h;
    this.steps += 1;
    if (this.steps % 2 === 0) this.trace();
  }

  private flowLight(x: number) {
    const spacing = this.flowSpacing();
    return bump(
      remEuclid(x - this.flowOffset + spacing / 2, spacing) - spacing / 2,
      7,
    );
  }

  private scan(width: number): { helix: number; envelope: Envelope } {
    const e = this.elapsed;
    const still = {
      helix: 1,
      envelope: { kind: "enter", reach: 1e4, head: 0, unfold: 1 } as Envelope,
    };
    if (this.stage === "failed" || this.reduceMotion) return still;
    if (this.stage === "recording") {
      const pass = 0.5 - 0.5 * Math.cos(Math.PI * clamp(e / ENTER, 0, 1));
      return {
        helix: 1,
        envelope: {
          kind: "enter",
          reach: (width / 2 + 12) * pass,
          head: 2.8 * (1 - smoothstep(0.08, ENTER, e)),
          unfold: smoothstep(0, 0.1, e),
        },
      };
    }
    if (this.stage === "processing") {
      const enter = smoothstep(0, 0.35, e);
      return {
        helix: 1 + (WORK_HELIX - 1) * enter,
        envelope: {
          kind: "work",
          head: 2.5 * smoothstep(0.05, 0.3, e) * TUNING.shimmer,
          swell: 0.9 * enter,
        },
      };
    }
    // Done: a front clears the traces from the middle out as the plate
    // collapses, while the light ahead of it fades.
    const t = clamp(e / WIPE, 0, 1);
    const front =
      (t * t * t - 2 * t * t + t) * WIPE * this.speedAtDone +
      (3 * t * t - 2 * t * t * t) * (width / 2 + 8);
    return {
      helix: WORK_HELIX,
      envelope: {
        kind: "clear",
        front,
        head: 2.8 * smoothstep(0, 0.04, e) * (1 - smoothstep(0.22, 0.32, e)),
        shine: 2.5 * TUNING.shimmer * (1 - smoothstep(0, 0.18, e)),
        swell: 0.9,
      },
    };
  }

  /** (amplitude, intensity, swell) at `x`. */
  private scanAt(envelope: Envelope, x: number): [number, number, number] {
    if (envelope.kind === "enter") {
      const { reach, head, unfold } = envelope;
      const d = Math.abs(x);
      const drawn =
        unfold *
        (1 - smoothstep(Math.max(reach - 14, 0), Math.max(reach, 0.001), d));
      const amplitude =
        drawn *
        (1 -
          smoothstep(Math.max(reach - 22, 0), Math.max(reach - 3, 0.001), d));
      const beam = head * bump(d - reach, 6);
      const swell =
        1.8 * unfold * (head / 2.8) * bump(d - Math.max(reach - 14, 0), 14);
      return [amplitude, amplitude + beam, swell];
    }
    const light = this.flowLight(x);
    if (envelope.kind === "work") {
      return [1, 1 + envelope.head * light, envelope.swell * light];
    }
    const { front, head, shine, swell } = envelope;
    const d = Math.abs(x);
    const keep = smoothstep(front - 12, front - 2, d);
    return [
      keep,
      keep * (1 + shine * light) + head * bump(d - front, 6),
      keep * swell * light,
    ];
  }

  /** Samples both traces into `lines`. */
  private trace() {
    const width = Math.max(this.width.x, TUNING.height);
    const scan = this.scan(width);
    const half = TUNING.swing;
    const breath = this.reduceMotion
      ? 0.5
      : 0.5 + 0.5 * Math.sin((this.time * TAU) / BREATH_PERIOD);
    const rest = (0.55 + 0.35 * breath) * (0.4 + 0.6 * this.live) * scan.helix;
    const halfWidth = width / 2;
    for (let k = 0; k < 2; k++) {
      const trace = this.traces[k]!;
      const sign = k === 0 ? 1 : -1;
      const offset = k * TUNING.samples * 2;
      for (let s = 0; s < TUNING.samples; s++) {
        const x = sampleX(s);
        const at = offset + s * 2;
        if (Math.abs(x) > halfWidth) {
          this.lines[at] = 0;
          this.lines[at + 1] = 0;
          continue;
        }
        const [amplitude, bright, swell] = this.scanAt(scan.envelope, x);
        const own = Math.abs(x);
        const xn = (x + halfWidth) / width;
        const ends = Math.min(
          smoothstep(-halfWidth + 3, -halfWidth + 17, x),
          smoothstep(-halfWidth + 3, -halfWidth + 17, -x),
        );
        const reach = 1 - 0.8 * smoothstep(14, halfWidth, own);
        const delay = own / TUNING.historySpeed;
        const a = trace.past(delay, 0);
        let spread = 0;
        for (let c = 0; c < 4; c++) {
          spread +=
            trace.past(delay, 1 + c) *
            Math.sin(TAU * SPATIAL[c]! * xn - trace.phases[c]!);
        }
        const helix =
          (rest + swell + half * 0.55 * a * reach) *
          Math.sin(TAU * TUNING.helixCycles * xn - this.carrier);
        const y =
          half *
          Math.tanh((helix + half * 0.7 * spread * reach) / half) *
          ends *
          amplitude;
        this.lines[at] = -sign * y;
        const voiced = 0.45 + 0.55 * Math.min(a * 1.8, 1);
        this.lines[at + 1] =
          voiced * amplitude * (0.35 + 0.65 * ends) +
          0.36 * Math.max(bright - amplitude, 0);
      }
    }
  }
}

function freshTraces() {
  return [
    new Trace([0.1, 1.7, 3.3, 4.6]),
    new Trace([2.4, 0.6, 5.1, 1.9]),
  ] as const;
}

type Rgb = [number, number, number];
type Rgba = [number, number, number, number];

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function hex(value: number): Rgb {
  return [
    (value >> 16) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
  ];
}

/**
 * The scope's colours for one frame, sRGB, from the graphite design tokens
 * (`packages/design-system/src/tokens.css`): the text colour while
 * recording, faint graphite with the text colour passing through it while
 * processing, and danger on failure.
 */
export function palette(dark: boolean, pose: { cool: number; fail: number }) {
  const strong = hex(dark ? 0xfafafa : 0x161616);
  const faint = hex(dark ? 0x5c5c5c : 0xaeaeae);
  const danger = hex(dark ? 0xf17471 : 0xb82d35);
  const plate: Rgba = [...hex(dark ? 0x191919 : 0xffffff), 1];
  const rim: Rgba = dark ? [1, 1, 1, 0.16] : [0, 0, 0, 0.12];
  const shadow: Rgba = dark ? [0, 0, 0, 0.45] : [0, 0, 0, 0.12];
  return {
    line: mix(mix(strong, faint, pose.cool), danger, pose.fail),
    light: mix(strong, danger, pose.fail),
    plate,
    rim,
    shadow,
  };
}
