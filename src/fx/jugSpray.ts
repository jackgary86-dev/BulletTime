/**
 * The burst from a round going through a closed, water-filled container (#240): not the quiet crown of an open tank
 * but a hydraulic ram. The pressure wave pushes water out of the exit hole in a hard cone, the entry sprays back,
 * a fine mist hangs, and a fast round pops the cap. Pure sizing; `gelEffect.ts` draws it.
 */

export interface JugSpray {
  /** Droplets in the cone out of the exit hole, and their speed range in m/s. */
  exitCount: number;
  exitSpeed: [number, number];
  /** Half-angle of that cone, radians. */
  exitSpread: number;
  /** Multiplier on the entry crown and jet. */
  entryScale: number;
  /** Fine mist particles hanging round the exit. */
  mist: number;
  /** Whether the cap is thrown off the top. */
  capPops: boolean;
}

/** Round speed above which the pressure pops the cap, m/s. */
export const CAP_POP_SPEED_MS = 450;

/** Spray from a round that hit at `entrySpeed` and, if it went through, left at `exitSpeed` (m/s). */
export function jugSpray(entrySpeed: number, exitSpeed: number | null): JugSpray {
  const energy = Math.min(1, (entrySpeed / 900) ** 2);
  const through = exitSpeed !== null;
  return {
    // Water is thrown out of the exit whether or not the round got through: the pressure finds the weakest wall.
    exitCount: Math.round((through ? 380 : 160) * (0.35 + energy)),
    exitSpeed: [6, 14 + (exitSpeed ?? entrySpeed * 0.4) * 0.07],
    exitSpread: through ? 0.45 : 0.9,
    entryScale: 1 + 1.4 * energy,
    mist: Math.round(60 + 140 * energy),
    capPops: entrySpeed >= CAP_POP_SPEED_MS,
  };
}
