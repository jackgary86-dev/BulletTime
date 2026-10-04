import { describe, expect, it } from 'vitest';
import { fullBoreShot } from './fullBore';
import { getPlateMaterial } from './materials';
import type { ArmorShot } from './model';
import { MUNITION_FAMILIES, impactState } from './munitions';
import { simulateArmor } from './simulate';

const rhaShot = (overrides: Partial<ArmorShot> = {}): ArmorShot => ({
  impact: impactState('ap-shot', 88, 1000),
  material: getPlateMaterial('rha'),
  thicknessM: 0.1,
  obliquityDeg: 0,
  ...overrides,
});

describe('simulateArmor', () => {
  it('runs the full-bore model for AP shot', () => {
    const tl = simulateArmor(rhaShot());
    expect(tl).toEqual(fullBoreShot(rhaShot()));
    expect(tl.result.perforated).toBe(true);
    expect(tl.events[0].type).toBe('impact');
    expect(tl.frames.length).toBeGreaterThanOrEqual(120);
  });

  it('runs the long-rod model for APFSDS', () => {
    const tl = simulateArmor(rhaShot({ impact: impactState('apfsds', 120), thicknessM: 0.3 }));
    expect(tl.result.mechanism).toBe('Hydrodynamic erosion');
  });

  it('runs the jet model for HEAT', () => {
    const tl = simulateArmor(rhaShot({ impact: impactState('heat', 120), thicknessM: 0.3 }));
    expect(tl.result.mechanism).toBe('Jet penetration');
  });

  it('runs the stress-wave model for HESH', () => {
    const tl = simulateArmor(rhaShot({ impact: impactState('hesh', 120), thicknessM: 0.05 }));
    expect(tl.result.mechanism).toBe('Spalling');
  });

  it('applies the model’s own obliquity limit', () => {
    expect(simulateArmor(rhaShot({ obliquityDeg: 85 })).shot.obliquityDeg).toBe(75);
  });

  it('throws for the families later tickets will model', () => {
    for (const family of MUNITION_FAMILIES.filter((f) => f.id !== 'ap-shot' && f.id !== 'apfsds' && f.id !== 'heat' && f.id !== 'hesh')) {
      expect(() => simulateArmor(rhaShot({ impact: impactState(family.id, 120) }))).toThrow(/not model/);
    }
  });
});
