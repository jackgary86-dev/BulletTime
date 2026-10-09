import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ParticleSystem } from '../fx/particles';
import { FLASH_CAP_CD, FLASH_SCALE, flashCandela, lightScale, setCleanFrameFlash, setFlashLevel, washScale } from './flash';
import { flashExposure } from './gradePass';

beforeAll(() => {
  // ParticleSystem paints a puff texture on a canvas; a stub is enough here.
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => undefined }),
    }),
  };
});

afterEach(() => {
  setFlashLevel('normal');
  setCleanFrameFlash(false);
});

describe('impact flash light (#321)', () => {
  it('never goes past the cap, whatever the round or the charge', () => {
    for (const raw of [0.1, 1, 3.4, 6, 45, 1e6]) expect(flashCandela(raw)).toBeLessThanOrEqual(FLASH_CAP_CD);
    expect(flashCandela(0)).toBe(0);
    expect(flashCandela(-1)).toBe(0);
    expect(flashCandela(Number.NaN)).toBe(0);
  });

  it('still lights more for a bigger hit, up to the cap', () => {
    const raws = [0.05, 0.1, 0.2, 0.5, 1, 3.4, 6, 20];
    for (let i = 1; i < raws.length; i++) expect(flashCandela(raws[i])).toBeGreaterThan(flashCandela(raws[i - 1]));
  });

  it('leaves a rifle-sized flash nearly as it was', () => {
    // A rifle round on steel lights about 0.1 to 0.2 cd.
    for (const raw of [0.09, 0.18]) expect(flashCandela(raw) / raw).toBeGreaterThan(0.97);
  });

  it('holds a shell-sized flash near the cap', () => {
    // A 155 mm shell on plate lit about 3.4 cd before; bloom then hid the hit.
    expect(flashCandela(3.4)).toBeGreaterThan(FLASH_CAP_CD * 0.99);
  });

  it('caps the light the particle system actually sets, and the Flash setting scales it', () => {
    const system = new ParticleSystem();
    system.addFlash(0, new THREE.Vector3(), 8, 150e-6);
    system.update(0);
    expect(system.flashLight.intensity).toBeCloseTo(flashCandela(8), 9);
    setFlashLevel('low');
    system.update(1e-9);
    expect(system.flashLight.intensity).toBeCloseTo(flashCandela(8 * Math.exp(-1e-9 / 150e-6)) * FLASH_SCALE.low, 9);
    setFlashLevel('off');
    system.update(2e-9);
    expect(system.flashLight.intensity).toBe(0);
  });

  it('applies a setting change to a paused frame', () => {
    const system = new ParticleSystem();
    system.addFlash(0, new THREE.Vector3(), 1, 150e-6);
    system.update(1e-6);
    const before = system.flashLight.intensity;
    setFlashLevel('off');
    system.update(1e-6);
    expect(before).toBeGreaterThan(0);
    expect(system.flashLight.intensity).toBe(0);
  });
});

describe('Flash setting (#321)', () => {
  it('scales the light and the muzzle-flash wash, off to normal', () => {
    expect(FLASH_SCALE.off).toBe(0);
    expect(FLASH_SCALE.low).toBeGreaterThan(0);
    expect(FLASH_SCALE.low).toBeLessThan(FLASH_SCALE.normal);
    setFlashLevel('low');
    expect(lightScale()).toBe(FLASH_SCALE.low);
    expect(washScale()).toBe(FLASH_SCALE.low);
  });

  it('turns the wash off in a clean frame, but not the impact light', () => {
    setCleanFrameFlash(true);
    expect(washScale()).toBe(0);
    expect(lightScale()).toBe(1);
  });
});

describe('muzzle-flash exposure wash (#321)', () => {
  const shutter = 1e-5;
  it('is bounded and gone after twelve footage frames, at any slow-motion rate', () => {
    for (const s of [1e-6, 1e-5, 1e-3]) {
      for (let f = 0; f <= 30; f += 0.25) expect(flashExposure(f * 2 * s, s)).toBeLessThanOrEqual(1);
      expect(flashExposure(12.01 * 2 * s, s)).toBe(0);
    }
    expect(flashExposure(2 * shutter, shutter)).toBeCloseTo(1);
  });
});
