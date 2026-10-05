import { describe, expect, it } from 'vitest';
import { MEDIA } from '../data/media';
import { roundsForMode } from '../data/modes';
import { MISSILES } from '../data/missiles';
import { layersFor, simulate } from './engine';

/**
 * Simulation budget (#244): every round any simulator offers, into every
 * material the pickers list, at its default thickness, must simulate within
 * `PER_SHOT_MS`. The slowest pairs take about 130 ms on a developer machine, so
 * the limit leaves room for a slower runner while still catching an engine
 * change that makes a shot several times slower. Run with `npm run perf`; it
 * takes about a minute, so it is not part of `npm test`.
 */
const PER_SHOT_MS = 500;
/** And the whole sweep, so many small slow-downs add up to a failure too. */
const TOTAL_MS = 150_000;

const rounds = [...new Map([...roundsForMode('bullet'), ...roundsForMode('artillery'), ...roundsForMode('explosion'), ...MISSILES].map((b) => [b.id, b])).values()];
const media = MEDIA.filter((m) => !m.dummyOnly);

describe('simulation budget (#244)', () => {
  it(`every round into every material simulates in under ${PER_SHOT_MS} ms`, () => {
    const slow: string[] = [];
    const times: { ms: number; name: string }[] = [];
    const start = performance.now();
    for (const bullet of rounds) {
      for (const medium of media) {
        const t0 = performance.now();
        simulate({ bullet, layers: layersFor(medium, medium.thickness.default), angleDeg: 0, impactPoint: { x: -0.2, y: 0.16, z: 0 }, standOffM: bullet.standoffM ?? 0.5 });
        const ms = performance.now() - t0;
        times.push({ ms, name: `${bullet.id} into ${medium.id}` });
        if (ms > PER_SHOT_MS) slow.push(`${bullet.id} into ${medium.id}: ${ms.toFixed(0)} ms`);
      }
    }
    const total = performance.now() - start;
    times.sort((a, b) => b.ms - a.ms);
    console.log(`simulated ${times.length} shots in ${(total / 1000).toFixed(1)} s; slowest: ${times.slice(0, 5).map((t) => `${t.name} ${t.ms.toFixed(0)} ms`).join(', ')}`);
    expect(slow, slow.join('\n')).toEqual([]);
    expect(total).toBeLessThan(TOTAL_MS);
  }, 300_000);
});
