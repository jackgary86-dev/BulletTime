import { describe, expect, it } from 'vitest';
import {
  DECAY_PATCH_RADII,
  HESH_CONTACT_PRESSURE_PA,
  HESH_MAX_OBLIQUITY_DEG,
  heshShot,
  maxSpallThickness,
  netStress,
  patchRadius,
  pulseLength,
  rearStress,
  spallOf,
} from './hesh';
import { getPlateMaterial, type PlateMaterial, type PlateMaterialId } from './materials';
import { TIMELINE_FRAMES, losThickness, type ArmorTimeline } from './model';
import { impactState, type SolidImpact } from './munitions';

const round = (calibreMm: number) => impactState('hesh', calibreMm) as SolidImpact;
const REF = round(120);
const D = REF.diameter;
const shoot = (plate: PlateMaterial | PlateMaterialId, calibres: number, obliquityDeg = 0, impact = REF): ArmorTimeline =>
  heshShot({ impact, material: typeof plate === 'string' ? getPlateMaterial(plate) : plate, thicknessM: calibres * impact.diameter, obliquityDeg });
const custom = (changes: Partial<PlateMaterial>): PlateMaterial => ({ ...getPlateMaterial('rha'), ...changes });

describe('the pulse', () => {
  it('has a length and a contact patch that scale with the calibre', () => {
    expect(pulseLength(round(150)) / pulseLength(round(60))).toBeCloseTo(150 / 60, 9);
    expect(patchRadius(round(150)) / patchRadius(round(60))).toBeCloseTo(150 / 60, 9);
  });

  it('weakens with the distance it crosses, relative to the contact patch', () => {
    const decayLength = DECAY_PATCH_RADII * patchRadius(REF);
    expect(rearStress(REF, 0, 0)).toBeCloseTo(HESH_CONTACT_PRESSURE_PA, 3);
    // Half the contact stress after one decay length.
    expect(rearStress(REF, decayLength, 0)).toBeCloseTo(HESH_CONTACT_PRESSURE_PA / 2, 3);
    let last = Infinity;
    for (const x of [0.1, 0.5, 1, 2, 4]) {
      const s = rearStress(REF, x * D, 0);
      expect(s).toBeLessThan(last);
      last = s;
    }
    // The same plate in calibres weakens it the same at every size.
    expect(rearStress(round(60), 0.8 * round(60).diameter, 0)).toBeCloseTo(rearStress(round(150), 0.8 * round(150).diameter, 0), 3);
  });

  it('is lower at a slope: cos(theta) of the normal stress', () => {
    expect(rearStress(REF, 0.5 * D, 60) / rearStress(REF, 0.5 * D, 0)).toBeCloseTo(0.5, 9);
  });

  it('is a triangle that reflects inverted: tension 2*sigma*d/lambda near the rear face', () => {
    const sigma = 4e9;
    const lambda = 0.03;
    const c = 5900;
    // Half a pulse length after the front arrives, at a quarter of a pulse length from the rear.
    const s = lambda / 2 / c;
    expect(netStress(lambda / 4, s, sigma, lambda, c)).toBeCloseTo((-2 * sigma * (lambda / 4)) / lambda, 0);
    // Before the front arrives there is no tension at all.
    expect(netStress(lambda / 4, -1e-6, sigma, lambda, c)).toBeGreaterThanOrEqual(0);
    // At the rear face itself there is no net stress (a free surface).
    expect(netStress(0, s, sigma, lambda, c)).toBeCloseTo(0, 6);
  });
});

