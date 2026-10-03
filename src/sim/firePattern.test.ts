import { describe, expect, it } from 'vitest';
import { getBullet } from '../data/bullets';
import { getMedium } from '../data/media';
import { BURST_CLIMB, patternSeed, roundOffsets } from './firePattern';
import { seededRandom } from './random';
import { appendShot, deadAir, MIN_DEAD_AIR_S } from './session';
import { layersFor, simulate } from './engine';
import type { Timeline } from './types';

const rand = (seed = 1) => seededRandom(seed);

describe('fire patterns', () => {
  it('single is one round on the aim point', () => {
    expect(roundOffsets('single', 5, 0.02, rand())).toEqual([{ y: 0, z: 0 }]);
  });

  it('a group stays inside the spread circle', () => {
    const shots = roundOffsets('group', 10, 0.02, rand());
    expect(shots).toHaveLength(10);
    for (const s of shots) expect(Math.hypot(s.y, s.z)).toBeLessThanOrEqual(0.02 + 1e-12);
  });

  it('a burst climbs and drifts right round by round', () => {
    const shots = roundOffsets('burst', 6, 0.02, rand());
    expect(shots).toHaveLength(6);
    for (let i = 1; i < shots.length; i++) expect(shots[i].y).toBeGreaterThan(shots[i - 1].y);
    expect(shots[5].z).toBeGreaterThan(shots[0].z);
    expect(shots[5].y - shots[0].y).toBeCloseTo(5 * BURST_CLIMB * 0.02, 2);
  });

  it('group and burst draw different random sequences', () => {
    expect(patternSeed('group', 0)).not.toBe(patternSeed('burst', 0));
    const g = roundOffsets('group', 5, 0.02, rand(patternSeed('group', 0)));
    const b = roundOffsets('burst', 5, 0.02, rand(patternSeed('burst', 0)));
    expect(g).not.toEqual(b);
  });
});

/** Fires `rounds` 9mm JHP rounds into gel, `gapS` apart, on one timeline. */
function burst(rounds: number, gapS: number): Timeline {
  let session: Timeline | null = null;
  for (let i = 0; i < rounds; i++) {
    const part = simulate({
      bullet: getBullet('9mm-jhp'),
      layers: layersFor(getMedium('gel10'), 0.4),
      angleDeg: 0,
      impactPoint: { x: 0, y: 1 + i * 0.01, z: 0 },
      standOffM: 0.5,
    });
    session = appendShot(session, part, i * gapS);
  }
  return session!;
}

describe('dead air between rounds', () => {
  it('finds the empty stretch between rounds of a 750 rpm burst', () => {
    const t = burst(5, 0.08);
    const gaps = deadAir(t);
    expect(gaps).toHaveLength(4);
    const skipped = gaps.reduce((sum, [a, b]) => sum + (b - a), 0);
    // Most of the 320 ms between the first and last round is dead air.
    expect(skipped).toBeGreaterThan(0.2);
    for (let i = 0; i < gaps.length; i++) {
      const [from, to] = gaps[i];
      expect(to).toBeLessThan(t.shots[i + 1].start);
      expect(from).toBeGreaterThan(t.shots[i].start);
    }
  });

  it('never skips any part of a round in flight', () => {
    const t = burst(4, 0.05);
    for (const [from, to] of deadAir(t)) {
      for (const track of t.tracks) {
        const overlaps = track.spawnT < to && track.endT > from;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('leaves back-to-back rounds and single shots alone', () => {
    expect(deadAir(burst(1, 0))).toEqual([]);
    for (const [a, b] of deadAir(burst(3, 0.012))) expect(b - a).toBeGreaterThan(MIN_DEAD_AIR_S);
  });
});
