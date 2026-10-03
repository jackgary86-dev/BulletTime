import { describe, expect, it } from 'vitest';
import {
  BREAKOUT_RATIO,
  CRATER_RADIUS_RATIO,
  LONG_ROD_MAX_OBLIQUITY_DEG,
  ROD_CONSUMED_RATIO,
  TATE_STEP_S,
  hydrodynamicLimit,
  interfaceSpeed,
  longRodShot,
  tatePenetration,
  tateRegime,
  type TateRod,
  type TateTarget,
} from './longRod';
import { PLATE_MATERIALS, getPlateMaterial, type PlateMaterialId } from './materials';
import { CRATER_PROFILE_SAMPLES, MAX_TIMELINE_FRAMES, TIMELINE_FRAMES, losThickness, type ArmorTimeline } from './model';
import { PENETRATOR_YIELD, impactState, type SolidImpact } from './munitions';

const rodOf = (calibreMm: number, velocity: number) => impactState('apfsds', calibreMm, velocity) as SolidImpact;
const tateRodOf = (calibreMm: number, velocity: number): TateRod => {
  const r = rodOf(calibreMm, velocity);
  return { density: r.density, yieldPa: PENETRATOR_YIELD[r.material], length: r.length, diameter: r.diameter, velocity: r.velocity };
};
const run = (calibreMm: number, velocity: number, thicknessMm: number, obliquityDeg = 0, plate: PlateMaterialId = 'rha') =>
  longRodShot({ impact: rodOf(calibreMm, velocity), material: getPlateMaterial(plate), thicknessM: thicknessMm / 1000, obliquityDeg });
/** Depth into a semi-infinite block, m. */
const thickDepth = (calibreMm: number, velocity: number, plate: PlateMaterialId = 'rha') =>
  tatePenetration(tateRodOf(calibreMm, velocity), getPlateMaterial(plate), Infinity).penetrationM;
const event = (tl: ArmorTimeline, type: string) => tl.events.find((e) => e.type === type);

/** The 120 mm-class reference rod: 27 mm × 702 mm tungsten alloy, 17,600 kg/m³, Yp 1.5 GPa. */
const D = 0.027;
const L0 = 0.702;
const RHO_P = 17600;
const YP = 1.5e9;
const ROD_AREA = Math.PI * (D / 2) ** 2;
const rodMass = (length: number) => RHO_P * ROD_AREA * length;

/** Expected thick-plate depths at 1,650 m/s, m (the Tate equations integrated independently). */
const EXPECTED_1650: Record<PlateMaterialId, number> = { rha: 0.607, 'cast-iron': 0.797, 'mild-steel': 0.864, copper: 0.914, 'al-5083': 1.615 };

/** The textbook closed form of the interface speed for ρp ≠ ρt: u = (v − μ√(v² + A)) / (1 − μ²), μ = √(ρt/ρp), A = 2(Rt − Yp)(1 − μ²)/ρt. */
const textbookU = (rp: number, Yp: number, rt: number, Rt: number, v: number) => {
  const mu = Math.sqrt(rt / rp);
  const A = (2 * (Rt - Yp) * (1 - mu * mu)) / rt;
  return (v - mu * Math.sqrt(v * v + A)) / (1 - mu * mu);
};

