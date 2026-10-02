import { describe, expect, it } from 'vitest';
import { BULLETS } from '../data/bullets';
import type { FinalState } from './types';
import { fire } from './testUtil';

/**
 * Regression baseline for the tuning constants (\`data/physics.ts\`, the bullet
 * and medium tables). Every catalogue round into deep gel, a pine board and a
 * 60 cm water tank, recorded from the tuned engine. A change in tuning that
 * moves any of these by more than a few percent fails here: if the change is
 * intended, re-record the row and say why in the commit.
 *
 * Columns: round, gel penetration (m), gel exit speed (m/s), final state in gel,
 * exit speed through pine (m/s), exit speed through the water tank (m/s).
 */
const BASELINE: [string, number, number, FinalState, number, number][] = [
  ['22lr-lrn', 0.294, 0, 'intact', 240, 25],
  ['9mm-fmj', 0.681, 0, 'intact', 307, 190],
  ['9mm-jhp', 0.312, 0, 'expanded', 307, 145],
  ['45acp-fmj', 0.624, 0, 'intact', 194, 198],
  ['357mag-jsp', 0.431, 0, 'expanded', 336, 123],
  ['556-m193', 0.390, 0, 'fragmented', 963, 153],
  ['762x39-fmj', 0.734, 0, 'intact', 690, 258],
  ['308-sp', 0.477, 0, 'expanded', 839, 135],
  ['12ga-slug', 0.402, 0, 'expanded', 433, 86],
  ['12ga-00buck', 0.372, 0, 'intact', 296, 99],
  ['50bmg-fmj', 0.900, 330, 'intact', 876, 476],
  ['20mm-hei', 0.001, 0, 'detonated', 0, 0],
];

/** Penetration may move by 6%, speeds by 8% or 10 m/s, whichever is larger. */
const within = (actual: number, expected: number, rel: number, abs: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.max(abs, Math.abs(expected) * rel));

describe('tuning baseline', () => {
  it('covers every round in the catalogue', () => {
    expect(BASELINE.map((r) => r[0]).sort()).toEqual(BULLETS.map((b) => b.id).sort());
  });

  it.each(BASELINE)('%s', (bullet, gelDepth, gelExit, state, pineExit, waterExit) => {
    const gel = fire({ bullet, thickness: 0.9 }).summary;
    within(gel.penetrationM, gelDepth, 0.06, 0.005);
    within(gel.exitSpeed, gelExit, 0.08, 10);
    expect(gel.finalState).toBe(state);
    within(fire({ bullet, medium: 'pine' }).summary.exitSpeed, pineExit, 0.08, 10);
    within(fire({ bullet, medium: 'water', thickness: 0.6 }).summary.exitSpeed, waterExit, 0.08, 10);
  });
});

/** 9mm FMJ into each barrier at its default thickness: what happens to the bullet, and its exit speed if it gets through. */
const BARRIERS: [string, FinalState, boolean, number][] = [
  ['steel-mild', 'splashed', false, 0],
  ['steel-ar500', 'splashed', false, 0],
  ['concrete', 'deformed', false, 0],
  ['cinder-block', 'deformed', false, 0],
  ['glass', 'deformed', true, 329],
  ['sandbag', 'intact', false, 0],
  ['oak', 'intact', true, 222],
  ['drywall', 'intact', true, 354],
  ['ice', 'intact', true, 91],
];

describe('barrier baseline (9mm FMJ)', () => {
  it.each(BARRIERS)('%s', (medium, state, through, exit) => {
    const s = fire({ bullet: '9mm-fmj', medium }).summary;
    expect(s.finalState).toBe(state);
    expect(s.passedThrough).toBe(through);
    within(s.exitSpeed, exit, 0.08, 10);
  });
});
