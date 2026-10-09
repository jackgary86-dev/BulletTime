import { describe, expect, it } from 'vitest';
import { getBullet } from './bullets';
import { BUILDINGS, buildingForFront, interiorGapM } from './buildings';
import { getMedium } from './media';
import { MODES, targetsForMode } from './modes';
import { siteShotY } from './sites';
import { STACK_PRESETS, presetLayers, presetListedIn, stackDepth } from './stacks';
import { fire } from '../sim/testUtil';

const buildings = Object.values(BUILDINGS);
const preset = (id: string) => STACK_PRESETS.find((p) => p.id === `building-${id}`)!;

describe('mock test buildings (#246)', () => {
  it('have the sizes the ticket asks for', () => {
    expect([BUILDINGS['block-house'].widthM, BUILDINGS['block-house'].depthM, BUILDINGS['block-house'].heightM]).toEqual([4, 4, 3]);
    expect(BUILDINGS['block-house'].front.thicknessM).toBe(0.3);
    expect([BUILDINGS['frame-panel'].widthM, BUILDINGS['frame-panel'].depthM, BUILDINGS['frame-panel'].heightM]).toEqual([8, 6, 6]);
    expect([BUILDINGS['steel-shed'].widthM, BUILDINGS['steel-shed'].depthM, BUILDINGS['steel-shed'].heightM]).toEqual([10, 6, 4]);
  });

  it.each(buildings)('$id: struck wall, room, far wall, and the stack spans the building', (b) => {
    const layers = presetLayers(preset(b.id));
    expect(layers.map((l) => l.medium.id)).toEqual([b.front.medium, b.back.medium]);
    expect(layers[1].gapM).toBeCloseTo(interiorGapM(b), 9);
    expect(stackDepth(layers)).toBeCloseTo(b.depthM, 9);
    expect(buildingForFront(b.front.medium)).toBe(b);
    expect(buildingForFront(b.back.medium)).toBeUndefined();
    // On the range the walls stand on the ground.
    const y = siteShotY('range', layers.map((l) => l.medium));
    for (const l of layers) expect(y - l.medium.heightM / 2, l.medium.id).toBeCloseTo(0, 9);
  });

  it('lists each struck wall and preset for Missile and Artillery, never Bullet, and hides the far walls', () => {
    for (const mode of ['missile', 'artillery'] as const) {
      const ids = targetsForMode(mode).map((m) => m.id);
      for (const b of buildings) {
        expect(ids, `${mode} ${b.id}`).toContain(b.front.medium);
        expect(ids).not.toContain(b.back.medium);
        expect(presetListedIn(preset(b.id), mode)).toBe(true);
      }
    }
    for (const b of buildings) {
      expect(targetsForMode('bullet').map((m) => m.id)).not.toContain(b.front.medium);
      expect(presetListedIn(preset(b.id), 'bullet')).toBe(false);
    }
  });

  it('gives a clean default shot into each building in Missile and Artillery', () => {
    for (const mode of ['missile', 'artillery'] as const) {
      const bullet = getBullet(MODES[mode].defaultId).id;
      for (const b of buildings) {
        const s = fire({ bullet, stack: presetLayers(preset(b.id)) }).summary;
        for (const v of [s.impactSpeed, s.impactEnergyJ, s.penetrationM]) expect(Number.isFinite(v), `${mode} ${b.id}`).toBe(true);
        expect(s.impactSpeed, `${mode} ${b.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('shows thin shed sheet barely slowing a shell, where the block house wall stops or slows it hard', () => {
    // Full-calibre shot: a dart would go through both.
    const shell = getBullet('88mm-ap').id;
    const shed = fire({ bullet: shell, stack: presetLayers(preset('steel-shed')).slice(0, 1) }).summary;
    expect(shed.passedThrough).toBe(true);
    expect(shed.exitSpeed).toBeGreaterThan(shed.impactSpeed * 0.9);
    const wall = getMedium('block-house-wall');
    const house = fire({ bullet: shell, stack: [{ medium: wall, thickness: 0.3, gapM: 0 }] }).summary;
    expect(!house.passedThrough || house.exitSpeed < house.impactSpeed * 0.9).toBe(true);
  });
});