describe('interface speed and regimes', () => {
  it('solves the Alekseevskii–Tate pressure balance with the physical root, 0 < u < v', () => {
    for (const plate of PLATE_MATERIALS) {
      for (const v of [800, 1400, 1650, 1800]) {
        const rod = { density: RHO_P, yieldPa: YP };
        const u = interfaceSpeed(rod, plate, v);
        expect(u).toBeGreaterThan(0);
        expect(u).toBeLessThan(v);
        const lhs = 0.5 * RHO_P * (v - u) ** 2 + YP;
        const rhs = 0.5 * plate.density * u ** 2 + plate.targetResistancePa;
        expect(Math.abs(lhs - rhs) / rhs).toBeLessThan(1e-9);
        expect(u).toBeCloseTo(textbookU(RHO_P, YP, plate.density, plate.targetResistancePa, v), 6);
      }
    }
    // A known value: 1,650 m/s into RHA.
    expect(interfaceSpeed({ density: RHO_P, yieldPa: YP }, getPlateMaterial('rha'), 1650)).toBeCloseTo(792.8, 1);
  });

  it('handles equal densities with the linear form, and a rod lighter than the plate', () => {
    const target: TateTarget = { density: 7850, targetResistancePa: 3e9 };
    const v = 1500;
    const u = interfaceSpeed({ density: 7850, yieldPa: 1e9 }, target, v);
    // ½ρ(v − u)² + Yp = ½ρu² + Rt  ⇒  u = v/2 − (Rt − Yp)/(ρv).
    expect(u).toBeCloseTo(v / 2 - 2e9 / (7850 * v), 9);
    // Steel rod into copper (ρp < ρt): still the root between 0 and v.
    const copper = getPlateMaterial('copper');
    const uc = interfaceSpeed({ density: 7850, yieldPa: 1.2e9 }, copper, v);
    expect(uc).toBeGreaterThan(0);
    expect(uc).toBeLessThan(v);
    expect(uc).toBeCloseTo(textbookU(7850, 1.2e9, copper.density, copper.targetResistancePa, v), 6);
  });

  it('switches to a rigid rod exactly when Yp − Rt > ½ρt·v², and to no penetration exactly when ½ρp·v² < Rt − Yp', () => {
    const target: TateTarget = { density: 2660, targetResistancePa: 1.8e9 };
    const v = 300;
    const rigidYp = target.targetResistancePa + 0.5 * target.density * v * v;
    expect(tateRegime({ density: 7850, yieldPa: rigidYp * 1.001 }, target, v)).toBe('rigid');
    expect(tateRegime({ density: 7850, yieldPa: rigidYp * 0.999 }, target, v)).toBe('hydrodynamic');
    expect(interfaceSpeed({ density: 7850, yieldPa: rigidYp * 1.001 }, target, v)).toBe(v);
    // Approaching the threshold from below, u approaches v continuously.
    expect(interfaceSpeed({ density: 7850, yieldPa: rigidYp * 0.99999 }, target, v)).toBeCloseTo(v, 0);

    const rha = getPlateMaterial('rha');
    const vc = Math.sqrt((2 * (rha.targetResistancePa - YP)) / RHO_P);
    expect(vc).toBeCloseTo(674.2, 0);
    expect(tateRegime({ density: RHO_P, yieldPa: YP }, rha, vc * 0.999)).toBe('no-penetration');
    expect(tateRegime({ density: RHO_P, yieldPa: YP }, rha, vc * 1.001)).toBe('hydrodynamic');
    expect(interfaceSpeed({ density: RHO_P, yieldPa: YP }, rha, vc * 0.999)).toBe(0);
    expect(interfaceSpeed({ density: RHO_P, yieldPa: YP }, rha, vc * 1.0001)).toBeLessThan(5);
  });
});

describe('hydrodynamic limit', () => {
  it('is L·√(ρp/ρt)', () => {
    expect(hydrodynamicLimit(L0, RHO_P, 7850)).toBeCloseTo(L0 * Math.sqrt(RHO_P / 7850), 12);
    expect(hydrodynamicLimit(L0, RHO_P, 7850)).toBeCloseTo(1.051, 3);
  });

  it('is never reached: calibres 40–150, 1,400–1,800 m/s, every plate, thick plates', () => {
    for (const cal of [40, 57, 76, 88, 105, 120, 150]) {
      for (const v of [1400, 1500, 1600, 1700, 1800]) {
        for (const plate of PLATE_MATERIALS) {
          const tp = tatePenetration(tateRodOf(cal, v), plate, Infinity);
          expect(tp.penetrationM).toBeGreaterThan(0);
          expect(tp.penetrationM).toBeLessThan(tp.hydrodynamicLimitM);
          expect(tp.hydrodynamicLimitM).toBeCloseTo(hydrodynamicLimit(rodOf(cal, v).length, RHO_P, plate.density), 12);
        }
      }
    }
  });

  it('with the plate weaker than the rod (Rt < Yp) the model would overshoot it, which is why Al 5083 has Rt = 1.8 GPa', () => {
    const al = getPlateMaterial('al-5083');
    expect(al.targetResistancePa).toBe(1.8e9);
    const weak = tatePenetration(tateRodOf(120, 1650), { density: al.density, targetResistancePa: 1.3e9 }, Infinity);
    expect(weak.penetrationM).toBeGreaterThan(weak.hydrodynamicLimitM);
  });
});

