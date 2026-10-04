import { describe, expect, it } from 'vitest';
import { CONCRETE_REFERENCE_BULLET } from '../data/concreteReference';
import { getMedium } from '../data/media';
import { layersFor, simulate } from '../sim/engine';
import { loadHardEffect } from './hardEffect';
import type { BurstSpec } from './particles';
import type { HoleSpec } from './holes';

/** What a concrete panel throws, and when (#224). */
function shoot(grade: string, speed = 207) {
  const medium = getMedium(`concrete-${grade.toLowerCase()}`);
  const layers = layersFor(medium, 0.045);
  const timeline = simulate({
    bullet: { ...CONCRETE_REFERENCE_BULLET, muzzleVelocityMs: speed },
    layers,
    angleDeg: 0,
    impactPoint: { x: -0.2, y: 0.16, z: 0 },
    standOffM: 0.5,
  });
  const bursts: BurstSpec[] = [];
  const holes: HoleSpec[] = [];
  loadHardEffect(
    timeline,
    layers,
    { add: (b: BurstSpec) => bursts.push(b), addFlash: () => undefined } as never,
    { add: (h: HoleSpec) => holes.push(h) } as never,
  );
  const impact = timeline.events.find((e) => e.type === 'impact' || e.type === 'enter')!;
  return { bursts, holes, impactT: impact.t, medium };
}

const chunks = (bursts: BurstSpec[]) => bursts.filter((b) => b.look === 'chunk');

describe('concrete debris timeline', () => {
  it.each([
    ['C35', 1.8e-3],
    ['C75', 2.2e-3],
    ['C110', 2.8e-3],
  ])('%s lets its back scab go %f s after impact', (grade, release) => {
    const { holes, impactT } = shoot(grade);
    const scab = holes[holes.length - 1];
    expect(scab.t - impactT).toBeCloseTo(release, 5);
  });

  it('the scab chips fly at 10-60 m/s and the slabs at 8-30 m/s', () => {
    for (const grade of ['C35', 'C75', 'C110']) {
      const { medium } = shoot(grade);
      const d = medium.concreteDamage!.debris;
      expect(d.chips.speed[0]).toBeGreaterThanOrEqual(10);
      expect(d.chips.speed[1]).toBeLessThanOrEqual(60);
      if (d.slabs) {
        expect(d.slabs.speed[0]).toBeGreaterThanOrEqual(8);
        expect(d.slabs.speed[1]).toBeLessThanOrEqual(30);
      }
    }
  });

  it('only C110 sheds large slabs, and they are bigger than any chip', () => {
    for (const grade of ['C35', 'C75']) expect(shoot(grade).medium.concreteDamage!.debris.slabs).toBeUndefined();
    const d = shoot('C110').medium.concreteDamage!.debris;
    expect(d.slabs!.count).toBe(3);
    expect(d.slabs!.size[0]).toBeGreaterThan(d.chips.size[1]);
    const released = chunks(shoot('C110').bursts).filter((b) => b.count === 3);
    expect(released).toHaveLength(1);
    expect(released[0].t0 - shoot('C110').impactT).toBeCloseTo(2.8e-3, 5);
  });

  it('chips get fewer and bigger as the concrete gets stronger', () => {
    const [a, b, c] = ['C35', 'C75', 'C110'].map((g) => shoot(g).medium.concreteDamage!.debris);
    expect(a.chips.count).toBeGreaterThan(b.chips.count);
    expect(b.chips.count).toBeGreaterThan(c.chips.count);
    expect(a.chips.size[1]).toBeLessThan(b.chips.size[1]);
    expect(b.chips.size[1]).toBeLessThan(c.chips.size[1]);
  });

  it('the front cloud lingers longest for C110 and the heaviest cloud is C35', () => {
    const [a, b, c] = ['C35', 'C75', 'C110'].map((g) => shoot(g).medium.concreteDamage!.debris);
    expect(c.frontLife).toBeGreaterThan(b.frontLife);
    expect(b.frontLife).toBeGreaterThan(a.frontLife);
    expect(a.frontDust).toBeGreaterThan(b.frontDust);
    expect(b.frontDust).toBeGreaterThan(c.frontDust);
  });

  it('the front blow-back starts at impact, before anything leaves the back', () => {
    const { bursts, impactT } = shoot('C35');
    const dusts = bursts.filter((b) => b.look === 'dust').sort((x, y) => x.t0 - y.t0);
    expect(dusts[0].t0).toBeCloseTo(impactT, 9);
    expect(bursts.some((b) => b.t0 >= impactT + 1.8e-3 - 1e-9 && b.look === 'chunk')).toBe(true);
  });
});
