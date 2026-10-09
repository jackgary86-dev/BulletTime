import { describe, expect, it } from 'vitest';
import { getBullet } from '../data/bullets';
import { getMedium } from '../data/media';
import { STANDARD_RESOLUTION, ULTRA_RESOLUTION } from '../data/physics';
import { layersFor, simulate } from './engine';

/**
 * Fire time for the heaviest rounds (#201): the most fragments and jets, at the
 * Standard and the Ultra step. Measured well under 200 ms; the budget is generous
 * so a slow CI runner does not fail it, but a runaway fragment count would.
 */
const BUDGET_MS = 2000;
const HEAVY = ['122mm-ap', '125mm-apfsds', '88mm-aphe', 'charge-cased', 'missile:cruise:heavy-core', 'missile:cruise:efp', '12ga-00buck'];

describe('fire time for heavy rounds (#201)', () => {
  it.each(HEAVY)('simulates %s into armour and gel inside the budget at Standard and Ultra', (id) => {
    for (const medium of ['rha', 'gel10']) {
      for (const resolution of [STANDARD_RESOLUTION, ULTRA_RESOLUTION]) {
        const m = getMedium(medium);
        const bullet = getBullet(id);
        const start = performance.now();
        const t = simulate({ bullet, layers: layersFor(m, m.thickness.default), angleDeg: 0, impactPoint: { x: -0.2, y: 0.16, z: 0 }, standOffM: bullet.standoffM ?? 0.5, resolution });
        expect(performance.now() - start).toBeLessThan(BUDGET_MS);
        // Tracks stay bounded too: one body for the round, plus its fragments and jets.
        expect(t.tracks.length).toBeLessThan(150);
      }
    }
  });
});
