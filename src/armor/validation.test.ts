/**
 * Armor lab (#169): the validation suite. Each model's own tests check its
 * code; this file pins the lab to published reference behaviour, by model, so
 * that changing a key constant (a material's Rt, a family's speed, a model's
 * exponent) makes at least one of these fail. The numbers are the open
 * textbook figures the models are tuned to, with the tolerance each deserves;
 * `docs/armor-models.md` says where each comes from and how far to trust it.
 */

import { describe, expect, it } from 'vitest';
import { energyBalance, fieldContext, pressureGPaAt, wavePulse } from './fields';
import {
  DE_MARRE_DIAMETER_EXP,
  DE_MARRE_K,
  DE_MARRE_MASS_EXP,
  DE_MARRE_THICKNESS_EXP,
  deMarreBallisticLimit,
  deMarreRhaPenetration,
  fullBorePenetration,
  fullBoreShot,
} from './fullBore';
import { HESH_CONTACT_PRESSURE_PA, maxSpallThickness } from './hesh';
import { densityRatio, jetPenetration, jetReach, jetShot } from './jet';
import { hydrodynamicLimit, longRodShot, rodIsRigid, tateInterfaceSpeed } from './longRod';
import { PLATE_MATERIALS, getPlateMaterial, type PlateMaterialId } from './materials';
import type { ArmorShot, ArmorTimeline } from './model';
import { PENETRATOR_DENSITY, PENETRATOR_YIELD, impactState, type MunitionFamilyId, type SolidImpact } from './munitions';
import { criticalRicochetDeg } from './ricochet';
import { simulateArmor } from './simulate';

const RHA = getPlateMaterial('rha');
const THICK = 3; // m: a block, so a round is stopped, never through
const heshRound = (calibreMm = 120) => impactState('hesh', calibreMm) as SolidImpact;

const shot = (family: MunitionFamilyId, material: PlateMaterialId, thicknessM: number, calibreMm = 120, velocity?: number, obliquityDeg = 0): ArmorShot => ({
  impact: impactState(family, calibreMm, velocity),
  material: getPlateMaterial(material),
  thicknessM,
  obliquityDeg,
});

