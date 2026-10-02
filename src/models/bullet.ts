import * as THREE from 'three';

/**
 * A simple procedural 9mm jacketed hollow point: a lathe profile with a copper
 * jacket and an exposed lead core in the nose cavity. The full catalogue of
 * bullet models arrives with #3.
 *
 * The returned group's origin is the bullet's nose and it points along +x, so
 * the timeline's nose position can be applied directly.
 */
export interface BulletModel {
  group: THREE.Group;
  /** Shows the bullet expanded to `diameter` (metres); shortens as it mushrooms. */
  setDiameter(diameter: number): void;
}

const DIAMETER = 0.00901;
const LENGTH = 0.0155;

export function createBulletModel(): BulletModel {
  const r = DIAMETER / 2;
  // Profile from the base (y = 0) to the hollow-point nose (y = LENGTH), as (radius, height).
  const profile = [
    [0, 0],
    [r * 0.92, 0],
    [r, LENGTH * 0.04],
    [r, LENGTH * 0.55],
    [r * 0.93, LENGTH * 0.72],
    [r * 0.76, LENGTH * 0.88],
    [r * 0.6, LENGTH],
    [r * 0.42, LENGTH],
    [r * 0.3, LENGTH * 0.86],
    [0, LENGTH * 0.82],
  ].map(([x, y]) => new THREE.Vector2(x, y));

  const jacket = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 48),
    new THREE.MeshPhysicalMaterial({
      color: 0xc8733f,
      metalness: 1,
      roughness: 0.28,
      clearcoat: 0.3,
    }),
  );
  jacket.castShadow = true;

  // Lead core visible inside the hollow point.
  const core = new THREE.Mesh(
    new THREE.CircleGeometry(r * 0.3, 24),
    new THREE.MeshStandardMaterial({ color: 0x6b6f75, metalness: 0.6, roughness: 0.55 }),
  );
  core.rotation.x = -Math.PI / 2;
  core.position.y = LENGTH * 0.825;

  // Lathe axis is +y; rotate so the bullet points along +x with the nose at the origin.
  const body = new THREE.Group();
  body.add(jacket, core);
  body.rotation.z = -Math.PI / 2;
  body.position.x = -LENGTH;

  const group = new THREE.Group();
  group.name = 'bullet';
  group.add(body);

  return {
    group,
    setDiameter(diameter) {
      const ratio = diameter / DIAMETER;
      // Lathe x/z are radial, y is the length; expansion trades length for width.
      body.scale.set(ratio, 1 / Math.sqrt(ratio), ratio);
      body.position.x = -LENGTH / Math.sqrt(ratio);
    },
  };
}
