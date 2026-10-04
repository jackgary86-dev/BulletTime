/**
 * Armor lab (#157): runs the penetration model for a shot's projectile
 * family. It lives apart from `model.ts` so that the models can import the
 * shared shape and helpers without an import cycle.
 */

import { fullBoreShot } from './fullBore';
import { withFragments } from './fragments';
import { heshShot } from './hesh';
import { jetShot } from './jet';
import { longRodShot } from './longRod';
import { normalizeShot, type ArmorShot, type ArmorTimeline } from './model';
import { ricochets, ricochetShot } from './ricochet';

/** Runs the model for the shot's projectile family, then works out the flight of whatever it throws clear of the plate. */
export function simulateArmor(shot: ArmorShot): ArmorTimeline {
  return withFragments(penetrate(shot));
}

function penetrate(shot: ArmorShot): ArmorTimeline {
  const family = shot.impact.family;
  // A kinetic round above its critical slope glances off, whatever the penetration models would say.
  if (ricochets(normalizeShot(shot))) return ricochetShot(shot);
  switch (family) {
    case 'ap-shot':
      return fullBoreShot(shot);
    case 'apfsds':
      return longRodShot(shot);
    case 'heat':
      return jetShot(shot);
    case 'hesh':
      return heshShot(shot);
    default:
      throw new Error(`The armor lab does not model '${family}' against plate yet`);
  }
}