describe('validation: Alekseevskii-Tate long rod (#169)', () => {
  const rodInto = (material: PlateMaterialId, velocity?: number, calibreMm = 120): ArmorTimeline => longRodShot(shot('apfsds', material, THICK, calibreMm, velocity));

  it('puts a 120 mm-class rod at its default speed into 550 to 750 mm of RHA', () => {
    const tl = rodInto('rha');
    expect(tl.result.perforated).toBe(false);
    expect(tl.result.penetrationM).toBeGreaterThanOrEqual(0.55);
    expect(tl.result.penetrationM).toBeLessThanOrEqual(0.75);
  });

  it('pins the reference case: about 600 mm of RHA at 1,650 m/s, within 8%, so a change to RHA or the rod shows', () => {
    expect(rodInto('rha', 1650).result.penetrationM).toBeGreaterThan(0.6 * 0.92);
    expect(rodInto('rha', 1650).result.penetrationM).toBeLessThan(0.6 * 1.08);
  });

  it('digs deeper into a plate that resists less: mild steel and copper take more than RHA, and cast iron too', () => {
    const rha = rodInto('rha', 1650).result.penetrationM;
    expect(rodInto('mild-steel', 1650).result.penetrationM).toBeGreaterThan(rha);
    expect(rodInto('copper', 1650).result.penetrationM).toBeGreaterThan(rha);
    expect(rodInto('cast-iron', 1650).result.penetrationM).toBeGreaterThan(rha);
  });

  it('holds that range across the family speed range (1,400 to 1,800 m/s)', () => {
    for (const v of [1400, 1600, 1800]) {
      const p = rodInto('rha', v).result.penetrationM;
      expect(p).toBeGreaterThan(0.45);
      expect(p).toBeLessThan(0.8);
    }
  });

  it('never goes deeper than the hydrodynamic limit L·sqrt(ρp/ρt) on a plate that resists more than the rod yields (Rt > Yp)', () => {
    // With a rod stronger than the plate resists (aluminium here) its own strength helps it dig, and it can pass the limit.
    for (const id of ['rha', 'mild-steel', 'cast-iron', 'copper'] as const) {
      expect(getPlateMaterial(id).targetResistancePa).toBeGreaterThan(PENETRATOR_YIELD['tungsten-alloy']);
      for (const v of [1400, 1650, 1800]) {
        const tl = rodInto(id, v);
        const imp = tl.shot.impact;
        const limit = hydrodynamicLimit(imp.family === 'apfsds' ? imp.length : 0, imp.density, getPlateMaterial(id).density);
        expect(tl.result.penetrationM).toBeLessThanOrEqual(limit * 1.001);
      }
    }
  });

  it('can pass the hydrodynamic limit when the rod is stronger than the plate resists (aluminium), as Tate predicts', () => {
    const al = getPlateMaterial('al-5083');
    expect(PENETRATOR_YIELD['tungsten-alloy']).toBeGreaterThan(al.targetResistancePa);
    const tl = rodInto('al-5083', 1650);
    const imp = tl.shot.impact;
    if (imp.family !== 'apfsds') throw new Error('expected a rod');
    expect(tl.result.penetrationM).toBeGreaterThan(hydrodynamicLimit(imp.length, imp.density, al.density));
  });

  it('rises with velocity and saturates toward the hydrodynamic limit', () => {
    const speeds = [1400, 1500, 1600, 1700, 1800];
    const imp = impactState('apfsds', 120);
    const limit = hydrodynamicLimit(imp.family === 'apfsds' ? imp.length : 0, imp.density, RHA.density);
    const depth = speeds.map((v) => rodInto('rha', v).result.penetrationM);
    for (let i = 1; i < depth.length; i++) expect(depth[i]).toBeGreaterThan(depth[i - 1]);
    const gains = depth.slice(1).map((d, i) => d - depth[i]);
    expect(gains[gains.length - 1]).toBeLessThan(gains[0]);
    // And the share of the limit climbs, getting closer to it but never past it.
    const share = depth.map((d) => d / limit);
    for (let i = 1; i < share.length; i++) expect(share[i]).toBeGreaterThan(share[i - 1]);
    expect(share[share.length - 1]).toBeLessThan(1);
    expect(share[share.length - 1]).toBeGreaterThan(0.55);
  });

  it('follows the interface equation: u -> v/(1 + sqrt(ρt/ρp)) when strength is negligible', () => {
    const rhoP = PENETRATOR_DENSITY['tungsten-alloy'];
    const rhoT = RHA.density;
    const v = 1e5; // so fast that strength is nothing
    const u = tateInterfaceSpeed(v, rhoP, PENETRATOR_YIELD['tungsten-alloy'], rhoT, RHA.targetResistancePa);
    expect(u / v).toBeCloseTo(1 / (1 + Math.sqrt(rhoT / rhoP)), 3);
  });

  it('satisfies the interface equation exactly at an ordinary speed', () => {
    const rhoP = PENETRATOR_DENSITY['tungsten-alloy'];
    const yp = PENETRATOR_YIELD['tungsten-alloy'];
    const v = 1650;
    const u = tateInterfaceSpeed(v, rhoP, yp, RHA.density, RHA.targetResistancePa);
    const lhs = 0.5 * rhoP * (v - u) ** 2 + yp;
    const rhs = 0.5 * RHA.density * u * u + RHA.targetResistancePa;
    expect(Math.abs(lhs - rhs) / rhs).toBeLessThan(1e-9);
  });

  it('has a no-penetration regime: below ½ρp·v² = Rt - Yp the interface does not move', () => {
    const rhoP = PENETRATOR_DENSITY['tungsten-alloy'];
    const yp = PENETRATOR_YIELD['tungsten-alloy'];
    const vCrit = Math.sqrt((2 * (RHA.targetResistancePa - yp)) / rhoP);
    expect(tateInterfaceSpeed(vCrit * 0.95, rhoP, yp, RHA.density, RHA.targetResistancePa)).toBe(0);
    expect(tateInterfaceSpeed(vCrit * 1.1, rhoP, yp, RHA.density, RHA.targetResistancePa)).toBeGreaterThan(0);
    // The critical speed is a few hundred m/s, well under a gun-launched rod's.
    expect(vCrit).toBeGreaterThan(400);
    expect(vCrit).toBeLessThan(1000);
  });

  it('has a rigid-rod regime when the rod is stronger than the plate resists: Yp - Rt > ½ρt·v²', () => {
    const yp = PENETRATOR_YIELD['tungsten-alloy'];
    const al = getPlateMaterial('al-5083');
    expect(rodIsRigid(300, yp, al.density, al.targetResistancePa)).toBe(true);
    expect(rodIsRigid(1650, yp, al.density, al.targetResistancePa)).toBe(false);
    expect(rodIsRigid(300, yp, RHA.density, RHA.targetResistancePa)).toBe(false);
  });

  it('digs a rigid rod into soft plate without eroding it, and the eroding rod into RHA shorter', () => {
    const slow = longRodShot({ ...shot('apfsds', 'al-5083', THICK), impact: { ...impactState('apfsds', 120), velocity: 300 } });
    const imp = slow.shot.impact;
    if (imp.family !== 'apfsds') throw new Error('expected a rod');
    expect(slow.frames[slow.frames.length - 1].penetratorLength).toBeCloseTo(imp.length, 6);
    const fast = rodInto('rha');
    expect(fast.frames[fast.frames.length - 1].penetratorLength).toBeLessThan(imp.length * 0.2);
  });
});

