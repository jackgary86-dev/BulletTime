import { describe, expect, it } from 'vitest';
import {
  BREAKOUT_RATIO,
  CRATER_DIAMETER_RATIO,
  LONG_ROD_MAX_OBLIQUITY_DEG,
  hydrodynamicLimit,
  longRodShot,
  rodIsRigid,
  tateInterfaceSpeed,
} from './longRod';
import { PLATE_MATERIALS, getPlateMaterial, type PlateMaterial, type PlateMaterialId } from './materials';
import { CRATER_PROFILE_SAMPLES, TIMELINE_FRAMES, losThickness, type ArmorTimeline } from './model';
import { PENETRATOR_YIELD, impactState, type SolidImpact } from './munitions';

const rod = (calibreMm: number, velocity?: number) => impactState('apfsds', calibreMm, velocity) as SolidImpact;
const shoot = (impact: SolidImpact, plate: PlateMaterial | PlateMaterialId, thicknessM: number, obliquityDeg = 0): ArmorTimeline =>
  longRodShot({ impact, material: typeof plate === 'string' ? getPlateMaterial(plate) : plate, thicknessM, obliquityDeg });
/** A plate far too thick to get through, so the result is the depth the rod reaches. */
const THICK = 5;
const depthInto = (impact: SolidImpact, plate: PlateMaterial | PlateMaterialId) => shoot(impact, plate, THICK).result.penetrationM;
const custom = (changes: Partial<PlateMaterial>): PlateMaterial => ({ ...getPlateMaterial('rha'), ...changes });

describe('Tate interface equation', () => {
  const rhoP = 17600;
  const rhoT = 7850;
  const yp = PENETRATOR_YIELD['tungsten-alloy'];
  const rt = getPlateMaterial('rha').targetResistancePa;

  it('satisfies the interface equation, half rho-p (v - u) squared plus Yp equals half rho-t u squared plus Rt', () => {
    for (const v of [1400, 1650, 1800, 2200]) {
      const u = tateInterfaceSpeed(v, rhoP, yp, rhoT, rt);
      const lhs = 0.5 * rhoP * (v - u) ** 2 + yp;
      const rhs = 0.5 * rhoT * u ** 2 + rt;
      expect(Math.abs(lhs - rhs) / rhs).toBeLessThan(1e-9);
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(v);
    }
  });

  it('reduces to the hydrodynamic u = v / (1 + sqrt(rho-t / rho-p)) with no strength', () => {
    const v = 1700;
    expect(tateInterfaceSpeed(v, rhoP, 0, rhoT, 0)).toBeCloseTo(v / (1 + Math.sqrt(rhoT / rhoP)), 6);
  });

  it('handles equal densities and matches the limit of nearly equal ones', () => {
    const v = 1500;
    const equal = tateInterfaceSpeed(v, 7850, 1e9, 7850, 3e9);
    expect(equal).toBeCloseTo(v / 2 - 2e9 / (7850 * v), 6);
    expect(tateInterfaceSpeed(v, 7850, 1e9, 7850.01, 3e9)).toBeCloseTo(equal, 2);
  });

  it('is zero once half rho-p v squared no longer beats Rt - Yp', () => {
    const vc = Math.sqrt((2 * (rt - yp)) / rhoP);
    expect(tateInterfaceSpeed(vc * 0.999, rhoP, yp, rhoT, rt)).toBe(0);
    expect(tateInterfaceSpeed(vc * 1.01, rhoP, yp, rhoT, rt)).toBeGreaterThan(0);
  });

  it('flags a rigid rod only when Yp - Rt exceeds half rho-t v squared', () => {
    expect(rodIsRigid(300, 1.5e9, 2660, 0.1e9)).toBe(true);
    expect(rodIsRigid(1650, 1.5e9, 2660, 0.1e9)).toBe(false);
    // A plate stronger than the rod can never leave it rigid.
    expect(rodIsRigid(10, 1.5e9, 7850, 5.5e9)).toBe(false);
  });
});

