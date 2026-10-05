import { describe, expect, it } from 'vitest';
import { ARTILLERY } from '../data/artillery';
import { BULLETS } from '../data/bullets';
import { AIRFRAMES } from '../data/missiles';
import { BASE_VIEW_WIDTH_M, previewScale, scaleNote } from './bulletPreviewScale';

describe('round preview fit', () => {
  it('keeps bullet-scale rounds at 1:1 with a millimetre ruler', () => {
    expect(previewScale(0.03, 0.009)).toBe(1);
    expect(scaleNote(1)).toBe('True scale, ruler in mm');
  });

  it('zooms out for the 240 mm mortar, a metre long, until it fits', () => {
    const s = previewScale(1.0, 0.24);
    expect(s).toBeGreaterThan(1);
    expect(BASE_VIEW_WIDTH_M * s).toBeGreaterThan(1.0 + 0.012);
    expect(scaleNote(s)).toContain(`${s} mm`);
  });

  it('every round in the catalogue fits its window at the chosen scale', () => {
    const fits = (lengthM: number, diameterM: number) => {
      const s = previewScale(lengthM, diameterM);
      return BASE_VIEW_WIDTH_M * s >= lengthM + 0.012 && 0.028 * s >= diameterM;
    };
    for (const b of [...BULLETS, ...ARTILLERY]) expect(fits(b.lengthMm / 1000, b.caliberMm / 1000), b.id).toBe(true);
    for (const a of AIRFRAMES) expect(fits(a.lengthMm / 1000, a.caliberMm / 1000), a.id).toBe(true);
  });
});
