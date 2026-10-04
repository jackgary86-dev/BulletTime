import * as THREE from 'three';
import { PLATE_BODY_NAME, layerGroupName } from '../models/targets';
import type { TargetLayer } from '../sim/engine';
import type { Timeline } from '../sim/types';
import { dishDepthAt, dishFalloff, planDishes, type Dish } from './plateDishMath';

/** The bulge is drawn out to this many Gaussian widths; beyond it the plate is flat. */
const REACH_SIGMAS = 3.5;
/** Mesh spacing as a fraction of the narrowest bulge width, and the most segments along an edge. */
const SEGMENT_PER_SIGMA = 3;
const MAX_SEGMENTS = 220;

interface Patch {
  mesh: THREE.Mesh;
  original: THREE.BufferGeometry;
  dishes: Array<{ dish: Dish; y: number; z: number }>;
  /** Back-face vertices the bulge reaches, and their rest x. */
  indices: number[];
  rest: Float32Array;
  lastKey: string;
}

/**
 * Bulges the back face of a metal plate where it is hit (#221). The plate is re-meshed finely enough to show a
 * bulge a few millimetres wide when a shot loads and put back on clear; the front face stays flat so the
 * marks drawn on it still sit on the surface. A pure function of sim time.
 */
export class PlateDish {
  private patches: Patch[] = [];

  load(timeline: Timeline, target: THREE.Group, layers: TargetLayer[]): void {
    this.clear();
    const byLayer = new Map<number, Dish[]>();
    for (const dish of planDishes(timeline, layers)) byLayer.set(dish.layer, [...(byLayer.get(dish.layer) ?? []), dish]);
    target.updateWorldMatrix(true, true);
    for (const [layer, dishes] of byLayer) {
      const mesh = target.getObjectByName(layerGroupName(layers[layer].stack ?? 0))?.getObjectByName(PLATE_BODY_NAME);
      if (!(mesh instanceof THREE.Mesh) || !(mesh.geometry instanceof THREE.BoxGeometry)) continue;
      const original = mesh.geometry;
      const { width: t, height: h, depth: w } = original.parameters;
      const sigma = Math.min(...dishes.map((d) => d.sigmaM));
      const step = sigma / SEGMENT_PER_SIGMA;
      const rows = Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(h / step)));
      const cols = Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(w / step)));
      const geometry = new THREE.BoxGeometry(t, h, w, 1, rows, cols);
      mesh.geometry = geometry;
      const local = dishes.map((dish) => {
        const p = mesh.worldToLocal(new THREE.Vector3(dish.pos.x, dish.pos.y, dish.pos.z));
        return { dish, y: p.y, z: p.z };
      });
      const position = geometry.getAttribute('position') as THREE.BufferAttribute;
      const indices: number[] = [];
      const rest: number[] = [];
      for (let i = 0; i < position.count; i++) {
        // Only the back face (x > 0) bulges.
        if (position.getX(i) <= 0) continue;
        const near = local.some(({ dish, y, z }) => Math.hypot(position.getY(i) - y, position.getZ(i) - z) < dish.sigmaM * REACH_SIGMAS);
        if (!near) continue;
        indices.push(i);
        rest.push(position.getX(i));
      }
      this.patches.push({ mesh, original, dishes: local, indices, rest: Float32Array.from(rest), lastKey: '' });
    }
  }

  update(t: number): void {
    for (const patch of this.patches) {
      const depths = patch.dishes.map(({ dish }) => dishDepthAt(dish, t));
      const key = depths.join(',');
      if (key === patch.lastKey) continue;
      patch.lastKey = key;
      const geometry = patch.mesh.geometry;
      const position = geometry.getAttribute('position') as THREE.BufferAttribute;
      patch.indices.forEach((vertex, n) => {
        let lift = 0;
        const y = position.getY(vertex);
        const z = position.getZ(vertex);
        patch.dishes.forEach(({ dish, y: cy, z: cz }, i) => {
          if (depths[i] > 0) lift += depths[i] * dishFalloff(dish, Math.hypot(y - cy, z - cz));
        });
        position.setX(vertex, patch.rest[n] + lift);
      });
      position.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
    }
  }

  clear(): void {
    for (const { mesh, original } of this.patches) {
      mesh.geometry.dispose();
      mesh.geometry = original;
    }
    this.patches = [];
  }
}