describe('long-rod penetration depth', () => {
  it('a 120 mm-class rod into thick RHA lands in the published 550-750 mm range', () => {
    const r = rod(120);
    expect(r.diameter * 1000).toBeCloseTo(27, 0);
    expect(r.length * 1000).toBeCloseTo(702, 0);
    const depth = depthInto(r, 'rha') * 1000;
    expect(depth).toBeGreaterThan(550);
    expect(depth).toBeLessThan(750);
  });

  it('stays below the hydrodynamic limit L * sqrt(rho-p / rho-t) over the calibre and speed range', () => {
    // Where the plate is stronger than the rod. A rod that outlasts a softer plate can slow to a rigid dig and go further.
    const plates = PLATE_MATERIALS.filter((p) => p.targetResistancePa >= PENETRATOR_YIELD['tungsten-alloy'] && p.id !== 'al-5083');
    expect(plates.length).toBeGreaterThanOrEqual(4);
    for (const cal of [40, 80, 120, 150]) {
      for (const v of [1400, 1650, 1800]) {
        for (const plate of plates) {
          const r = rod(cal, v);
          expect(depthInto(r, plate)).toBeLessThan(hydrodynamicLimit(r.length, r.density, plate.density));
        }
      }
    }
  });

  it('falls with target strength: RHA < cast iron < mild steel < copper < aluminium', () => {
    const r = rod(120);
    const depths = (['rha', 'cast-iron', 'mild-steel', 'copper', 'al-5083'] as PlateMaterialId[]).map((id) => depthInto(r, id));
    for (let i = 1; i < depths.length; i++) expect(depths[i]).toBeGreaterThan(depths[i - 1]);
  });

  it('grows with rod length and with speed', () => {
    expect(depthInto(rod(150), 'rha')).toBeGreaterThan(depthInto(rod(120), 'rha'));
    expect(depthInto(rod(120), 'rha')).toBeGreaterThan(depthInto(rod(80), 'rha'));
    expect(depthInto(rod(120, 1800), 'rha')).toBeGreaterThan(depthInto(rod(120, 1400), 'rha'));
  });

  it('erodes the rod as it digs, and stops it with length left when it is too slow to erode the plate', () => {
    const tl = shoot(rod(120), 'rha', THICK);
    const lengths = tl.frames.map((f) => f.penetratorLength);
    for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBeLessThanOrEqual(lengths[i - 1] + 1e-12);
    expect(lengths[0]).toBeCloseTo(rod(120).length, 9);
    expect(lengths[lengths.length - 1]).toBeLessThan(rod(120).length);
    expect(tl.result.perforated).toBe(false);
    expect(tl.events[tl.events.length - 1].type).toBe('stop');
  });
});

describe('special cases', () => {
  it('a rigid rod digs without eroding, to the depth the constant-length equation gives', () => {
    const impact = { ...rod(120, 1650), velocity: 300 };
    const soft = custom({ density: 2660, targetResistancePa: 0.1e9, name: 'soft test plate' });
    expect(rodIsRigid(impact.velocity, PENETRATOR_YIELD[impact.material], soft.density, soft.targetResistancePa)).toBe(true);
    const tl = shoot(impact, soft, THICK);
    // No erosion: the rod keeps its length.
    expect(tl.frames.every((f) => Math.abs(f.penetratorLength - impact.length) < 1e-9)).toBe(true);
    // Resistance half rho-t v squared plus Rt against rho-p * L: depth = (rho-p L / rho-t) ln(1 + rho-t v^2 / (2 Rt)).
    const expected = ((impact.density * impact.length) / soft.density) * Math.log(1 + (soft.density * impact.velocity ** 2) / (2 * soft.targetResistancePa));
    expect(tl.result.penetrationM / expected).toBeGreaterThan(0.98);
    expect(tl.result.penetrationM / expected).toBeLessThan(1.02);
    expect(tl.events[tl.events.length - 1].label).toMatch(/Rigid rod stops/);
  });

  it('does not penetrate at all when half rho-p v squared is below Rt - Yp, and leaves the rod whole', () => {
    const impact = rod(120, 1400);
    const hard = custom({ targetResistancePa: 2e10, name: 'very hard test plate' });
    expect(0.5 * impact.density * impact.velocity ** 2).toBeLessThan(hard.targetResistancePa - PENETRATOR_YIELD[impact.material]);
    const tl = shoot(impact, hard, 0.3);
    expect(tl.result.penetrationM).toBe(0);
    expect(tl.result.perforated).toBe(false);
    expect(tl.frames.every((f) => f.depth === 0 && f.penetratorLength === impact.length)).toBe(true);
    expect(tl.events[tl.events.length - 1].type).toBe('stop');
  });
});

