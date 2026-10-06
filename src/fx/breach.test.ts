import { describe, expect, it } from 'vitest';
import { bodyCrumples } from '../sim/crumple';
import { MAX_FRAGMENT_HOLES, MIN_BREACH_YIELD_KG, breachRadiusM, fragmentHoleRadiusM } from './breach';

describe('blast breach in a thin panel (#240)', () => {
  it('grows with the yield and is bigger in drywall than in board', () => {
    const small = breachRadiusM(0.12, 'drywall', 0.9);
    const big = breachRadiusM(3.5, 'drywall', 0.9);
    expect(small).toBeGreaterThan(0.08);
    expect(big).toBeGreaterThan(small * 2);
    expect(breachRadiusM(0.12, 'drywall', 0.9)).toBeGreaterThan(breachRadiusM(0.12, 'wood', 0.9));
  });

  it('is capped by the size of the sheet, and absent for a primer-sized burst or a panel that is not a panel', () => {
    expect(breachRadiusM(25, 'drywall', 0.3)).toBeLessThanOrEqual(0.45 * 0.3 + 1e-12);
    expect(breachRadiusM(MIN_BREACH_YIELD_KG / 2, 'drywall', 0.9)).toBe(0);
    expect(breachRadiusM(1, 'steel', 0.9)).toBe(0);
  });

  it('draws a small hole for each fragment, never smaller than 3 mm, up to a cap', () => {
    expect(fragmentHoleRadiusM(0.001)).toBe(0.003);
    expect(fragmentHoleRadiusM(0.02)).toBeCloseTo(0.012, 6);
    expect(MAX_FRAGMENT_HOLES).toBeGreaterThan(10);
  });
});

describe('which bodies stay on show after the burst (#248)', () => {
  it('keeps a missile or a jet head, and drops a fragmentation shell casing', () => {
    expect(bodyCrumples({ shape: 'missile', blast: {} })).toBe(true);
    expect(bodyCrumples({ shape: 'roundNose', blast: { jet: { count: 6 } } })).toBe(true);
    expect(bodyCrumples({ shape: 'roundNose', blast: {} })).toBe(false);
    expect(bodyCrumples({ shape: 'roundNose' })).toBe(false);
  });
});
