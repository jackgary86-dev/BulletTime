import { describe, expect, it } from 'vitest';
import { ARTILLERY } from './artillery';
import { LARGE_PLATE_IDS, MEDIA, getMedium, mediumListedIn } from './media';
import { STACK_PRESETS, presetLayers } from './stacks';
import { fire } from '../sim/testUtil';
import { getBullet } from './bullets';
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
    expect(presets.map((p) => p.id)).toEqual(expect.arrayContaining(['plate-large', 'plate-spaced', 'plate-concrete']));
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

describe('Missile jets against the large plates (#233)', () => {
  const block = presetLayers(STACK_PRESETS.find((p) => p.id === 'plate-block')!);
  const calibres = (id: string) => {
    const s = fire({ bullet: id, stack: block }).summary;
    return { s, cal: s.penetrationM / (getBullet(id).caliberMm / 1000) };
  };

  it('a shaped charge stops in the RHA block about four to five calibres deep, like solid armour (#195)', () => {
    for (const a of ['light-rocket', 'shoulder-rocket', 'guided-at']) {
      const { s, cal } = calibres(missileId(a, 'shaped'));
      expect(s.passedThrough, a).toBe(false);
      expect(cal, a).toBeGreaterThan(3.5);
      expect(cal, a).toBeLessThan(6.5);
    }
  });

  it('a tandem head bores deeper into the block than a single charge, and still stops', () => {
    for (const a of ['light-rocket', 'guided-at']) {
      const tandem = calibres(missileId(a, 'tandem'));
      expect(tandem.s.passedThrough, a).toBe(false);
      expect(tandem.cal, a).toBeGreaterThan(calibres(missileId(a, 'shaped')).cal * 1.1);
    }
  });

  it('shaped and tandem heads defeat each large plate at its default thickness with a clean result', () => {
    for (const id of LARGE_PLATE_IDS) {
      for (const head of ['shaped', 'tandem']) {
        const s = fire({ bullet: missileId('guided-at', head), medium: id }).summary;
        for (const v of [s.impactSpeed, s.impactEnergyJ, s.penetrationM]) expect(Number.isFinite(v), `${id} ${head}`).toBe(true);
        expect(s.passedThrough, `${id} ${head}`).toBe(true);
      }
    }
  });
});
