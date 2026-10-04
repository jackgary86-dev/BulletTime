import { describe, expect, it } from 'vitest';
import { fieldScale } from './fields';
import {
  MOLTEN_RGB,
  OVERLAY_MAX_COLS,
  TEACHING_NOTE,
  buildOverlay,
  fieldColor,
  legendTicks,
  niceScaleLength,
  paletteColor,
  palette,
  scaleLabel,
} from './fieldOverlay';
import { getPlateMaterial } from './materials';
import { impactState, type MunitionFamilyId } from './munitions';
import { sectionLayout } from './section';
import { simulateArmor } from './simulate';

const run = (family: MunitionFamilyId, thicknessM: number, material: 'rha' | 'cast-iron' = 'rha', calibreMm = 120) =>
  simulateArmor({ impact: impactState(family, calibreMm), material: getPlateMaterial(material), thicknessM, obliquityDeg: 0 });

describe('palettes (#167)', () => {
  it('interpolates between stops and clamps', () => {
    const stops = palette('temperature');
    expect(paletteColor(stops, 0)).toEqual(stops[0]);
    expect(paletteColor(stops, 1)).toEqual(stops[stops.length - 1]);
    expect(paletteColor(stops, -3)).toEqual(stops[0]);
    expect(paletteColor(stops, 9)).toEqual(stops[stops.length - 1]);
    const mid = paletteColor([[0, 0, 0], [100, 200, 50]], 0.5);
    expect(mid).toEqual([50, 100, 25]);
  });

  it('runs the temperature palette from dark to bright, so heat reads as brighter', () => {
    const lum = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const stops = palette('temperature');
    for (let i = 1; i < stops.length; i++) expect(lum(stops[i])).toBeGreaterThan(lum(stops[i - 1]));
  });

  it('runs the stress palette brighter with stress as well', () => {
    const lum = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const stops = palette('stress');
    for (let i = 1; i < stops.length; i++) expect(lum(stops[i])).toBeGreaterThan(lum(stops[i - 1]));
  });
});

