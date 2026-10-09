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
 *
 * Re-recorded for #204: in metal plate a long rod now follows the Armor lab's
 * Tate model and a jet its density law, so HEAT and shaped-charge rows match
 * `jetReachIn` within about 5%, darts and kinetic cores stop at Tate's depth,
 * and tandem heads bore 1.2 times a single charge.
 *
 * Re-recorded when Artillery and Missile went to armour-piercing and penetrator rounds only: the
 * high-explosive, HEAT, HESH and shaped-charge rows went, and the new APDS, APCR and APFSDS shells and
 * the long-rod and heavy-core missile heads came in. Rows for rounds that stayed are unchanged.
 */
const ARTILLERY_BASELINE: [string, number, FinalState, number, number][] = [
  ['20mm-ap', 0.049, 'deformed', 0, 0],
  ['25mm-apds', 0.087, 'deformed', 0, 0],
  ['30mm-ap', 0.071, 'deformed', 0, 0],
  ['30mm-apfsds', 0.082, 'deformed', 1124, 0],
  ['37mm-ap', 0.057, 'deformed', 0, 0],
  ['45mm-ap', 0.075, 'deformed', 0, 0],
  ['50mm-ap', 0.108, 'deformed', 192, 0],
  ['57mm-ap', 0.151, 'deformed', 531, 0],
  ['57mm-apds', 0.18, 'deformed', 725, 0],
  ['75mm-apcbc', 0.141, 'deformed', 398, 0],
  ['76mm-ap', 0.188, 'deformed', 570, 0],
  ['76mm-hvap', 0.206, 'deformed', 695, 0],
  ['88mm-ap', 0.231, 'deformed', 713, 0],
  ['88mm-apcr', 0.267, 'deformed', 844, 0],
  ['100mm-ap', 0.23, 'deformed', 644, 0],
  ['76mm-aphe', 0.156, 'detonated', 0, 26],
  ['88mm-aphe', 0.171, 'detonated', 0, 26],
  ['105mm-apds', 0.274, 'deformed', 1076, 0],
  ['105mm-apfsds', 0.421, 'deformed', 1434, 0],
  ['122mm-ap', 0.201, 'deformed', 542, 0],
  ['120mm-apfsds', 0.535, 'deformed', 1414, 0],
  ['125mm-apfsds', 0.571, 'deformed', 1687, 0],
];

/** Missile columns: round, depth into 1 m of armour plate (m), final state, fragments. */
const MISSILE_BASELINE: [string, number, FinalState, number][] = [
  ['missile:light-rocket:penetrator', 0.459, 'deformed', 0],
  ['missile:light-rocket:long-rod', 0.758, 'deformed', 0],
  ['missile:light-rocket:heavy-core', 0.198, 'deformed', 0],
  ['missile:light-rocket:efp', 0.255, 'detonated', 5],
  ['missile:shoulder-rocket:penetrator', 0.413, 'deformed', 0],
  ['missile:shoulder-rocket:long-rod', 0.682, 'deformed', 0],
  ['missile:shoulder-rocket:heavy-core', 0.178, 'deformed', 0],
  ['missile:shoulder-rocket:efp', 0.285, 'detonated', 5],
  ['missile:guided-at:penetrator', 0.734, 'deformed', 0],
  ['missile:guided-at:long-rod', 1, 'intact', 14],
  ['missile:guided-at:heavy-core', 0.317, 'deformed', 0],
  ['missile:guided-at:efp', 0.416, 'detonated', 5],
  ['missile:air-surface:penetrator', 0.803, 'deformed', 0],
  ['missile:air-surface:long-rod', 1, 'intact', 14],
  ['missile:air-surface:heavy-core', 0.347, 'deformed', 0],
  ['missile:air-surface:efp', 0.553, 'detonated', 5],
  ['missile:cruise:penetrator', 1, 'intact', 14],
  ['missile:cruise:long-rod', 1, 'intact', 14],
  ['missile:cruise:heavy-core', 1, 'intact', 14],
  ['missile:cruise:efp', 1, 'detonated', 5],
];

/**
 * Charge columns: charge, overpressure at the test-bed stand-off (kPa), final state, fragments, on a 0.19 m concrete block.
 *
 * Re-recorded for #320: the pressure comes from each charge's free-air share of its yield (a cased charge 0.7, the
 * cutting charge 0.3), and the far-field fit is held at its value at a scaled range of 0.5 instead of being
 * extrapolated toward contact, so the block, satchel and fuel-air charge, all closer than that here, read the hold.
 */
const CHARGE_BASELINE: [string, number, FinalState, number][] = [
  ['charge-flash', 1420, 'detonated', 0],
  ['charge-cased', 3915, 'detonated', 60],
  ['charge-block', 13936, 'detonated', 0],
  ['charge-satchel', 13936, 'detonated', 0],
  ['charge-shaped', 4193, 'detonated', 6],
  ['charge-thermobaric', 13936, 'detonated', 0],
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
