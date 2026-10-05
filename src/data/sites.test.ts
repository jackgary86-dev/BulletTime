import { describe, expect, it } from 'vitest';
import { getBullet } from './bullets';
import { getMedium } from './media';
import { MODES, targetsForMode } from './modes';
import { SITES, siteForMode, siteShotY } from './sites';
import { STACK_PRESETS, presetLayers } from './stacks';
import { fire } from '../sim/testUtil';

describe('proving-ground site (#231)', () => {
  it('keeps Bullet in the lab and takes the heavy simulators outdoors', () => {
    expect(siteForMode('bullet')).toBe('lab');
    for (const mode of ['artillery', 'missile', 'explosion'] as const) expect(siteForMode(mode)).toBe('range');
  });

  it('keeps the lab bench line whatever the target', () => {
    expect(siteShotY('lab', [getMedium('gel10')])).toBe(SITES.lab.baseShotY);
    expect(siteShotY('lab', [getMedium('bunker-wall')])).toBe(SITES.lab.baseShotY);
  });

  it('stands big targets on the ground and lifts small ones onto a support', () => {
    // The 3 m wall's centre is 1.5 m up, so its foot is on the ground.
    expect(siteShotY('range', [getMedium('bunker-wall')])).toBe(1.5);
    // The tallest layer sets the line, so every layer sits on or above the ground.
    const stack = presetLayers(STACK_PRESETS.find((p) => p.id === 'bunker-berm')!).map((l) => l.medium);
    const y = siteShotY('range', stack);
    for (const m of stack) expect(y - m.heightM / 2, m.id).toBeGreaterThanOrEqual(-1e-9);
    expect(siteShotY('range', [getMedium('gel10')])).toBe(SITES.range.baseShotY);
  });

  it('lists the full-size walls for Missile and Artillery, not Bullet', () => {
    for (const id of ['bunker-wall', 'brick-wall-full', 'earth-berm-full']) {
      expect(targetsForMode('missile').map((m) => m.id)).toContain(id);
      expect(targetsForMode('artillery').map((m) => m.id)).toContain(id);
      expect(targetsForMode('bullet').map((m) => m.id)).not.toContain(id);
    }
  });

  it('gives a clean Artillery result on each full-size wall', () => {
    const shell = getBullet(MODES.artillery.defaultId).id;
    for (const id of ['bunker-wall', 'brick-wall-full', 'earth-berm-full']) {
      const m = getMedium(id);
      const s = fire({ bullet: shell, stack: [{ medium: m, thickness: m.thickness.default, gapM: 0 }] }).summary;
      expect(Number.isFinite(s.penetrationM), id).toBe(true);
      expect(s.impactSpeed, id).toBeGreaterThan(0);
    }
  });

  it('parks the tank with its hull side above the tracks, listed for Missile and Artillery only', () => {
    const tank = getMedium('tank-hull');
    // The struck plate's middle: its lower edge rides 0.95 m up, over the tracks.
    expect(siteShotY('range', [tank])).toBeCloseTo(0.95 + tank.heightM / 2, 9);
    expect(targetsForMode('missile').map((m) => m.id)).toContain('tank-hull');
    expect(targetsForMode('artillery').map((m) => m.id)).toContain('tank-hull');
    expect(targetsForMode('bullet').map((m) => m.id)).not.toContain('tank-hull');
    const missile = getBullet(MODES.missile.defaultId).id;
    const s = fire({ bullet: missile, stack: [{ medium: tank, thickness: tank.thickness.default, gapM: 0 }] }).summary;
    expect(Number.isFinite(s.penetrationM)).toBe(true);
    expect(s.impactSpeed).toBeGreaterThan(0);
  });
});
