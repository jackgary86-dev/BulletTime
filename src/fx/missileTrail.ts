import * as THREE from 'three';

/**
 * A missile's rocket motor and smoke trail (#194). The plume is a pair of
 * crossed, additive flame cards behind the base; the smoke is a line of soft
 * puffs that widen and fade with distance. Everything is a function of the
 * missile's position and size, so scrubbing the timeline back and forth stays
 * in step. Materials, textures and geometry are shared and never freed, so
 * firing again does not recompile shaders (#127).
 */

/** Smoke puffs per trail. */
const PUFFS = 22;
/** The flame is about this many body lengths long, the smoke this many beyond it. */
const FLAME_LENGTHS = 0.9;
const SMOKE_LENGTHS = 3.5;
const MIN_FLAME_M = 0.25;
const MIN_SMOKE_M = 1.2;

let flameTexture: THREE.Texture | null = null;
let puffTexture: THREE.Texture | null = null;
let flameGeometry: THREE.BufferGeometry | null = null;
let flameMaterial: THREE.MeshBasicMaterial | null = null;

/** Hot and bright at the right-hand end (the nozzle), cooling and fraying toward the left. */
function makeFlameTexture(): THREE.Texture {
  const w = 256;
  const h = 96;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = 1 - x / w; // 0 at the nozzle, 1 at the tip
      const v = (y / h - 0.5) * 2;
      const half = 0.5 + 0.45 * Math.sqrt(u);
      const edge = Math.max(0, 1 - Math.abs(v) / half);
      // Shock diamonds: bright bands along the exhaust.
      const diamonds = 0.8 + 0.2 * Math.cos(u * 34);
      const frayed = 0.8 + 0.2 * Math.sin(v * 19 + u * 11);
      const a = Math.min(1, edge ** 1.2 * (1 - u) ** 1.1 * diamonds * frayed * 1.7);
      const heat = Math.min(1, (1 - u) * 1.3);
      const i = (y * w + x) * 4;
      image.data[i] = 255;
      image.data[i + 1] = Math.round(110 + 140 * heat);
      image.data[i + 2] = Math.round(30 + 190 * heat ** 3);
      image.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A soft, slightly uneven puff of smoke. */
function makePuffTexture(): THREE.Texture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(235, 235, 235, 0.9)');
  g.addColorStop(0.55, 'rgba(210, 210, 210, 0.45)');
  g.addColorStop(1, 'rgba(190, 190, 190, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function shared(): { flameGeometry: THREE.BufferGeometry; flameMaterial: THREE.MeshBasicMaterial; puff: THREE.Texture } {
  flameTexture ??= makeFlameTexture();
  puffTexture ??= makePuffTexture();
  if (!flameGeometry) {
    // A card with its nozzle edge at the origin, running back along -x.
    flameGeometry = new THREE.PlaneGeometry(1, 1);
    flameGeometry.translate(-0.5, 0, 0);
  }
  flameMaterial ??= new THREE.MeshBasicMaterial({
    map: flameTexture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  return { flameGeometry, flameMaterial, puff: puffTexture };
}

export interface MissileTrail {
  group: THREE.Group;
  /**
   * Shows the motor and smoke for a missile `inAir`. `length` and `diameter` are the
   * airframe's, in metres; `now` is a wall-clock time in seconds that keeps the flame flickering.
   */
  update(inAir: boolean, length: number, diameter: number, now: number): void;
  dispose(): void;
}

export function createMissileTrail(): MissileTrail {
  const { flameGeometry: geometry, flameMaterial: material, puff } = shared();
  const group = new THREE.Group();
  group.name = 'missile-trail';

  const flame = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const card = new THREE.Mesh(geometry, material);
    card.rotation.x = (i * Math.PI) / 2;
    card.renderOrder = 3;
    card.frustumCulled = false;
    flame.add(card);
  }
  group.add(flame);

  const puffs: THREE.Sprite[] = [];
  for (let i = 0; i < PUFFS; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, transparent: true, depthWrite: false, color: 0xd2d2d2 }));
    sprite.renderOrder = 2;
    sprite.frustumCulled = false;
    puffs.push(sprite);
    group.add(sprite);
  }

  return {
    group,
    update(inAir, length, diameter, now) {
      group.visible = inAir;
      if (!inAir) return;
      const flameLength = Math.max(MIN_FLAME_M, length * FLAME_LENGTHS);
      const smokeLength = Math.max(MIN_SMOKE_M, length * SMOKE_LENGTHS);
      const flicker = 1 + 0.07 * Math.sin(now * 61) + 0.05 * Math.sin(now * 113 + 1);
      // The flame starts at the base of the airframe, which sits `length` behind the nose.
      flame.position.x = -length;
      flame.scale.set(flameLength * flicker, diameter * (1.7 + 0.08 * Math.sin(now * 89)), diameter * 1.7);
      const smokeStart = -length - flameLength * 0.8;
      for (let i = 0; i < PUFFS; i++) {
        const k = (i + 1) / PUFFS;
        const sprite = puffs[i];
        // A stable wobble per puff keeps the trail from looking like a straight pipe.
        const wobble = Math.sin(i * 2.399) * diameter * 0.25 * k;
        sprite.position.set(smokeStart - k * smokeLength, wobble, Math.cos(i * 1.7) * diameter * 0.25 * k);
        const size = diameter * (1.4 + 3.6 * k);
        sprite.scale.set(size, size, 1);
        (sprite.material as THREE.SpriteMaterial).opacity = 0.55 * (1 - k) ** 1.4;
      }
    },
    dispose() {
      for (const sprite of puffs) sprite.material.dispose();
    },
  };
}
