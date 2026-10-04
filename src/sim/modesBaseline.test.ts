import { describe, expect, it } from 'vitest';
import { ARTILLERY } from '../data/artillery';
import { EXPLOSIVES } from '../data/explosives';
import { MISSILES } from '../data/missiles';
import { ULTRA_RESOLUTION, type SimResolution } from '../data/physics';
import type { FinalState } from './types';
import { fire } from './testUtil';

/**
 * Regression baseline for the artillery, missile and charge tuning (#210), the
 * counterpart of baseline.test.ts for the bullet catalogue. Recorded from the
 * tuned engine; a change that moves a row by more than a few percent fails
 * here. If the change is intended, re-record the row and say why in the commit.
 *
 * Artillery columns: shell, depth into 1 m of armour plate (m), final state
 * there, exit speed from 0.4 m of reinforced concrete (m/s), fragments in the plate.
 */
const ARTILLERY_BASELINE: [string, number, FinalState, number, number][] = [
  ['23mm-he', 0.009, 'detonated', 0, 35],
  ['30mm-ap', 0.071, 'deformed', 0, 0],
  ['40mm-he', 0.015, 'detonated', 0, 38],
  ['37mm-ap', 0.057, 'deformed', 0, 0],
  ['45mm-ap', 0.075, 'deformed', 0, 0],
  ['50mm-ap', 0.108, 'deformed', 192, 0],
  ['57mm-ap', 0.151, 'deformed', 531, 0],
  ['76mm-he', 0.022, 'detonated', 0, 45],
  ['76mm-ap', 0.188, 'deformed', 570, 0],
  ['87mm-he', 0.021, 'detonated', 0, 47],
  ['88mm-ap', 0.231, 'deformed', 713, 0],
  ['88mm-he', 0.023, 'detonated', 0, 48],
  ['102mm-naval-he', 0.02, 'detonated', 0, 50],
  ['127mm-naval-he', 0.02, 'detonated', 0, 55],
  ['76mm-aphe', 0.156, 'detonated', 0, 26],
  ['88mm-aphe', 0.171, 'detonated', 0, 26],
  ['60mm-mortar', 0.019, 'detonated', 0, 42],
  ['82mm-mortar', 0.018, 'detonated', 0, 46],
  ['120mm-mortar', 0.023, 'detonated', 0, 54],
  ['240mm-mortar', 0.021, 'detonated', 0, 64],
  ['84mm-rr-heat', 0.171, 'detonated', 1591, 18],
  ['90mm-rr-heat', 0.182, 'detonated', 1750, 18],
  ['105mm-rr-heat', 0.262, 'detonated', 2677, 18],
  ['120mm-rr-hesh', 0.01, 'detonated', 0, 12],
  ['105mm-he', 0.021, 'detonated', 0, 51],
  ['122mm-he', 0.023, 'detonated', 0, 54],
  ['150mm-he', 0.022, 'detonated', 0, 60],
  ['152mm-he', 0.023, 'detonated', 0, 60],
  ['155mm-he', 0.024, 'detonated', 0, 61],
  ['203mm-he', 0.024, 'detonated', 0, 64],
  ['240mm-he', 0.022, 'detonated', 0, 64],
  ['155mm-he-delay', 0.123, 'splashed', 395, 71],
  ['203mm-he-delay', 0.095, 'splashed', 98, 74],
  ['105mm-heat', 0.277, 'detonated', 2950, 18],
  ['120mm-apfsds', 1, 'intact', 1414, 14],
];

