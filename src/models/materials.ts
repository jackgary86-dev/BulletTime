import * as THREE from 'three';

/** Shared physically based materials for projectiles. */
export const BULLET_MATERIALS = {
  copper: new THREE.MeshPhysicalMaterial({
    color: 0xc8733f,
    metalness: 1,
    roughness: 0.28,
    clearcoat: 0.3,
  }),
  gildingMetal: new THREE.MeshPhysicalMaterial({
    color: 0xd08a52,
    metalness: 1,
    roughness: 0.25,
    clearcoat: 0.3,
  }),
  lead: new THREE.MeshStandardMaterial({ color: 0x7a7f86, metalness: 0.55, roughness: 0.55 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xd4a94a, metalness: 1, roughness: 0.3 }),
  aluminium: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 1, roughness: 0.35 }),
  /** Olive-drab painted steel body of the cannon shell. */
  paintedSteel: new THREE.MeshStandardMaterial({ color: 0x4b5233, metalness: 0.3, roughness: 0.6 }),
  /** Yellow identification band on the HE shell. */
  yellowPaint: new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.2, roughness: 0.55 }),
  /** Red identification band for incendiary filler. */
  redPaint: new THREE.MeshStandardMaterial({ color: 0x8c1d18, metalness: 0.2, roughness: 0.55 }),
} as const;
