import { describe, expect, it } from 'vitest';
import {
  DEBRIS_HALF_ANGLE_DEG,
  FUZE_FAIL_OBLIQUITY_DEG,
  HOLE_DEEP_DIAMETER_RATIO,
  HOLE_ENTRY_DIAMETER_RATIO,
  SLUG_FRACTION,
  densityRatio,
  jetPenetration,
  jetPenetrationSpeed,
  jetReach,
  jetShot,
} from './jet';
import { PLATE_MATERIALS, getPlateMaterial, type PlateMaterialId } from './materials';
import { CRATER_PROFILE_SAMPLES, MAX_OBLIQUITY_DEG, TIMELINE_FRAMES, losThickness, type ArmorTimeline } from './model';
import { MAX_CALIBRE_MM, MIN_CALIBRE_MM, impactState, type JetImpact } from './munitions';

const jet = (calibreMm: number) => impactState('heat', calibreMm) as JetImpact;
const shoot = (impact: JetImpact, plate: PlateMaterialId, thicknessM: number, obliquityDeg = 0): ArmorTimeline =>
  jetShot({ impact, material: getPlateMaterial(plate), thicknessM, obliquityDeg });
const THICK = 5;
const CALIBRES = [MIN_CALIBRE_MM, 60, 90, 120, MAX_CALIBRE_MM];

describe('density law', () => {
  it('gives u = v / (1 + sqrt(rho-t / rho-j)) for the crater bottom', () => {
    const gamma = Math.sqrt(7850 / 8960);
    expect(densityRatio(8960, 7850)).toBeCloseTo(gamma, 12);
    expect(jetPenetrationSpeed(8000, 8960, 7850)).toBeCloseTo(8000 / (1 + gamma), 6);
    // Equal densities share the speed evenly.
    expect(jetPenetrationSpeed(6000, 8000, 8000)).toBeCloseTo(3000, 9);
  });

  it('balances the pressures on both sides of the interface', () => {
    const v = 7000;
    const u = jetPenetrationSpeed(v, 8960, 7850);
    expect(0.5 * 8960 * (v - u) ** 2).toBeCloseTo(0.5 * 7850 * u ** 2, -3);
  });

  it('gives P = L * sqrt(rho-j / rho-t)', () => {
    expect(jetPenetration(0.5, 8960, 7850)).toBeCloseTo(0.5 * Math.sqrt(8960 / 7850), 12);
    expect(jetPenetration(0.5, 8960, 8960)).toBeCloseTo(0.5, 12);
  });
});

describe('penetration depth', () => {
  it('is about 5 to 7 cone diameters into RHA at 0 degrees for every calibre', () => {
    for (const cal of CALIBRES) {
      const impact = jet(cal);
      const depth = shoot(impact, 'rha', THICK).result.penetrationM / impact.coneDiameter;
      expect(depth).toBeGreaterThan(5);
      expect(depth).toBeLessThan(7);
    }
  });

  it('is the density law on all of the jet but its slug', () => {
    for (const cal of [40, 120]) {
      const impact = jet(cal);
      for (const material of PLATE_MATERIALS) {
        const expected = (1 - SLUG_FRACTION) * impact.jetLength * Math.sqrt(impact.density / material.density);
        expect(shoot(impact, material.id, THICK).result.penetrationM).toBeCloseTo(expected, 9);
        expect(jetReach(impact, material)).toBeCloseTo(expected, 12);
      }
    }
  });

  it('scales with sqrt(rho-j / rho-t) across materials, whatever their strength', () => {
    const impact = jet(120);
    const rha = shoot(impact, 'rha', THICK).result.penetrationM;
    for (const material of PLATE_MATERIALS) {
      const ratio = shoot(impact, material.id, THICK).result.penetrationM / rha;
      expect(ratio).toBeCloseTo(Math.sqrt(getPlateMaterial('rha').density / material.density), 9);
    }
    // Mild steel and RHA have the same density but very different strength: the same depth.
    expect(shoot(impact, 'mild-steel', THICK).result.penetrationM).toBeCloseTo(rha, 12);
    // Aluminium is a third the density of steel and goes much deeper; copper is denser and goes less deep.
    expect(shoot(impact, 'al-5083', THICK).result.penetrationM).toBeGreaterThan(1.5 * rha);
    expect(shoot(impact, 'copper', THICK).result.penetrationM).toBeLessThan(rha);
  });

  it('grows with calibre', () => {
    const depths = CALIBRES.map((cal) => shoot(jet(cal), 'rha', THICK).result.penetrationM);
    for (let i = 1; i < depths.length; i++) expect(depths[i]).toBeGreaterThan(depths[i - 1]);
  });
});

