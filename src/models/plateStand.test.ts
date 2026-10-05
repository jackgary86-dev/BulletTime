import { describe, expect, it } from 'vitest';
import { LARGE_PLATE_IDS, getMedium } from '../data/media';
import { siteShotY } from '../data/sites';
import { STACK_PRESETS, presetLayers, stackOffsets } from '../data/stacks';
import type { Vec3 } from '../sim/types';
import { PLATE_STAND, isLargePlate, partBounds, plateStandParts, plateStandSpans } from './plateStandLayout';

type Aabb = { min: Vec3; max: Vec3 };
const overlaps = (a: Aabb, b: Aabb) =>
  a.min.x < b.max.x && a.max.x > b.min.x && a.min.y < b.max.y && a.max.y > b.min.y && a.min.z < b.max.z && a.max.z > b.min.z;
const shift = (b: Aabb, x: number): Aabb => ({ min: { ...b.min, x: b.min.x + x }, max: { ...b.max, x: b.max.x + x } });

describe('proving-ground plate stand (#232, #234)', () => {
  it.each(LARGE_PLATE_IDS)('%s stands in a footing sunk into the ground, rising just past its top edge', (id) => {
    const spec = getMedium(id);
    expect(isLargePlate(spec)).toBe(true);
    const shotY = siteShotY('range', [spec]);
    // On the range a plate stands on the ground.
    expect(shotY - spec.heightM / 2).toBeCloseTo(0, 9);
    const bounds = plateStandParts(spec, spec.thickness.default, shotY).map(partBounds);
    const minY = Math.min(...bounds.map((b) => b.min.y));
    const maxY = Math.max(...bounds.map((b) => b.max.y));
    expect(minY).toBeCloseTo(-shotY + PLATE_STAND.slotM - PLATE_STAND.footingH, 9);
    expect(maxY).toBeGreaterThan(spec.heightM / 2);
    expect(maxY).toBeLessThan(spec.heightM / 2 + 0.2);
  });

  it('leaves the small coupon and bullet-lab plates on their hangers', () => {
    for (const id of ['rha', 'steel-mild', 'steel-ar500', 'sheet-metal']) expect(isLargePlate(getMedium(id))).toBe(false);
  });

  it.each([0.005, 0.1, 0.3])('keeps a %s m plate\'s shot line clear in front and behind', (t) => {
    const spec = getMedium('rha-plate');
    const shotY = siteShotY('range', [spec]);
    // A 1 m band round the shot line through the middle of the plate, from far in front to far behind.
    const path: Aabb = { min: { x: -50, y: -0.5, z: -0.5 }, max: { x: 50, y: 0.5, z: 0.5 } };
    for (const b of plateStandParts(spec, t, shotY).map(partBounds)) expect(overlaps(b, path)).toBe(false);
  });

  const platePresets = STACK_PRESETS.filter((p) => p.layers.some((l) => isLargePlate(getMedium(l.medium))));
  it('gives plates bolted face to face one stand, and spaced plates one each', () => {
    const layer = (gapM: number, id = 'rha-plate') => ({ medium: getMedium(id), thickness: 0.3, gapM });
    const [block, ...rest] = plateStandSpans([layer(0), layer(0), layer(0)]);
    expect(block).toBeCloseTo(0.9, 9);
    expect(rest).toEqual([null, null]);
    expect(plateStandSpans([layer(0), layer(0.3), layer(0)])).toEqual([0.3, 0.6, null]);
    expect(plateStandSpans([layer(0, 'reinforced-concrete'), layer(0)])).toEqual([0.3, 0.3]);
  });

  it('covers the plate presets', () => {
    expect(platePresets.map((p) => p.id)).toEqual(expect.arrayContaining(['plate-large', 'plate-spaced', 'plate-block', 'plate-concrete']));
  });

  it.each(platePresets.map((p) => p.id))('%s: no plate stand runs into another layer', (id) => {
    const layers = presetLayers(STACK_PRESETS.find((p) => p.id === id)!);
    const shotY = siteShotY('range', layers.map((l) => l.medium));
    const offsets = stackOffsets(layers);
    const e = 1e-4;
    const bodies: Aabb[] = layers.map((l, i) => ({
      min: { x: offsets[i] + e, y: -l.medium.heightM / 2 + e, z: -l.medium.widthM / 2 + e },
      max: { x: offsets[i] + l.thickness - e, y: l.medium.heightM / 2 - e, z: l.medium.widthM / 2 - e },
    }));
    const spans = plateStandSpans(layers);
    layers.forEach((l, i) => {
      const span = spans[i];
      if (!isLargePlate(l.medium) || span === null) return;
      // The stand grips its own plate, and any plates bolted behind it.
      const own = new Set([i]);
      for (let j = i + 1; j < layers.length && spans[j] === null; j++) own.add(j);
      const stand = plateStandParts(l.medium, span, shotY).map((p) => shift(partBounds(p), offsets[i]));
      bodies.forEach((body, j) => {
        if (own.has(j)) return;
        for (const b of stand) expect(overlaps(b, body), `${l.medium.id} stand into layer ${j}`).toBe(false);
      });
    });
  });
});