describe('120 mm-class rod', () => {
  it('is 27 × 702 mm of 17,600 kg/m³ tungsten alloy with Yp 1.5 GPa', () => {
    const r = rodOf(120, 1650);
    expect(r.diameter).toBeCloseTo(D, 12);
    expect(r.length).toBeCloseTo(L0, 12);
    expect(r.density).toBe(RHO_P);
    expect(PENETRATOR_YIELD[r.material]).toBe(YP);
  });

  it('gets 550–750 mm into RHA at 1,650 m/s (about 607 mm)', () => {
    const tl = run(120, 1650, 2000);
    expect(tl.result.perforated).toBe(false);
    expect(tl.result.penetrationM).toBeGreaterThan(0.55);
    expect(tl.result.penetrationM).toBeLessThan(0.75);
    expect(tl.result.penetrationM).toBeCloseTo(0.607, 3);
    expect(tl.result.mechanism).toBe('Hydrodynamic erosion');
  });

  it('lands on the expected depths in every plate within 0.5%', () => {
    for (const plate of PLATE_MATERIALS) {
      const p = thickDepth(120, 1650, plate.id);
      expect(Math.abs(p / EXPECTED_1650[plate.id] - 1)).toBeLessThan(0.005);
    }
    expect(Math.abs(thickDepth(120, 1400) / 0.482 - 1)).toBeLessThan(0.005);
    expect(Math.abs(thickDepth(120, 1800) / 0.665 - 1)).toBeLessThan(0.005);
  });
});

describe('plate strength and velocity', () => {
  it('falls with target strength: RHA < cast iron < mild steel < copper < Al 5083', () => {
    const order: PlateMaterialId[] = ['rha', 'cast-iron', 'mild-steel', 'copper', 'al-5083'];
    for (const [cal, v] of [
      [120, 1650],
      [40, 1400],
      [150, 1800],
    ]) {
      const depths = order.map((id) => run(cal, v, 3000, 0, id).result.penetrationM);
      for (let i = 1; i < depths.length; i++) expect(depths[i]).toBeGreaterThan(depths[i - 1]);
    }
  });

  it('a stronger plate of the same density stops the rod sooner (Rt is used)', () => {
    const rod = tateRodOf(120, 1650);
    const p = (Rt: number) => tatePenetration(rod, { density: 7850, targetResistancePa: Rt }, Infinity).penetrationM;
    expect(p(4e9)).toBeGreaterThan(p(5.5e9));
    expect(p(5.5e9)).toBeGreaterThan(p(7e9));
  });

  it('rises with velocity and saturates towards the hydrodynamic limit', () => {
    for (const plate of PLATE_MATERIALS) {
      let previous = 0;
      for (let v = 1400; v <= 1800; v += 50) {
        const tp = tatePenetration(tateRodOf(120, v), plate, Infinity);
        const ratio = tp.penetrationM / tp.hydrodynamicLimitM;
        expect(ratio).toBeGreaterThan(previous);
        expect(ratio).toBeLessThan(1);
        previous = ratio;
      }
    }
    // A long way above the family's range the ratio keeps climbing towards 1.
    const fast = tatePenetration({ ...tateRodOf(120, 1650), velocity: 6000 }, getPlateMaterial('rha'), Infinity);
    expect(fast.penetrationM / fast.hydrodynamicLimitM).toBeGreaterThan(0.85);
    expect(fast.penetrationM / fast.hydrodynamicLimitM).toBeLessThan(1);
  });
});

