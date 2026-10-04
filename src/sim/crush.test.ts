import { describe, expect, it } from 'vitest';
import { CONCRETE_REFERENCE_BULLET } from '../data/concreteReference';
import { getMedium } from '../data/media';
import { CRUSH_ABSORBED, CRUSH_SHORTEN, CRUSH_STUB, CRUSH_WIDEN, CRUSH_ZONE, crushFromSpeed, crushShape } from './crush';
import { layersFor, simulate } from './engine';
import { sampleTrack } from './sample';
import { fire } from './testUtil';

/** A bullet crushed by concrete shows it in the replay and carries it past the panel (#226). */
function shootConcrete(grade: string, speed: number) {
  const timeline = simulate({
    bullet: { ...CONCRETE_REFERENCE_BULLET, muzzleVelocityMs: speed },
    layers: layersFor(getMedium(`concrete-${grade}`), 0.045),
    angleDeg: 0,
    impactPoint: { x: -0.2, y: 0.16, z: 0 },
    standOffM: 0.5,
  });
  const track = timeline.tracks[0];
  const impact = timeline.events.find((e) => e.type === 'impact' || e.type === 'enter')!.t;
  return { timeline, track, impact, at: (ms: number) => sampleTrack(track, impact + ms * 1e-3) };
}

describe('crush shape', () => {
  it('is 45% shorter and 35% wider when fully crushed, and untouched at zero', () => {
    expect(crushShape(0)).toEqual({ widthRatio: 1, lengthFraction: 1 });
    expect(crushShape(1).widthRatio).toBeCloseTo(1.35, 9);
    expect(crushShape(1).lengthFraction).toBeCloseTo(0.55, 9);
    expect(CRUSH_ZONE).toBeGreaterThan(0);
    expect(CRUSH_ZONE).toBeLessThan(1);
    // The stub the deformation keeps accounts for that shortening: the nose zone shrinks by (1 - stub).
    expect((1 - CRUSH_ZONE) * (1 - CRUSH_STUB)).toBeCloseTo(CRUSH_SHORTEN, 9);
    expect(CRUSH_WIDEN).toBe(0.35);
  });

  it('follows the energy taken, saturating at the energy a crushed bullet has lost', () => {
    expect(crushFromSpeed(155, 155)).toBe(0);
    expect(crushFromSpeed(0, 155)).toBe(1);
    expect(crushFromSpeed(155 * Math.sqrt(1 - CRUSH_ABSORBED), 155)).toBeCloseTo(1, 9);
    expect(crushFromSpeed(110, 155)).toBeGreaterThan(crushFromSpeed(130, 155));
    expect(crushFromSpeed(10, 0)).toBe(0);
  });
});

describe('crush in the timeline (#226)', () => {
  it.each(['c35', 'c75', 'c110'])('%s: a bullet that crossed the panel is a full stub by 0.4 ms', (grade) => {
    const { at } = shootConcrete(grade, 156);
    expect(at(0)?.crush ?? 0).toBe(0);
    expect(at(0.4)?.crush ?? 0).toBeGreaterThan(0.9);
  });

  it('crush grows during the strike and never recovers', () => {
    const { at } = shootConcrete('c35', 207);
    let last = 0;
    for (let ms = 0; ms <= 4; ms += 0.1) {
      const frame = at(ms);
      if (!frame) break;
      expect(frame.crush ?? 0).toBeGreaterThanOrEqual(last - 1e-9);
      last = frame.crush ?? 0;
    }
    expect(last).toBeGreaterThan(0.8);
  });

  it('the slug behind the panel keeps the crushed state', () => {
    const { track, timeline } = shootConcrete('c35', 156);
    expect(timeline.summary.passedThrough).toBe(true);
    expect(track.keyframes[track.keyframes.length - 1].crush).toBeGreaterThan(0.9);
  });

  it('a bullet that is not in concrete is never crushed', () => {
    const steel = fire({ bullet: '308-sp', medium: 'steel-mild', thickness: 0.002 });
    expect(steel.tracks.every((t) => t.keyframes.every((k) => k.crush === undefined))).toBe(true);
    const gel = fire({ bullet: '9mm-fmj', medium: 'gel10', thickness: 0.2 });
    expect(gel.tracks.every((t) => t.keyframes.every((k) => k.crush === undefined))).toBe(true);
  });

  it('fragments are never crushed', () => {
    const { timeline } = shootConcrete('c35', 300);
    for (const t of timeline.tracks.filter((t) => t.kind === 'fragment')) expect(t.keyframes.every((k) => k.crush === undefined)).toBe(true);
  });
});
