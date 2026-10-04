import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraDirector } from './cameraDirector';

/** Just enough of OrbitControls for the director. */
function fakeControls() {
  return { target: new THREE.Vector3(), addEventListener: () => {}, update: () => {} } as never;
}

function settled(mode: 'side' | 'auto' = 'side') {
  const camera = new THREE.PerspectiveCamera();
  const director = new CameraDirector(camera, fakeControls(), () => {});
  director.setTarget(new THREE.Vector3(0.2, 1.1, 0), 0.4, 0.3);
  director.reset();
  director.setMode(mode);
  return { camera, director };
}

describe('camera stays put when a shot is fired (#239)', () => {
  it('starts in the fixed side view', () => {
    expect(new CameraDirector(new THREE.PerspectiveCamera(), fakeControls(), () => {}).mode).toBe('side');
  });

  it('does not move in the side view when the aim point changes, however long it runs', () => {
    const { camera, director } = settled();
    const before = camera.position.clone();
    director.setAim(new THREE.Vector3(0.2, 1.3, 0.1));
    for (let i = 0; i < 600; i++) director.update(1 / 60, i * 1e-5, null);
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-9);
  });

  it('still takes the aim point into the close-up', () => {
    const { camera, director } = settled();
    director.setMode('closeup');
    director.setAim(new THREE.Vector3(0.2, 1.3, 0.1));
    for (let i = 0; i < 600; i++) director.update(1 / 60, 0, null);
    expect(camera.position.y).toBeCloseTo(1.3 + 0.07, 2);
  });
});
