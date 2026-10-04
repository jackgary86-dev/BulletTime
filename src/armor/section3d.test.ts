import { describe, expect, it } from 'vitest';
import { getPlateMaterial, type PlateMaterialId } from './materials';
import { MUNITION_FAMILIES, impactState, type MunitionFamilyId } from './munitions';
import { playbackAt } from './playback';
import { PLATE_RADIUS_SHARE, roomHalfHeight, section3d, type ProfilePoint } from './section3d';
import { simulateStack, type PlateLayer, type StackTimeline } from './stack';
import { stackLayout, stackShapes } from './stackView';

const layer = (material: PlateMaterialId, thicknessMm: number, gapMm = 0): PlateLayer => ({ material: getPlateMaterial(material), thicknessM: thicknessMm / 1000, gapBeforeM: gapMm / 1000 });
const run = (family: MunitionFamilyId, layers: PlateLayer[], calibreMm = 120, obliquityDeg = 0): StackTimeline =>
  simulateStack({ impact: impactState(family, calibreMm), layers, obliquityDeg });

/** Signed area of a closed outline in the (x, r) plane. */
const area = (pts: ProfilePoint[]) => pts.reduce((a, p, i) => {
  const q = pts[(i + 1) % pts.length];
  return a + (p.x * q.r - q.x * p.r) / 2;
}, 0);

/** Whether two segments cross at a point inside both (touching ends do not count). */
function crosses(a: ProfilePoint, b: ProfilePoint, c: ProfilePoint, d: ProfilePoint): boolean {
  const cross = (o: ProfilePoint, p: ProfilePoint, q: ProfilePoint) => (p.x - o.x) * (q.r - o.r) - (p.r - o.r) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  const eps = 1e-12;
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
}

