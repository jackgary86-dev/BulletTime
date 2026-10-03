import { describe, expect, it } from 'vitest';
import { simulate } from '../sim/engine';
import { BULLETS, getBullet } from './bullets';
import { MEDIA, getMedium } from './media';
import {
  BOWLING_BALL_CRACK_J,
  MELON_BURST_J,
  OUTLINE_AIM_LIMIT,
  chordFraction,
  clampAimToObjects,
  clampToOutline,
  energyIntoLayer,
  objectOutcome,
  shapeLayers,
} from './objects';
import { physicsLayers } from './stacks';

const OBJECTS = MEDIA.filter((m) => m.shape);

function shoot(mediumId: string, bulletId: string, y = 0, z = 0) {
  const medium = getMedium(mediumId);
  const stack = [{ medium, thickness: medium.thickness.default, gapM: 0 }];
  const aim = clampAimToObjects(stack, y, z);
  const timeline = simulate({
    bullet: getBullet(bulletId),
    layers: shapeLayers(physicsLayers(stack), aim.y, aim.z),
    angleDeg: 0,
    impactPoint: { x: -0.2, y: 0.16 + aim.y, z: aim.z },
    standOffM: 0.5,
  });
  return { timeline, energy: energyIntoLayer(timeline, 0), medium };
}

describe('object outlines', () => {
  it('lists the five showpiece objects from the ticket', () => {
    expect(OBJECTS.map((m) => m.id).sort()).toEqual(['bottle', 'bowling-ball', 'gong', 'steel-ball', 'watermelon']);
  });

  it('crosses the full depth at the centre and a chord off it', () => {
    expect(chordFraction('sphere', 0, 0, 0.1, 0.1)).toBe(1);
    // 3-4-5: 60% of the way out, the chord is 80% of the diameter.
    expect(chordFraction('sphere', 0.06, 0, 0.1, 0.1)).toBeCloseTo(0.8, 9);
    expect(chordFraction('ellipsoid', 0, 0.09, 0.1, 0.15)).toBeCloseTo(0.8, 9);
    expect(chordFraction('sphere', 0.1, 0.1, 0.1, 0.1)).toBe(0);
  });

  it('treats a bottle as round across and straight up, and a gong as flat', () => {
    expect(chordFraction('cylinder', 0.08, 0, 0.09, 0.04)).toBe(1);
    expect(chordFraction('cylinder', 0, 0.024, 0.09, 0.04)).toBeCloseTo(0.8, 9);
    expect(chordFraction('disc', 0.1, 0.1, 0.15, 0.15)).toBe(1);
  });

  it('keeps the aim inside the outline', () => {
    expect(clampToOutline('sphere', 0.02, -0.03, 0.1, 0.1)).toEqual({ y: 0.02, z: -0.03 });
    const corner = clampToOutline('sphere', 0.1, 0.1, 0.1, 0.1);
    expect(Math.hypot(corner.y, corner.z)).toBeCloseTo(0.1 * OUTLINE_AIM_LIMIT, 9);
    expect(corner.y).toBeCloseTo(corner.z, 9);
    const bottle = clampToOutline('cylinder', 0.2, 0.2, 0.09, 0.04);
    expect(bottle).toEqual({ y: 0.09 * OUTLINE_AIM_LIMIT, z: 0.04 * OUTLINE_AIM_LIMIT });
  });

  it('shrinks a ball to the chord and centres it in the ball', () => {
    const ball = getMedium('bowling-ball');
    const [layer] = shapeLayers(physicsLayers([{ medium: ball, thickness: 0.216, gapM: 0 }]), 0.0648, 0);
    expect(layer.thickness).toBeCloseTo(0.216 * 0.8, 9);
    expect(layer.offset + layer.thickness / 2).toBeCloseTo(0.108, 9);
  });

  it('leaves slabs alone', () => {
    const gel = getMedium('gel10');
    const layers = physicsLayers([{ medium: gel, thickness: 0.4, gapM: 0 }]);
    expect(shapeLayers(layers, 0.05, 0.05)).toEqual(layers);
  });
});

describe('objects under fire', () => {
  it.each(OBJECTS.map((m) => [m.id] as const))('%s takes every round, on centre and off it, without errors', (id) => {
    for (const bullet of BULLETS) {
      for (const [y, z] of [
        [0, 0],
        [0.03, -0.02],
        [0.5, 0.5],
      ]) {
        const { timeline, energy, medium } = shoot(id, bullet.id, y, z);
        const s = timeline.summary;
        expect(Number.isFinite(s.penetrationM) && Number.isFinite(s.exitSpeed) && Number.isFinite(energy)).toBe(true);
        expect(s.penetrationM).toBeLessThanOrEqual(medium.thickness.default + 1e-6);
        expect(objectOutcome(medium, energy, s.passedThrough)).toMatch(/\.$/);
      }
    }
  });

  it('a pistol round buries itself in a bowling ball; a rifle round cracks it', () => {
    const pistol = shoot('bowling-ball', '9mm-fmj');
    expect(pistol.timeline.summary.passedThrough).toBe(false);
    expect(pistol.energy).toBeLessThan(BOWLING_BALL_CRACK_J);
    expect(shoot('bowling-ball', '308-sp').energy).toBeGreaterThan(BOWLING_BALL_CRACK_J);
  });

  it('nothing gets through the steel ball', () => {
    for (const bullet of BULLETS) expect(shoot('steel-ball', bullet.id).timeline.summary.passedThrough).toBe(false);
  });

  it('a pistol round dents the gong; a rifle round goes through', () => {
    expect(shoot('gong', '9mm-fmj').timeline.summary.passedThrough).toBe(false);
    expect(shoot('gong', '308-sp').timeline.summary.passedThrough).toBe(true);
  });

  it('a watermelon only bursts for the fast rounds', () => {
    expect(shoot('watermelon', '9mm-fmj').energy).toBeLessThan(MELON_BURST_J);
    expect(shoot('watermelon', '22lr-lrn').energy).toBeLessThan(MELON_BURST_J);
    expect(shoot('watermelon', '308-sp').energy).toBeGreaterThan(MELON_BURST_J);
    expect(shoot('watermelon', '556-m193').energy).toBeGreaterThan(MELON_BURST_J);
  });

  it('every bullet goes straight through a bottle of water', () => {
    for (const bullet of BULLETS.filter((b) => b.behaviour !== 'explosive')) expect(shoot('bottle', bullet.id).timeline.summary.passedThrough).toBe(true);
  });

  it('an edge shot crosses less of a ball than a centre shot', () => {
    const centre = shoot('watermelon', '9mm-fmj');
    const edge = shoot('watermelon', '9mm-fmj', 0.08, 0);
    expect(edge.timeline.summary.penetrationM).toBeLessThan(centre.timeline.summary.penetrationM);
  });
});