describe('special cases', () => {
  const rigidRod: TateRod = { density: 7850, yieldPa: 4e9, length: 0.1, diameter: 0.01, velocity: 300 };
  const al: TateTarget = getPlateMaterial('al-5083');

  it('a strong, slow rod into soft plate digs as a rigid body: u = v, no erosion, P = (ρp·L/ρt)·ln(1 + ρt·v²/(2·Rt))', () => {
    const tp = tatePenetration(rigidRod, al, Infinity);
    expect(tp.impactRegime).toBe('rigid');
    expect(tp.outcome).toBe('stopped');
    expect(tp.residualLengthM).toBe(0.1);
    expect(tp.erodedRodJ).toBe(0);
    for (const s of tp.samples) {
      expect(s.length).toBe(0.1);
      expect(s.interfaceSpeed).toBe(s.velocity);
    }
    const analytic = ((7850 * 0.1) / al.density) * Math.log(1 + (al.density * 300 ** 2) / (2 * al.targetResistancePa));
    expect(analytic).toBeCloseTo(0.019, 3);
    expect(Math.abs(tp.penetrationM / analytic - 1)).toBeLessThan(0.02);
    expect(tp.regimePenetrationM.rigid).toBeCloseTo(tp.penetrationM, 12);
    // Faster, where the ½ρt·v² inertia term matters as much as Rt, the same law holds to 1%.
    const fast = tatePenetration({ ...rigidRod, velocity: 1000 }, al, Infinity);
    expect(fast.impactRegime).toBe('rigid');
    const fastAnalytic = ((7850 * 0.1) / al.density) * Math.log(1 + (al.density * 1000 ** 2) / (2 * al.targetResistancePa));
    expect(Math.abs(fast.penetrationM / fastAnalytic - 1)).toBeLessThan(0.01);
    expect(fast.residualLengthM).toBe(0.1);
  });

  it('just under the rigid threshold the same rod erodes', () => {
    const yp = al.targetResistancePa + 0.5 * al.density * 300 ** 2;
    const tp = tatePenetration({ ...rigidRod, yieldPa: yp * 0.99 }, al, Infinity);
    expect(tp.impactRegime).toBe('hydrodynamic');
    expect(tp.residualLengthM).toBeLessThan(0.1);
    expect(tp.erodedRodJ).toBeGreaterThan(0);
  });

  it('a weak rod against a very strong plate does not dig: P = 0 and the rod is consumed at the face', () => {
    const weak: TateRod = { density: RHO_P, yieldPa: 0.05e9, length: 0.2, diameter: 0.01, velocity: 500 };
    const tp = tatePenetration(weak, getPlateMaterial('rha'), Infinity);
    expect(tp.impactRegime).toBe('no-penetration');
    expect(tp.penetrationM).toBe(0);
    expect(tp.outcome).toBe('rod-consumed');
    expect(tp.residualLengthM).toBeLessThanOrEqual(ROD_CONSUMED_RATIO * 0.01);
    for (const s of tp.samples) {
      expect(s.penetration).toBe(0);
      expect(s.interfaceSpeed).toBe(0);
    }
    // Eroding against the face: v² = v0² + (2Yp/ρp)·ln(L/L0) while it lasts.
    const mid = tp.samples[Math.floor(tp.samples.length / 2)];
    expect(mid.velocity ** 2).toBeCloseTo(500 ** 2 + ((2 * 0.05e9) / RHO_P) * Math.log(mid.length / 0.2), -1);
  });

  it('a real rod far below its family’s speed stalls at the face of RHA with a stub left', () => {
    const slow = { ...rodOf(120, 1650), velocity: 500 };
    const tl = longRodShot({ impact: slow, material: getPlateMaterial('rha'), thicknessM: 0.3, obliquityDeg: 0 });
    expect(tl.result.mechanism).toBe('No penetration (rod erodes at the face)');
    expect(tl.result.penetrationM).toBe(0);
    expect(tl.result.perforated).toBe(false);
    expect(tl.events[1]).toMatchObject({ t: 0, type: 'no-penetration', label: 'Rod erodes at the face without digging' });
    const stop = event(tl, 'stop')!;
    expect(stop.speed).toBe(0);
    // The rod stops when v² = v0² + (2Yp/ρp)·ln(L/L0) reaches 0: L = L0·exp(−ρp·v0²/(2Yp)).
    const stub = L0 * Math.exp(-(RHO_P * 500 ** 2) / (2 * YP));
    expect(tl.frames[tl.frames.length - 1].penetratorLength).toBeCloseTo(stub, 3);
  });

  it('in RHA the rod erodes until the crater stops deepening, then is used up', () => {
    const tl = run(120, 1650, 2000);
    const stalled = event(tl, 'no-penetration')!;
    expect(stalled.label).toBe('Crater stops deepening; the rod erodes against its floor');
    expect(stalled.speed).toBeLessThan(Math.sqrt((2 * (5.5e9 - YP)) / RHO_P));
    expect(event(tl, 'rod-consumed')).toBeDefined();
    expect(event(tl, 'rod-consumed')!.label).toBe('Rod consumed');
    expect(tl.frames[tl.frames.length - 1].penetratorLength).toBeLessThan(ROD_CONSUMED_RATIO * D);
  });
});

