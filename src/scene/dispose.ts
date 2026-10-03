import * as THREE from 'three';

/** Every geometry, material and texture an object tree uses (plus a scene's environment and background). */
function resourcesOf(root: THREE.Object3D): Set<{ dispose(): void }> {
  const found = new Set<{ dispose(): void }>();
  const addTextures = (material: THREE.Material) => {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) found.add(value);
    const uniforms = (material as THREE.ShaderMaterial).uniforms;
    if (uniforms) for (const u of Object.values(uniforms)) if (u?.value instanceof THREE.Texture) found.add(u.value);
  };
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) found.add(mesh.geometry);
    const materials = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const m of materials) {
      found.add(m);
      addTextures(m);
    }
    const { shadow } = obj as { shadow?: THREE.LightShadow };
    if (shadow) found.add(shadow);
  });
  if (root instanceof THREE.Scene) {
    if (root.environment) found.add(root.environment);
    if (root.background instanceof THREE.Texture) found.add(root.background);
  }
  return found;
}

/**
 * Frees the GPU resources of `root` that `keep` doesn't also use (#133): the
 * second comparison lane shares cached textures and materials with the first,
 * and those must stay.
 */
export function disposeTree(root: THREE.Object3D, keep: THREE.Object3D | null): void {
  const kept = keep ? resourcesOf(keep) : new Set();
  for (const resource of resourcesOf(root)) if (!kept.has(resource)) resource.dispose();
  // Instanced meshes (particles, glass shards, the lab's acoustic panels) also hold instance buffers.
  disposeInstanceBuffers(root);
}

/** Frees the per-instance matrix and colour buffers of every instanced mesh under `root`. */
export function disposeInstanceBuffers(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if ((obj as THREE.InstancedMesh).isInstancedMesh) (obj as THREE.InstancedMesh).dispose();
  });
}