function simple(pts: ProfilePoint[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (crosses(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
}

const SHOTS: [MunitionFamilyId, PlateLayer[], number, number][] = [
  ['apfsds', [layer('rha', 120)], 120, 0],
  ['apfsds', [layer('rha', 300)], 40, 0],
  ['ap-shot', [layer('rha', 80)], 88, 30],
  ['heat', [layer('rha', 200)], 105, 0],
  ['hesh', [layer('rha', 60)], 120, 0],
  ['apfsds', [layer('mild-steel', 20), layer('rha', 250, 300)], 50, 0],
  ['ap-shot', [layer('rha', 40)], 76, 80],
];

describe('3D sectioned plate (#172)', () => {
  it.each(SHOTS)('%s: every plate is a closed, simple cut face inside its radius at every moment', (family, layers, cal, ob) => {
    const s = run(family, layers, cal, ob);
    for (let k = 0; k <= 20; k++) {
      const pb = playbackAt(s, k / 20);
      const view = section3d(s, pb.t, pb.fragmentT);
      expect(view.plates).toHaveLength(s.stages.length);
      for (const plate of view.plates) {
        expect(plate.outline.length).toBeGreaterThanOrEqual(3);
        for (const p of plate.outline) {
          expect(p.r).toBeGreaterThanOrEqual(0);
          expect(p.r).toBeLessThanOrEqual(plate.radiusM + 1e-12);
          expect(p.x).toBeGreaterThanOrEqual(plate.frontX - 1e-12);
          expect(Number.isFinite(p.x)).toBe(true);
        }
        expect(simple(plate.outline)).toBe(true);
        // Never more than the plate and its bulge, never nothing.
        const a = Math.abs(area(plate.outline));
        expect(a).toBeGreaterThan(0);
        expect(a).toBeLessThanOrEqual(plate.radiusM * (Math.max(...plate.outline.map((p) => p.x)) - plate.frontX) + 1e-12);
        for (const surface of plate.surfaces) expect(surface.points.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('before impact the cut face is the whole plate; once through, the crater runs to the rear face', () => {
    const s = run('apfsds', [layer('rha', 100)]);
    expect(s.result.perforated).toBe(true);
    const start = section3d(s, 0, 0).plates[0];
    expect(Math.abs(area(start.outline))).toBeCloseTo(start.radiusM * (start.rearX - start.frontX), 9);
    expect(start.surfaces.some((x) => x.kind === 'crater')).toBe(false);
    const end = section3d(s, s.duration, s.duration).plates[0];
    expect(end.throughHole).toBe(true);
    const wall = end.surfaces.find((x) => x.kind === 'crater')!.points;
    expect(wall[0].x).toBeCloseTo(end.frontX, 9);
    expect(wall[wall.length - 1].x).toBeCloseTo(end.rearX, 9);
    expect(wall[wall.length - 1].r).toBeGreaterThan(0);
    expect(Math.abs(area(end.outline))).toBeLessThan(Math.abs(area(start.outline)));
  });

  it('a stopped round leaves a blind crater closed on the axis, and the plate glows with the energy it took', () => {
    const s = run('apfsds', [layer('rha', 300)], 40);
    expect(s.result.perforated).toBe(false);
    const end = section3d(s, s.duration, s.duration).plates[0];
    expect(end.throughHole).toBe(false);
    const wall = end.surfaces.find((x) => x.kind === 'crater')!.points;
    expect(wall[wall.length - 1].r).toBe(0);
    expect(wall[wall.length - 1].x).toBeLessThan(end.rearX);
    expect(end.heat).toBeGreaterThan(0.5);
    expect(section3d(s, 0, 0).plates[0].heat).toBe(0);
  });

  it('shows the plates, the gaps and the round where the 2D section does', () => {
    for (const [family, layers, cal, ob] of SHOTS) {
      const s = run(family, layers, cal, ob);
      const layout = stackLayout(s, 900, 500);
      for (const u of [0.1, 0.3, 0.5]) {
        const pb = playbackAt(s, u);
        const view = section3d(s, pb.t, pb.fragmentT);
        const parts = stackShapes(s, pb.t, pb.fragmentT, layout);
        const x0 = layout.stages[0].frontX;
        view.plates.forEach((plate, i) => {
          expect(plate.frontX).toBeCloseTo((layout.stages[i].frontX - x0) / layout.pxPerM, 9);
          expect(plate.rearX).toBeCloseTo((layout.stages[i].rearX - x0) / layout.pxPerM, 9);
        });
        const shown = parts.find((p) => !p.shapes.penetrator.hidden);
        if (shown && !view.penetrator.hidden) expect(view.penetrator.noseX).toBeCloseTo((shown.shapes.penetrator.noseX - x0) / layout.pxPerM, 6);
      }
    }
  });

  it('every plate fits above the floor, which is where the pieces land', () => {
    const s = run('ap-shot', [layer('rha', 40)], 88);
    const half = roomHalfHeight(s);
    const view = section3d(s, s.duration, s.duration);
    expect(view.radiusM).toBeCloseTo(PLATE_RADIUS_SHARE * half, 12);
    expect(view.floorY).toBeCloseTo(-half, 12);
    expect(view.room!.floorY).toBeCloseTo(view.floorY, 12);
  });

  it('thrown pieces start in the section plane, spread out of it as they fly, never sink through the floor, and play back the same every time', () => {
    let spread = false;
    for (const f of MUNITION_FAMILIES.filter((m) => m.id !== 'he-frag')) {
      const s = run(f.id, [layer('rha', 40)], 88);
      if (!s.fragments) continue;
      const end = playbackAt(s, 1);
      const a = section3d(s, end.t, end.fragmentT);
      const b = section3d(s, end.t, end.fragmentT);
      expect(a.fragments).toEqual(b.fragments);
      for (const p of a.fragments) {
        expect(p.y).toBeGreaterThanOrEqual(a.room!.floorY - 1e-9);
        expect(Number.isFinite(p.z)).toBe(true);
      }
      const first = Math.min(...s.fragments.tracks.map((tr) => tr.t0));
      const launched = section3d(s, s.duration, first).fragments;
      expect(launched.length).toBeGreaterThan(0);
      for (const p of launched) expect(Math.abs(p.z)).toBe(0);
      spread = spread || a.fragments.some((p) => p.z !== 0);
    }
    expect(spread).toBe(true);
  });
});