describe('perforation and breakout', () => {
  it('120 mm at 1,650 m/s perforates 300 mm RHA: the rear face breaks out one rod diameter early', () => {
    const tl = run(120, 1650, 300);
    const r = tl.result;
    expect(r.perforated).toBe(true);
    expect(r.mechanism).toBe('Hydrodynamic erosion');
    expect(r.penetrationM).toBeCloseTo(0.3, 12);
    const breakout = event(tl, 'breakout')!;
    expect(breakout.label).toBe('Rear face breaks out');
    expect(breakout.depth).toBeCloseTo(0.3 - D, 9);

    // The disc: one rod diameter thick, as wide as the crater (2 D), flying at the residual velocity.
    const disc = r.plug!;
    expect(disc.thicknessM).toBeCloseTo(0.027, 9);
    expect(disc.diameterM).toBeCloseTo(0.054, 12);
    expect(disc.massKg).toBeCloseTo(7850 * Math.PI * 0.027 ** 2 * 0.027, 9);
    expect(disc.velocity).toBe(r.residualVelocity);

    // The rod pushes it out and they share momentum.
    const residualLength = tl.frames[tl.frames.length - 1].penetratorLength;
    expect(residualLength).toBeGreaterThan(0.2);
    expect(residualLength).toBeLessThan(L0);
    expect(r.residualMassKg).toBeCloseTo(rodMass(residualLength), 12);
    expect(rodMass(residualLength) * breakout.speed).toBeCloseTo((rodMass(residualLength) + disc.massKg) * r.residualVelocity, 6);
    expect(r.residualVelocity).toBeGreaterThan(1300);
    expect(r.residualVelocity).toBeLessThan(1650);
    expect(r.residualEnergyJ).toBeCloseTo(0.5 * r.residualMassKg * r.residualVelocity ** 2, 6);

    const exit = event(tl, 'perforate')!;
    expect(exit.label).toBe('Rod exits behind the plate');
    expect(exit.depth).toBeCloseTo(0.3, 12);
    expect(exit.speed).toBe(r.residualVelocity);
    expect(exit.t).toBeCloseTo(breakout.t + 0.027 / r.residualVelocity, 12);
    expect(event(tl, 'rod-consumed')).toBeUndefined();
    expect(event(tl, 'stop')).toBeUndefined();
  });

  it('perforates exactly when the crater would get within one rod diameter of the rear face', () => {
    const P = thickDepth(120, 1650);
    expect(run(120, 1650, (P + D) * 1000 - 0.5).result.perforated).toBe(true);
    expect(run(120, 1650, (P + D) * 1000 + 0.5).result.perforated).toBe(false);
  });

  it('a plate thinner than one rod diameter breaks out at impact', () => {
    const tl = run(120, 1650, 20);
    const breakout = event(tl, 'breakout')!;
    expect(breakout.t).toBe(0);
    expect(breakout.speed).toBe(1650);
    expect(tl.result.plug!.thicknessM).toBeCloseTo(0.02, 12);
    expect(tl.frames[tl.frames.length - 1].penetratorLength).toBeCloseTo(L0, 12);
  });

  it('after breakout rod and disc move on at the residual velocity, then fly on behind the plate through a hole 2 D wide', () => {
    const tl = run(120, 1650, 300);
    const breakout = event(tl, 'breakout')!;
    const exit = event(tl, 'perforate')!;
    const vr = tl.result.residualVelocity;
    const after = tl.frames.filter((f) => f.t > exit.t);
    expect(after.length).toBeGreaterThan(5);
    for (const f of after) {
      expect(f.depth).toBeCloseTo(0.3, 12);
      expect(f.travel).toBeCloseTo(breakout.depth + vr * (f.t - breakout.t), 9);
      expect(f.speed).toBe(vr);
      expect(f.penetrationRate).toBe(0);
      expect(f.craterRadius).toBeCloseTo(0.027, 12);
      expect(f.craterProfile!.every((x) => Math.abs(x - 0.027) < 1e-12)).toBe(true);
    }
  });

  it('measures the line-of-sight thickness through the slope and clamps the slope to 75°', () => {
    expect(LONG_ROD_MAX_OBLIQUITY_DEG).toBe(75);
    // 320 mm square-on is perforated; at 60° it is 640 mm along the shot line and stops the rod.
    expect(run(120, 1650, 320).result.perforated).toBe(true);
    const sloped = run(120, 1650, 320, 60);
    expect(sloped.result.losThicknessM).toBeCloseTo(losThickness(0.32, 60), 12);
    expect(sloped.result.perforated).toBe(false);
    expect(sloped.result.penetrationM).toBeCloseTo(thickDepth(120, 1650), 9);
    const steep = run(120, 1650, 100, 85);
    expect(steep.shot.obliquityDeg).toBe(75);
    expect(steep.result.losThicknessM).toBeCloseTo(losThickness(0.1, 75), 12);
  });
});

