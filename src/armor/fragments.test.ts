import { describe, expect, it } from 'vitest';
import {
  FLOOR_RESTITUTION,
  GRAVITY,
  MAX_FRAGMENTS,
  MAX_SEGMENTS,
  buildTrack,
  fragmentRoom,
  fragmentStateAt,
  seededRandom,
  withFragments,
  type FragmentSeed,
} from './fragments';
import { getPlateMaterial } from './materials';
import type { ArmorShot, FragmentField } from './model';
import { impactState, type MunitionFamilyId } from './munitions';
import { simulateArmor } from './simulate';
import { simulateStack } from './stack';

const room = fragmentRoom(0.1);
const seed = (over: Partial<FragmentSeed> = {}): FragmentSeed => ({
  kind: 'shard',
  t0: 0,
  x: room.rearX,
  y: 0,
  vx: 40,
  vy: 5,
  lengthM: 0.02,
  widthM: 0.01,
  massKg: 0.05,
  hot: false,
  ...over,
});
const shotOf = (family: MunitionFamilyId, thicknessM: number, obliquityDeg = 0, material: 'rha' | 'cast-iron' = 'rha', calibreMm = 120): ArmorShot => ({
  impact: impactState(family, calibreMm),
  material: getPlateMaterial(material),
  thicknessM,
  obliquityDeg,
});

describe('test room (#165)', () => {
  it('has a box either side of the plate, as deep as the air the section view leaves', () => {
    expect(room.frontX).toBe(0);
    expect(room.rearX).toBeCloseTo(0.1, 12);
    expect(room.rightX - room.rearX).toBeCloseTo(0 - room.leftX, 12);
    expect(room.floorY).toBeLessThan(0);
    expect(room.ceilingY).toBeCloseTo(-room.floorY, 12);
  });
});

describe('fragment flight (#165)', () => {
  it('follows a parabola between bounces', () => {
    const track = buildTrack(seed({ vx: 0.5, vy: 1, x: room.rearX + 0.01, y: 0 }), room);
    const a = fragmentStateAt(track, 0.05);
    expect(a.x).toBeCloseTo(room.rearX + 0.01 + 0.5 * 0.05, 9);
    expect(a.y).toBeCloseTo(1 * 0.05 - 0.5 * GRAVITY * 0.05 ** 2, 9);
  });

  it('is a pure function of time: asking out of order gives the same answers', () => {
    const track = buildTrack(seed(), room);
    const times = [0.5, 0.0002, 0.03, 0.0002, 0.5, 1e-5];
    const first = times.map((t) => fragmentStateAt(track, t));
    const again = [...times].reverse().map((t) => fragmentStateAt(track, t)).reverse();
    expect(again).toEqual(first);
  });

  it('is continuous in position through every bounce', () => {
    const track = buildTrack(seed({ vx: 300, vy: 120 }), room);
    expect(track.segments.length).toBeGreaterThan(3);
    for (let i = 1; i < track.segments.length; i++) {
      const s = track.segments[i];
      const prev = track.segments[i - 1];
      const dt = s.t0 - prev.t0;
      expect(s.x).toBeCloseTo(prev.x + prev.vx * dt + 0.5 * prev.ax * dt * dt, 6);
      expect(s.y).toBeCloseTo(prev.y + prev.vy * dt + 0.5 * prev.ay * dt * dt, 6);
    }
  });

  it('never leaves the box it was thrown into', () => {
    for (const [vx, vy] of [[900, 40], [-500, 300], [60, -80], [5, 400]]) {
      for (const fromRear of [true, false]) {
        const track = buildTrack(seed({ x: fromRear ? room.rearX : 0, vx: fromRear ? Math.abs(vx) : -Math.abs(vx), vy }), room);
        const end = track.segments[track.segments.length - 1].t0;
        for (let k = 0; k <= 200; k++) {
          const s = fragmentStateAt(track, (end * k) / 200);
          if (fromRear) {
            expect(s.x).toBeGreaterThanOrEqual(room.rearX - 1e-9);
            expect(s.x).toBeLessThanOrEqual(room.rightX + 1e-9);
          } else {
            expect(s.x).toBeGreaterThanOrEqual(room.leftX - 1e-9);
            expect(s.x).toBeLessThanOrEqual(room.frontX + 1e-9);
          }
          expect(s.y).toBeGreaterThanOrEqual(room.floorY - 1e-9);
          expect(s.y).toBeLessThanOrEqual(room.ceilingY + 1e-9);
        }
      }
    }
  });

  it('bounces off the floor with restitution, then lower each time', () => {
    const y0 = 0.09;
    const track = buildTrack(seed({ vx: 0, vy: 0, y: y0 }), room);
    const floorY = room.floorY + 0.005;
    const hits = track.segments.filter((s, i) => i > 0 && Math.abs(s.y - floorY) < 1e-9 && s.vy > 0);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].vy).toBeCloseTo(FLOOR_RESTITUTION * Math.sqrt(2 * GRAVITY * (y0 - floorY)), 6);
    for (let i = 1; i < hits.length; i++) expect(hits[i].vy).toBeLessThan(hits[i - 1].vy);
  });

  it('reverses and slows against a wall', () => {
    const track = buildTrack(seed({ vx: 100, vy: 0, y: 0 }), room);
    const afterWall = track.segments.find((s) => s.vx < 0);
    expect(afterWall).toBeDefined();
    expect(Math.abs(afterWall!.vx)).toBeLessThan(100);
  });

  it('settles on the floor and stays there', () => {
    for (const [vx, vy] of [[900, 40], [60, -80], [5, 400]]) {
      const track = buildTrack(seed({ vx, vy }), room);
      const end = track.segments[track.segments.length - 1];
      const rest = fragmentStateAt(track, end.t0 + 100);
      expect(rest.resting).toBe(true);
      expect(rest.y).toBeCloseTo(room.floorY + 0.005, 6);
      expect(fragmentStateAt(track, end.t0 + 1000)).toEqual(rest);
      expect(track.segments.length).toBeLessThanOrEqual(MAX_SEGMENTS);
    }
  });

  it('ends at rest on the floor, with nothing left moving', () => {
    const track = buildTrack(seed({ vx: 20, vy: 10 }), room);
    const end = track.segments[track.segments.length - 1];
    expect(end.vx).toBe(0);
    expect(end.vy).toBe(0);
    expect(end.y).toBeCloseTo(room.floorY + 0.005, 6);
  });

  it('tumbles while it flies and stops turning at rest', () => {
    const track = buildTrack(seed({ vx: 50, vy: 20 }), room);
    expect(Math.abs(fragmentStateAt(track, 1e-4).angle - fragmentStateAt(track, 0).angle)).toBeGreaterThan(0);
    const end = track.segments[track.segments.length - 1].t0;
    expect(fragmentStateAt(track, end + 1).angle).toBe(fragmentStateAt(track, end + 5).angle);
  });

  it('does not start before it is thrown', () => {
    const track = buildTrack(seed({ t0: 0.002 }), room);
    expect(track.t0).toBe(0.002);
    expect(track.segments[0].t0).toBe(0.002);
  });
});

