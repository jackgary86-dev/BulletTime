import { describe, expect, it } from 'vitest';
import { getPlateMaterial, type PlateMaterialId } from './materials';
import { MAX_OBLIQUITY_DEG, losThickness, type ArmorShot } from './model';
import { impactState, type MunitionFamilyId } from './munitions';
import { criticalRicochetDeg, ricochetOutcome, ricochets, ricochetShot } from './ricochet';
import { simulateArmor } from './simulate';

const shotOf = (family: MunitionFamilyId, obliquityDeg: number, material: PlateMaterialId = 'rha', thicknessM = 0.1, calibreMm = 120, velocity?: number): ArmorShot => ({
  impact: impactState(family, calibreMm, velocity),
  material: getPlateMaterial(material),
  thicknessM,
  obliquityDeg,
});

describe('critical ricochet slope (#165)', () => {
  it('puts full-bore shot at 60-70° and long rods at 75-80° on RHA at default speed', () => {
    const shot = criticalRicochetDeg(impactState('ap-shot', 88), getPlateMaterial('rha'));
    const rod = criticalRicochetDeg(impactState('apfsds', 120), getPlateMaterial('rha'));
    expect(shot).toBeGreaterThanOrEqual(60);
    expect(shot).toBeLessThanOrEqual(70);
    expect(rod).toBeGreaterThanOrEqual(75);
    expect(rod).toBeLessThanOrEqual(80);
  });

  it('is higher for a softer plate', () => {
    for (const family of ['ap-shot', 'apfsds'] as const) {
      const impact = impactState(family, 120);
      const rha = criticalRicochetDeg(impact, getPlateMaterial('rha'))!;
      const mild = criticalRicochetDeg(impact, getPlateMaterial('mild-steel'))!;
      const copper = criticalRicochetDeg(impact, getPlateMaterial('copper'))!;
      expect(mild).toBeGreaterThan(rha);
      expect(copper).toBeGreaterThan(mild);
    }
  });

  it('rises with speed, and stays under the steepest slope the lab offers', () => {
    const slow = criticalRicochetDeg(impactState('ap-shot', 88, 700), getPlateMaterial('rha'))!;
    const fast = criticalRicochetDeg(impactState('ap-shot', 88, 1050), getPlateMaterial('rha'))!;
    expect(fast).toBeGreaterThan(slow);
    for (const family of ['ap-shot', 'apfsds'] as const) {
      for (const id of ['rha', 'mild-steel', 'cast-iron', 'copper', 'al-5083'] as const) {
        expect(criticalRicochetDeg(impactState(family, 120, 1800), getPlateMaterial(id))!).toBeLessThan(MAX_OBLIQUITY_DEG);
      }
    }
  });

  it('is null for families that do not glance off: jets skid, squash heads stick', () => {
    for (const family of ['heat', 'hesh', 'he-frag'] as const) expect(criticalRicochetDeg(impactState(family, 120), getPlateMaterial('rha'))).toBeNull();
  });
});

describe('ricochet decision (#165)', () => {
  it('never ricochets at 0°', () => {
    for (const family of ['ap-shot', 'apfsds'] as const) expect(ricochets(shotOf(family, 0))).toBe(false);
  });

  it('ricochets just above the critical slope and not at it', () => {
    for (const family of ['ap-shot', 'apfsds'] as const) {
      const critical = criticalRicochetDeg(impactState(family, 120), getPlateMaterial('rha'))!;
      expect(ricochets(shotOf(family, critical))).toBe(false);
      expect(ricochets(shotOf(family, critical + 0.5))).toBe(true);
    }
  });

  it('leaves jets and squash heads to their own models', () => {
    expect(ricochets(shotOf('heat', 85))).toBe(false);
    expect(ricochets(shotOf('hesh', 85))).toBe(false);
  });
});

describe('ricochet outcome (#165)', () => {
  it('leaves at a shallow angle, slower than it arrived', () => {
    const impact = impactState('apfsds', 120);
    const o = ricochetOutcome(impact, getPlateMaterial('rha'), 82);
    expect(o.exitAngleDeg).toBeGreaterThan(0);
    expect(o.exitAngleDeg).toBeLessThan(18);
    expect(o.exitSpeed).toBeLessThan(impact.velocity);
    expect(o.exitSpeed).toBeGreaterThan(0.5 * impact.velocity);
  });

  it('shatters steel shot on RHA but not on a soft plate, and keeps a rod whole', () => {
    expect(ricochetOutcome(impactState('ap-shot', 88), getPlateMaterial('rha'), 75).shattered).toBe(true);
    expect(ricochetOutcome(impactState('ap-shot', 88), getPlateMaterial('mild-steel'), 80).shattered).toBe(false);
    expect(ricochetOutcome(impactState('apfsds', 120), getPlateMaterial('rha'), 82).shattered).toBe(false);
  });

  it('cuts a shallower gouge the steeper the slope', () => {
    const mat = getPlateMaterial('rha');
    const a = ricochetOutcome(impactState('apfsds', 120), mat, 79).gougeDepthM;
    const b = ricochetOutcome(impactState('apfsds', 120), mat, 85).gougeDepthM;
    expect(b).toBeLessThan(a);
    expect(b).toBeGreaterThan(0);
  });

  it('refuses a family that does not ricochet', () => {
    expect(() => ricochetOutcome(impactState('heat', 120), getPlateMaterial('rha'), 85)).toThrow();
  });
});