describe('crater and rear face', () => {
  it('the crater is twice the rod diameter wide, with a round bottom', () => {
    expect(CRATER_RADIUS_RATIO).toBe(1);
    const tl = run(120, 1650, 2000);
    const R = 0.027;
    const last = tl.frames[tl.frames.length - 1];
    expect(last.craterRadius).toBeCloseTo(R, 12);
    for (const f of tl.frames) {
      const profile = f.craterProfile!;
      expect(profile).toHaveLength(CRATER_PROFILE_SAMPLES);
      expect(profile[0]).toBeCloseTo(f.craterRadius, 12);
      expect(profile[profile.length - 1]).toBe(0);
      for (let i = 1; i < profile.length; i++) expect(profile[i]).toBeLessThanOrEqual(profile[i - 1]);
    }
    const early = tl.frames.filter((f) => f.depth > 0 && f.depth < R);
    for (const f of early) expect(f.craterRadius).toBeCloseTo(Math.sqrt(f.depth * (2 * R - f.depth)), 12);
    expect(last.craterProfile![1]).toBeCloseTo(R, 12);
    // Part-way in, the profile sample just above the bottom sits on the round nose.
    const mid = tl.frames.find((f) => f.depth > 0.1 && f.depth < 0.3)!;
    const s = mid.depth / (CRATER_PROFILE_SAMPLES - 1);
    expect(s).toBeLessThan(R);
    expect(mid.craterProfile![CRATER_PROFILE_SAMPLES - 2]).toBeCloseTo(Math.sqrt(s * (2 * R - s)), 12);
    expect(mid.craterProfile![1]).toBeCloseTo(R, 12);
  });

  it('bulges the rear face once less than 1.5 rod diameters are left, and freezes it at breakout', () => {
    expect(BREAKOUT_RATIO).toBe(1);
    const P = thickDepth(120, 1650);
    // Stopped 30 mm short of the rear face.
    const stopped = run(120, 1650, (P + 0.03) * 1000);
    expect(stopped.result.perforated).toBe(false);
    expect(stopped.frames[0].rearBulge).toBe(0);
    expect(stopped.frames[stopped.frames.length - 1].rearBulge).toBeCloseTo(0.25 * (1.5 * D - 0.03), 6);
    expect(run(120, 1650, 2000).frames.every((f) => f.rearBulge === 0)).toBe(true);
    const through = run(120, 1650, 300);
    const tb = event(through, 'breakout')!.t;
    for (const f of through.frames.filter((x) => x.t >= tb)) expect(f.rearBulge).toBeCloseTo(0.25 * 0.5 * D, 12);
  });
});