describe('seeded random (#165)', () => {
  it('repeats for the same seed and differs for another', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const c = seededRandom(8);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect([c(), c(), c()]).not.toEqual(xs);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('what each shot throws (#165)', () => {
  it('throws a plug from a plugged plate, leaving the rear face', () => {
    const tl = simulateArmor(shotOf('ap-shot', 0.06));
    expect(tl.result.plug).toBeDefined();
    const plug = tl.fragments!.tracks.find((t) => t.kind === 'plug')!;
    expect(plug.massKg).toBeCloseTo(tl.result.plug!.massKg, 9);
    expect(plug.segments[0].vx).toBeCloseTo(tl.result.plug!.velocity, 6);
    expect(plug.t0).toBe(tl.events.find((e) => e.type === 'perforate')!.t);
  });

  it('throws a scab from a spalled plate and nothing from one that holds', () => {
    const spalls = simulateArmor(shotOf('hesh', 0.03, 0, 'cast-iron'));
    expect(spalls.result.scab).toBeDefined();
    expect(spalls.fragments!.tracks.some((t) => t.kind === 'scab')).toBe(true);
    const holds = simulateArmor(shotOf('hesh', 0.3));
    expect(holds.result.scab).toBeUndefined();
    expect(holds.fragments).toBeUndefined();
  });

  it('throws a jet debris cone behind a perforated plate', () => {
    const tl = simulateArmor(shotOf('heat', 0.1));
    expect(tl.result.perforated).toBe(true);
    const kinds = new Set(tl.fragments!.tracks.map((t) => t.kind));
    expect(kinds.has('jet')).toBe(true);
    expect(kinds.has('spall')).toBe(true);
    for (const t of tl.fragments!.tracks) expect(t.segments[0].vx).toBeGreaterThan(0);
  });

  it('hands the penetrator over to a track once it is through, so it bounces too', () => {
    const tl = simulateArmor(shotOf('apfsds', 0.05));
    expect(tl.result.perforated).toBe(true);
    expect(tl.fragments!.handoffS).toBe(tl.events.find((e) => e.type === 'perforate')!.t);
    expect(tl.fragments!.tracks.some((t) => t.kind === 'penetrator')).toBe(true);
  });

  it('throws nothing from a plate that stops the round', () => {
    const tl = simulateArmor(shotOf('apfsds', 0.3, 0, 'rha', 40));
    expect(tl.result.perforated).toBe(false);
    expect(tl.fragments).toBeUndefined();
  });

  it('throws the pieces of a shattered shot, up to the cap', () => {
    const tl = simulateArmor(shotOf('ap-shot', 0.04, 60));
    expect(tl.result.shattered).toBe(true);
    expect(tl.result.perforated).toBe(true);
    const shards = tl.fragments!.tracks.filter((t) => t.kind === 'shard');
    expect(shards.length).toBe(Math.min(tl.result.fragments, MAX_FRAGMENTS));
  });

  it('sends a ricochet back out of the front face, as one piece for a rod and many for shattered shot', () => {
    const rod = simulateArmor(shotOf('apfsds', 0.1, 85));
    expect(rod.fragments!.tracks).toHaveLength(1);
    expect(rod.fragments!.tracks[0].kind).toBe('penetrator');
    expect(rod.fragments!.tracks[0].segments[0].vx).toBeLessThan(0);
    expect(rod.fragments!.handoffS).toBe(rod.events.find((e) => e.type === 'ricochet')!.t);
    const shot = simulateArmor(shotOf('ap-shot', 0.1, 80));
    expect(shot.result.shattered).toBe(true);
    expect(shot.fragments!.tracks.length).toBeGreaterThan(5);
    for (const t of shot.fragments!.tracks) expect(t.segments[0].vx).toBeLessThan(0);
  });

  it('throws the same pieces for the same shot', () => {
    expect(simulateArmor(shotOf('heat', 0.1)).fragments).toEqual(simulateArmor(shotOf('heat', 0.1)).fragments);
  });

  it('every piece comes to rest, and the field says when', () => {
    for (const tl of [simulateArmor(shotOf('heat', 0.1)), simulateArmor(shotOf('ap-shot', 0.04, 60)), simulateArmor(shotOf('apfsds', 0.1, 85))]) {
      const field = tl.fragments!;
      expect(field.restS).toBeGreaterThan(0);
      for (const t of field.tracks) expect(fragmentStateAt(t, field.restS + 1).resting).toBe(true);
    }
  });

  it('adds nothing to a timeline that throws nothing', () => {
    const tl = simulateArmor(shotOf('apfsds', 0.3, 0, 'rha', 40));
    expect(withFragments(tl)).toBe(tl);
  });
});

describe('pieces about as large as the room', () => {
  /** Every track flies, lands and rests in order, with finite, sensible angles. */
  const expectSettles = (field: FragmentField) => {
    const { room } = field;
    for (const tr of field.tracks) {
      expect(tr.segments.length).toBeLessThan(MAX_SEGMENTS - 2);
      expect(field.restS).toBeGreaterThanOrEqual(tr.t0);
      for (let i = 1; i < tr.segments.length; i++) expect(tr.segments[i].t0).toBeGreaterThanOrEqual(tr.segments[i - 1].t0);
      expect(fragmentStateAt(tr, tr.t0).resting).toBe(false);
      const end = tr.segments[tr.segments.length - 1].t0;
      for (let k = 0; k <= 50; k++) {
        const s = fragmentStateAt(tr, tr.t0 + ((end - tr.t0) * k) / 50);
        expect(Number.isFinite(s.angle)).toBe(true);
        expect(Math.abs(s.angle)).toBeLessThan(100);
        expect(s.x).toBeGreaterThanOrEqual(room.leftX - 1e-9);
        expect(s.x).toBeLessThanOrEqual(room.rightX + 1e-9);
        expect(s.y).toBeGreaterThanOrEqual(room.floorY - 1e-9);
        expect(s.y).toBeLessThanOrEqual(room.ceilingY + 1e-9);
      }
      const rest = fragmentStateAt(tr, field.restS + 1);
      expect(rest.resting).toBe(true);
      expect(rest.y).toBeLessThan(0);
    }
  };

  it('lands and rests the plug and the 88 mm shot thrown through 40 mm RHA', () => {
    const stack = simulateStack({ impact: impactState('ap-shot', 88), layers: [{ material: getPlateMaterial('rha'), thicknessM: 0.04, gapBeforeM: 0 }], obliquityDeg: 0 });
    const field = stack.fragments!;
    expect(field.tracks.map((t) => t.kind).sort()).toEqual(['penetrator', 'plug']);
    expectSettles(field);
  });

  // A sweep of 160 simulations: slow enough to pass 5 s when the whole suite runs in parallel.
  it('lands and rests what large-calibre shots throw through thin plates', { timeout: 30_000 }, () => {
    const families: MunitionFamilyId[] = ['ap-shot', 'apfsds', 'heat', 'hesh'];
    let fields = 0;
    for (const family of families) {
      for (const calibreMm of [76, 88, 105, 120, 125]) {
        for (const thicknessM of [0.005, 0.01, 0.02, 0.04]) {
          for (const obliquityDeg of [0, 45]) {
            const field = simulateArmor(shotOf(family, thicknessM, obliquityDeg, 'rha', calibreMm)).fragments;
            if (!field) continue;
            fields++;
            expectSettles(field);
          }
        }
      }
    }
    expect(fields).toBeGreaterThan(20);
  });
});
