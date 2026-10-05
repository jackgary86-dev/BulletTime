import { describe, expect, it } from 'vitest';
import { FRAGMENT_REBOUND_SHARE, fragmentStateAt } from './fragments';
import {
  blastDish,
  fragmentBallisticLimit,
  fragmentDiameter,
  fragmentHit,
  fragmentRhaPenetration,
  fragmentSpray,
  heFragShot,
  sprayHalfSpan,
} from './heFrag';
import { getPlateMaterial, type PlateMaterialId } from './materials';
import { frameAt, losThickness } from './model';
import { MAX_CALIBRE_MM, MIN_CALIBRE_MM, impactState, type FragmentImpact } from './munitions';
import { sectionLayout, sectionShapes } from './section';
import { simulateArmor } from './simulate';

const he = (calibreMm: number) => impactState('he-frag', calibreMm) as FragmentImpact;
const shoot = (calibreMm: number, material: PlateMaterialId, thicknessM: number, obliquityDeg = 0) =>
  simulateArmor({ impact: he(calibreMm), material: getPlateMaterial(material), thicknessM, obliquityDeg });
const CALIBRES = [MIN_CALIBRE_MM, 75, 105, 125, MAX_CALIBRE_MM];
const count = (pits: { outcome: string }[], outcome: string) => pits.filter((p) => p.outcome === outcome).length;