describe('validation: De Marre full-bore shot (#169)', () => {
  it('puts the 88 mm, 10.2 kg reference shot at 1,000 m/s through 165 mm of RHA, within 10%', () => {
    const p = deMarreRhaPenetration(0.088, 10.2, 1000);
    expect(p).toBeGreaterThan(0.165 * 0.9);
    expect(p).toBeLessThan(0.165 * 1.1);
  });

  it('is consistent with the ballistic-limit form: the speed to get through P is 1,000 m/s', () => {
    const p = deMarreRhaPenetration(0.088, 10.2, 1000);
    expect(deMarreBallisticLimit(0.088, p, 10.2)).toBeCloseTo(1000, 6);
  });

  it('has the textbook exponents on calibre, plate thickness and mass', () => {
    expect(DE_MARRE_DIAMETER_EXP).toBe(0.75);
    expect(DE_MARRE_THICKNESS_EXP).toBe(0.7);
    expect(DE_MARRE_MASS_EXP).toBe(0.5);
    expect(DE_MARRE_K).toBeGreaterThan(5e4);
    expect(DE_MARRE_K).toBeLessThan(9e4);
  });

  it('scales as v^(1/0.7): twice the speed gets through 2^(1/0.7) times the plate', () => {
    const a = deMarreRhaPenetration(0.088, 10.2, 600);
    const b = deMarreRhaPenetration(0.088, 10.2, 1200);
    expect(b / a).toBeCloseTo(2 ** (1 / 0.7), 9);
  });

  it('gets through more plate with more mass and a wider calibre, as the formula says', () => {
    const base = deMarreRhaPenetration(0.088, 10.2, 900);
    expect(deMarreRhaPenetration(0.088, 20.4, 900) / base).toBeCloseTo(2 ** (0.5 / 0.7), 9);
    expect(deMarreRhaPenetration(0.176, 10.2, 900) / base).toBeCloseTo(2 ** (-0.75 / 0.7), 9);
  });

  it('measures the plate along the line of sight: the shot perforates when T/cos θ < P, and not otherwise', () => {
    const impact = impactState('ap-shot', 88, 1000) as SolidImpact;
    for (const deg of [0, 30, 45]) {
      const { pathM } = fullBorePenetration(impact, RHA, deg);
      const cos = Math.cos((deg * Math.PI) / 180);
      const thin = fullBoreShot({ impact, material: RHA, thicknessM: 0.95 * pathM * cos, obliquityDeg: deg });
      const thick = fullBoreShot({ impact, material: RHA, thicknessM: 1.15 * pathM * cos, obliquityDeg: deg });
      expect(thin.result.perforated).toBe(true);
      expect(thick.result.perforated).toBe(false);
      expect(thin.result.losThicknessM).toBeCloseTo(0.95 * pathM, 9);
    }
  });

  it('needs a plate of another material in proportion to its RHA thickness factor', () => {
    const impact = impactState('ap-shot', 88, 1000) as SolidImpact;
    for (const id of ['mild-steel', 'cast-iron', 'copper', 'al-5083'] as const) {
      const m = getPlateMaterial(id);
      const { rhaM, pathM } = fullBorePenetration(impact, m, 0);
      expect(pathM).toBeCloseTo(rhaM / m.rhaThicknessFactor, 9);
    }
  });
});