describe('perforation', () => {
  const impact = rod(120);
  const through = shoot(impact, 'rha', 0.3);

  it('goes through a plate thinner than its depth and reports what is left of the rod', () => {
    const r = through.result;
    expect(r.perforated).toBe(true);
    expect(r.penetrationM).toBeCloseTo(0.3, 9);
    expect(r.residualVelocity).toBeGreaterThan(0);
    expect(r.residualVelocity).toBeLessThan(impact.velocity);
    // Residual mass is the surviving length of the rod.
    const length = r.residualMassKg / (impact.density * Math.PI * (impact.diameter / 2) ** 2);
    expect(length).toBeGreaterThan(0);
    expect(length).toBeLessThan(impact.length);
    const last = through.events[through.events.length - 1];
    expect(last.type).toBe('perforate');
    expect(last.depth).toBeCloseTo(0.3, 9);
  });

  it('is not perforated by a plate thicker than its depth', () => {
    expect(shoot(impact, 'rha', 0.7).result.perforated).toBe(false);
  });

  it('breaks out when the crater is within a rod diameter of the far face, and stops eroding from there', () => {
    const breakout = through.frames.find((f) => f.travel >= 0.3 - BREAKOUT_RATIO * impact.diameter - 1e-9);
    expect(breakout).toBeDefined();
    const after = through.frames.filter((f) => f.t >= (breakout?.t ?? Infinity));
    expect(after.length).toBeGreaterThan(1);
    expect(Math.max(...after.map((f) => f.penetratorLength)) - Math.min(...after.map((f) => f.penetratorLength))).toBeLessThan(0.01 * impact.length);
  });

  it('accounts for all the impact energy', () => {
    const r = through.result;
    expect(r.impactEnergyJ).toBeCloseTo(0.5 * impact.mass * impact.velocity ** 2, 3);
    expect(r.residualEnergyJ + r.energy.plateWorkJ + r.energy.ejectaJ).toBeCloseTo(r.impactEnergyJ, 3);
    const finalDeposited = through.frames[through.frames.length - 1].energyDepositedJ;
    expect(Math.abs(finalDeposited - r.energy.plateWorkJ) / r.impactEnergyJ).toBeLessThan(0.001);
  });

  it('a stopped rod leaves nothing behind the plate', () => {
    const r = shoot(impact, 'rha', 0.7).result;
    expect(r.residualVelocity).toBe(0);
    expect(r.residualMassKg).toBe(0);
    expect(r.residualEnergyJ).toBe(0);
  });
});

describe('timeline', () => {
  const impact = rod(120);
  const tl = shoot(impact, 'rha', 0.4);

  it('is a well-formed ArmorTimeline', () => {
    expect(tl.frames.length).toBeGreaterThanOrEqual(TIMELINE_FRAMES);
    expect(tl.frames[0].t).toBe(0);
    expect(tl.frames[tl.frames.length - 1].t).toBeCloseTo(tl.duration, 12);
    expect(tl.events[0].type).toBe('impact');
    expect(tl.result.mechanism).toBe('Hydrodynamic erosion');
    expect(tl.result.shattered).toBe(false);
    expect(tl.result.fragments).toBe(0);
  });

  it('digs steadily deeper and never beyond the plate', () => {
    for (let i = 1; i < tl.frames.length; i++) {
      expect(tl.frames[i].depth).toBeGreaterThanOrEqual(tl.frames[i - 1].depth - 1e-12);
      expect(tl.frames[i].energyDepositedJ).toBeGreaterThanOrEqual(tl.frames[i - 1].energyDepositedJ - 1);
    }
    for (const f of tl.frames) {
      expect(f.depth).toBeLessThanOrEqual(tl.result.losThicknessM + 1e-12);
      expect(f.speed).toBeGreaterThanOrEqual(0);
      expect(f.penetrationRate).toBeLessThanOrEqual(f.speed + 1e-9);
    }
  });

  it('makes a crater about twice the rod diameter, with a profile from the face to the nose', () => {
    const final = shoot(impact, 'rha', THICK).frames.at(-1)!;
    expect(final.craterRadius).toBeCloseTo((CRATER_DIAMETER_RATIO * impact.diameter) / 2, 4);
    expect(final.craterProfile).toHaveLength(CRATER_PROFILE_SAMPLES);
    expect(final.craterProfile![0]).toBeCloseTo(final.craterRadius, 9);
    expect(Math.min(...final.craterProfile!)).toBeGreaterThanOrEqual(impact.diameter / 2 - 1e-9);
  });

  it('starts with a crater as wide as the rod', () => {
    expect(tl.frames[0].craterRadius).toBeCloseTo(impact.diameter / 2, 9);
  });

  it('bulges the rear face as the rod nears it', () => {
    expect(tl.frames[0].rearBulge).toBe(0);
    expect(Math.max(...tl.frames.map((f) => f.rearBulge))).toBeGreaterThan(0);
  });
});

describe('slope and input checks', () => {
  const impact = rod(120);

  it('a sloped plate is a longer path', () => {
    const flat = shoot(impact, 'rha', 0.3);
    const sloped = shoot(impact, 'rha', 0.3, 65);
    expect(sloped.result.losThicknessM).toBeCloseTo(losThickness(0.3, 65), 9);
    expect(flat.result.perforated).toBe(true);
    expect(sloped.result.perforated).toBe(false);
  });

  it('clamps the slope to what it models', () => {
    expect(shoot(impact, 'rha', 0.3, 85).shot.obliquityDeg).toBe(LONG_ROD_MAX_OBLIQUITY_DEG);
  });

  it('only models long rods', () => {
    expect(() => longRodShot({ impact: impactState('ap-shot', 88), material: getPlateMaterial('rha'), thicknessM: 0.1, obliquityDeg: 0 })).toThrow(/long rods/);
  });

  it('rejects a plate with no thickness', () => {
    expect(() => shoot(impact, 'rha', 0)).toThrow(/thickness/i);
  });
});
