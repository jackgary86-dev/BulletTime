import { describe, expect, it } from 'vitest';
import { layersFor, simulate } from '../sim/engine';
import { GEL_REFERENCE } from './gelReference';
import { getMedium } from './media';

/** Gelatin penetration, cavity and retained weight against the single-shot reference tracks (#228). Tolerance 20%. */
const GR = 6.479891e-5;
const TOL = 0.2;

const shoot = (bullet: (typeof GEL_REFERENCE)[number]['bullet']) =>
  simulate({ bullet, layers: layersFor(getMedium('gel10'), 0.6), angleDeg: 0, impactPoint: { x: -0.2, y: 0.16, z: 0 }, standOffM: 0.5 });

const within = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(expected * TOL);

describe('gel reference tracks (#228)', () => {
  it.each(GEL_REFERENCE)('$id penetrates to the measured depth', ({ bullet, penetrationM }) => {
    within(shoot(bullet).summary.penetrationM, penetrationM);
  });

  it.each(GEL_REFERENCE.filter((r) => r.cavityM !== undefined))('$id temporary cavity is as wide as measured', ({ bullet, cavityM }) => {
    within(shoot(bullet).summary.maxCavityDiameter, cavityM!);
  });

  it.each(GEL_REFERENCE.filter((r) => r.retained !== undefined))('$id keeps the measured share of its weight', ({ bullet, retained }) => {
    const kept = shoot(bullet).tracks[0].massKg / (bullet.massGrains * GR);
    within(kept, retained!);
  });

  it.each(GEL_REFERENCE.filter((r) => r.energyJ !== undefined))('$id starts with the measured energy', ({ bullet, energyJ }) => {
    within(shoot(bullet).summary.impactEnergyJ, energyJ!);
  });

  it('fragmenting rounds lose between a third and most of their weight', () => {
    for (const { bullet, retained } of GEL_REFERENCE.filter((r) => r.retained !== undefined)) {
      const kept = shoot(bullet).tracks[0].massKg / (bullet.massGrains * GR);
      expect(kept).toBeLessThan(0.67);
      expect(kept).toBeGreaterThan(0.1);
      expect(shoot(bullet).summary.finalState).toBe('fragmented');
      expect(retained).toBeLessThan(0.67);
    }
  });

  it('the permanent channel is a narrow track inside a temporary cavity several calibres wide', () => {
    for (const { bullet } of GEL_REFERENCE.filter((r) => r.cavityM !== undefined)) {
      const timeline = shoot(bullet);
      const widest = timeline.summary.maxCavityDiameter;
      expect(widest).toBeGreaterThan(5 * (bullet.caliberMm / 1000));
      const channel = Math.max(...timeline.cavity.map((c) => c.channelRadius * 2));
      expect(channel).toBeLessThan(widest / 4);
    }
  });

  it('a heavier TAP round goes deeper than a light one, as measured', () => {
    const [light, mid, heavy] = GEL_REFERENCE.slice(0, 3).map((r) => shoot(r.bullet).summary.penetrationM);
    expect(light).toBeLessThan(mid);
    expect(mid).toBeLessThan(heavy);
  });
});
