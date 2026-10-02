import * as THREE from 'three';
import { seededRandom } from '../sim/random';

let cached: THREE.Texture | null = null;

/**
 * A tileable normal map of crumpled film: the wrinkled, folded look of a
 * temporary cavity wall in high-speed gel footage. Built once from a height
 * field of random ridges and creases, then differentiated into normals.
 */
export function crinkleNormalMap(): THREE.Texture {
  if (cached) return cached;
  const size = 256;
  const height = new Float32Array(size * size);
  const rand = seededRandom(97);

  // Random straight creases with a sharp ridge profile, wrapped so the map tiles.
  for (let n = 0; n < 220; n++) {
    const x0 = rand() * size;
    const y0 = rand() * size;
    const angle = rand() * Math.PI;
    const length = 10 + rand() * 60;
    const width = 1.5 + rand() * 3.5;
    const amp = (rand() - 0.4) * 1.6;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const reach = Math.ceil(length / 2 + width * 2);
    for (let oy = -reach; oy <= reach; oy++) {
      for (let ox = -reach; ox <= reach; ox++) {
        const along = ox * dx + oy * dy;
        if (Math.abs(along) > length / 2) continue;
        const across = Math.abs(-ox * dy + oy * dx);
        if (across > width * 2) continue;
        const taper = 1 - Math.abs(along) / (length / 2);
        const ridge = Math.max(0, 1 - across / (width * 2));
        const x = (((Math.round(x0 + ox) % size) + size) % size) | 0;
        const y = (((Math.round(y0 + oy) % size) + size) % size) | 0;
        height[y * size + x] += amp * ridge * ridge * taper;
      }
    }
  }

  const data = new Uint8Array(size * size * 4);
  const h = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  const strength = 2.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (h(x - 1, y) - h(x + 1, y)) * strength;
      const ny = (h(x, y - 1) - h(x, y + 1)) * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  cached = texture;
  return texture;
}
