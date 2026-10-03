import { describe, expect, it } from 'vitest';
import { DEFAULT_PLATE_MATERIAL_ID, PLATE_MATERIALS, getPlateMaterial } from './materials';

const within = (value: number, min: number, max: number) => value >= min && value <= max;

describe('plate materials', () => {
  it('has the five materials from the epic, each once', () => {
    expect(PLATE_MATERIALS.map((m) => m.id)).toEqual(['rha', 'mild-steel', 'cast-iron', 'copper', 'al-5083']);
    expect(getPlateMaterial(DEFAULT_PLATE_MATERIAL_ID).id).toBe('rha');
    expect(() => getPlateMaterial('unobtainium' as never)).toThrow();
  });

  it.each(PLATE_MATERIALS.map((m) => [m.name, m] as const))('%s has plausible values', (_, m) => {
    expect(within(m.density, 2500, 9000)).toBe(true);
    expect(within(m.soundSpeed, 3500, 6500)).toBe(true);
    expect(within(m.yieldPa, 0.1e9, 1.5e9)).toBe(true);
    expect(within(m.brinell, 30, 600)).toBe(true);
    expect(within(m.spallStrengthPa, 0.3e9, 6e9)).toBe(true);
    expect(within(m.meltingPointC, 500, 1600)).toBe(true);
    expect(within(m.specificHeat, 300, 1000)).toBe(true);
    expect(within(m.thermalConductivity, 10, 450)).toBe(true);
    expect(within(m.rhaThicknessFactor, 0.2, 1)).toBe(true);
    // Target resistance is several times yield (Tate), never below it.
    expect(m.targetResistancePa / m.yieldPa).toBeGreaterThan(2);
    expect(m.targetResistancePa / m.yieldPa).toBeLessThan(12);
    expect(m.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(m.description.length).toBeGreaterThan(20);
  });

  it('RHA resists best: the highest Rt, hardness and thickness efficiency', () => {
    const rha = getPlateMaterial('rha');
    for (const m of PLATE_MATERIALS.filter((x) => x.id !== 'rha')) {
      expect(m.targetResistancePa).toBeLessThan(rha.targetResistancePa);
      expect(m.brinell).toBeLessThan(rha.brinell);
      expect(m.rhaThicknessFactor).toBeLessThan(rha.rhaThicknessFactor);
    }
  });

  it('cast iron is the easiest to spall and aluminium the weakest per thickness', () => {
    const spall = PLATE_MATERIALS.map((m) => m.spallStrengthPa);
    expect(getPlateMaterial('cast-iron').spallStrengthPa).toBe(Math.min(...spall));
    const factors = PLATE_MATERIALS.map((m) => m.rhaThicknessFactor);
    expect(getPlateMaterial('al-5083').rhaThicknessFactor).toBe(Math.min(...factors));
  });
});