/** Missile columns: round, depth into 1 m of armour plate (m), final state, fragments. */
const MISSILE_BASELINE: [string, number, FinalState, number][] = [
  ['missile:light-rocket:shaped', 0.331, 'detonated', 16],
  ['missile:light-rocket:tandem', 0.409, 'detonated', 22],
  ['missile:light-rocket:blast-frag', 0.023, 'detonated', 56],
  ['missile:light-rocket:penetrator', 0.86, 'deformed', 0],
  ['missile:light-rocket:thermobaric', 0.01, 'detonated', 6],
  ['missile:shoulder-rocket:shaped', 0.37, 'detonated', 16],
  ['missile:shoulder-rocket:tandem', 0.459, 'detonated', 22],
  ['missile:shoulder-rocket:blast-frag', 0.02, 'detonated', 56],
  ['missile:shoulder-rocket:penetrator', 0.758, 'deformed', 0],
  ['missile:shoulder-rocket:thermobaric', 0.011, 'detonated', 6],
  ['missile:guided-at:shaped', 0.521, 'detonated', 16],
  ['missile:guided-at:tandem', 0.658, 'detonated', 22],
  ['missile:guided-at:blast-frag', 0.023, 'detonated', 56],
  ['missile:guided-at:penetrator', 1, 'intact', 14],
  ['missile:guided-at:thermobaric', 0.011, 'detonated', 6],
  ['missile:air-surface:shaped', 0.691, 'detonated', 16],
  ['missile:air-surface:tandem', 0.858, 'detonated', 22],
  ['missile:air-surface:blast-frag', 0.023, 'detonated', 56],
  ['missile:air-surface:penetrator', 1, 'intact', 14],
  ['missile:air-surface:thermobaric', 0.013, 'detonated', 6],
  ['missile:cruise:shaped', 1, 'detonated', 16],
  ['missile:cruise:tandem', 1, 'detonated', 22],
  ['missile:cruise:blast-frag', 0.024, 'detonated', 56],
  ['missile:cruise:penetrator', 1, 'intact', 14],
  ['missile:cruise:thermobaric', 0.012, 'detonated', 6],
];

/** Charge columns: charge, overpressure at the test-bed stand-off (kPa), final state, fragments, on a 0.19 m concrete block. */
const CHARGE_BASELINE: [string, number, FinalState, number][] = [
  ['charge-flash', 1420, 'detonated', 0],
  ['charge-cased', 5582, 'detonated', 60],
  ['charge-block', 18121, 'detonated', 0],
  ['charge-satchel', 90959, 'detonated', 0],
  ['charge-shaped', 13936, 'detonated', 6],
  ['charge-thermobaric', 48893, 'detonated', 0],
  ['charge-incendiary', 309, 'detonated', 0],
];

/** Depths and speeds may move by 8% (5 mm / 10 m/s floor), counts by 10% (or 2), pressures by 6%. */
const within = (actual: number, expected: number, rel: number, abs: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.max(abs, Math.abs(expected) * rel));

const resolutions: [string, SimResolution | undefined][] = [
  ['normal resolution', undefined],
  // Ultra (#38) integrates 4x finer; it must land on the same tuned numbers, not re-tune them.
  ['Ultra resolution', ULTRA_RESOLUTION],
];

describe('catalogue coverage', () => {
  it('has a baseline row for every shell, missile and charge', () => {
    expect(ARTILLERY_BASELINE.map((r) => r[0]).sort()).toEqual(ARTILLERY.map((b) => b.id).sort());
    expect(MISSILE_BASELINE.map((r) => r[0]).sort()).toEqual(MISSILES.map((b) => b.id).sort());
    expect(CHARGE_BASELINE.map((r) => r[0]).sort()).toEqual(EXPLOSIVES.map((b) => b.id).sort());
  });
});

describe.each(resolutions)('tuning baseline at %s', (_label, resolution) => {
  it.each(ARTILLERY_BASELINE)('shell %s', (bullet, depth, state, concreteExit, fragments) => {
    const plate = fire({ bullet, medium: 'rha', thickness: 1.0, resolution }).summary;
    within(plate.penetrationM, depth, 0.08, 0.005);
    expect(plate.finalState).toBe(state);
    within(plate.fragments, fragments, 0.1, 2);
    within(fire({ bullet, medium: 'reinforced-concrete', thickness: 0.4, resolution }).summary.exitSpeed, concreteExit, 0.08, 10);
  });

  it.each(MISSILE_BASELINE)('missile %s', (bullet, depth, state, fragments) => {
    const plate = fire({ bullet, medium: 'rha', thickness: 1.0, resolution }).summary;
    within(plate.penetrationM, depth, 0.08, 0.005);
    expect(plate.finalState).toBe(state);
    within(plate.fragments, fragments, 0.1, 2);
  });

  it.each(CHARGE_BASELINE)('charge %s', (bullet, kPa, state, fragments) => {
    const s = fire({ bullet, medium: 'concrete', thickness: 0.19, resolution }).summary;
    within(s.blastKPa ?? 0, kPa, 0.06, 1);
    expect(s.finalState).toBe(state);
    within(s.fragments, fragments, 0.1, 2);
  });
});