describe('scab', () => {
  const rha = getPlateMaterial('rha');

  it('has thickness x_s = lambda * sigma_spall / (2 * sigma_rear) and leaves at 2(sigma_rear - sigma_spall) / (rho * c)', () => {
    const lambda = 0.03;
    const sigma = 6e9;
    const s = spallOf(lambda, sigma, rha, 1);
    expect(s.spalls).toBe(true);
    expect(s.thicknessM).toBeCloseTo((lambda * rha.spallStrengthPa) / (2 * sigma), 12);
    expect(s.velocity).toBeCloseTo((2 * (sigma - rha.spallStrengthPa)) / (rha.density * rha.soundSpeed), 9);
  });

  it('does not form when the tension stays under the spall strength', () => {
    const s = spallOf(0.03, rha.spallStrengthPa * 0.99, rha, 1);
    expect(s.spalls).toBe(false);
    expect(s.thicknessM).toBe(0);
    expect(s.velocity).toBe(0);
    // Right at the spall strength there is no scab either: it would leave at no speed.
    expect(spallOf(0.03, rha.spallStrengthPa, rha, 1).spalls).toBe(false);
  });

  it('is never thicker than the plate', () => {
    expect(spallOf(0.03, rha.spallStrengthPa * 1.0001, rha, 0.001).thicknessM).toBe(0.001);
  });

  it('grows as the plate’s spall strength rises relative to the pulse', () => {
    const strengths = [2e9, 3e9, 4e9, 5e9];
    const thicknesses = strengths.map((spallStrengthPa) => shoot(custom({ spallStrengthPa }), 0.5).result.scab!.thicknessM);
    for (let i = 1; i < thicknesses.length; i++) expect(thicknesses[i]).toBeGreaterThan(thicknesses[i - 1]);
    // Same ratio thicker: the pulse weakens with the plate, so the same plate spalls a thicker scab.
    const rhaThicknesses = [0.2, 0.5, 0.8, 1].map((calibres) => shoot('rha', calibres).result.scab!.thicknessM);
    for (let i = 1; i < rhaThicknesses.length; i++) expect(rhaThicknesses[i]).toBeGreaterThan(rhaThicknesses[i - 1]);
  });

  it('is a disc about as wide as the contact patch, and weighs what that volume of plate does', () => {
    const scab = shoot('rha', 0.5).result.scab!;
    expect(scab.diameterM).toBeCloseTo(2 * patchRadius(REF), 12);
    expect(scab.massKg).toBeCloseTo(getPlateMaterial('rha').density * Math.PI * patchRadius(REF) ** 2 * scab.thicknessM, 9);
    expect(scab.velocity).toBeGreaterThan(0);
  });
});

describe('which plates spall', () => {
  it('a thin RHA plate, under about a calibre, spalls', () => {
    for (const calibres of [0.1, 0.3, 0.6, 0.9, 1]) {
      const tl = shoot('rha', calibres);
      expect(tl.result.mechanism).toBe('Spalling');
      expect(tl.result.scab).toBeDefined();
    }
  });

  it('RHA thicker than about a calibre and a half does not', () => {
    for (const calibres of [1.5, 2, 3, 5]) {
      const tl = shoot('rha', calibres);
      expect(tl.result.mechanism).toBe('Surface damage');
      expect(tl.result.scab).toBeUndefined();
    }
  });

  it('the thickest RHA that spalls sits between one and one and a half calibres, and the simulation agrees', () => {
    const limit = maxSpallThickness(REF, getPlateMaterial('rha'));
    expect(limit / D).toBeGreaterThan(1);
    expect(limit / D).toBeLessThan(1.5);
    expect(shoot('rha', (limit / D) * 0.99).result.scab).toBeDefined();
    expect(shoot('rha', (limit / D) * 1.01).result.scab).toBeUndefined();
  });

  it('brittle cast iron spalls more readily than RHA', () => {
    expect(maxSpallThickness(REF, getPlateMaterial('cast-iron'))).toBeGreaterThan(2 * maxSpallThickness(REF, getPlateMaterial('rha')));
    // Plates that hold against RHA's limit still spall in cast iron.
    for (const calibres of [1.5, 2, 3]) {
      expect(shoot('rha', calibres).result.scab).toBeUndefined();
      expect(shoot('cast-iron', calibres).result.scab).toBeDefined();
    }
    // And where both spall, cast iron's scab leaves faster.
    expect(shoot('cast-iron', 0.5).result.scab!.velocity).toBeGreaterThan(shoot('rha', 0.5).result.scab!.velocity);
  });

  it('the same holds at every calibre, since the plate is measured in calibres', () => {
    for (const cal of [40, 90, 150]) {
      expect(shoot('rha', 0.8, 0, round(cal)).result.scab).toBeDefined();
      expect(shoot('rha', 1.6, 0, round(cal)).result.scab).toBeUndefined();
    }
  });

  it('no round spalls a plate when the contact pressure cannot reach its spall strength', () => {
    expect(maxSpallThickness(REF, custom({ spallStrengthPa: 1e10 }))).toBe(0);
  });
});

