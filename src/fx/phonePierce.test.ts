import { describe, expect, it } from 'vitest';
import { piercePlan } from './phonePierce';

describe('phone battery pierce (#240)', () => {
  it('grows with the round and stays bounded', () => {
    const small = piercePlan(150);
    const rifle = piercePlan(3500);
    expect(rifle.flashCd).toBeGreaterThan(small.flashCd);
    expect(rifle.sparks).toBeGreaterThan(small.sparks);
    expect(rifle.sparkSpeed[1]).toBeGreaterThan(small.sparkSpeed[1]);
    expect(piercePlan(1e9).flashCd).toBeLessThanOrEqual(0.9 + 1e-9);
    expect(piercePlan(1e9).sparks).toBeLessThanOrEqual(160);
  });

  it('is never dark: even a .22 gives a visible flash, a spark spray and some vapour', () => {
    const tiny = piercePlan(0);
    expect(tiny.flashCd).toBeGreaterThanOrEqual(0.2);
    expect(tiny.sparks).toBeGreaterThanOrEqual(40);
    expect(tiny.vapour).toBeGreaterThanOrEqual(10);
    expect(piercePlan(-5).flashCd).toBe(tiny.flashCd);
  });
});
