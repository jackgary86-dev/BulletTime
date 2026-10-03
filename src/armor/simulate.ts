/**
 * Armor lab (#157): runs the penetration model for a shot's projectile
 * family. It lives apart from `model.ts` so that the models can import the
 * shared shape and helpers without an import cycle.
 */

import { fullBoreShot } from './fullBore';
import { longRodShot } from './longRod';
import type { ArmorShot, ArmorTimeline } from './model';

/** Runs the model for the shot's projectile family. */
export function simulateArmor(shot: ArmorShot): ArmorTimeline {
  const family = shot.impact.family;
  switch (family) {
    case 'ap-shot':
      return fullBoreShot(shot);
    case 'apfsds':
      return longRodShot(shot);
    default:
      throw new Error(`The armor lab does not model '${family}' against plate yet`);
  }
}
