import { describe, expect, it } from 'vitest';
import { MIN_SCAR_YIELD_KG, SCAR_LAYERS, scarRadiusM } from './blastScar';

describe('blast scar on steel (#240)', () => {
  it('scales with the yield, from a palm-sized mark to a dinner-plate one', () => {
    const small = scarRadiusM(0.12, 0.04);
    const big = scarRadiusM(3.5, 0.127);
    expect(small).toBeGreaterThan(0.05);
    expect(small).toBeLessThan(0.15);
    expect(big).toBeGreaterThan(small * 2);
    expect(big).toBeLessThan(0.5);
  });

  it('is at least a calibre across, and absent for a primer-sized burst', () => {
    expect(scarRadiusM(0.05, 0.1)).toBeGreaterThanOrEqual(0.09);
    expect(scarRadiusM(MIN_SCAR_YIELD_KG / 2, 0.1)).toBe(0);
  });

  it('is built outside in: soot first, then bare metal, then scorch, then a bright centre', () => {
    const radii = SCAR_LAYERS.map((l) => l.radius);
    expect(radii).toEqual([...radii].sort((a, b) => b - a));
    expect(SCAR_LAYERS[0].roughness).toBe(1);
    expect(SCAR_LAYERS[1].metalness).toBeGreaterThan(0.5);
    expect(SCAR_LAYERS.at(-1)!.color).toBeGreaterThan(SCAR_LAYERS[0].color);
  });
});