describe('slope', () => {
  it('lengthens the path to the line-of-sight thickness and spreads the patch', () => {
    const flat = shoot('rha', 0.5);
    const sloped = shoot('rha', 0.5, 45);
    expect(sloped.result.losThicknessM).toBeCloseTo(losThickness(0.5 * D, 45), 12);
    expect(sloped.result.scab!.diameterM).toBeCloseTo(flat.result.scab!.diameterM / Math.cos(Math.PI / 4), 9);
    // The stress that reaches the rear is lower, so the scab is thicker and slower.
    expect(sloped.result.scab!.thicknessM).toBeGreaterThan(flat.result.scab!.thicknessM);
    expect(sloped.result.scab!.velocity).toBeLessThan(flat.result.scab!.velocity);
  });

  it('a plate that spalls square-on can hold against a steep slope', () => {
    expect(shoot('rha', 0.9, 0).result.scab).toBeDefined();
    expect(shoot('rha', 0.9, 60).result.scab).toBeUndefined();
  });

  it('puts the thickness limit at the same place in the simulation', () => {
    for (const slope of [0, 30, 55]) {
      const limit = maxSpallThickness(REF, getPlateMaterial('rha'), slope);
      expect(shoot('rha', (limit / D) * 0.99, slope).result.scab).toBeDefined();
      expect(shoot('rha', (limit / D) * 1.01, slope).result.scab).toBeUndefined();
    }
  });

  it('clamps the slope to what it models', () => {
    expect(shoot('rha', 0.5, 85).shot.obliquityDeg).toBe(HESH_MAX_OBLIQUITY_DEG);
  });
});

