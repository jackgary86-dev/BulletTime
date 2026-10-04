import { describe, expect, it } from 'vitest';
import { frameAt } from './model';
import { getPlateMaterial } from './materials';
import { impactState } from './munitions';
import { heatColor, shade } from './sectionDraw';
import { penetratorDiameter, sectionLayout, sectionShapes } from './section';
import { simulateArmor } from './simulate';

const rod = (thicknessMm: number, obliquityDeg = 0) =>
  simulateArmor({ impact: impactState('apfsds', 120), material: getPlateMaterial('rha'), thicknessM: thicknessMm / 1000, obliquityDeg });

describe('cross-section layout (#167)', () => {
  it('fits the plate and a margin either side into the canvas, with the plate full height', () => {
    const tl = rod(120);
    const l = sectionLayout(tl, 900, 500);
    expect(l.frontX).toBeGreaterThan(0);
    expect(l.rearX).toBeLessThan(900);
    expect((l.rearX - l.frontX) / l.pxPerM).toBeCloseTo(tl.result.losThicknessM, 9);
    expect(l.plate.height).toBe(500);
    expect(l.axisY).toBe(250);
    // The margins either side are equal.
    expect(l.frontX).toBeCloseTo(900 - l.rearX, 6);
  });

  it('keeps a thin plate from being drawn as a sliver', () => {
    const l = sectionLayout(rod(10), 900, 500);
    expect((l.rearX - l.frontX) / l.pxPerM).toBeLessThan(0.05);
    expect(l.pxPerM).toBeLessThan(900 / 0.12 + 1);
  });

  it('draws a thicker plate wider, in the same canvas', () => {
    const thin = sectionLayout(rod(40), 900, 500);
    const thick = sectionLayout(rod(250), 900, 500);
    expect(thick.pxPerM).toBeLessThan(thin.pxPerM);
  });
});

describe('cross-section shapes (#167)', () => {
  it('has no crater at impact, and a crater inside the plate while digging', () => {
    const tl = rod(300);
    const layout = sectionLayout(tl, 900, 500);
    expect(sectionShapes(tl, frameAt(tl, 0), layout).crater).toHaveLength(0);
    const mid = sectionShapes(tl, frameAt(tl, tl.duration * 0.4), layout);
    expect(mid.crater.length).toBeGreaterThan(10);
    for (const p of mid.crater) {
      expect(p.x).toBeGreaterThanOrEqual(layout.frontX - 1e-6);
      expect(p.x).toBeLessThanOrEqual(layout.rearX + 1);
    }
    expect(mid.progress).toBeGreaterThan(0);
    expect(mid.progress).toBeLessThan(1);
  });

  it('mirrors the crater about the shot line', () => {
    const tl = rod(300);
    const layout = sectionLayout(tl, 900, 500);
    const s = sectionShapes(tl, frameAt(tl, tl.duration * 0.4), layout);
    const above = s.crater.filter((p) => p.y < layout.axisY).length;
    const below = s.crater.filter((p) => p.y > layout.axisY).length;
    expect(Math.abs(above - below)).toBeLessThanOrEqual(1);
  });

  it('opens the crater through the rear face once the plate is perforated, with the penetrator beyond it', () => {
    const tl = rod(60);
    expect(tl.result.perforated).toBe(true);
    const layout = sectionLayout(tl, 900, 500);
    const end = sectionShapes(tl, frameAt(tl, tl.duration), layout);
    expect(end.throughHole).toBe(true);
    expect(end.progress).toBe(1);
    expect(end.penetrator.noseX).toBeGreaterThan(layout.rearX);
  });

  it('grows the heat share from nothing towards the energy the plate absorbed', () => {
    const tl = rod(300);
    const layout = sectionLayout(tl, 900, 500);
    const early = sectionShapes(tl, frameAt(tl, 0), layout).heat;
    const late = sectionShapes(tl, frameAt(tl, tl.duration), layout).heat;
    expect(early).toBeLessThan(0.05);
    expect(late).toBeGreaterThan(early);
    expect(late).toBeLessThanOrEqual(1);
  });

  it('sizes the penetrator by its own diameter, and a jet by its jet diameter', () => {
    expect(penetratorDiameter(rod(100))).toBeCloseTo(0.12 * (27 / 120), 6);
    const jet = simulateArmor({ impact: impactState('heat', 100), material: getPlateMaterial('rha'), thicknessM: 0.1, obliquityDeg: 0 });
    expect(penetratorDiameter(jet)).toBeLessThan(0.01);
  });
});

describe('cross-section colours (#167)', () => {
  it('runs the heat ramp from dark red to white-hot and keeps alpha', () => {
    expect(heatColor(0, 0.5)).toBe('rgba(255, 40, 20, 0.5)');
    expect(heatColor(1)).toBe('rgba(255, 255, 220, 1)');
    expect(heatColor(2)).toBe(heatColor(1));
  });

  it('darkens a hex colour and clamps it', () => {
    expect(shade('#808080', 0.5)).toBe('rgb(64, 64, 64)');
    expect(shade('#ffffff', 2)).toBe('rgb(255, 255, 255)');
  });
});
