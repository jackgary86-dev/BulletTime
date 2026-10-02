import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Where the target sits; cameras and lights frame this point. Units are metres. */
export const TARGET_FOCUS = new THREE.Vector3(0, 0.15, 0);

export interface CameraRig {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
}

/**
 * A perspective camera framing the classic side-on ballistics shot, with orbit
 * controls for free inspection. Camera presets arrive in a later ticket.
 */
export function createCameraRig(canvas: HTMLCanvasElement): CameraRig {
  const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.01, 50);
  camera.position.set(0.15, 0.32, 1.25);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(TARGET_FOCUS);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.15;
  controls.maxDistance = 6;
  controls.maxPolarAngle = Math.PI * 0.495; // stay above the floor
  controls.update();

  return { camera, controls };
}
