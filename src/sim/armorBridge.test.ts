import { describe, expect, it } from 'vitest';
import { getPlateMaterial } from '../armor/materials';
import { getBullet } from '../data/bullets';
import { getMedium } from '../data/media';
import { jetStandoffFactor, missileId } from '../data/missiles';
import { MIN_JET_SPEED_MS, jetLengthFor, jetReachIn, plateMaterialFor, rodThroughPlate, steadyDecel } from './armorBridge';
import { fire } from './testUtil';

const rha = getPlateMaterial('rha');
const shoot = (bullet: string, medium: string, thickness: number) => fire({ bullet, medium, thickness });

describe('the Armor lab models in the Artillery and Missile simulators (#204)', () => {
  it('maps the metal targets onto the lab plates and leaves everything else to the engine', () => {
    expect(plateMaterialFor(getMedium('rha-plate'))?.id).toBe('rha');
    expect(plateMaterialFor(getMedium('tank-hull'))?.id).toBe('rha');
    expect(plateMaterialFor(getMedium('mild-plate'))?.id).toBe('mild-steel');
    expect(plateMaterialFor(getMedium('cast-iron-plate'))?.id).toBe('cast-iron');
    expect(plateMaterialFor(getMedium('aluminum'))?.id).toBe('al-5083');
    for (const id of ['reinforced-concrete', 'concrete-c35', 'gel10', 'packed-earth', 'gong', 'steel-ball']) expect(plateMaterialFor(getMedium(id)), id).toBeNull();
  });

  it('stops an APFSDS dart at the Tate depth in thick RHA', () => {
    const b = getBullet('120mm-apfsds');
    const tate = rodThroughPlate({ speed: b.muzzleVelocityMs, massKg: 4, lengthM: b.lengthMm / 1000 }, rha, 1.0);
    expect(tate.perforated).toBe(false);
    const s = shoot('120mm-apfsds', 'rha', 1.0).summary;
    expect(s.passedThrough).toBe(false);
    expect(s.penetrationM).toBeGreaterThan(tate.depthM * 0.97);
    expect(s.penetrationM).toBeLessThan(tate.depthM * 1.03);
  });

  it('gets a dart through thinner plate at about the Tate residual speed', () => {
    const b = getBullet('120mm-apfsds');
    const tate = rodThroughPlate({ speed: b.muzzleVelocityMs, massKg: 4, lengthM: b.lengthMm / 1000 }, rha, 0.3);
    const s = shoot('120mm-apfsds', 'rha-plate', 0.3).summary;
    expect(tate.perforated).toBe(true);
    expect(s.passedThrough).toBe(true);
    // The air in front of the plate takes a little off before it arrives.
    expect(s.exitSpeed).toBeGreaterThan(tate.residualSpeed * 0.9);
    expect(s.exitSpeed).toBeLessThan(tate.residualSpeed * 1.02);
  });

  it('digs a shaped-charge jet to the density-law reach in thick RHA', () => {
    // The Explosion lab's cutting charge is the shaped charge left in the catalogue.
    const b = getBullet('charge-shaped');
    const jet = b.blast!.jet!;
    const reach = jetReachIn(jetLengthFor(b.caliberMm, jetStandoffFactor(jet.standoffCal) * (jet.lengthScale ?? 1)), rha);
    const depth = shoot('charge-shaped', 'rha', 1.0).summary.penetrationM;
    expect(depth).toBeGreaterThan(reach * 0.92);
    expect(depth).toBeLessThan(reach * 1.08);
  });

  it('puts a jet through plate thinner than its reach, where the old law stopped it', () => {
    const s = shoot('charge-shaped', 'rha-plate', 0.3).summary;
    expect(jetReachIn(jetLengthFor(100), rha)).toBeGreaterThan(0.3);
    expect(s.passedThrough).toBe(true);
  });

  it('digs a jet deeper into lighter metal, by the density law', () => {
    const steel = shoot('charge-shaped', 'rha', 1.0).summary.penetrationM;
    expect(jetReachIn(1, getPlateMaterial('mild-steel'))).toBeCloseTo(jetReachIn(1, rha), 9);
    expect(jetReachIn(1, getPlateMaterial('al-5083')) / jetReachIn(1, rha)).toBeGreaterThan(1.6);
    expect(steel).toBeGreaterThan(0);
  });

  it('leaves the slow slug of a formed penetrator to the engine law', () => {
    const efp = getBullet(missileId('guided-at', 'efp')).blast!.jet!;
    expect(efp.speedMs).toBeLessThan(MIN_JET_SPEED_MS);
  });

  it('gives a steady deceleration that ends at the exit speed or at rest at the depth', () => {
    const a = steadyDecel(1000, { perforated: true, depthM: 0.2, exitSpeed: 600 }, 0.2);
    expect(1000 ** 2 - 2 * a * 0.2).toBeCloseTo(600 ** 2, 6);
    const b = steadyDecel(1000, { perforated: false, depthM: 0.1, exitSpeed: 0 }, 0.3);
    expect(1000 ** 2 / (2 * b)).toBeCloseTo(0.1, 9);
  });

  it('does not touch the Bullet lab', () => {
    // A Bullet-mode round into armour plate keeps the engine law (no darts or jets there).
    const s = shoot('308-sp', 'rha', 0.02).summary;
    expect(s.passedThrough).toBe(false);
  });
});
