import { describe, expect, it } from 'vitest';
import { getBullet } from '../data/bullets';
import { getMedium } from '../data/media';
import { airBlastYieldKg, blastResponse, reflectedImpulsePaS, standFor, tipRatio } from './blastResponse';
import type { TargetLayer } from './engine';

/** Whether a blast tips a target over is a matter of its impulse against the stand's weight and base (#320). */

const layer = (id: string, offset = 0, stack = 0, thickness?: number): TargetLayer => {
  const medium = getMedium(id);
  return { medium, thickness: thickness ?? medium.thickness.default, offset, stack };
};
const air = (id: string) => airBlastYieldKg(getBullet(id).blast!);

describe('blast toppling (#320)', () => {
  it('a cutting charge in contact with three AR500 plates cuts them, it does not knock the stand over', () => {
    // The report: three 9.5 mm AR500 plates 10 cm apart, then gel, the linear shaped charge at contact.
    const stack = [layer('steel-ar500', 0, 0, 0.0095), layer('steel-ar500', 0.11, 1, 0.0095), layer('steel-ar500', 0.22, 2, 0.0095), layer('gel10', 0.33, 3)];
    const out = blastResponse(air('charge-shaped'), 0, stack);
    for (const l of out) expect(['intact', 'cracked']).toContain(l.outcome);
    expect(out[0].tip).toBeLessThan(0.5);
  });

  it('puts only part of a cutting or cased charge into the sideways blast', () => {
    expect(air('charge-shaped')).toBeLessThan(getBullet('charge-shaped').blast!.yieldKg * 0.5);
    expect(air('charge-cased')).toBeLessThan(getBullet('charge-cased').blast!.yieldKg);
    expect(air('charge-block')).toBe(getBullet('charge-block').blast!.yieldKg);
  });

  it('a multi-kilogram charge a metre from a light wooden panel still takes it down', () => {
    const [panel] = blastResponse(air('charge-satchel'), 1, [layer('pine')]);
    expect(['toppled', 'destroyed']).toContain(panel.outcome);
  });

  it('a multi-kilogram charge a metre away knocks over a loose concrete block, and a small one does not', () => {
    const big = blastResponse(air('charge-satchel'), 1, [layer('concrete')])[0];
    expect(big.outcome).toBe('toppled');
    expect(big.tiltRad).toBeGreaterThan(0.3);
    const small = blastResponse(air('charge-flash'), 1, [layer('concrete')])[0];
    expect(small.outcome).not.toBe('toppled');
  });

  it('pushes harder with more yield, less with range and less on a heavier stand', () => {
    const stand = standFor(getMedium('concrete'), 0.19);
    const tip = (kg: number, m: number) => tipRatio(stand, reflectedImpulsePaS(kg, m));
    expect(tip(4, 2)).toBeGreaterThan(tip(1, 2));
    expect(tip(1, 1)).toBeGreaterThan(tip(1, 2));
    expect(tip(1, 2)).toBeGreaterThan(tip(1, 4));
    const heavier = { ...stand, massKg: stand.massKg * 2 };
    expect(tipRatio(heavier, reflectedImpulsePaS(1, 2))).toBeLessThan(tip(1, 2));
  });

  it('never moves a proving-ground target: a large plate in its footing, a wall, a berm, a tank', () => {
    for (const id of ['ar500-plate', 'bunker-wall', 'earth-berm-full', 'tank-hull']) {
      const [l] = blastResponse(air('charge-satchel'), 0, [layer(id)]);
      expect(l.outcome).not.toBe('toppled');
      expect(l.tip).toBe(0);
    }
  });

  it('holds the pressure at the near-field limit instead of extrapolating to contact', () => {
    const [touching] = blastResponse(1, 0, [layer('steel-ar500')]);
    const [close] = blastResponse(1, 0.5, [layer('steel-ar500')]);
    expect(touching.pressureKPa).toBeCloseTo(close.pressureKPa, 0);
    expect(touching.pressureKPa).toBeLessThan(20_000);
  });
});