describe('HE fragmentation against plate (#170)', () => {
  it.each([0.05, 0.08, 0.12])('gets nothing through %s m of RHA at any calibre: the face is only pitted', (t) => {
    for (const cal of CALIBRES) {
      const { result } = shoot(cal, 'rha', t);
      expect(result.perforated, `${cal} mm`).toBe(false);
      expect(result.mechanism).toBe('Fragment pitting');
      expect(result.residualVelocity).toBe(0);
      expect(count(result.pits!, 'pit'), `${cal} mm`).toBeGreaterThan(result.pits!.length / 2);
      expect(result.penetrationM).toBeLessThan(t / 2);
      // The blast only rings armor: no dish.
      expect(result.blastDishM).toBe(0);
    }
  });

  it.each([0.006, 0.01])('holes %s m of mild steel with some fragments, and the rest pit it', (t) => {
    for (const cal of CALIBRES) {
      const { result } = shoot(cal, 'mild-steel', t);
      const through = count(result.pits!, 'perforate');
      expect(through, `${cal} mm`).toBeGreaterThan(0);
      expect(result.perforated).toBe(true);
      expect(result.mechanism).toBe('Fragment perforation');
      for (const p of result.pits!.filter((x) => x.outcome === 'perforate')) {
        expect(p.residualVelocity).toBeGreaterThan(0);
        expect(p.residualVelocity).toBeLessThan(p.velocity);
      }
    }
  });

  it('holes fewer fragments as the mild steel gets thicker', () => {
    const through = (t: number) => count(shoot(105, 'mild-steel', t).result.pits!, 'perforate');
    expect(through(0.006)).toBeGreaterThanOrEqual(through(0.01));
    expect(through(0.01)).toBeGreaterThan(through(0.015));
    expect(through(0.015)).toBeGreaterThan(through(0.04));
  });

  it('spreads the energy: no single fragment carries a tenth of the total, and each is far below what a solid shot would need', () => {
    const { result } = shoot(MAX_CALIBRE_MM, 'rha', 0.05);
    for (const p of result.pits!) expect(0.5 * p.massKg * p.velocity ** 2).toBeLessThan(result.impactEnergyJ / 10);
  });

  it('balances the energy: work in the plate plus what gets through is what arrived', () => {
    for (const [mat, t] of [['rha', 0.05], ['mild-steel', 0.01]] as const) {
      const { result } = shoot(105, mat, t);
      const arrived = result.pits!.reduce((e, p) => e + 0.5 * p.massKg * p.velocity ** 2, 0);
      expect(result.impactEnergyJ).toBeCloseTo(arrived, 6);
      expect(result.energy.plateWorkJ + result.energy.ejectaJ + result.residualEnergyJ).toBeCloseTo(result.impactEnergyJ, 6);
    }
  });

  it('sizes the spray from the munition inputs only: the count, mass and speed ranges', () => {
    const impact = he(120);
    const spray = fragmentSpray(impact, 0.05);
    expect(spray).toHaveLength(impact.fragments.count);
    for (const f of spray) {
      expect(f.massKg).toBeGreaterThanOrEqual(impact.fragments.mass[0] - 1e-12);
      expect(f.massKg).toBeLessThanOrEqual(impact.fragments.mass[1] + 1e-12);
      expect(f.velocity).toBeGreaterThanOrEqual(impact.fragments.velocity[0]);
      expect(f.velocity).toBeLessThanOrEqual(impact.fragments.velocity[1]);
      expect(Math.abs(f.yM)).toBeLessThanOrEqual(0.05);
      expect(f.diameterM).toBeCloseTo(fragmentDiameter(f.massKg), 12);
    }
    // Deterministic: the same shot throws the same spray.
    expect(fragmentSpray(impact, 0.05)).toEqual(spray);
  });

  it('a fragment at its ballistic limit just gets through, and one a little slower does not', () => {
    const material = getPlateMaterial('mild-steel');
    const f = { massKg: 0.005, diameterM: fragmentDiameter(0.005), yM: 0, velocity: 0 };
    const los = 0.008;
    const vbl = fragmentBallisticLimit(f, material, los);
    expect(fragmentRhaPenetration({ ...f, velocity: vbl }) / material.rhaThicknessFactor).toBeCloseTo(los, 9);
    expect(fragmentHit({ ...f, velocity: vbl * 1.02 }, material, los).outcome).toBe('perforate');
    expect(fragmentHit({ ...f, velocity: vbl * 0.98 }, material, los).outcome).not.toBe('perforate');
  });

  it('dishes thin plate with the blast and leaves armor flat', () => {
    expect(blastDish(he(105), getPlateMaterial('mild-steel'), 0.006)).toBeGreaterThan(0.001);
    expect(blastDish(he(MAX_CALIBRE_MM), getPlateMaterial('rha'), 0.05)).toBe(0);
    // Deeper on thinner and softer plate.
    expect(blastDish(he(105), getPlateMaterial('mild-steel'), 0.01)).toBeGreaterThan(blastDish(he(105), getPlateMaterial('mild-steel'), 0.015));
    expect(blastDish(he(105), getPlateMaterial('mild-steel'), 0.01)).toBeGreaterThan(blastDish(he(105), getPlateMaterial('rha'), 0.01));
  });

  it('starts with the first fragment at t = 0', () => {
    const tl = shoot(105, 'rha', 0.05);
    expect(Math.min(...tl.result.pits!.map((p) => p.t0))).toBe(0);
    expect(tl.events[0]).toMatchObject({ t: 0, type: 'impact' });
  });

  it('plays the pits in: each digs in after it arrives and ends at its final depth, and the elastic wave stays in the plate', () => {
    const tl = shoot(105, 'mild-steel', 0.015);
    const pits = tl.result.pits!;
    const end = tl.frames[tl.frames.length - 1];
    expect(end.pitDepths).toHaveLength(pits.length);
    pits.forEach((p, i) => expect(end.pitDepths![i]).toBeCloseTo(p.depthM, 12));
    for (let k = 1; k < tl.frames.length; k++) {
      const a = tl.frames[k - 1];
      const b = tl.frames[k];
      b.pitDepths!.forEach((d, i) => expect(d).toBeGreaterThanOrEqual(a.pitDepths![i] - 1e-15));
      expect(b.waveFrontM!).toBeLessThanOrEqual(tl.result.losThicknessM + 1e-12);
      expect(b.energyDepositedJ).toBeGreaterThanOrEqual(a.energyDepositedJ - 1e-9);
    }
    expect(end.energyDepositedJ).toBeCloseTo(tl.result.energy.plateWorkJ, 3);
    expect(frameAt(tl, tl.duration / 2).pitDepths).toHaveLength(pits.length);
  });

  it('throws the pitting fragments back off the face and the perforating ones on through; embedded ones stay put', () => {
    const tl = shoot(105, 'mild-steel', 0.015);
    const pits = tl.result.pits!;
    const tracks = tl.fragments!.tracks;
    const mid = tl.result.losThicknessM / 2;
    const front = tracks.filter((tr) => tr.segments[0].x < mid);
    const rear = tracks.filter((tr) => tr.segments[0].x > mid);
    const cut = pits.filter((p) => p.inSection);
    expect(front.length).toBe(count(cut, 'pit'));
    expect(rear.length).toBe(count(cut, 'perforate'));
    for (const tr of front) {
      expect(tr.segments[0].vx).toBeLessThan(0);
      const v = Math.hypot(tr.segments[0].vx, tr.segments[0].vy);
      expect(v).toBeLessThanOrEqual(FRAGMENT_REBOUND_SHARE * he(105).fragments.velocity[1] + 1e-9);
      // It never goes back into the plate.
      for (const t of [tr.t0, tr.t0 + 1e-3, tl.fragments!.restS]) expect(fragmentStateAt(tr, t).x).toBeLessThanOrEqual(1e-9);
    }
    for (const tr of rear) expect(tr.segments[0].vx).toBeGreaterThan(0);
  });

  it('draws one pit per fragment along the cut at the end, all on screen and none overlapping, and no crater on the axis', () => {
    for (const [mat, t] of [['rha', 0.05], ['mild-steel', 0.01]] as const) {
      const tl = shoot(MAX_CALIBRE_MM, mat, t);
      const layout = sectionLayout(tl, 900, 500);
      const shapes = sectionShapes(tl, tl.frames[tl.frames.length - 1], layout);
      expect(shapes.crater).toHaveLength(0);
      const cut = tl.result.pits!.filter((p) => p.inSection);
      expect(cut.length).toBeGreaterThanOrEqual(3);
      expect(shapes.pits).toHaveLength(cut.length);
      for (const a of cut) for (const b of cut) if (a !== b) expect(Math.abs(a.yM - b.yM)).toBeGreaterThanOrEqual(a.radiusM + b.radiusM);
      for (const pit of shapes.pits) for (const p of pit.outline) {
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(layout.height);
        expect(p.x).toBeGreaterThanOrEqual(layout.frontX - 1e-9);
      }
      expect(shapes.pits.filter((p) => p.through).length).toBe(count(cut, 'perforate'));
    }
  });

  it('keeps the spray within the face the section shows, at any slope', () => {
    for (const obliquityDeg of [0, 30, 60]) {
      const tl = heFragShot({ impact: he(105), material: getPlateMaterial('rha'), thicknessM: 0.05, obliquityDeg });
      const half = sprayHalfSpan(losThickness(0.05, tl.shot.obliquityDeg));
      for (const p of tl.result.pits!) expect(Math.abs(p.yM)).toBeLessThanOrEqual(half + 1e-12);
    }
  });
});
