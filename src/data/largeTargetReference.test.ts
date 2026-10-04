import { describe, expect, it } from 'vitest';
import checklist from '../../docs/material-reference/CHECKLIST.md?raw';
import sheet from '../../docs/material-reference/large-targets.md?raw';
import { getPlateMaterial } from '../armor/materials';
import { LARGE_TARGET_REFERENCE } from './largeTargetReference';
import { LARGE_PLATE_IDS, getMedium } from './media';

/** The reference figures (#262) must agree with the catalogue they describe and be labelled for what they are. */
describe('large-target reference', () => {
  it('covers every large steel plate, plus concrete and earth', () => {
    const ids = LARGE_TARGET_REFERENCE.map((r) => r.mediumId);
    for (const id of LARGE_PLATE_IDS) expect(ids).toContain(id);
    expect(ids).toEqual(expect.arrayContaining(['reinforced-concrete', 'packed-earth']));
  });

  it.each(LARGE_TARGET_REFERENCE.map((r) => [r.mediumId, r] as const))('%s: densities match the catalogue and every figure is labelled and sourced', (_id, r) => {
    const medium = getMedium(r.mediumId);
    const density = r.figures.find((f) => f.name === 'Density');
    expect(density?.value).toBe(medium.density);
    for (const f of r.figures) {
      expect(['published', 'model', 'illustrative']).toContain(f.status);
      expect(f.source.length).toBeGreaterThan(10);
    }
    if (r.plateMaterial) expect(getPlateMaterial(r.plateMaterial).density).toBe(medium.density);
    // Engine constants quoted here are the live ones, so they cannot drift.
    const quoted = r.figures.find((f) => f.name.startsWith('Resistance'));
    if (quoted) expect(quoted.value).toBe(medium.resistancePa);
  });

  it('measured claims are limited to published sources: nothing here is called measured', () => {
    for (const r of LARGE_TARGET_REFERENCE) for (const f of r.figures) expect(f.status).not.toBe('measured' as never);
  });

  it('every target has a replay link and a row in CHECKLIST.md', () => {
    for (const r of LARGE_TARGET_REFERENCE) {
      expect(r.replay).toContain(`medium=${r.mediumId}`);
      expect(checklist, r.mediumId).toContain(r.replay);
    }
  });

  it('the sheet names every kind of figure and every target', () => {
    for (const kind of ['published', 'model', 'illustrative']) expect(sheet).toContain(kind);
    for (const r of LARGE_TARGET_REFERENCE) expect(sheet.toLowerCase()).toContain(getMedium(r.mediumId).name.toLowerCase().replace('armour plate (rolled steel)', 'rha'));
  });
});
