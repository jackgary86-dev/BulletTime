import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraDirector, springTo } from './cameraDirector';
import { flashExposure } from './gradePass';
import { formatCount, formatShutter, formatSpeed, formatTimecode } from '../ui/cameraHud';

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

describe('fixed side view (#239)', () => {
  /** A director on a bare camera, with just enough of the orbit controls for it to drive. */
  const rig = () => {
    const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.01, 50);
    const controls = { target: new THREE.Vector3(), addEventListener: () => {}, update: () => {} };
    const director = new CameraDirector(camera, controls as never, () => {});
    director.setTarget(new THREE.Vector3(-0.2, 0.16, 0), 0.4, 0.3);
    director.reset();
    return { camera, director };
  };

  it('starts on the side view and does not move when a shot is aimed off centre', () => {
    const { camera, director } = rig();
    expect(director.mode).toBe('side');
    const before = camera.position.clone();
    director.setAim(new THREE.Vector3(-0.2, 0.16 + 0.06, -0.05));
    for (let i = 0; i < 120; i++) director.update(1 / 60, 1e-3, null);
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-9);
  });

  it('the close-up still follows the aim', () => {
    const { camera, director } = rig();
    director.setMode('closeup');
    director.setAim(new THREE.Vector3(-0.2, 0.16 + 0.06, -0.05));
    for (let i = 0; i < 240; i++) director.update(1 / 60, 1e-3, null);
    expect(camera.position.y).toBeCloseTo(0.16 + 0.06 + 0.07, 3);
  });
});

describe('two-readout HUD (#239)', () => {
  it('shows the speed in whole metres per second', () => {
    expect(formatSpeed(1249.6)).toBe(`${formatCount(1250)} m/s`);
    expect(formatSpeed(0)).toBe('0 m/s');
    expect(formatSpeed(-3)).toBe('0 m/s');
  });
});
