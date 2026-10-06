/**
 * Crumple timing for missile and shell bodies at impact (#248): the body keeps its place at the target face and
 * shortens from the nose back over a few milliseconds, instead of vanishing into the blast. A pure function of
 * the time since contact, so playback and scrubbing agree.
 */

/** Slowest and fastest crumple, in seconds: a hard wall at high speed folds the body fast, a soft berm slowly. */
const MIN_DURATION_S = 4e-3;
const MAX_DURATION_S = 30e-3;
/** The body is drawn until this long after the crumple finishes, as the pieces clear. */
export const CLEAR_AFTER_S = 15e-3;

/** Seconds the body takes to fold fully: the time to stop over its own length (L / v), stretched for soft targets. */
export function crumpleDuration(lengthM: number, impactSpeed: number, hardness: number): number {
  const stopS = lengthM / Math.max(1, impactSpeed);
  const soft = 1 + 4 * (1 - Math.min(1, Math.max(0, hardness)));
  return Math.min(MAX_DURATION_S, Math.max(MIN_DURATION_S, 3 * stopS * soft));
}

/** 0 (intact) to 1 (fully folded) at `sinceContactS`; monotonic, with a fast start that eases off as the body piles up. */
export function crumpleProgress(sinceContactS: number, durationS: number): number {
  if (sinceContactS <= 0) return 0;
  const k = Math.min(1, sinceContactS / durationS);
  return 1 - (1 - k) ** 2;
}

/** Body length left at that progress: never below a fifth of the original (the motor and warhead survive as a stub). */
export function crumpledLength(lengthM: number, progress: number): number {
  return lengthM * (1 - 0.8 * Math.min(1, Math.max(0, progress)));
}

/** Whether the body is still drawn at `sinceContactS`. */
export function bodyVisible(sinceContactS: number, durationS: number): boolean {
  return sinceContactS < durationS + CLEAR_AFTER_S;
}

/**
 * Whether a round's body stays on show and folds after the burst (#248): a missile does, and so does any head that
 * forms a jet (the body crushes behind it). A fragmentation shell's casing bursts into the fragments the physics
 * already throws, so it must not be left lying whole on the face.
 */
export function bodyCrumples(spec: { shape?: string; blast?: { jet?: unknown } }): boolean {
  return spec.shape === 'missile' || !!spec.blast?.jet;
}
