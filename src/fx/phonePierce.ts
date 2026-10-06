/**
 * The bright pierce of a phone's battery pouch (#240): when a round meets the cell there is a white-hot flash, a
 * burst of sparks from the shorted foil, and on the way out a puff of pale electrolyte vapour. Pure sizing;
 * `panelEffect.ts` draws it.
 */

export interface PiercePlan {
  /** Peak brightness of the flash in candela, and its decay in seconds. */
  flashCd: number;
  flashDecayS: number;
  /** Sparks thrown from the entry, and their speed range in m/s. */
  sparks: number;
  sparkSpeed: [number, number];
  /** Vapour particles puffed out of the exit. */
  vapour: number;
}

/** A round of this energy (joules) meeting a cell: energy sets the size of the flash, more than the speed does. */
export function piercePlan(energyJ: number): PiercePlan {
  const k = Math.min(1, Math.sqrt(Math.max(0, energyJ) / 2500));
  return {
    flashCd: 0.2 + 0.7 * k,
    flashDecayS: 250e-6 + 350e-6 * k,
    sparks: Math.round(40 + 120 * k),
    sparkSpeed: [18, 50 + 90 * k],
    vapour: Math.round(10 + 22 * k),
  };
}
