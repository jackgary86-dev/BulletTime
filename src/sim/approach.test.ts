import { describe, expect, it } from 'vitest';
import { getMedium } from '../data/media';
import { STACK_PRESETS, presetLayers, type StackLayer } from '../data/stacks';
import { siteShotY } from '../data/sites';
import { getBullet } from '../data/bullets';
import { MODES } from '../data/modes';
import { fire } from './testUtil';
import { applyRowMajor, approachDir, approachHit, clampApproach, engineToWorld, outsideSite, pathStart, targetShape } from './approach';

const preset = (id: string): StackLayer[] => presetLayers(STACK_PRESETS.find((p) => p.id === id)!);
const lineOf = (layers: StackLayer[]) => siteShotY('range', layers.map((l) => l.medium));
const house = preset('building-block-house');
const plate: StackLayer[] = [{ medium: getMedium('rha-plate'), thickness: 0.15, gapM: 0 }];
const tank: StackLayer[] = [{ medium: getMedium('tank-hull'), thickness: 0.07, gapM: 0 }];

describe('missile approach from any angle (#250)', () => {
  it('keeps the dive in 0-90° and the bearing within ±75° in 15° steps', () => {
    expect(clampApproach({ diveDeg: 120, bearingDeg: 100 })).toEqual({ diveDeg: 90, bearingDeg: 75 });
    expect(clampApproach({ diveDeg: -5, bearingDeg: 22 })).toEqual({ diveDeg: 0, bearingDeg: 15 });
    const d = approachDir({ diveDeg: 90, bearingDeg: 0 });
    expect(d.y).toBeCloseTo(-1, 9);
  });

  it('a level run hits the block house wall head on, as before', () => {
    const hit = approachHit({ diveDeg: 0, bearingDeg: 0 }, house, lineOf(house));
    expect(hit.face).toBe('front');
    expect(hit.obliquityDeg).toBeCloseTo(0, 9);
    expect(hit.entry.x).toBeCloseTo(0, 9);
    expect(hit.layers.map((l) => l.medium.id)).toEqual(house.map((l) => l.medium.id));
  });

  it('a 70° dive onto the block house lands on the roof, through the roof slab', () => {
    const hit = approachHit({ diveDeg: 70, bearingDeg: 0 }, house, lineOf(house));
    expect(hit.face).toBe('top');
    expect(hit.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(hit.obliquityDeg).toBeCloseTo(20, 6);
    expect(hit.layers[0].medium.id).toBe('roof-slab');
    // On the roof, between the front and back walls.
    expect(hit.entry.y).toBeCloseTo(targetShape(house, lineOf(house)).box.max.y, 9);
    expect(hit.entry.x).toBeGreaterThan(0);
    expect(hit.entry.x).toBeLessThan(4);
    const s = fire({ bullet: getBullet(MODES.missile.defaultId).id, stack: hit.layers, angleDeg: hit.obliquityDeg }).summary;
    expect(Number.isFinite(s.penetrationM)).toBe(true);
    expect(s.penetrationM).toBeGreaterThan(0);
  });

  it('switches from wall to roof where the path clears the roof edge', () => {
    // Block house: 4 m deep, roof 1.5 m above the shot line, aimed at the middle (2 m in): the edge is at atan(1.5 / 2).
    const edge = (Math.atan(1.5 / 2) * 180) / Math.PI;
    expect(approachHit({ diveDeg: edge - 2, bearingDeg: 0 }, house, lineOf(house)).face).toBe('front');
    expect(approachHit({ diveDeg: edge + 2, bearingDeg: 0 }, house, lineOf(house)).face).toBe('top');
  });

  it('a steep dive onto the tank meets the turret roof', () => {
    const hit = approachHit({ diveDeg: 80, bearingDeg: 0 }, tank, lineOf(tank));
    expect(hit.face).toBe('top');
    expect(hit.layers.map((l) => l.medium.id)).toEqual(['turret-roof', 'hull-floor']);
  });

  it('a plate has no roof: a steep dive meets its face very obliquely', () => {
    const hit = approachHit({ diveDeg: 60, bearingDeg: 0 }, plate, lineOf(plate));
    expect(hit.face).toBe('front');
    expect(hit.obliquityDeg).toBeCloseTo(60, 6);
    expect(hit.layers).toEqual(plate);
  });

  it('obliquity combines dive and bearing against the face normal', () => {
    const hit = approachHit({ diveDeg: 30, bearingDeg: 45 }, plate, lineOf(plate));
    const expected = (Math.acos(Math.cos((30 * Math.PI) / 180) * Math.cos((45 * Math.PI) / 180)) * 180) / Math.PI;
    expect(hit.obliquityDeg).toBeCloseTo(expected, 6);
  });

  it('starts the run outside the proving ground at every angle', () => {
    for (const diveDeg of [0, 30, 70, 90]) {
      for (const bearingDeg of [-75, 0, 45]) {
        const hit = approachHit({ diveDeg, bearingDeg }, house, lineOf(house));
        expect(outsideSite(pathStart(hit)), `${diveDeg}/${bearingDeg}`).toBe(true);
      }
    }
  });

  it('carries the engine frame onto the real path and face', () => {
    for (const [diveDeg, bearingDeg] of [[0, 0], [70, 0], [30, 45], [90, 0]]) {
      const hit = approachHit({ diveDeg, bearingDeg }, house, lineOf(house));
      const face = { x: -0.2, y: 1.5, z: 0 };
      const entry = { x: 1, y: 3, z: 0.5 };
      const m = engineToWorld(hit, face, entry);
      // The face centre lands on the entry point.
      const p = applyRowMajor(m, face);
      expect(p.x).toBeCloseTo(entry.x, 9);
      expect(p.y).toBeCloseTo(entry.y, 9);
      expect(p.z).toBeCloseTo(entry.z, 9);
      // The engine's +x (the path) becomes the real direction of travel.
      const o = applyRowMajor(m, { x: 0, y: 0, z: 0 });
      const x = applyRowMajor(m, { x: 1, y: 0, z: 0 });
      expect(x.x - o.x).toBeCloseTo(hit.dir.x, 9);
      expect(x.y - o.y).toBeCloseTo(hit.dir.y, 9);
      expect(x.z - o.z).toBeCloseTo(hit.dir.z, 9);
      // And the engine face's outward normal becomes the struck face's.
      const t = (hit.obliquityDeg * Math.PI) / 180;
      const n = applyRowMajor(m, { x: -Math.cos(t), y: 0, z: Math.sin(t) });
      expect(n.x - o.x).toBeCloseTo(hit.normal.x, 9);
      expect(n.y - o.y).toBeCloseTo(hit.normal.y, 9);
      expect(n.z - o.z).toBeCloseTo(hit.normal.z, 9);
    }
  });
});
