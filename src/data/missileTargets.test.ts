import { describe, expect, it } from 'vitest';
import { applyReplayLink } from '../ui/replayLink';
import { getBullet } from './bullets';
import { MEDIA, MISSILE_MIN_FACE_M, getMedium } from './media';
import { MODES, targetsForMode } from './modes';
import { STACK_PRESETS, presetLayers, presetListedIn, type StackLayer } from './stacks';
import { fire } from '../sim/testUtil';

describe('Missile target list (#245)', () => {
  const list = targetsForMode('missile');

  it('has no entry under 2 m across, so no gel, wood, glass or small plate', () => {
    expect(list.length).toBeGreaterThan(0);
    // A vehicle (#231) is listed for its size, though the struck plate is a band of its side.
    for (const m of list.filter((x) => !x.vehicle)) expect(Math.min(m.heightM, m.widthM), m.id).toBeGreaterThanOrEqual(MISSILE_MIN_FACE_M);
    const ids = list.map((m) => m.id);
    for (const small of ['gel10', 'pine', 'glass', 'drywall', 'rha', 'steel-mild']) expect(ids).not.toContain(small);
    expect(ids).toEqual(expect.arrayContaining(['rha-plate', 'mild-plate', 'ar500-plate', 'cast-iron-plate']));
  });

  it('leaves the Bullet list as it was: every non-heavy, non-dummy medium', () => {
    expect(targetsForMode('bullet').map((m) => m.id)).toEqual(MEDIA.filter((m) => !m.dummyOnly && !m.heavy).map((m) => m.id));
    expect(targetsForMode('bullet').some((m) => m.id === 'gel10')).toBe(true);
  });

  it('starts on the 150 mm RHA plate at proving-ground size', () => {
    const { defaultTargetId, defaultTargetThicknessM } = MODES.missile;
    expect(defaultTargetId).toBe('rha-plate');
    expect(defaultTargetThicknessM).toBe(0.15);
    expect(list.map((m) => m.id)).toContain(defaultTargetId);
    const { min, max } = getMedium(defaultTargetId!).thickness;
    expect(defaultTargetThicknessM!).toBeGreaterThanOrEqual(min);
    expect(defaultTargetThicknessM!).toBeLessThanOrEqual(max);
    expect(MODES.bullet.defaultTargetId).toBeUndefined();
  });

  it('lists only the heavy presets, and the Bullet lab none of them', () => {
    const missile = STACK_PRESETS.filter((p) => presetListedIn(p, 'missile'));
    expect(missile.length).toBeGreaterThan(0);
    expect(missile.every((p) => p.heavy)).toBe(true);
    expect(STACK_PRESETS.filter((p) => presetListedIn(p, 'bullet')).some((p) => p.heavy)).toBe(false);
    expect(STACK_PRESETS.filter((p) => presetListedIn(p, 'artillery')).length).toBe(STACK_PRESETS.length);
  });

  it('gives a clean result for a Missile shot at every listed target and preset', () => {
    const missile = getBullet(MODES.missile.defaultId).id;
    const stacks: [string, StackLayer[]][] = [
      ...list.map((m): [string, StackLayer[]] => [m.id, [{ medium: m, thickness: m.thickness.default, gapM: 0 }]]),
      ...STACK_PRESETS.filter((p) => presetListedIn(p, 'missile')).map((p): [string, StackLayer[]] => [p.id, presetLayers(p)]),
    ];
    for (const [name, stack] of stacks) {
      const s = fire({ bullet: missile, stack }).summary;
      for (const v of [s.impactSpeed, s.impactEnergyJ, s.penetrationM, s.exitSpeed]) expect(Number.isFinite(v), name).toBe(true);
      expect(s.impactSpeed, name).toBeGreaterThan(0);
    }
  });
});

describe('replay link in the Missile lab (#245)', () => {
  /** A stub of the pickers: a select holding option values. */
  function root(options: Record<string, string[]>) {
    const selects = Object.fromEntries(
      Object.entries(options).map(([selector, values]) => [selector, { options: values.map((value) => ({ value })), value: values[0], dispatchEvent: () => true }]),
    );
    const slider = { min: '0.05', max: '0.3', value: '0.15', dispatchEvent: () => true };
    return { querySelector: (sel: string) => (sel === '#thickness-slider' ? slider : selects[sel]), selects, slider } as never;
  }

  it('names a small target the mode does not list, and keeps the default plate and its thickness', () => {
    const r = root({ '#bullet-select': ['missile:guided-at:shaped'], '#medium-select': ['rha-plate', 'mild-plate'] });
    const ignored = applyReplayLink(r, { atS: 1e-4, medium: 'steel-mild', thicknessM: 0.003 });
    expect(ignored).toEqual(['steel-mild']);
    expect((r as never as { selects: Record<string, { value: string }>; slider: { value: string } }).selects['#medium-select'].value).toBe('rha-plate');
    expect((r as never as { slider: { value: string } }).slider.value).toBe('0.15');
  });

  it('applies a target the mode lists, and reports nothing', () => {
    const r = root({ '#bullet-select': ['a'], '#medium-select': ['rha-plate', 'mild-plate'] });
    expect(applyReplayLink(r, { atS: 1e-4, medium: 'mild-plate', thicknessM: 0.1 })).toEqual([]);
    expect((r as never as { selects: Record<string, { value: string }> }).selects['#medium-select'].value).toBe('mild-plate');
  });
});