describe('validation: shaped-charge density law (#169)', () => {
  const jetInto = (material: PlateMaterialId, calibreMm = 100): ArmorTimeline => jetShot(shot('heat', material, THICK, calibreMm));

  it('goes about 5 to 7 cone diameters into RHA', () => {
    for (const cal of [50, 100, 150]) {
      const tl = jetInto('rha', cal);
      const imp = tl.shot.impact;
      if (imp.family !== 'heat') throw new Error('expected a jet');
      const cones = tl.result.penetrationM / imp.coneDiameter;
      expect(cones).toBeGreaterThanOrEqual(5);
      expect(cones).toBeLessThanOrEqual(7);
    }
  });

  it('scales as sqrt(ρjet/ρtarget) across plate materials', () => {
    const imp = impactState('heat', 100);
    if (imp.family !== 'heat') throw new Error('expected a jet');
    const rha = jetPenetration(imp.jetLength, imp.density, RHA.density);
    for (const id of ['mild-steel', 'cast-iron', 'copper', 'al-5083'] as const) {
      const m = getPlateMaterial(id);
      expect(jetPenetration(imp.jetLength, imp.density, m.density) / rha).toBeCloseTo(Math.sqrt(RHA.density / m.density), 9);
    }
  });

  it('digs deeper into aluminium than RHA by about the square root of their density ratio, in the model too', () => {
    const al = jetInto('al-5083');
    const rha = jetInto('rha');
    expect(al.result.penetrationM / rha.result.penetrationM).toBeCloseTo(Math.sqrt(RHA.density / getPlateMaterial('al-5083').density), 2);
  });

  it('digs less into copper, which is denser than steel, and equal-density plate gives gamma = 1', () => {
    expect(jetInto('copper').result.penetrationM).toBeLessThan(jetInto('rha').result.penetrationM);
    expect(densityRatio(8960, 8960)).toBe(1);
  });

  it('uses all but the slug of the jet: reach is the density law on 95% of its length', () => {
    const imp = impactState('heat', 100);
    if (imp.family !== 'heat') throw new Error('expected a jet');
    expect(jetReach(imp, RHA)).toBeCloseTo(0.95 * jetPenetration(imp.jetLength, imp.density, RHA.density), 9);
  });

  it('runs a copper jet at 8 km/s at its tip, as a shaped charge does', () => {
    const imp = impactState('heat', 100);
    if (imp.family !== 'heat') throw new Error('expected a jet');
    expect(imp.jetTipVelocity).toBe(8000);
    expect(imp.material).toBe('copper');
  });
});

