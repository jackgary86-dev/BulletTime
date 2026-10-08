import { describe, expect, it } from 'vitest';
import { FLASH_CAP_CD, flashLightLevel, flashWashScale, softClipFlash } from './flashSetting';
import { flashExposure } from './gradePass';

describe('impact flash limit (#321)', () => {
  it('is bounded for any round or yield, and never below zero', () => {
    for (const cd of [0, 0.01, 0.06, 0.5, 6, 30, 1e6, Infinity]) {
      const level = softClipFlash(cd);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(FLASH_CAP_CD);
    }
    expect(softClipFlash(NaN)).toBe(0);
    expect(softClipFlash(-3)).toBe(0);
  });

  it('still grows with the round, up to the cap: a bigger round looks bigger', () => {
    const levels = [0.02, 0.06, 0.15, 0.4, 1, 3].map((cd) => softClipFlash(cd));
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1]);
    // A small flash passes nearly unchanged.
    expect(softClipFlash(0.02)).toBeCloseTo(0.02, 2);
  });

  it('is scaled by the setting: off is dark, low is dimmer than normal', () => {
    expect(flashLightLevel(5, 'off')).toBe(0);
    expect(flashLightLevel(5, 'low')).toBeGreaterThan(0);
    expect(flashLightLevel(5, 'low')).toBeLessThan(flashLightLevel(5, 'normal'));
    expect(flashLightLevel(5, 'normal')).toBeLessThanOrEqual(FLASH_CAP_CD);
  });
});

describe('camera exposure wash (#321)', () => {
  it('is bounded at 1 and gone after twelve frames', () => {
    const shutter = 1 / 1000;
    for (let frame = 0; frame <= 30; frame += 0.5) {
      const wash = flashExposure(frame * 2 * shutter, shutter);
      expect(wash).toBeGreaterThanOrEqual(0);
      expect(wash).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(flashExposure(13 * 2 * shutter, shutter)).toBe(0);
    expect(flashExposure(-1, shutter)).toBe(0);
  });

  it('follows the setting, and a clean frame drops it entirely', () => {
    expect(flashWashScale('normal', false)).toBe(1);
    expect(flashWashScale('low', false)).toBeLessThan(1);
    expect(flashWashScale('off', false)).toBe(0);
    expect(flashWashScale('normal', true)).toBe(0);
  });
});