describe('timeline', () => {
  const tl = shoot('rha', 0.6);
  const rha = getPlateMaterial('rha');
  const tLos = 0.6 * D;
  const eventOf = (type: string) => tl.events.find((e) => e.type === type)!;

  it('never penetrates', () => {
    expect(tl.result.perforated).toBe(false);
    expect(tl.result.penetrationM).toBe(0);
    expect(tl.result.residualVelocity).toBe(0);
    expect(tl.frames.every((f) => f.depth === 0)).toBe(true);
  });

  it('sends the front across the plate at the sound speed, then reflects it', () => {
    const arrive = eventOf('reflect');
    expect(arrive.t).toBeCloseTo(tLos / rha.soundSpeed, 12);
    for (const f of tl.frames.filter((f) => f.t > 0 && f.t < arrive.t)) expect(f.waveFrontM).toBeCloseTo(rha.soundSpeed * f.t, 9);
    for (const f of tl.frames.filter((f) => f.t >= arrive.t)) expect(f.waveFrontM).toBeCloseTo(tLos, 12);
    // The reflected front starts at the rear face and heads back toward the front.
    const after = tl.frames.filter((f) => f.t >= arrive.t);
    for (let i = 1; i < after.length; i++) expect(after[i].reflectedFrontM!).toBeLessThanOrEqual(after[i - 1].reflectedFrontM! + 1e-12);
    expect(tl.frames.find((f) => f.t < arrive.t)!.reflectedFrontM).toBeCloseTo(tLos, 12);
  });

  it('tears the scab off a scab-thickness inside the rear face, a scab-thickness of wave time after the pulse arrives', () => {
    const scab = tl.result.scab!;
    const spall = eventOf('spall');
    expect(spall.t).toBeCloseTo(eventOf('reflect').t + scab.thicknessM / rha.soundSpeed, 12);
    expect(spall.depth).toBeCloseTo(tLos - scab.thicknessM, 12);
    expect(spall.speed).toBeCloseTo(scab.velocity, 9);
    expect(tl.events.map((e) => e.type)).toEqual(['impact', 'reflect', 'spall']);
    // The scab leaves the plate from then on, at its own speed.
    expect(tl.frames.filter((f) => f.t <= spall.t).every((f) => f.rearBulge === 0)).toBe(true);
    const late = tl.frames[tl.frames.length - 1];
    expect(late.rearBulge).toBeCloseTo(scab.velocity * (late.t - spall.t), 12);
  });

  it('builds tension after the reflection, peaking near the rear-face stress, and none before', () => {
    const arrive = eventOf('reflect').t;
    for (const f of tl.frames.filter((f) => f.t < arrive)) expect(f.peakTensionPa).toBe(0);
    const peak = Math.max(...tl.frames.map((f) => f.peakTensionPa!));
    const sigma = rearStress(REF, tLos, 0);
    expect(peak).toBeGreaterThan(0.9 * sigma);
    expect(peak).toBeLessThanOrEqual(sigma * 1.0001);
    expect(peak).toBeGreaterThan(rha.spallStrengthPa);
  });

  it('keeps the tension under the spall strength when the plate holds', () => {
    const thick = shoot('rha', 2);
    const peak = Math.max(...thick.frames.map((f) => f.peakTensionPa!));
    expect(peak).toBeLessThanOrEqual(getPlateMaterial('rha').spallStrengthPa);
    expect(thick.events.map((e) => e.type)).toEqual(['impact', 'reflect', 'stop']);
    expect(thick.events[2].label).toMatch(/holds/);
  });

  it('is a well-formed ArmorTimeline', () => {
    expect(tl.frames.length).toBeGreaterThanOrEqual(TIMELINE_FRAMES);
    expect(tl.frames[0].t).toBe(0);
    expect(tl.frames[tl.frames.length - 1].t).toBeCloseTo(tl.duration, 12);
    for (let i = 1; i < tl.events.length; i++) expect(tl.events[i].t).toBeGreaterThanOrEqual(tl.events[i - 1].t);
    expect(tl.result.mechanism).toBe('Spalling');
    expect(tl.result.shattered).toBe(false);
    // Enough frames that the wave's few microseconds are not a single frame.
    const step = tl.duration / (tl.frames.length - 1);
    expect(eventOf('spall').t / step).toBeGreaterThan(1);
  });

  it('accounts for all the energy, the scab carrying a little of it', () => {
    const r = tl.result;
    expect(r.impactEnergyJ).toBeCloseTo(0.5 * REF.mass * REF.velocity ** 2, 3);
    expect(r.energy.ejectaJ).toBeCloseTo(0.5 * r.scab!.massKg * r.scab!.velocity ** 2, 6);
    expect(r.energy.plateWorkJ + r.energy.ejectaJ + r.residualEnergyJ).toBeCloseTo(r.impactEnergyJ, 3);
    expect(r.energy.ejectaJ).toBeGreaterThan(0);
    expect(r.energy.ejectaJ).toBeLessThan(0.01 * r.impactEnergyJ);
    expect(tl.frames[tl.frames.length - 1].energyDepositedJ).toBeCloseTo(r.energy.plateWorkJ, 3);
  });

  it('flattens the charge into its contact patch', () => {
    expect(tl.frames[0].craterRadius).toBe(0);
    expect(tl.frames[tl.frames.length - 1].craterRadius).toBeCloseTo(patchRadius(REF), 12);
  });
});

describe('input checks', () => {
  it('only models squash-head rounds', () => {
    expect(() => heshShot({ impact: impactState('ap-shot', 88), material: getPlateMaterial('rha'), thicknessM: 0.1, obliquityDeg: 0 })).toThrow(/squash-head/);
  });

  it('rejects a plate with no thickness', () => {
    expect(() => shoot('rha', 0)).toThrow(/thickness/i);
  });
});