describe('jet timeline', () => {
  const impact = jet(120);
  const tl = shoot(impact, 'rha', THICK);

  it('slows the crater bottom as slower jet elements arrive', () => {
    const digging = tl.frames.filter((f) => f.penetrationRate > 0);
    expect(digging.length).toBeGreaterThan(20);
    expect(digging[0].penetrationRate).toBeCloseTo(jetPenetrationSpeed(impact.jetTipVelocity, impact.density, 7850), 0);
    for (let i = 1; i < digging.length; i++) expect(digging[i].penetrationRate).toBeLessThan(digging[i - 1].penetrationRate);
    // The element now arriving runs from the tip speed down toward the tail speed.
    expect(digging[0].speed).toBeCloseTo(impact.jetTipVelocity, -1);
    expect(digging[digging.length - 1].speed).toBeGreaterThan(impact.jetTailVelocity);
    expect(digging[digging.length - 1].speed).toBeLessThan(impact.jetTipVelocity);
  });

  it('uses the jet up as it digs, to the slug', () => {
    const lengths = tl.frames.map((f) => f.penetratorLength);
    expect(lengths[0]).toBeCloseTo(impact.jetLength, 9);
    for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBeLessThanOrEqual(lengths[i - 1] + 1e-12);
    expect(lengths[lengths.length - 1]).toBeCloseTo(SLUG_FRACTION * impact.jetLength, 9);
  });

  it('digs steadily deeper, reaching its depth and stopping', () => {
    for (let i = 1; i < tl.frames.length; i++) expect(tl.frames[i].depth).toBeGreaterThanOrEqual(tl.frames[i - 1].depth - 1e-12);
    const last = tl.frames[tl.frames.length - 1];
    expect(last.depth).toBeCloseTo(tl.result.penetrationM, 9);
    expect(last.penetrationRate).toBe(0);
    expect(last.speed).toBe(0);
    const stop = tl.events[tl.events.length - 1];
    expect(stop.type).toBe('stop');
    expect(stop.label).toMatch(/slug/);
  });

  it('is a well-formed ArmorTimeline', () => {
    expect(tl.frames.length).toBeGreaterThanOrEqual(TIMELINE_FRAMES);
    expect(tl.frames[0].t).toBe(0);
    expect(tl.events[0].type).toBe('impact');
    expect(tl.result.mechanism).toBe('Jet penetration');
    expect(tl.result.perforated).toBe(false);
    expect(tl.result.residualVelocity).toBe(0);
    expect(tl.result.residualMassKg).toBe(0);
    expect(tl.result.debris).toBeUndefined();
  });

  it('takes less time through a denser plate at the same depth ratio, and longer to dig deeper', () => {
    expect(shoot(jet(150), 'rha', THICK).duration).toBeGreaterThan(shoot(jet(40), 'rha', THICK).duration);
  });

  it('puts all the jet energy into the plate when it stops', () => {
    const r = tl.result;
    expect(r.residualEnergyJ).toBe(0);
    expect(r.energy.ejectaJ).toBe(0);
    expect(r.energy.plateWorkJ).toBeCloseTo(r.impactEnergyJ, 3);
    const deposited = tl.frames.map((f) => f.energyDepositedJ);
    for (let i = 1; i < deposited.length; i++) expect(deposited[i]).toBeGreaterThanOrEqual(deposited[i - 1] - 1e-6);
    expect(deposited[deposited.length - 1]).toBeCloseTo(r.energy.plateWorkJ, 3);
  });
});

describe('hole profile', () => {
  const impact = jet(120);
  const final = shoot(impact, 'rha', THICK).frames.at(-1)!;

  it('is narrow: about a quarter of the cone diameter at the face, tapering toward a tenth deep down', () => {
    const profile = final.craterProfile!;
    expect(profile).toHaveLength(CRATER_PROFILE_SAMPLES);
    expect(final.craterRadius).toBeCloseTo((HOLE_ENTRY_DIAMETER_RATIO * impact.coneDiameter) / 2, 12);
    expect(profile[0]).toBeCloseTo(final.craterRadius, 12);
    for (let i = 1; i < profile.length; i++) expect(profile[i]).toBeLessThanOrEqual(profile[i - 1] + 1e-12);
    expect(profile[profile.length - 1]).toBeGreaterThan((HOLE_DEEP_DIAMETER_RATIO * impact.coneDiameter) / 2 - 1e-12);
    expect(profile[profile.length - 1]).toBeLessThan(profile[0]);
    // Deep and narrow: far deeper than it is wide.
    expect(final.depth / (2 * final.craterRadius)).toBeGreaterThan(10);
  });
});

