import * as THREE from 'three';
import { seededRandom } from '../sim/random';

/**
 * Handling and loading wear (#70): fine scuffs running along the bullet's
 * length (lathe v), a few brighter burnished streaks and some duller patches,
 * as a roughness map. Values multiply each material's roughness.
 */
function wearRoughnessMap(): THREE.Texture {
  const w = 64;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgb(200, 200, 200)';
  ctx.fillRect(0, 0, w, h);
  const rand = seededRandom(313);
  // Long scuffs along the length: rougher (lighter) and polished (darker) lines.
  for (let i = 0; i < 70; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const len = 20 + rand() * 120;
    const v = rand() < 0.5 ? 255 : 120;
    ctx.strokeStyle = `rgba(${v}, ${v}, ${v}, ${0.15 + rand() * 0.3})`;
    ctx.lineWidth = 0.5 + rand();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 3, y + len);
    ctx.stroke();
  }
  // Dull, oxidised patches.
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.06 + rand() * 0.08})`;
    ctx.beginPath();
    ctx.ellipse(rand() * w, rand() * h, 3 + rand() * 8, 6 + rand() * 20, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

const wear = wearRoughnessMap();

/** Shared physically based materials for projectiles. */
export const BULLET_MATERIALS = {
  copper: new THREE.MeshPhysicalMaterial({
    color: 0xc8733f,
    metalness: 1,
    roughness: 0.34,
    roughnessMap: wear,
    clearcoat: 0.3,
  }),
  gildingMetal: new THREE.MeshPhysicalMaterial({
    color: 0xd08a52,
    metalness: 1,
    roughness: 0.31,
    roughnessMap: wear,
    clearcoat: 0.3,
  }),
  lead: new THREE.MeshStandardMaterial({ color: 0x7a7f86, metalness: 0.55, roughness: 0.62, roughnessMap: wear }),
  /** The dark, oxidised lead core seen in a hollow-point cavity and an open FMJ base. */
  leadCore: new THREE.MeshStandardMaterial({ color: 0x5c6066, metalness: 0.5, roughness: 0.7, side: THREE.DoubleSide }),
  /** The dark slits of skive cuts in a hollow-point jacket. */
  skive: new THREE.MeshStandardMaterial({ color: 0x2a1c14, metalness: 0.4, roughness: 0.7 }),
  /** White polyethylene shot cup and wads. */
  wad: new THREE.MeshPhysicalMaterial({ color: 0xeceae4, roughness: 0.4, transmission: 0.45, thickness: 0.0008, side: THREE.DoubleSide }),
  brass: new THREE.MeshStandardMaterial({ color: 0xd4a94a, metalness: 1, roughness: 0.3 }),
  aluminium: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 1, roughness: 0.35 }),
  /** Olive-drab painted steel body of the cannon shell. */
  paintedSteel: new THREE.MeshStandardMaterial({ color: 0x4b5233, metalness: 0.3, roughness: 0.6 }),
  /** Yellow identification band on the HE shell. */
  yellowPaint: new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.2, roughness: 0.55 }),
  /** Red identification band for incendiary filler. */
  redPaint: new THREE.MeshStandardMaterial({ color: 0x8c1d18, metalness: 0.2, roughness: 0.55 }),
} as const;