describe('energy', () => {
  const closes = (tl: ArmorTimeline) => {
    const r = tl.result;
    const { plateWorkJ, ejectaJ, erodedRodJ } = r.energy;
    expect(plateWorkJ).toBeGreaterThanOrEqual(0);
    expect(ejectaJ).toBeGreaterThanOrEqual(0);
    expect(erodedRodJ!).toBeGreaterThanOrEqual(0);
    const total = plateWorkJ + ejectaJ + erodedRodJ! + r.residualEnergyJ;
    expect(Math.abs(total / r.impactEnergyJ - 1)).toBeLessThan(1e-6);
    expect(tl.frames[tl.frames.length - 1].energyDepositedJ).toBe(plateWorkJ);
  };

  it('impact energy is ½·m·v0² of the whole rod', () => {
    expect(run(120, 1650, 300).result.impactEnergyJ).toBeCloseTo(0.5 * rodMass(L0) * 1650 ** 2, 3);
  });

  it('plate work, eroded rod material, breakout disc and residual rod add up to the impact energy', () => {
    for (const tl of [run(120, 1650, 2000), run(120, 1650, 300), run(120, 1650, 20), run(40, 1400, 100, 60, 'copper'), run(150, 1800, 3000, 0, 'al-5083')]) closes(tl);
    const thick = run(120, 1650, 2000).result;
    expect(thick.energy.ejectaJ).toBe(0);
    expect(thick.residualEnergyJ).toBe(0);
    // Most of a long rod's energy leaves with the material eroded off its head.
    expect(thick.energy.erodedRodJ!).toBeGreaterThan(thick.energy.plateWorkJ);
    const thin = run(120, 1650, 300).result;
    expect(thin.energy.ejectaJ).toBeCloseTo(0.5 * thin.plug!.massKg * thin.residualVelocity ** 2, 6);
  });

  it('closes for the rigid and no-penetration special cases too', () => {
    const check = (rod: TateRod, target: TateTarget) => {
      const tp = tatePenetration(rod, target, Infinity);
      const impact = 0.5 * rod.density * Math.PI * (rod.diameter / 2) ** 2 * rod.length * rod.velocity ** 2;
      const residual = 0.5 * rod.density * Math.PI * (rod.diameter / 2) ** 2 * tp.residualLengthM * tp.residualVelocity ** 2;
      expect(Math.abs((tp.plateWorkJ + tp.erodedRodJ + residual) / impact - 1)).toBeLessThan(1e-6);
    };
    check({ density: 7850, yieldPa: 4e9, length: 0.1, diameter: 0.01, velocity: 300 }, getPlateMaterial('al-5083'));
    check({ density: RHO_P, yieldPa: 0.05e9, length: 0.2, diameter: 0.01, velocity: 500 }, getPlateMaterial('rha'));
  });
});

