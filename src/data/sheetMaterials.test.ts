import { describe, expect, it } from 'vitest';
import { fire } from '../sim/testUtil';
import { formatThickness, gaugeOf } from './gauge';
import { MEDIA, getMedium } from './media';

const withStock = MEDIA.filter((m) => m.stockThicknessM);
const SHEET_IDS = ['steel-mild', 'steel-stainless', 'steel-galvanised', 'titanium', 'aluminum', 'copper', 'brass', 'lead-sheet', 'sheet-metal', 'polycarbonate', 'acrylic', 'glass', 'plywood', 'mdf', 'osb', 'drywall', 'cement-board', 'fibreglass', 'kevlar', 'ceramic-tile'];

/** Sheet and plate materials in their stock thicknesses (#261). */
describe('stock thicknesses (#261)', () => {
  it('gives every sheet and plate material a stock list', () => {
    for (const id of SHEET_IDS) expect(getMedium(id).stockThicknessM, id).toBeDefined();
  });

  it.each(withStock.map((m) => [m.id] as const))('%s: stock is inside the range, ascending, and holds the default', (id) => {
    const m = getMedium(id);
    const stock = [...m.stockThicknessM!];
    expect(stock.length).toBeGreaterThan(1);
    for (const t of stock) {
      expect(t).toBeGreaterThanOrEqual(m.thickness.min - 1e-12);
      expect(t).toBeLessThanOrEqual(m.thickness.max + 1e-12);
    }
    expect(stock).toEqual([...stock].sort((a, b) => a - b));
    expect(new Set(stock).size).toBe(stock.length);
    expect(stock.some((t) => Math.abs(t - m.thickness.default) < 1e-12)).toBe(true);
  });

  it('offers the ticket gauges for mild steel and the plate thicknesses up to 25 mm', () => {
    const stock = getMedium('steel-mild').stockThicknessM!.map((t) => Math.round(t * 1e4) / 10);
    for (const mm of [1, 1.5, 2, 3, 4, 6, 8, 10, 12, 16, 20, 25]) expect(stock).toContain(mm);
  });
});

/** Which stock thickness of each metal a round perforates: pinned so tuning cannot quietly move it. */
describe('perforation by stock thickness (#261)', () => {
  const perforates = (bullet: string, medium: string, t: number) => fire({ bullet, medium, thickness: t }).summary.passedThrough;
  const metals = ['steel-mild', 'steel-stainless', 'steel-galvanised', 'titanium', 'aluminum', 'copper', 'brass', 'lead-sheet'];
  const rounds = ['9mm-fmj', '308-sp', '12ga-slug'];

  it.each(metals.flatMap((m) => rounds.map((r) => [m, r] as const)))('%s vs %s: thicker never perforates what thinner stops', (medium, bullet) => {
    const stock = getMedium(medium).stockThicknessM!;
    let stopped = false;
    for (const t of stock) {
      const through = perforates(bullet, medium, t);
      expect(stopped && through, `${bullet} stopped by a thinner ${medium} but went through ${t * 1000} mm`).toBe(false);
      if (!through) stopped = true;
    }
  });

  // Rounds in order: 9 mm FMJ, .308 SP, 12 ga slug. Galvanised stock stops at 6 mm, so its 6 is the cap, not a stop.
  it('pins the thickest stock each round gets through, per metal (mm)', () => {
    const thickest = (medium: string, bullet: string) => {
      const through = getMedium(medium).stockThicknessM!.filter((t) => perforates(bullet, medium, t));
      return through.length ? Math.round(Math.max(...through) * 1e4) / 10 : 0;
    };
    const table = Object.fromEntries(metals.map((m) => [m, rounds.map((r) => thickest(m, r))]));
    expect(table).toEqual({
      'steel-mild': [2, 16, 4],
      'steel-stainless': [2, 12, 4],
      'steel-galvanised': [3, 6, 6],
      titanium: [1, 10, 3],
      aluminum: [6, 25, 8],
      copper: [8, 12, 10],
      brass: [6, 12, 8],
      'lead-sheet': [6, 12, 8],
    });
  });

  it('stronger metals stop thicker sheet: the thickest each lets a round through is ordered by strength', () => {
    const limit = (medium: string, bullet: string) => Math.max(0, ...getMedium(medium).stockThicknessM!.filter((t) => perforates(bullet, medium, t)));
    for (const bullet of ['9mm-fmj', '308-sp']) {
      // A smaller limit means the metal stops sooner.
      expect(limit('steel-stainless', bullet), bullet).toBeLessThanOrEqual(limit('steel-mild', bullet));
      expect(limit('titanium', bullet), bullet).toBeLessThanOrEqual(limit('steel-stainless', bullet));
      expect(limit('steel-mild', bullet), bullet).toBeLessThanOrEqual(limit('aluminum', bullet));
      expect(limit('brass', bullet), bullet).toBeLessThanOrEqual(limit('copper', bullet));
    }
  });

  it('non-metals behave as they should', () => {
    // A single sheet of soft armour stops a pistol round but not a rifle round; thin polycarbonate does not stop a pistol.
    expect(perforates('9mm-fmj', 'kevlar', 0.012)).toBe(false);
    expect(perforates('308-sp', 'kevlar', 0.024)).toBe(true);
    expect(perforates('9mm-fmj', 'polycarbonate', 0.006)).toBe(true);
    expect(perforates('9mm-fmj', 'polycarbonate', 0.025)).toBe(false);
    for (const m of ['mdf', 'osb', 'cement-board', 'fibreglass']) expect(perforates('308-sp', m, getMedium(m).thickness.default)).toBe(true);
  });
});

describe('gauge labels (#261)', () => {
  it('names the gauge of sheet steel and only that', () => {
    expect(gaugeOf(getMedium('steel-mild'), 0.0015)).toBe(16);
    expect(gaugeOf(getMedium('steel-mild'), 0.003)).toBe(11);
    expect(gaugeOf(getMedium('steel-mild'), 0.0017)).toBeNull();
    expect(gaugeOf(getMedium('aluminum'), 0.0015)).toBeNull();
    expect(formatThickness(getMedium('steel-mild'), 0.0015)).toBe('16 ga · 1.5 mm');
    expect(formatThickness(getMedium('steel-mild'), 0.006)).toBe('6.0 mm');
    expect(formatThickness(getMedium('gel10'), 0.4)).toBe('40.0 cm');
  });
});