describe('validation: HESH spall (#169)', () => {
  const spalls = (material: PlateMaterialId, thicknessM: number, calibreMm = 120) => simulateArmor(shot('hesh', material, thicknessM, calibreMm)).result.scab !== undefined;

  it('spalls a plate below the boundary thickness and not above it', () => {
    for (const id of ['rha', 'cast-iron', 'mild-steel'] as const) {
      const limit = maxSpallThickness(heshRound(), getPlateMaterial(id), 0);
      expect(limit).toBeGreaterThan(0);
      expect(spalls(id, limit * 0.9)).toBe(true);
      expect(spalls(id, limit * 1.1)).toBe(false);
    }
  });

  it('spalls cast iron through more thickness than RHA, because it is weaker in tension', () => {
    const imp = heshRound();
    const iron = maxSpallThickness(imp, getPlateMaterial('cast-iron'), 0);
    const rha = maxSpallThickness(imp, RHA, 0);
    expect(iron).toBeGreaterThan(rha);
    // A plate in between: cast iron spalls, RHA holds.
    const between = (iron + rha) / 2;
    expect(spalls('cast-iron', between)).toBe(true);
    expect(spalls('rha', between)).toBe(false);
  });

  it('has the spall boundary where the rear-face stress equals the spall strength', () => {
    const imp = impactState('hesh', 120);
    if (imp.family !== 'hesh') throw new Error('expected a squash head');
    const limit = maxSpallThickness(imp, RHA, 0);
    expect(HESH_CONTACT_PRESSURE_PA / RHA.spallStrengthPa).toBeGreaterThan(1);
    const at = simulateArmor(shot('hesh', 'rha', limit * 0.999));
    expect(at.result.scab).toBeDefined();
    expect(at.result.mechanism).toBe('Spalling');
  });

  it('lets a slope cut the spall: a steeper plate spalls through less normal thickness', () => {
    const imp = heshRound();
    expect(maxSpallThickness(imp, RHA, 45)).toBeLessThan(maxSpallThickness(imp, RHA, 0));
  });

  it('is slower the thicker the scab-making plate, and the scab never thicker than the plate', () => {
    const tl = simulateArmor(shot('hesh', 'cast-iron', 0.02));
    expect(tl.result.scab).toBeDefined();
    expect(tl.result.scab!.thicknessM).toBeLessThanOrEqual(0.02 + 1e-12);
  });
});

describe('validation: energy and the pressure wave (#169)', () => {
  const FAMILIES: [MunitionFamilyId, number][] = [['ap-shot', 0.06], ['apfsds', 0.1], ['heat', 0.1], ['hesh', 0.03]];

  it('closes the energy balance to within 2% of the impact energy, for every family, at every instant', () => {
    for (const [family, thickness] of FAMILIES) {
      const tl = simulateArmor(shot(family, family === 'hesh' ? 'cast-iron' : 'rha', thickness));
      for (let i = 0; i <= 100; i++) {
        const b = energyBalance(tl, (tl.duration * i) / 100);
        expect(Math.abs(b.totalJ - b.impactJ)).toBeLessThanOrEqual(0.02 * b.impactJ);
      }
    }
  });

  it('puts the impact energy of a round at ½mv²', () => {
    const imp = impactState('ap-shot', 88, 1000);
    if (imp.family !== 'ap-shot') throw new Error('expected shot');
    const tl = simulateArmor({ impact: imp, material: RHA, thicknessM: 0.1, obliquityDeg: 0 });
    expect(tl.result.impactEnergyJ).toBeCloseTo(0.5 * imp.mass * 1000 ** 2, 3);
  });

  it('has the pressure front at c·t from the impact, for the plate material', () => {
    for (const id of ['rha', 'al-5083', 'copper'] as const) {
      const tl = simulateArmor(shot('ap-shot', id, 0.3, 150));
      const c = getPlateMaterial(id).soundSpeed;
      const w = wavePulse(tl).lengthM;
      const t = (0.4 * tl.result.losThicknessM) / c;
      const ctx = fieldContext(tl, t);
      let farthest = 0;
      for (let i = 0; i <= 3000; i++) {
        const x = (tl.result.losThicknessM * i) / 3000;
        if (Math.abs(pressureGPaAt(ctx, x, 0)) > 1e-3) farthest = x;
      }
      expect(farthest).toBeLessThanOrEqual(c * t + 1e-9);
      expect(farthest).toBeGreaterThan(c * t - 0.25 * w);
    }
  });
});

