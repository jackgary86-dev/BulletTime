import { describe, expect, it } from 'vitest';
import { getMedium } from '../data/media';
import { missileId } from '../data/missiles';
import { fire } from './testUtil';

/** Three 300 mm RHA plates with `gapM` of air between them (#281). */
const block = (gapM: number) => [0, 1, 2].map((i) => ({ medium: getMedium('rha-plate'), thickness: 0.3, gapM: i ? gapM : 0 }));
const depth = (bullet: string, gapM: number) => fire({ bullet, stack: block(gapM) }).summary.penetrationM;

describe('jets cross air gaps between plates (#281)', () => {
  it('depth is continuous in the gap: solid-steel depth plus the air crossed, never stopping at an interface', () => {
    for (const a of ['light-rocket', 'guided-at', 'air-surface']) {
      for (const head of ['shaped', 'tandem']) {
        const id = missileId(a, head);
        const solid = depth(id, 0);
        let last = solid;
        for (const gapM of [0.001, 0.002, 0.005, 0.01, 0.05]) {
          const d = depth(id, gapM);
          // At least the solid depth, at most that plus both gaps' air, and growing with the gap.
          expect(d, `${a} ${head} ${gapM * 1000} mm`).toBeGreaterThanOrEqual(solid - 0.002);
          expect(d, `${a} ${head} ${gapM * 1000} mm`).toBeLessThanOrEqual(solid + 2 * gapM + 0.01);
          expect(d, `${a} ${head} ${gapM * 1000} mm`).toBeGreaterThanOrEqual(last - 0.002);
          last = d;
        }
      }
    }
  });

  it('fragments that perforate a wall carry on across the room to the far wall', () => {
    const wall = getMedium('block-house-wall');
    const back = getMedium('block-house-back');
    const t = fire({ bullet: missileId('guided-at', 'shaped'), stack: [{ medium: wall, thickness: 0.3, gapM: 0 }, { medium: back, thickness: 0.3, gapM: 3.4 }] });
    // Something reaches the far wall (layer 1) now.
    expect(t.events.some((e) => (e.type === 'impact' || e.type === 'enter') && e.layer === 1)).toBe(true);
  });
});
