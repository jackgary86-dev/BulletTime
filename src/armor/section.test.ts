import { describe, expect, it } from 'vitest';
import { frameAt } from './model';
import { getPlateMaterial } from './materials';
import { impactState } from './munitions';
import { heatColor, shade } from './sectionDraw';
import { MIN_FRAGMENT_PX, dimensionLine, fragmentShapes, penetratorDiameter, roomShapes, sectionLayout, sectionShapes } from './section';
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

describe('thrown pieces on the section (#165)', () => {
  const jet = () => simulateArmor({ impact: impactState('heat', 100), material: getPlateMaterial('rha'), thicknessM: 0.1, obliquityDeg: 0 });
  const glance = () => simulateArmor({ impact: impactState('apfsds', 120), material: getPlateMaterial('rha'), thicknessM: 0.1, obliquityDeg: 85 });

  it('fits the fragment room into the canvas, with the plate centred', () => {
    const tl = jet();
    for (const [w, h] of [[900, 500], [900, 300], [500, 700]]) {
      const l = sectionLayout(tl, w, h);
      const room = roomShapes(tl, l)!;
      expect(room.floorY).toBeLessThanOrEqual(h + 1e-6);
      expect(room.ceilingY).toBeGreaterThanOrEqual(-1e-6);
      expect(room.leftX).toBeGreaterThanOrEqual(-1e-6);
      expect(room.rightX).toBeLessThanOrEqual(w + 1e-6);
      expect(l.frontX).toBeCloseTo(w - l.rearX, 6);
    }
  });

  it('has no room when nothing is thrown', () => {
    const tl = simulateArmor({ impact: impactState('apfsds', 40), material: getPlateMaterial('rha'), thicknessM: 0.3, obliquityDeg: 0 });
    expect(roomShapes(tl, sectionLayout(tl, 900, 500))).toBeNull();
    expect(fragmentShapes(tl, 1, sectionLayout(tl, 900, 500))).toEqual([]);
  });

  it('shows a piece only once it has been thrown, and behind the plate for a jet', () => {
    const tl = jet();
    const l = sectionLayout(tl, 900, 500);
    const t0 = tl.fragments!.tracks[0].t0;
    expect(fragmentShapes(tl, t0 * 0.5, l)).toHaveLength(0);
    const after = fragmentShapes(tl, t0 + 1e-5, l);
    expect(after.length).toBe(tl.fragments!.tracks.length);
    for (const f of after) expect(f.x).toBeGreaterThanOrEqual(l.rearX - 1);
  });

  it('sends a ricochet out of the front face', () => {
    const tl = glance();
    const l = sectionLayout(tl, 900, 500);
    const f = fragmentShapes(tl, tl.fragments!.tracks[0].t0 + 1e-5, l);
    expect(f).toHaveLength(1);
    expect(f[0].x).toBeLessThanOrEqual(l.frontX + 1);
  });

  it('keeps every piece inside the room, and at rest on the floor at the end', () => {
    const tl = jet();
    const l = sectionLayout(tl, 900, 500);
    const room = roomShapes(tl, l)!;
    const end = fragmentShapes(tl, tl.fragments!.restS + 1, l);
    for (const f of end) {
      expect(f.resting).toBe(true);
      expect(f.y).toBeLessThanOrEqual(room.floorY + 1e-6);
      expect(f.y).toBeGreaterThan(room.floorY - 40);
    }
  });

  it('never draws a piece smaller than a few pixels', () => {
    const tl = jet();
    const l = sectionLayout(tl, 900, 500);
    for (const f of fragmentShapes(tl, tl.fragments!.tracks[0].t0, l)) expect(f.lengthPx).toBeGreaterThanOrEqual(MIN_FRAGMENT_PX);
  });

  it('hands the penetrator to its track after the handoff time', () => {
    const tl = simulateArmor({ impact: impactState('apfsds', 120), material: getPlateMaterial('rha'), thicknessM: 0.05, obliquityDeg: 0 });
    const l = sectionLayout(tl, 900, 500);
    const f = frameAt(tl, tl.duration);
    expect(sectionShapes(tl, f, l, tl.fragments!.handoffS! - 1e-9).penetrator.hidden).toBe(false);
    expect(sectionShapes(tl, f, l, tl.fragments!.handoffS!).penetrator.hidden).toBe(true);
    expect(sectionShapes(tl, f, l).penetrator.hidden).toBe(tl.duration >= tl.fragments!.handoffS!);
  });
});

describe('line-of-sight dimension (#165)', () => {
  it('labels the plate square-on with its thickness', () => {
    const tl = rod(120);
    const d = dimensionLine(tl, sectionLayout(tl, 900, 500));
    expect(d.label).toBe('plate 120 mm');
    expect(d.x0).toBeLessThan(d.x1);
  });

  it('labels a sloped plate with its line-of-sight thickness, thickness and angle', () => {
    const tl = simulateArmor({ impact: impactState('ap-shot', 88), material: getPlateMaterial('rha'), thicknessM: 0.05, obliquityDeg: 60 });
    const d = dimensionLine(tl, sectionLayout(tl, 900, 500));
    expect(d.label).toContain('line of sight 100 mm');
    expect(d.label).toContain('plate 50 mm at 60');
  });
});
