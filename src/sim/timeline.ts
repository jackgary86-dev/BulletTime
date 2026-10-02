/**
 * A crude one-dimensional shot timeline for the end-to-end slice.
 *
 * The whole shot is integrated up front with a fixed 1 µs step and stored as
 * keyframes; playback then only samples the timeline at the current simulated
 * time. The full physics engine (#5) replaces `simulateShot` but keeps this
 * keyframe shape, so playback, scrubbing and replay stay unchanged.
 */

export interface Keyframe {
  /** Simulated time since the shot started, in seconds. */
  t: number;
  /** Bullet nose position along the shot line (world x), in metres. */
  x: number;
  /** Bullet speed in m/s. */
  v: number;
  /** Current bullet diameter in metres (grows as a hollow point expands). */
  diameter: number;
}

export interface Timeline {
  keyframes: Keyframe[];
  /** Total simulated duration in seconds. */
  duration: number;
  /** Time at which the bullet reaches the target face, in seconds. */
  impactTime: number;
}

export interface ShotParams {
  massKg: number;
  diameterM: number;
  muzzleVelocity: number;
  /** Diameter the bullet expands to inside the medium (equal to diameterM for no expansion). */
  expandedDiameterM: number;
  /** Distance over which expansion completes, in metres. */
  expansionDistanceM: number;
  startX: number;
  targetFrontX: number;
  targetBackX: number;
  medium: { density: number; dragCoefficient: number; resistancePa: number };
}

const STEP_S = 1e-6;
const SAMPLE_EVERY = 5; // keep one keyframe per 5 µs
const STOP_SPEED = 2; // m/s below which the bullet is considered at rest
const HOLD_AFTER_S = 1.5e-3; // linger after the bullet stops so the aftermath is visible
const MAX_TIME_S = 0.05;
const EXIT_RUN_M = 0.6; // after passing through, follow the bullet this far, then end

/** Integrates the shot with a fixed timestep and returns the keyframe timeline. */
export function simulateShot(p: ShotParams): Timeline {
  const keyframes: Keyframe[] = [];
  let t = 0;
  let x = p.startX;
  let v = p.muzzleVelocity;
  let diameter = p.diameterM;
  let impactTime = Number.NaN;
  let step = 0;

  const record = () => keyframes.push({ t, x, v, diameter });
  record();

  while (t < MAX_TIME_S) {
    const inMedium = x >= p.targetFrontX && x <= p.targetBackX;
    if (inMedium) {
      if (Number.isNaN(impactTime)) impactTime = t;
      const depth = x - p.targetFrontX;
      const progress = Math.min(1, depth / p.expansionDistanceM);
      diameter = p.diameterM + (p.expandedDiameterM - p.diameterM) * progress;
      const area = (Math.PI * diameter * diameter) / 4;
      const { density, dragCoefficient, resistancePa } = p.medium;
      // Hydrodynamic drag plus a constant material strength term.
      const force = 0.5 * density * dragCoefficient * area * v * v + resistancePa * area;
      v = Math.max(0, v - (force / p.massKg) * STEP_S);
    }
    // Air drag over a metre is negligible at this scale and is ignored here.
    x += v * STEP_S;
    t += STEP_S;
    step++;

    if (step % SAMPLE_EVERY === 0) record();
    if (x > p.targetBackX + EXIT_RUN_M) {
      record();
      break;
    }
    if (v < STOP_SPEED) {
      v = 0;
      record();
      break;
    }
  }

  const end = keyframes[keyframes.length - 1];
  keyframes.push({ ...end, t: end.t + HOLD_AFTER_S });

  return {
    keyframes,
    duration: end.t + HOLD_AFTER_S,
    impactTime: Number.isNaN(impactTime) ? end.t : impactTime,
  };
}

/** Linearly interpolates the timeline at time `t` (clamped to its range). */
export function sampleTimeline(timeline: Timeline, t: number): Keyframe {
  const frames = timeline.keyframes;
  if (t <= frames[0].t) return frames[0];
  const last = frames[frames.length - 1];
  if (t >= last.t) return last;

  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[hi];
  const k = (t - a.t) / (b.t - a.t);
  return {
    t,
    x: a.x + (b.x - a.x) * k,
    v: a.v + (b.v - a.v) * k,
    diameter: a.diameter + (b.diameter - a.diameter) * k,
  };
}
