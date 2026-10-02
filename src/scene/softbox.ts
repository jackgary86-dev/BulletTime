import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

/** A rectangular studio softbox: where it hangs, what it points at and how bright it is. */
export interface SoftboxSpec {
  name: string;
  position: THREE.Vector3;
  target: THREE.Vector3;
  width: number;
  height: number;
  color: number;
  intensity: number;
  /** Brightness of the softbox's face in reflections (the environment map). */
  reflection: number;
}

export interface Softbox {
  group: THREE.Group;
  light: THREE.RectAreaLight;
  /** The glowing diffuser face, dimmed along with the light. */
  face: THREE.MeshBasicMaterial;
  spec: SoftboxSpec;
  setLevel(level: number): void;
}

let uniformsReady = false;

/**
 * A soft area light with a visible diffuser panel and a dark housing, so it
 * reads as real studio gear when the camera orbits round to see it.
 */
export function createSoftbox(spec: SoftboxSpec): Softbox {
  if (!uniformsReady) {
    RectAreaLightUniformsLib.init();
    uniformsReady = true;
  }
  const group = new THREE.Group();
  group.name = `softbox-${spec.name}`;
  group.position.copy(spec.position);
  group.lookAt(spec.target);

  const light = new THREE.RectAreaLight(spec.color, spec.intensity, spec.width, spec.height);
  // RectAreaLight shines down its local -z; the group looks down +z at the target.
  light.rotation.y = Math.PI;
  group.add(light);

  const face = new THREE.MeshBasicMaterial({ color: spec.color, fog: false });
  const diffuser = new THREE.Mesh(new THREE.PlaneGeometry(spec.width, spec.height), face);
  diffuser.position.z = 0.002;
  group.add(diffuser);

  // A shallow box behind the diffuser, open toward the target.
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(spec.width + 0.04, spec.height + 0.04, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.7, metalness: 0.2 }),
  );
  housing.position.z = -0.062;
  group.add(housing);

  const setLevel = (level: number) => {
    light.intensity = spec.intensity * level;
    face.color.set(spec.color).multiplyScalar(Math.min(1, 0.15 + level));
  };
  return { group, light, face, spec, setLevel };
}