describe('ricochet timeline (#165)', () => {
  it('leaves a gouge, not a crater: shallow, never perforated, with a ricochet event', () => {
    for (const family of ['ap-shot', 'apfsds'] as const) {
      const tl = simulateArmor(shotOf(family, 85));
      expect(tl.result.mechanism).toBe('Ricochet');
      expect(tl.result.perforated).toBe(false);
      expect(tl.result.ricochet).toBeDefined();
      expect(tl.result.penetrationM).toBeLessThanOrEqual((0.3 * tl.shot.impact.calibreMm) / 1000 + 1e-9);
      expect(tl.result.penetrationM).toBeGreaterThan(0);
      expect(tl.events.map((e) => e.type)).toContain('ricochet');
      expect(tl.events[0].type).toBe('impact');
    }
  });

  it('reports line-of-sight thickness T / cos θ in the results, at the slope fired', () => {
    for (const [family, deg] of [['ap-shot', 80], ['apfsds', 84]] as const) {
      const tl = simulateArmor(shotOf(family, deg, 'rha', 0.08));
      expect(tl.shot.obliquityDeg).toBe(deg);
      expect(tl.result.losThicknessM).toBeCloseTo(0.08 / Math.cos((deg * Math.PI) / 180), 9);
      expect(tl.result.losThicknessM).toBeCloseTo(losThickness(0.08, deg), 12);
    }
  });

  it('reports line-of-sight thickness for the penetrating families too', () => {
    const tl = simulateArmor(shotOf('ap-shot', 40, 'rha', 0.05));
    expect(tl.result.losThicknessM).toBeCloseTo(0.05 / Math.cos((40 * Math.PI) / 180), 9);
  });

  it('keeps the gouge once cut: depth only grows, up to the gouge depth', () => {
    const tl = ricochetShot(shotOf('apfsds', 82));
    let prev = 0;
    for (const f of tl.frames) {
      expect(f.depth).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(f.depth).toBeLessThanOrEqual(tl.result.penetrationM + 1e-12);
      prev = f.depth;
    }
    expect(tl.frames[tl.frames.length - 1].depth).toBeCloseTo(tl.result.penetrationM, 9);
  });

  it('backs the nose out of the face after the turn, and ends outside it', () => {
    const tl = ricochetShot(shotOf('apfsds', 82));
    const last = tl.frames[tl.frames.length - 1];
    expect(last.travel).toBeLessThan(0);
    expect(Math.max(...tl.frames.map((f) => f.travel))).toBeCloseTo(tl.result.penetrationM, 3);
  });

  it('accounts for the energy: absorbed plus carried away equals the impact energy', () => {
    const tl = ricochetShot(shotOf('ap-shot', 80));
    expect(tl.result.energy.plateWorkJ + tl.result.residualEnergyJ).toBeCloseTo(tl.result.impactEnergyJ, 3);
    expect(tl.result.residualEnergyJ).toBeLessThan(tl.result.impactEnergyJ);
  });

  it('keeps frames evenly spaced from 0 to the duration, with events in order', () => {
    const tl = ricochetShot(shotOf('apfsds', 82));
    expect(tl.frames[0].t).toBe(0);
    expect(tl.frames[tl.frames.length - 1].t).toBeCloseTo(tl.duration, 12);
    expect(tl.events.every((e, i) => i === 0 || e.t >= tl.events[i - 1].t)).toBe(true);
  });

  it('rejects a family that cannot ricochet', () => {
    expect(() => ricochetShot(shotOf('heat', 85))).toThrow();
  });

  it('does not ricochet below the critical slope: penetration models run as before', () => {
    expect(simulateArmor(shotOf('ap-shot', 40)).result.mechanism).not.toBe('Ricochet');
    expect(simulateArmor(shotOf('apfsds', 70, 'rha', 0.3)).result.mechanism).toBe('Hydrodynamic erosion');
  });
});
