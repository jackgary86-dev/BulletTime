import { describe, expect, it } from 'vitest';
import { getMedium } from '../data/media';
import { layersFor, simulate } from '../sim/engine';
import { bulletAt } from '../sim/testUtil';
import { loadHardEffect } from './hardEffect';
import type { HoleSpec } from './holes';
import { DISH_HELD, DISH_PERFORATED, dishDepthAt, dishFalloff, dishStiffness, planDishes } from './plateDishMath';

/** Rear dishing of a metal plate (#221). */
function shoot(bullet: string, thickness: number, medium = 'steel-mild') {
  const layers = layersFor(getMedium(medium), thickness);
  const timeline = simulate({ bullet: bulletAt(bullet), layers, angleDeg: 0, impactPoint: { x: -0.2, y: 0.16, z: 0 }, standOffM: 0.5 });
  return { timeline, layers, dishes: planDishes(timeline, layers) };
}
const diameterOf = (bullet: string) => bulletAt(bullet).caliberMm / 1000;

describe('plate dish (#221)', () => {
  it('a perforated plate bulges 0.3 bullet diameters, growing from contact to exit', () => {
    const { timeline, dishes } = shoot('308-sp', 0.002);
    const exit = timeline.events.find((e) => e.type === 'exit')!;
    expect(dishes).toHaveLength(1);
    const [dish] = dishes;
    expect(dish.depthM).toBeCloseTo(diameterOf('308-sp') * DISH_PERFORATED, 4);
    expect(dishDepthAt(dish, dish.t0 - 1e-6)).toBe(0);
    expect(dishDepthAt(dish, dish.t0)).toBe(0);
    expect(dishDepthAt(dish, exit.t)).toBeCloseTo(dish.depthM, 9);
    const mid = dishDepthAt(dish, (dish.t0 + exit.t) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(dish.depthM);
    // It stays after the hole opens.
    expect(dishDepthAt(dish, exit.t + 1e-3)).toBeCloseTo(dish.depthM, 9);
  });

  it('is about 2.5 bullet radii wide and falls off as a Gaussian', () => {
    const [dish] = shoot('308-sp', 0.002).dishes;
    expect(dish.sigmaM).toBeCloseTo(2.5 * (diameterOf('308-sp') / 2), 6);
    expect(dishFalloff(dish, 0)).toBe(1);
    expect(dishFalloff(dish, dish.sigmaM)).toBeCloseTo(Math.exp(-0.5), 9);
    expect(dishFalloff(dish, 4 * dish.sigmaM)).toBeLessThan(0.001);
  });

  it('a plate that holds keeps a smaller dent, in place after the strike', () => {
    const { timeline, dishes } = shoot('9mm-fmj', 0.0095, 'steel-ar500');
    expect(timeline.events.some((e) => e.type === 'exit')).toBe(false);
    expect(dishes).toHaveLength(1);
    expect(dishes[0].depthM).toBeCloseTo(diameterOf('9mm-fmj') * DISH_HELD, 4);
    expect(dishDepthAt(dishes[0], dishes[0].t0 + 1)).toBeCloseTo(dishes[0].depthM, 9);
  });

  it('thick plate does not bow', () => {
    expect(dishStiffness(0.005, 0.01)).toBe(1);
    expect(dishStiffness(0.05, 0.01)).toBe(0);
    expect(shoot('9mm-fmj', 0.05).dishes).toHaveLength(0);
  });

  it('only metal plates bulge', () => {
    expect(shoot('308-sp', 0.05, 'gel10').dishes).toHaveLength(0);
    expect(shoot('308-sp', 0.045, 'concrete-c35').dishes).toHaveLength(0);
  });

  it('the exit hole is lifted onto the bulge', () => {
    const { timeline, layers, dishes } = shoot('308-sp', 0.002);
    const exit = timeline.events.find((e) => e.type === 'exit')!;
    const holes: HoleSpec[] = [];
    loadHardEffect(timeline, layers, { add: () => undefined, addFlash: () => undefined } as never, { add: (h: HoleSpec) => holes.push(h) } as never);
    const back = holes[holes.length - 1];
    expect((back.pos as { x: number }).x - exit.pos.x).toBeCloseTo(dishes[0].depthM * (exit.normal?.x ?? 1), 6);
  });
});
