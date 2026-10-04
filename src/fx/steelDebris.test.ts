import { describe, expect, it } from 'vitest';
import { getMedium } from '../data/media';
import { layersFor, simulate } from '../sim/engine';
import { bulletAt } from '../sim/testUtil';
import { loadHardEffect } from './hardEffect';
import type { BurstSpec } from './particles';
import type { HoleSpec } from './holes';

/** What a steel plate throws on entry and exit (#219, #220). Sim times are in seconds. */
function shoot(bullet: string, thickness: number, medium = 'steel-mild') {
  const m = getMedium(medium);
  const layers = layersFor(m, thickness);
  const timeline = simulate({ bullet: bulletAt(bullet), layers, angleDeg: 0, impactPoint: { x: -0.2, y: 0.16, z: 0 }, standOffM: 0.5 });
  const bursts: BurstSpec[] = [];
  const holes: HoleSpec[] = [];
  loadHardEffect(
    timeline,
    layers,
    { add: (b: BurstSpec) => bursts.push(b), addFlash: () => undefined } as never,
    { add: (h: HoleSpec) => holes.push(h) } as never,
  );
  const impact = timeline.events.find((e) => e.type === 'impact' || e.type === 'enter')!;
  const exit = timeline.events.find((e) => e.type === 'exit');
  return { bursts, holes, timeline, impact, exit };
}

const dark = (b: BurstSpec) => b.look === 'dust' && b.color === 0x26262a;

describe('steel plate blow-back on entry (#219)', () => {
  it('throws a dark rear-facing cone about 1.3 rad wide that is gone within 100 us', () => {
    const { bursts, impact } = shoot('308-sp', 0.002);
    const cloud = bursts.filter(dark);
    expect(cloud).toHaveLength(1);
    const [c] = cloud;
    expect(c.spread).toBeCloseTo(1.3, 5);
    expect(c.life[0]).toBeGreaterThanOrEqual(60e-6 - 1e-12);
    expect(c.life[1]).toBeLessThanOrEqual(100e-6 + 1e-12);
    expect(c.t0).toBeCloseTo(impact.t, 9);
    // It leaves the struck face, back towards the shooter.
    expect(c.axis.x).toBeLessThan(0);
  });

  it('adds one droplet sheet up and one down the plate, hugging the face', () => {
    const { bursts } = shoot('308-sp', 0.002);
    const sheets = bursts.filter((b) => b.look === 'droplet');
    expect(sheets).toHaveLength(2);
    expect(sheets[0].axis.y * sheets[1].axis.y).toBeLessThan(0);
    for (const s of sheets) expect(Math.abs(s.axis.y)).toBeGreaterThan(0.9);
  });

  it('nothing spawns before the impact event', () => {
    const { bursts, impact } = shoot('308-sp', 0.002);
    for (const b of bursts) expect(b.t0).toBeGreaterThanOrEqual(impact.t - 1e-12);
  });

  it('a round that splashes off AR500 still throws the cloud', () => {
    const { bursts, exit } = shoot('9mm-fmj', 0.0095, 'steel-ar500');
    expect(exit).toBeUndefined();
    expect(bursts.filter(dark)).toHaveLength(1);
  });
});

describe('steel plate exit (#220)', () => {
  const { bursts, holes, timeline, exit } = shoot('308-sp', 0.002);

  it('perforates', () => expect(exit).toBeDefined());

  it('a 2-3 mm plug chip leaves at 0.8 of the bullet speed', () => {
    const plug = bursts.find((b) => b.look === 'chunk' && b.count === 1)!;
    expect(plug.t0).toBeCloseTo(exit!.t, 9);
    expect(plug.speed[0]).toBeCloseTo(exit!.speed * 0.8, 5);
    expect(plug.size[0]).toBeGreaterThanOrEqual(0.002);
    expect(plug.size[1]).toBeLessThanOrEqual(0.003);
  });

  it('a dark debris string trails along the axis at 0.2-0.8 of the bullet speed for about 100 us', () => {
    const string = bursts.find((b) => b.look === 'grain' && b.color === 0x26262a)!;
    expect(string.spread).toBeLessThan(0.2);
    expect(string.speed[0]).toBeCloseTo(exit!.speed * 0.2, 5);
    expect(string.speed[1]).toBeCloseTo(exit!.speed * 0.8, 5);
    expect(string.life[1]).toBeLessThanOrEqual(130e-6);
    expect(string.life[0]).toBeGreaterThanOrEqual(80e-6 - 1e-12);
  });

  it('the bright side chips follow the 14 shed fragments: about 10, spread about 1.3 rad', () => {
    expect(timeline.tracks.filter((t) => t.kind === 'fragment')).toHaveLength(14);
    const chips = bursts.find((b) => b.look === 'shard' && b.spread === 1.3)!;
    expect(chips.count).toBe(10);
  });

  it('the back hole has 3-8 petals', () => {
    const back = holes[holes.length - 1];
    expect(back.rim!.count).toBeGreaterThanOrEqual(3);
    expect(back.rim!.count).toBeLessThanOrEqual(8);
  });

  it('a gentler round gets fewer petals than a violent one', () => {
    const slow = shoot('9mm-fmj', 0.0008);
    const fast = shoot('308-sp', 0.002);
    expect(slow.exit).toBeDefined();
    const petals = (s: typeof slow) => s.holes[s.holes.length - 1].rim!.count;
    expect(petals(slow)).toBeLessThan(petals(fast));
  });

  it('a plate that holds sheds no plug, string or side chips', () => {
    const held = shoot('9mm-fmj', 0.05);
    expect(held.exit).toBeUndefined();
    expect(held.bursts.some((b) => b.look === 'shard' && b.spread === 1.3)).toBe(false);
    expect(held.bursts.some((b) => b.look === 'chunk' && b.count === 1)).toBe(false);
  });
});
