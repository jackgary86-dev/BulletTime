import type { BurstSpec } from './particles';

/** Round diameter the steel particle bursts are tuned for, in metres (a rifle bullet). */
const TUNED_DIAMETER_M = 0.012;
/** The most a burst is scaled up, so a 240 mm shell does not fill the view with one chip. */
const MAX_SCALE = 12;

/** How much bigger than a bullet a round is, for sizing sparks, chips and flashes (1 for anything bullet-sized or smaller). */
export function shellScale(diameterM: number): number {
  return Math.min(MAX_SCALE, Math.max(1, diameterM / TUNED_DIAMETER_M));
}

/** A burst tuned for a bullet, redrawn for a shell (#234): bigger pieces over a wider start area that linger longer. */
export function scaleBurst(spec: BurstSpec, s: number): BurstSpec {
  if (s <= 1) return spec;
  return {
    ...spec,
    originJitter: spec.originJitter === undefined ? undefined : spec.originJitter * s,
    size: [spec.size[0] * s, spec.size[1] * s],
    life: [spec.life[0] * Math.sqrt(s), spec.life[1] * Math.sqrt(s)],
  };
}