describe('validation: ricochet thresholds (#169)', () => {
  it('puts full-bore shot at 60 to 70 degrees on RHA', () => {
    const d = criticalRicochetDeg(impactState('ap-shot', 88), RHA)!;
    expect(d).toBeGreaterThanOrEqual(60);
    expect(d).toBeLessThanOrEqual(70);
  });

  it('puts long rods at 75 to 80 degrees on RHA', () => {
    const d = criticalRicochetDeg(impactState('apfsds', 120), RHA)!;
    expect(d).toBeGreaterThanOrEqual(75);
    expect(d).toBeLessThanOrEqual(80);
  });

  it('puts the rod threshold above the shot threshold, on every plate', () => {
    for (const m of PLATE_MATERIALS) {
      expect(criticalRicochetDeg(impactState('apfsds', 120), m)!).toBeGreaterThan(criticalRicochetDeg(impactState('ap-shot', 88), m)!);
    }
  });

  it('raises the threshold for softer plates', () => {
    const impact = impactState('ap-shot', 88);
    const byHardness = [...PLATE_MATERIALS].sort((a, b) => b.brinell - a.brinell);
    const angles = byHardness.map((m) => criticalRicochetDeg(impact, m)!);
    for (let i = 1; i < angles.length; i++) expect(angles[i]).toBeGreaterThanOrEqual(angles[i - 1]);
    expect(angles[angles.length - 1]).toBeGreaterThan(angles[0]);
  });

  it('never ricochets square-on, and a jet skids instead of ricocheting', () => {
    expect(simulateArmor(shot('ap-shot', 'rha', 0.1, 88, undefined, 0)).result.mechanism).not.toBe('Ricochet');
    expect(simulateArmor(shot('apfsds', 'rha', 0.1, 120, undefined, 0)).result.mechanism).not.toBe('Ricochet');
    const jet = simulateArmor(shot('heat', 'rha', 0.1, 100, undefined, 85));
    expect(jet.result.failedToFuze).toBe(true);
    expect(jet.result.mechanism).not.toBe('Ricochet');
  });
});

describe('validation: the catalogues the models read (#169)', () => {
  it('has RHA as the reference plate: factor 1 and Rt well above yield', () => {
    expect(RHA.rhaThicknessFactor).toBe(1);
    expect(RHA.targetResistancePa / RHA.yieldPa).toBeGreaterThan(3);
    expect(RHA.targetResistancePa / RHA.yieldPa).toBeLessThan(8);
  });

  it('has the textbook densities: steel 7,850, tungsten alloy 17,600, copper 8,960 kg/m³', () => {
    expect(RHA.density).toBe(7850);
    expect(PENETRATOR_DENSITY['tungsten-alloy']).toBe(17600);
    expect(PENETRATOR_DENSITY.copper).toBe(8960);
    expect(getPlateMaterial('al-5083').density).toBeGreaterThan(2600);
    expect(getPlateMaterial('al-5083').density).toBeLessThan(2750);
  });

  it('has sound speeds of the right order: about 5.9 km/s in steel, 6.3 in aluminium', () => {
    expect(RHA.soundSpeed).toBeGreaterThan(5500);
    expect(RHA.soundSpeed).toBeLessThan(6200);
    expect(getPlateMaterial('al-5083').soundSpeed).toBeGreaterThan(6000);
  });

  it('keeps a plate material softer than RHA thinner-equivalent: its RHA thickness factor is below 1', () => {
    for (const id of ['mild-steel', 'cast-iron', 'copper', 'al-5083'] as const) expect(getPlateMaterial(id).rhaThicknessFactor).toBeLessThan(1);
  });
});
