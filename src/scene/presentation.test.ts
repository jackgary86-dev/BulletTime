import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { springTo } from './cameraDirector';
import { flashExposure } from './gradePass';
import { formatShutter, formatTimecode } from '../ui/cameraHud';

describe('camera spring (#75)', () => {
  const settle = (dt: number, seconds: number) => {
    const value = new THREE.Vector3(1, 0, 0);
    const velocity = new THREE.Vector3();
    const target = new THREE.Vector3();
    let minX = 1;
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      springTo(value, velocity, target, 6, dt);
      minX = Math.min(minX, value.x);
    }
    return { x: value.x, minX };
  };

  it('glides in without overshooting', () => {
    const { x, minX } = settle(1 / 60, 2);
    expect(x).toBeLessThan(0.01);
    expect(minX).toBeGreaterThanOrEqual(0);
  });

  it('moves the same at any frame rate', () => {
    expect(settle(1 / 30, 0.5).x).toBeCloseTo(settle(1 / 144, 0.5).x, 2);
  });
});

describe('muzzle flash exposure (#75)', () => {
  const shutter = 1e-5;
  it('is dark on the trigger frame, peaks a frame later and fades', () => {
    expect(flashExposure(0, shutter)).toBe(0);
    expect(flashExposure(2 * shutter, shutter)).toBeCloseTo(1);
    expect(flashExposure(16 * shutter, shutter)).toBeLessThan(0.1);
    expect(flashExposure(-1e-6, shutter)).toBe(0);
  });
});

describe('camera readout (#75)', () => {
  it('formats the timecode and shutter', () => {
    expect(formatTimecode(0.0003)).toBe('T+0.000 300 s');
    expect(formatTimecode(1.25)).toBe('T+1.250 000 s');
    expect(formatShutter(1 / 120000)).toBe('1/120 000 s');
  });
});
