import { describe, expect, it } from 'vitest';
import { ARTILLERY } from './artillery';
import { LARGE_PLATE_IDS, MEDIA, getMedium, mediumListedIn } from './media';
import { STACK_PRESETS, presetLayers } from './stacks';
import { fire } from '../sim/testUtil';

describe('large steel plates (#232)', () => {
  it.each(LARGE_PLATE_IDS)('%s is a proving-ground sized, heavy target with a sane thickness range', (id) => {
    const m = getMedium(id);
    expect(m.heavy).toBe(true);
    expect(m.widthM).toBeGreaterThanOrEqual(3);
    expect(m.heightM).toBeGreaterThanOrEqual(2);
    expect(m.thickness.max).toBeLessThanOrEqual(0.3);
    expect(m.thickness.default).toBeGreaterThanOrEqual(m.thickness.min);
    expect(m.thickness.default).toBeLessThanOrEqual(m.thickness.max);
  });

  it('are listed in Artillery and Missile but never the Bullet lab', () => {
    for (const id of LARGE_PLATE_IDS) {
      const m = getMedium(id);
      expect(mediumListedIn(m, 'artillery')).toBe(true);
      expect(mediumListedIn(m, 'missile')).toBe(true);
      expect(mediumListedIn(m, 'bullet')).toBe(false);
    }
    expect(mediumListedIn(getMedium('rha'), 'bullet')).toBe(false);
    expect(MEDIA.filter((m) => m.heavy).map((m) => m.id)).toEqual(expect.arrayContaining([...LARGE_PLATE_IDS, 'rha']));
  });

  it('plate presets only use known media and are heavy-only', () => {
    const presets = STACK_PRESETS.filter((p) => p.heavy);
    expect(presets.map((p) => p.id)).toEqual(['plate-large', 'plate-spaced', 'plate-concrete', 'era-plate']);
    for (const p of presets) expect(presetLayers(p).length).toBeGreaterThan(0);
  });

  it('every shell fires cleanly into every large plate at its default thickness', () => {
    for (const id of LARGE_PLATE_IDS) {
      for (const shell of ARTILLERY) {
        const t = fire({ bullet: shell.id, medium: id });
        expect(t.summary).toBeDefined();
      }
    }
  });

  it('shell types separate: HE holes thin mild plate but stops on armour; AP goes through 100 mm RHA but not 300 mm', () => {
    const through = (bullet: string, medium: string, thickness: number) => fire({ bullet, medium, thickness }).summary.passedThrough;
    expect(through('155mm-he', 'mild-plate', 0.02)).toBe(true);
    expect(through('155mm-he', 'ar500-plate', 0.025)).toBe(false);
    expect(through('155mm-he', 'rha-plate', 0.1)).toBe(false);
    expect(through('76mm-ap', 'rha-plate', 0.1)).toBe(true);
    expect(through('76mm-ap', 'rha-plate', 0.3)).toBe(false);
  });
});
