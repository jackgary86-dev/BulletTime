/**
 * A bullet crushed by concrete (#226): by about 0.4 ms it is a short mushroomed stub, roughly 45% shorter with
 * a nose 35% wider and a flat face, and it carries on as a flattened slug. The state follows the energy the
 * panel has taken, so a bullet that stops early is only partly crushed.
 */
/** Share of the kinetic energy that is gone when the bullet is fully crushed (the measured bullets lose 84-92%). */
export const CRUSH_ABSORBED = 0.7;
/** Nose widening and shortening at full crush. */
export const CRUSH_WIDEN = 0.35;
export const CRUSH_SHORTEN = 0.45;
/** How much of the deforming nose survives as a stub, and where along the bullet the deforming zone begins. */
export const CRUSH_STUB = 0.3;
export const CRUSH_ZONE = 1 - CRUSH_SHORTEN / (1 - CRUSH_STUB);

/** 0 (untouched) to 1 (a full stub) from the speed the bullet arrived at and its speed now. */
export function crushFromSpeed(speed: number, impactSpeed: number): number {
  if (impactSpeed <= 0) return 0;
  const absorbed = 1 - Math.min(1, speed / impactSpeed) ** 2;
  return Math.min(1, Math.max(0, absorbed / CRUSH_ABSORBED));
}

/** Nose width ratio and length fraction for a given crush. */
export function crushShape(crush: number): { widthRatio: number; lengthFraction: number } {
  return { widthRatio: 1 + CRUSH_WIDEN * crush, lengthFraction: 1 - CRUSH_SHORTEN * crush };
}
