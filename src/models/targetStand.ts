import * as THREE from 'three';

/** Gel block preview size in metres: 40 cm long along the shot line (+x), 15 cm square. */
export const PREVIEW_BLOCK = { length: 0.4, width: 0.15, height: 0.15 } as const;
const STAND_HEIGHT = 0.045;

/**
 * A lab stand with a translucent 10% gelatin block on it, so the studio has a
 * subject from the first ticket. The real target models replace the block later.
 */
export function createTargetStand(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'target-stand';

  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.35, metalness: 0.9 });
  const legGeometry = new THREE.CylinderGeometry(0.008, 0.008, STAND_HEIGHT, 16);
  for (const x of [-0.16, 0.16]) {
    for (const z of [-0.05, 0.05]) {
      const leg = new THREE.Mesh(legGeometry, steel);
      leg.position.set(x, STAND_HEIGHT / 2, z);
      leg.castShadow = true;
      group.add(leg);
    }
  }
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.006, 0.17), steel);
  tray.position.y = STAND_HEIGHT;
  tray.castShadow = true;
  tray.receiveShadow = true;
  group.add(tray);

  const gel = new THREE.Mesh(
    new THREE.BoxGeometry(PREVIEW_BLOCK.length, PREVIEW_BLOCK.height, PREVIEW_BLOCK.width),
    new THREE.MeshPhysicalMaterial({
      color: 0xfff3dc,
      roughness: 0.08,
      metalness: 0,
      transmission: 0.96,
      thickness: PREVIEW_BLOCK.width,
      ior: 1.35,
      attenuationColor: new THREE.Color(0xf3c98a),
      attenuationDistance: 1.2,
      specularIntensity: 0.8,
      clearcoat: 0.4,
      clearcoatRoughness: 0.1,
    }),
  );
  gel.position.y = STAND_HEIGHT + 0.003 + PREVIEW_BLOCK.height / 2;
  gel.castShadow = true;
  gel.name = 'gel-block-preview';
  group.add(gel);

  return group;
}
