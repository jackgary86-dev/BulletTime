/**
 * Impact slow-motion (#238): a time warp on the playback clock. Real high-speed
 * footage lingers on the moment of contact, and in every mode the interesting
 * part (entry, cavity opening, spall, exit) is over before the eye catches it.
 * Around each round's first contact the clock runs at a fraction of the chosen
 * rate: it eases down just before contact, holds, then eases back to full speed.
 *
 * `warpAt` is the speed factor (1 = the chosen rate) as a pure function of sim
 * time. It is a multiplier on the clock, not a pause, so scrubbing, stepping and
 * replay links address the same sim times as before and the HUD keeps showing
 * true simulated time.
 */

/** Clock speed during the hold, as a fraction of the chosen rate. */
export const SLOW_FACTOR = 0.1;
/** The clock eases down over this long before contact, s of sim time. */
export const WARP_LEAD_S = 50e-6;
/** The clock holds at `SLOW_FACTOR` this long after contact, s. About two seconds of real time at the default 1/1,000 rate. */
export const WARP_HOLD_S = 200e-6;
/** The clock eases back to full speed over this long after the hold, s. */
export const WARP_RAMP_S = 2e-3;

function smoothstep(x: number): number {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
}

/**
 * The speed factor at `tau` after one round's first contact (negative before it)
 * for a beat with the given lead, hold and ramp lengths (any one unit of time).
 * Always in [SLOW_FACTOR, 1]; 1 outside the beat.
 */
export function warpShape(tau: number, lead: number, hold: number, ramp: number): number {
  if (tau <= -lead || tau >= hold + ramp) return 1;
  if (tau < 0) return 1 - (1 - SLOW_FACTOR) * smoothstep((tau + lead) / lead);
  if (tau <= hold) return SLOW_FACTOR;
  return SLOW_FACTOR + (1 - SLOW_FACTOR) * smoothstep((tau - hold) / ramp);
}

/** The speed factor at `tauS` seconds after one round's first contact (negative before it). Always in [SLOW_FACTOR, 1]. */
export function warpAfter(tauS: number): number {
  return warpShape(tauS, WARP_LEAD_S, WARP_HOLD_S, WARP_RAMP_S);
}

/** The speed factor at sim time `t` given every round's first-contact time: the slowest of the beats overlapping `t`. */
export function warpAt(t: number, impacts: readonly number[]): number {
  let factor = 1;
  for (const impact of impacts) factor = Math.min(factor, warpAfter(t - impact));
  return factor;
}

/** Steps a simulated clock forward by `realDeltaS` of wall time at `rate` (sim s per real s), warped around `impacts`. */
export function advanceWarped(t: number, realDeltaS: number, rate: number, impacts: readonly number[]): number {
  // Sub-steps keep a long frame from jumping over the slow stretch.
  const steps = 4;
  const h = (realDeltaS * rate) / steps;
  let now = t;
  for (let i = 0; i < steps; i++) now += h * warpAt(now + 0.5 * h * warpAt(now, impacts), impacts);
  return now;
}

/**
 * Wall-clock seconds to play sim time `from` to `to` at `rate` with the warp,
 * for bounding how much longer a shot plays than it would without it.
 */
export function warpedPlayTimeS(from: number, to: number, rate: number, impacts: readonly number[], steps = 20_000): number {
  const h = (to - from) / steps;
  let real = 0;
  for (let i = 0; i < steps; i++) real += h / (rate * warpAt(from + (i + 0.5) * h, impacts));
  return real;
}