describe('integration and frames', () => {
  it('halving the step changes the depth by under 0.5%', () => {
    for (const plate of PLATE_MATERIALS) {
      for (const [cal, v] of [
        [120, 1650],
        [40, 1400],
      ]) {
        const coarse = tatePenetration(tateRodOf(cal, v), plate, Infinity, TATE_STEP_S).penetrationM;
        const fine = tatePenetration(tateRodOf(cal, v), plate, Infinity, TATE_STEP_S / 2).penetrationM;
        expect(Math.abs(coarse / fine - 1)).toBeLessThan(0.005);
      }
    }
  });

  it('frames are finite, evenly spaced, at least 120; depth never falls and the rod never grows', () => {
    for (const tl of [run(120, 1650, 2000), run(120, 1650, 300), run(40, 1400, 30, 70), run(150, 1800, 500, 30, 'copper'), run(120, 1650, 20)]) {
      expect(tl.frames.length).toBeGreaterThanOrEqual(120);
      expect(tl.frames.length).toBeLessThanOrEqual(MAX_TIMELINE_FRAMES);
      expect(tl.frames[0].t).toBe(0);
      expect(tl.frames[tl.frames.length - 1].t).toBeCloseTo(tl.duration, 15);
      const dt = tl.frames[1].t - tl.frames[0].t;
      for (let i = 0; i < tl.frames.length; i++) {
        const f = tl.frames[i];
        for (const value of Object.values(f).flat()) expect(Number.isFinite(value)).toBe(true);
        expect(f.depth).toBeLessThanOrEqual(tl.result.losThicknessM + 1e-12);
        expect(f.travel).toBeGreaterThanOrEqual(f.depth);
        expect(f.penetrationRate).toBeGreaterThanOrEqual(0);
        expect(f.penetrationRate).toBeLessThanOrEqual(f.speed);
        expect(f.energyDepositedJ).toBeLessThanOrEqual(tl.result.impactEnergyJ * (1 + 1e-12));
        if (i > 0) {
          const p = tl.frames[i - 1];
          expect(f.t - p.t).toBeCloseTo(dt, 15);
          expect(f.depth).toBeGreaterThanOrEqual(p.depth);
          expect(f.travel).toBeGreaterThanOrEqual(p.travel);
          expect(f.penetratorLength).toBeLessThanOrEqual(p.penetratorLength);
          expect(f.speed).toBeLessThanOrEqual(p.speed);
          expect(f.rearBulge).toBeGreaterThanOrEqual(p.rearBulge);
          expect(f.craterRadius).toBeGreaterThanOrEqual(p.craterRadius);
          expect(f.energyDepositedJ).toBeGreaterThanOrEqual(p.energyDepositedJ);
        }
      }
      expect(tl.frames[tl.frames.length - 1].depth).toBeCloseTo(tl.result.penetrationM, 12);
    }
  });

  it('while eroding, frames report the tail speed v, the interface speed u and the shrinking rod', () => {
    const tl = run(120, 1650, 2000);
    const first = tl.frames[0];
    expect(first.speed).toBe(1650);
    expect(first.penetrationRate).toBeCloseTo(interfaceSpeed({ density: RHO_P, yieldPa: YP }, getPlateMaterial('rha'), 1650), 9);
    expect(first.penetratorLength).toBe(L0);
    const mid = tl.frames[40];
    expect(mid.penetratorLength).toBeLessThan(L0);
    expect(mid.penetrationRate).toBeCloseTo(interfaceSpeed({ density: RHO_P, yieldPa: YP }, getPlateMaterial('rha'), mid.speed), -1);
    // The rod is used up at L0 − P·(v − u)/u on average: far more rod is eaten than crater dug in RHA.
    expect(L0 - mid.penetratorLength).toBeGreaterThan(mid.depth * 0.5);
  });

  it('keeps the standard frame count, runs on 20% (at least 30 µs) past the last event, and orders the events', () => {
    const tl = run(120, 1650, 2000);
    expect(tl.frames.length).toBe(TIMELINE_FRAMES);
    const last = tl.events[tl.events.length - 1];
    expect(tl.duration).toBeCloseTo(last.t + Math.max(0.2 * last.t, 30e-6), 15);
    expect(tl.events[0]).toMatchObject({ t: 0, type: 'impact', depth: 0, speed: 1650, label: 'Impact' });
    for (let i = 1; i < tl.events.length; i++) expect(tl.events[i].t).toBeGreaterThanOrEqual(tl.events[i - 1].t);
    expect(tl.result.shattered).toBe(false);
    expect(tl.result.fragments).toBe(0);
  });

  it('refuses projectiles other than APFSDS long rods', () => {
    const shot = { impact: impactState('ap-shot', 88), material: getPlateMaterial('rha'), thicknessM: 0.1, obliquityDeg: 0 };
    expect(() => longRodShot(shot)).toThrow(/APFSDS/);
  });
});
