import { describe, expect, it } from 'vitest';
import { CONCRETE_REFERENCE } from '../data/concreteReference';
import { getMedium } from '../data/media';
import { concreteFootprint } from './concreteDamage';

/** The spall and scab footprints follow the measured panels (#223). */
const mediumOf = (id: string) => getMedium(`concrete-${id.toLowerCase()}`);

describe('concrete damage footprints', () => {
  it.each(CONCRETE_REFERENCE)('$id matches the measured spall and scab at the reference thickness', ({ id, spallMm, scabMm }) => {
    const m = mediumOf(id);
    const t = m.concreteDamage!.refThicknessM;
    const spall = concreteFootprint(m, t, 'spall')!;
    const scab = concreteFootprint(m, t, 'scab')!;
    expect(spall.w * 1000).toBeCloseTo(spallMm[0], 6);
    expect(spall.h * 1000).toBeCloseTo(spallMm[1], 6);
    expect(scab.w * 1000).toBeCloseTo(scabMm[0], 6);
    expect(scab.h * 1000).toBeCloseTo(scabMm[1], 6);
  });

  it('the scab is at least 1.8× the spall width, and relatively widest for the strongest grade', () => {
    const ratios = CONCRETE_REFERENCE.map(({ id }) => {
      const m = mediumOf(id);
      const t = m.concreteDamage!.refThicknessM;
      return concreteFootprint(m, t, 'scab')!.w / concreteFootprint(m, t, 'spall')!.w;
    });
    for (const r of ratios) expect(r).toBeGreaterThanOrEqual(1.79);
    expect(ratios[2]).toBeGreaterThan(ratios[0]);
    expect(ratios[2]).toBeGreaterThan(ratios[1]);
  });

  it('a thicker panel scabs wider, and the scab grows faster than the spall', () => {
    const m = mediumOf('C35');
    const spallGrow = concreteFootprint(m, 0.09, 'spall')!.w / concreteFootprint(m, 0.045, 'spall')!.w;
    const scabGrow = concreteFootprint(m, 0.09, 'scab')!.w / concreteFootprint(m, 0.045, 'scab')!.w;
    expect(scabGrow).toBeGreaterThan(spallGrow);
    expect(spallGrow).toBeGreaterThan(1);
  });

  it('ordinary media have no measured footprint', () => {
    expect(concreteFootprint(getMedium('concrete'), 0.19, 'scab')).toBeUndefined();
  });
});
