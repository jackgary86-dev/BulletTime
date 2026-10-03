import * as THREE from 'three';
import { TARGET_FOCUS } from './camera';
import { createLabSet } from './labSet';
import type { SoftboxSpec } from './softbox';

/**
 * Bakes the lab room into a prefiltered environment map (#54), so metal,
 * glass and gel reflect the room they stand in: its walls, backstop, ceiling
 * strips and, brightest of all, the softboxes lighting the target.
 */
export function createLabEnvironment(renderer: THREE.WebGLRenderer, softboxes: SoftboxSpec[]): THREE.Texture {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050608);
  const lab = createLabSet();
  // Only the room matters here; its wash light stands in for the studio lights.
  scene.add(lab.group);
  scene.add(new THREE.HemisphereLight(0xb8c4d6, 0x1a1a1c, 1.4));

  // The softboxes as bright emissive cards, so highlights take their shape.
  for (const box of softboxes) {
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(box.width, box.height),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(box.color).multiplyScalar(box.reflection), side: THREE.DoubleSide }),
    );
    card.position.copy(box.position);
    card.lookAt(box.target);
    scene.add(card);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.02, 0.05, 30, { position: TARGET_FOCUS });
  const texture = target.texture;
  // Freeing the map frees its framebuffer too (#133).
  texture.addEventListener('dispose', () => target.dispose());
  pmrem.dispose();
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    // Shared cached textures stay alive; only the materials go.
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
  });
  return texture;
}