describe('perforation', () => {
  const impact = jet(120);
  const thin = shoot(impact, 'rha', 0.3);

  it('goes through a thin plate, with the rest of the jet flying on at its own speed', () => {
    const r = thin.result;
    expect(r.perforated).toBe(true);
    expect(r.penetrationM).toBeCloseTo(0.3, 12);
    expect(r.residualVelocity).toBeGreaterThan(impact.jetTailVelocity);
    expect(r.residualVelocity).toBeLessThan(impact.jetTipVelocity);
    expect(r.residualMassKg).toBeGreaterThan(0);
    const last = thin.events[thin.events.length - 1];
    expect(last.type).toBe('perforate');
    expect(last.depth).toBeCloseTo(0.3, 12);
    // Behind the plate the jet keeps going.
    const frames = thin.frames;
    expect(frames[frames.length - 1].travel).toBeGreaterThan(0.3);
    expect(frames[frames.length - 1].speed).toBeCloseTo(r.residualVelocity, 6);
  });

  it('sprays a debris cone of jet particles and plate spall behind the plate', () => {
    const d = thin.result.debris!;
    expect(d).toBeDefined();
    expect(d.halfAngleDeg).toBe(DEBRIS_HALF_ANGLE_DEG);
    expect(d.jetParticles.massKg).toBeCloseTo(thin.result.residualMassKg, 12);
    expect(d.jetParticles.velocity).toBeCloseTo(thin.result.residualVelocity, 9);
    expect(d.spall.massKg).toBeGreaterThan(0);
    expect(d.spall.velocity).toBeGreaterThan(0);
    expect(d.spall.velocity).toBeLessThan(d.jetParticles.velocity);
  });

  it('accounts for all of the jet energy', () => {
    const r = thin.result;
    expect(r.residualEnergyJ + r.energy.plateWorkJ + r.energy.ejectaJ).toBeCloseTo(r.impactEnergyJ, 3);
    expect(r.energy.plateWorkJ).toBeGreaterThan(0);
    expect(r.energy.ejectaJ).toBeGreaterThan(0);
    expect(thin.frames[thin.frames.length - 1].energyDepositedJ).toBeCloseTo(r.energy.plateWorkJ, 3);
  });

  it('a thinner plate leaves more of the jet', () => {
    expect(shoot(impact, 'rha', 0.1).result.residualMassKg).toBeGreaterThan(thin.result.residualMassKg);
    expect(shoot(impact, 'rha', 0.1).result.residualVelocity).toBeGreaterThan(thin.result.residualVelocity);
  });

  it('is stopped by a plate thicker than its reach, and perforates one just under it', () => {
    const reach = jetReach(impact, getPlateMaterial('rha'));
    expect(shoot(impact, 'rha', reach * 1.001).result.perforated).toBe(false);
    expect(shoot(impact, 'rha', reach * 0.999).result.perforated).toBe(true);
  });

  it('digs through the thin plate in order, never beyond it', () => {
    for (const f of thin.frames) expect(f.depth).toBeLessThanOrEqual(0.3 + 1e-12);
  });
});

describe('slope', () => {
  const impact = jet(120);

  it('uses the line-of-sight thickness', () => {
    const reach = jetReach(impact, getPlateMaterial('rha'));
    const t = reach * 0.8;
    const sloped = shoot(impact, 'rha', t, 45);
    expect(sloped.result.losThicknessM).toBeCloseTo(losThickness(t, 45), 12);
    // 0.8 reach at 45 degrees is a path of 1.13 reach: not perforated.
    expect(sloped.result.perforated).toBe(false);
    expect(shoot(impact, 'rha', t, 0).result.perforated).toBe(true);
  });

  it('fails to fuze above 80 degrees and skids off', () => {
    expect(FUZE_FAIL_OBLIQUITY_DEG).toBe(80);
    const tl = shoot(impact, 'rha', 0.05, 82);
    expect(tl.result.failedToFuze).toBe(true);
    expect(tl.result.penetrationM).toBe(0);
    expect(tl.result.perforated).toBe(false);
    expect(tl.result.residualMassKg).toBe(0);
    expect(tl.events.map((e) => e.type)).toEqual(['impact', 'skid']);
    expect(tl.frames.every((f) => f.depth === 0)).toBe(true);
    expect(tl.result.debris).toBeUndefined();
  });

  it('still fuzes at exactly 80 degrees', () => {
    const tl = shoot(impact, 'rha', 0.05, 80);
    expect(tl.result.failedToFuze).toBeUndefined();
    expect(tl.result.penetrationM).toBeGreaterThan(0);
  });

  it('clamps the slope to the lab limit', () => {
    expect(shoot(impact, 'rha', 0.05, 100).shot.obliquityDeg).toBe(MAX_OBLIQUITY_DEG);
  });
});

describe('input checks', () => {
  it('only models shaped-charge jets', () => {
    expect(() => jetShot({ impact: impactState('ap-shot', 88), material: getPlateMaterial('rha'), thicknessM: 0.1, obliquityDeg: 0 })).toThrow(/shaped-charge/);
  });

  it('rejects a plate with no thickness', () => {
    expect(() => shoot(jet(120), 'rha', 0)).toThrow(/thickness/i);
  });
});
