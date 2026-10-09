import { describe, expect, it } from 'vitest';
import { getMedium } from '../data/media';
import { layersFor } from '../sim/engine';
import { simulate } from '../sim/engine';
import { bulletAt } from '../sim/testUtil';
import type { BurstSpec } from './particles';
import { loadHardEffect } from './hardEffect';
import { loadSandEffect } from './sandEffect';

/** A stand-in for the particle system and the hole marks that records what is added. */
function recorder() {
  const bursts: BurstSpec[] = [];
  const marks: { streaks?: unknown; noOpening?: boolean }[] = [];
  const system = { add: (b: BurstSpec) => void bursts.push(b), addFlash: () => undefined };
  const holes = { add: (m: { streaks?: unknown; noOpening?: boolean }) => void marks.push(m) };
  return { bursts, marks, system: system as never, holes: holes as never };
}

function shoot(bullet: string, medium: string, thickness: number) {
  const m = getMedium(medium);
  const layers = layersFor(m, thickness);
  const timeline = simulate({ bullet: bulletAt(bullet), layers, angleDeg: 0, impactPoint: { x: -0.2, y: 0.16, z: 0 }, standOffM: 0.5 });
  return { timeline, layers };
}

describe('cast iron looks brittle (#296)', () => {
  it('is marked brittle, and mild steel and the other plates are not', () => {
    expect(getMedium('cast-iron-plate').brittle).toBe(true);
    for (const id of ['mild-plate', 'rha-plate', 'ar500-plate', 'steel-mild']) expect(getMedium(id).brittle, id).toBeUndefined();
  });

  it('cracks the face and throws chunks on a hit that mild plate of the same size only dents', () => {
    const iron = recorder();
    const { timeline, layers } = shoot('76mm-ap', 'cast-iron-plate', 0.1);
    loadHardEffect(timeline, layers, iron.system, iron.holes);
    const mild = recorder();
    const mildShot = shoot('76mm-ap', 'mild-plate', 0.1);
    loadHardEffect(mildShot.timeline, mildShot.layers, mild.system, mild.holes);
    // Crack streaks are drawn on the iron and not on the mild plate.
    expect(iron.marks.some((m) => m.streaks && m.noOpening)).toBe(true);
    expect(mild.marks.some((m) => m.streaks && m.noOpening)).toBe(false);
    // Angular grey chunks fly in far greater number than from mild steel.
    const chunks = (r: ReturnType<typeof recorder>) => r.bursts.filter((b) => b.look === 'chunk').reduce((n, b) => n + b.count, 0);
    expect(chunks(iron)).toBeGreaterThan(chunks(mild) + 50);
  });
});

describe('packed earth throws a soil column (#296)', () => {
  it('is the berm look', () => {
    expect(getMedium('packed-earth').look).toBe('earthBerm');
  });

  it('throws clods and a dust plume sized to a shell, which a sandbag does not', () => {
    const { timeline } = shoot('122mm-ap', 'packed-earth', 1);
    const earth = recorder();
    loadSandEffect(timeline, 0, earth.system, earth.holes, getMedium('packed-earth'));
    const bag = recorder();
    loadSandEffect(timeline, 0, bag.system, bag.holes, getMedium('sandbag'));
    const clods = earth.bursts.filter((b) => b.look === 'chunk');
    expect(clods.length).toBeGreaterThan(0);
    expect(bag.bursts.filter((b) => b.look === 'chunk').length).toBe(0);
    // A 122 mm shell throws clods of several centimetres, not millimetres.
    expect(Math.max(...clods.map((b) => b.size[1]))).toBeGreaterThan(0.02);
    // The column goes up: its axis points above the horizontal.
    expect(clods.every((b) => b.axis.y > 0.3)).toBe(true);
  });
});
