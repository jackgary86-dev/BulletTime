import { describe, expect, it } from 'vitest';
import { CONCRETE_REFERENCE, CONCRETE_REFERENCE_BULLET } from '../data/concreteReference';
import { getMedium } from '../data/media';
import { concreteDebrisAccounting, energyAccounting, MOMENTUM_BAND } from './accounting';
import { layersFor, simulate } from './engine';

/** The reference sheet retained energy fractions, (vr/vi)^2, at the single-shot sections (#227). */
const RETAINED = { C35: 0.127, C75: 0.16, C110: 0.079 };

function shot(grade: string, speed: number) {
  const m = getMedium(`concrete-${grade.toLowerCase()}`);
  const summary = simulate({
    bullet: { ...CONCRETE_REFERENCE_BULLET, muzzleVelocityMs: speed },
    layers: layersFor(m, 0.045),
    angleDeg: 0,
    impactPoint: { x: -0.2, y: 0.16, z: 0 },
    standOffM: 0.5,
  }).summary;
  return { m, summary, acc: energyAccounting(summary) };
}

describe('energy accounting (#227)', () => {
  it('retained fraction is (vr/vi)^2 and the rest is absorbed', () => {
    const acc = energyAccounting({ impactSpeed: 200, impactEnergyJ: 1000, passedThrough: true, exitSpeed: 100 });
    expect(acc.retained).toBeCloseTo(0.25, 9);
    expect(acc.absorbed).toBeCloseTo(0.75, 9);
    expect(acc.residualJ).toBeCloseTo(250, 9);
    expect(acc.massKg).toBeCloseTo(0.05, 9);
  });

  it('a stopped bullet keeps nothing', () => {
    const acc = energyAccounting({ impactSpeed: 150, impactEnergyJ: 500, passedThrough: false, exitSpeed: 0 });
    expect(acc.residualSpeedMs).toBe(0);
    expect(acc.absorbed).toBe(1);
  });

  it('the reference sheet fractions match the measured sections', () => {
    for (const { id, section } of CONCRETE_REFERENCE) {
      const acc = energyAccounting({ impactSpeed: section.initialMs, impactEnergyJ: 1, passedThrough: true, exitSpeed: section.residualMs });
      expect(acc.retained).toBeCloseTo(RETAINED[id], 2);
      expect(acc.absorbed).toBeGreaterThan(0.83);
      expect(acc.absorbed).toBeLessThan(0.93);
    }
  });

  // The measured sections absorb 84-92%; the model lets a little more through near 160 m/s (see concreteGrades.test.ts).
  it.each(['C35', 'C75', 'C110'])('%s: the panel absorbs most of a ~160 m/s round', (grade) => {
    const { acc } = shot(grade, 160);
    expect(acc.absorbed).toBeGreaterThan(0.7);
    expect(acc.impactJ).toBeCloseTo(0.5 * acc.massKg * acc.impactSpeedMs ** 2, 3);
  });
});

describe('concrete debris and momentum (#227)', () => {
  it.each(['C35', 'C75', 'C110'])('%s: spall and scab momentum is the same order as the bullet loses', (grade) => {
    const { m, acc } = shot(grade, 207);
    expect(acc.residualSpeedMs).toBeGreaterThan(0);
    const debris = concreteDebrisAccounting(m, 0.045, acc)!;
    expect(debris.ratio, `${grade} ratio`).toBeGreaterThan(1 / MOMENTUM_BAND);
    expect(debris.ratio, `${grade} ratio`).toBeLessThan(MOMENTUM_BAND);
    expect(debris.consistent).toBe(true);
  });

  it('the scab is heavier than the spall and only exists once the panel is perforated', () => {
    const through = shot('C35', 207);
    const d = concreteDebrisAccounting(through.m, 0.045, through.acc)!;
    expect(d.scabKg).toBeGreaterThan(d.spallKg);
    const held = shot('C35', 100);
    expect(held.acc.residualSpeedMs).toBe(0);
    expect(concreteDebrisAccounting(held.m, 0.045, held.acc)!.scabKg).toBe(0);
  });

  it('a stronger grade throws a wider scab, so a heavier one at the same thickness', () => {
    const a = shot('C35', 207);
    const c = shot('C110', 207);
    expect(concreteDebrisAccounting(c.m, 0.045, c.acc)!.scabKg).toBeGreaterThan(concreteDebrisAccounting(a.m, 0.045, a.acc)!.scabKg);
  });

  it('flags an outlier', () => {
    const { m, acc } = shot('C35', 207);
    const wild = concreteDebrisAccounting(m, 0.045, { ...acc, massKg: acc.massKg * 100 })!;
    expect(wild.consistent).toBe(false);
  });

  it('other media have no debris tally', () => {
    const { acc } = shot('C35', 207);
    expect(concreteDebrisAccounting(getMedium('concrete'), 0.19, acc)).toBeUndefined();
  });
});