describe('field colours (#167)', () => {
  const temp = fieldScale('temperature', run('apfsds', 0.1));
  const stress = fieldScale('stress', run('apfsds', 0.1));
  const pressure = fieldScale('pressure', run('apfsds', 0.1));

  it('leaves cold metal and unstressed metal see-through, and makes hot and stressed metal opaque', () => {
    expect(fieldColor(temp, temp.min)[3]).toBe(0);
    expect(fieldColor(temp, temp.max)[3]).toBeGreaterThan(0.8);
    expect(fieldColor(stress, 0)[3]).toBe(0);
    expect(fieldColor(stress, stress.max)[3]).toBeGreaterThan(0.8);
  });

  it('is monotonic in opacity with the value', () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const a = fieldColor(temp, temp.min + ((temp.max - temp.min) * i) / 20)[3];
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
  });

  it('shows tension blue and compression red, fading to nothing at zero', () => {
    const tension = fieldColor(pressure, -pressure.max);
    const compression = fieldColor(pressure, pressure.max);
    expect(tension[2]).toBeGreaterThan(tension[0]);
    expect(compression[0]).toBeGreaterThan(compression[2]);
    expect(fieldColor(pressure, 0)[3]).toBe(0);
    expect(fieldColor(pressure, pressure.max / 2)[3]).toBeLessThan(compression[3]);
  });

  it('draws molten metal white-hot', () => {
    expect(fieldColor(temp, temp.max, true)).toEqual([...MOLTEN_RGB, 0.95]);
  });

  it('keeps every channel in range', () => {
    for (const s of [temp, stress, pressure]) {
      for (let i = -2; i <= 22; i++) {
        const [r, g, b, a] = fieldColor(s, s.min + ((s.max - s.min) * i) / 20);
        for (const v of [r, g, b]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(255);
        }
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('overlay buffer (#167)', () => {
  it('has one RGBA cell per grid cell, coarse enough to be cheap', () => {
    const tl = run('apfsds', 0.1);
    const layout = sectionLayout(tl, 900, 500);
    const o = buildOverlay(tl, tl.duration * 0.5, 'temperature', layout);
    expect(o.rgba).toHaveLength(o.cols * o.rows * 4);
    expect(o.values).toHaveLength(o.cols * o.rows);
    expect(o.cols).toBeLessThanOrEqual(OVERLAY_MAX_COLS);
    expect(o.cols * o.rows).toBeLessThan(20000);
    expect(o.kind).toBe('temperature');
  });

  it('is hotter along the shot line than at the top of the plate, once the rod has dug in', () => {
    const tl = run('apfsds', 0.2);
    const layout = sectionLayout(tl, 900, 500);
    const o = buildOverlay(tl, tl.duration * 0.6, 'temperature', layout);
    const mid = Math.floor(o.rows / 2);
    const col = Math.floor(o.cols * 0.1);
    expect(o.values[mid * o.cols + col]).toBeGreaterThan(o.values[col]);
    expect(o.rgba[(mid * o.cols + col) * 4 + 3]).toBeGreaterThan(o.rgba[col * 4 + 3]);
  });

  it('counts molten cells for a jet and none for a plugged plate', () => {
    const jet = run('heat', 0.1);
    const jl = sectionLayout(jet, 900, 500);
    expect(buildOverlay(jet, jet.duration * 0.4, 'temperature', jl).moltenCells).toBeGreaterThan(0);
    const plugged = run('ap-shot', 0.06);
    const pl = sectionLayout(plugged, 900, 500);
    expect(buildOverlay(plugged, plugged.duration * 0.5, 'temperature', pl).moltenCells).toBe(0);
  });

  it('draws every field for every family without blowing up, with a visible mark somewhere', () => {
    for (const [family, thickness, material] of [['ap-shot', 0.1, 'rha'], ['apfsds', 0.1, 'rha'], ['heat', 0.1, 'rha'], ['hesh', 0.03, 'cast-iron']] as const) {
      const tl = run(family, thickness, material);
      const layout = sectionLayout(tl, 900, 500);
      for (const kind of ['temperature', 'stress', 'pressure'] as const) {
        let marked = false;
        for (const f of [0.002, 0.005, 0.01, 0.2, 0.5, 0.9]) {
          const o = buildOverlay(tl, tl.duration * f, kind, layout);
          for (let k = 3; k < o.rgba.length; k += 4) if (o.rgba[k] > 0) marked = true;
        }
        expect(marked, `${family} ${kind}`).toBe(true);
      }
    }
  });
});

describe('legend (#167)', () => {
  it('labels the ends and the middle in real units', () => {
    const tl = run('apfsds', 0.1);
    const ticks = legendTicks(fieldScale('temperature', tl));
    expect(ticks[0].position).toBe(1);
    expect(ticks[ticks.length - 1].position).toBe(0);
    for (const t of ticks) expect(t.label).toContain('°C');
  });

  it('marks yield on the stress legend and zero on the pressure legend', () => {
    const tl = run('apfsds', 0.1);
    expect(legendTicks(fieldScale('stress', tl)).some((t) => t.label === '1 (yield)')).toBe(true);
    const p = legendTicks(fieldScale('pressure', tl));
    expect(p.some((t) => t.value === 0 && t.position === 0.5)).toBe(true);
    for (const t of p) expect(t.label).toContain('GPa');
  });

  it('carries the teaching-approximation note', () => {
    expect(TEACHING_NOTE).toMatch(/approximation/i);
  });
});

describe('scale bar (#167)', () => {
  it('picks a round length that fits', () => {
    for (const pxPerM of [300, 1500, 4000, 25000]) {
      const length = niceScaleLength(pxPerM, 140);
      expect(length * pxPerM).toBeLessThanOrEqual(140 + 1e-9);
      expect(length * pxPerM).toBeGreaterThan(140 / 2.5);
      const m = length / 10 ** Math.floor(Math.log10(length));
      expect([1, 2, 5].some((x) => Math.abs(m - x) < 1e-9)).toBe(true);
    }
  });

  it('is finite for silly input and labels in mm or m', () => {
    expect(niceScaleLength(0, 100)).toBe(0.01);
    expect(scaleLabel(0.05)).toBe('50 mm');
    expect(scaleLabel(0.002)).toBe('2 mm');
    expect(scaleLabel(2)).toBe('2 m');
  });
});
