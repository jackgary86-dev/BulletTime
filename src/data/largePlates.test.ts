import { describe, expect, it } from 'vitest';
import { ARTILLERY } from './artillery';
import { LARGE_PLATE_IDS, MEDIA, getMedium, mediumListedIn } from './media';
import { STACK_PRESETS, presetLayers } from './stacks';
import { fire } from '../sim/testUtil';
import { missileId } from './missiles';

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
    expect(presets.map((p) => p.id)).toEqual(expect.arrayContaining(['plate-large', 'plate-spaced', 'plate-concrete', 'era-plate']));
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

  it('shell types separate: full-calibre AP goes through 100 mm RHA but not 300 mm, a dart goes through 300 mm', () => {
    const through = (bullet: string, medium: string, thickness: number) => fire({ bullet, medium, thickness }).summary.passedThrough;
    expect(through('76mm-ap', 'rha-plate', 0.1)).toBe(true);
    expect(through('76mm-ap', 'rha-plate', 0.3)).toBe(false);
    expect(through('120mm-apfsds', 'rha-plate', 0.3)).toBe(true);
  });
});

describe('Missile penetrators against the large plates (#233)', () => {
  const block = presetLayers(STACK_PRESETS.find((p) => p.id === 'plate-block')!);
  const depth = (head: string, airframe = 'guided-at') => fire({ bullet: missileId(airframe, head), stack: block }).summary;

  it('a long rod bores deepest into the 900 mm RHA block and a heavy core least, which stops in it', () => {
    for (const a of ['light-rocket', 'guided-at']) {
      const rod = depth('long-rod', a);
      const core = depth('penetrator', a);
      const heavy = depth('heavy-core', a);
      expect(heavy.passedThrough, a).toBe(false);
      if (!rod.passedThrough) expect(rod.penetrationM, a).toBeGreaterThan(core.penetrationM);
      expect(core.penetrationM, a).toBeGreaterThan(heavy.penetrationM);
    }
  });

  it('every head fires cleanly into each large plate at its default thickness', () => {
    for (const id of LARGE_PLATE_IDS) {
      for (const head of ['penetrator', 'long-rod', 'heavy-core', 'efp']) {
        const s = fire({ bullet: missileId('guided-at', head), medium: id }).summary;
        for (const v of [s.impactSpeed, s.impactEnergyJ, s.penetrationM]) expect(Number.isFinite(v), `${id} ${head}`).toBe(true);
        expect(s.penetrationM, `${id} ${head}`).toBeGreaterThan(0);
      }
    }
  });
});
