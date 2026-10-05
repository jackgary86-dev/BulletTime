import * as THREE from 'three';

/**
 * A missile's rocket motor and smoke trail (#194, #247). The plume is layered:
 * a hard white-orange core cone that blooms, a pair of crossed additive flame
 * cards with shock diamonds, and (on higher quality) a wider outer plume and a
 * faint halo whose edges are eaten by scrolling noise. The smoke is a line of
 * soft puffs that widen and fade with distance, warm where the plume lights
 * them. Everything is a function of the
 * missile's position and size, so scrubbing the timeline back and forth stays
 * in step. Materials, textures and geometry are shared and never freed, so
 * firing again does not recompile shaders (#127).
 */

/** Smoke puffs per trail. */
const PUFFS = 26;
/** The flame is about this many body lengths long, the smoke this many beyond it. */
const FLAME_LENGTHS = 0.9;
const SMOKE_LENGTHS = 3.5;
const MIN_FLAME_M = 0.25;
const MIN_SMOKE_M = 1.2;
/** How much brighter than white the core's hottest end is, so it blooms. */
const CORE_GAIN = 1.8;
/** The part of the smoke trail the plume lights, as a share of its length. */
const LIT_SMOKE_SHARE = 0.35;
/** How far behind the nozzle the motor light sits, in diameters. */
const LIGHT_GAP = 0.6;

let flameTexture: THREE.Texture | null = null;
let puffTexture: THREE.Texture | null = null;
let flameGeometry: THREE.BufferGeometry | null = null;
let flameMaterial: THREE.MeshBasicMaterial | null = null;
let coreGeometry: THREE.BufferGeometry | null = null;
let coreMaterial: THREE.MeshBasicMaterial | null = null;
let outerMaterial: THREE.MeshBasicMaterial | null = null;
let haloMaterial: THREE.MeshBasicMaterial | null = null;
let noiseTexture: THREE.Texture | null = null;

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

/** A tileable noise, 0.45 to 1, for eating the outer plume's edge as it scrolls back from the nozzle. */
function makeNoiseTexture(): THREE.Texture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  const tau = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Sums of sines with whole numbers of cycles wrap seamlessly.
      const n = 0.5 + 0.22 * Math.sin(tau * (3 * u + 1 * v) + 1.3) + 0.16 * Math.sin(tau * (5 * u - 2 * v) + 4.1) + 0.12 * Math.sin(tau * (9 * u + 4 * v) + 2.2);
      const g = Math.round(255 * (0.45 + 0.55 * Math.min(1, Math.max(0, n))));
      const i = (y * size + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = g;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** A cone with its mouth at the origin and its tip one unit back along -x, brightest at the mouth and black (so nothing, additively) at the tip. */
function makeCoreGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(0.5, 1, 20, 1, true);
  geometry.rotateZ(Math.PI / 2);
  geometry.translate(-0.5, 0, 0);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const t = Math.min(1, Math.max(0, -position.getX(i)));
    const heat = (1 - t) ** 1.3 * CORE_GAIN;
    colors[i * 3] = heat;
    colors[i * 3 + 1] = heat * (0.78 - 0.3 * t);
    colors[i * 3 + 2] = heat * (0.5 - 0.4 * t);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

interface Shared {
  flameGeometry: THREE.BufferGeometry;
  flameMaterial: THREE.MeshBasicMaterial;
  coreGeometry: THREE.BufferGeometry;
  coreMaterial: THREE.MeshBasicMaterial;
  outerMaterial: THREE.MeshBasicMaterial;
  haloMaterial: THREE.MeshBasicMaterial;
  puff: THREE.Texture;
}

function shared(): Shared {
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
  coreGeometry ??= makeCoreGeometry();
  coreMaterial ??= new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  noiseTexture ??= makeNoiseTexture();
  // The outer plume and the halo share the flame card but lose their edges to scrolling noise.
  outerMaterial ??= new THREE.MeshBasicMaterial({
    map: flameTexture,
    alphaMap: noiseTexture,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  haloMaterial ??= new THREE.MeshBasicMaterial({
    map: flameTexture,
    alphaMap: noiseTexture,
    transparent: true,
    opacity: 0.28,
    color: 0xff8a40,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  return { flameGeometry, flameMaterial, coreGeometry, coreMaterial, outerMaterial, haloMaterial, puff: puffTexture };
}

/** What the motor lights: its glow on the ground and the smoke, in the renderer's light units. */
export interface MotorLight {
  intensity: number;
  /** How far it reaches, m. */
  distance: number;
  /** Behind the nozzle along the missile's axis, m. */
  offset: number;
}

/** The nozzle light for a missile of this size at wall-clock `now`: bigger motors burn brighter and reach further, and it flickers a little. */
export function motorLight(length: number, diameter: number, now: number): MotorLight {
  const flicker = 1 + 0.12 * Math.sin(now * 47) + 0.08 * Math.sin(now * 97 + 2);
  const scale = Math.max(0.05, diameter);
  return {
    intensity: 12 * Math.sqrt(scale / 0.1) * flicker,
    distance: Math.max(3, Math.min(30, length * 6 + scale * 20)),
    offset: length + scale * LIGHT_GAP,
  };
}

/** The column of hot air behind a motor: from the nozzle, `length` m back along the missile's axis, `radius` m wide at its start. */
export function hazeColumn(length: number, diameter: number): { length: number; radius: number } {
  const flame = Math.max(MIN_FLAME_M, length * FLAME_LENGTHS);
  return { length: flame * 2.4, radius: Math.max(0.05, diameter * 3) };
}

/** Plume layers a quality level draws: 1 is the core and flame cards, 2 adds the outer plume, 3 adds the halo. */
export type PlumeLayers = 1 | 2 | 3;

export interface MissileTrail {
  group: THREE.Group;
  /**
   * Shows the motor and smoke for a missile `inAir`. `length` and `diameter` are the
   * airframe's, in metres; `now` is a wall-clock time in seconds that keeps the flame flickering.
   */
  update(inAir: boolean, length: number, diameter: number, now: number): void;
  /** How many plume layers to draw (lower quality draws fewer). */
  layers: PlumeLayers;
  dispose(): void;
}

export function createMissileTrail(): MissileTrail {
  const { flameGeometry: geometry, flameMaterial: material, coreGeometry: coneGeometry, coreMaterial: coneMaterial, outerMaterial: outer, haloMaterial: halo, puff } = shared();
  const group = new THREE.Group();
  group.name = 'missile-trail';

  // The flame group is scaled to the plume (length, then width and height); the layers inside refine that.
  const flame = new THREE.Group();
  const core = new THREE.Mesh(coneGeometry, coneMaterial);
  core.renderOrder = 4;
  core.frustumCulled = false;
  flame.add(core);
  const cards = (mat: THREE.Material, order: number) => {
    const pair = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const card = new THREE.Mesh(geometry, mat);
      card.rotation.x = (i * Math.PI) / 2;
      card.renderOrder = order;
      card.frustumCulled = false;
      pair.add(card);
    }
    flame.add(pair);
    return pair;
  };
  const haloCards = cards(halo, 1);
  const outerCards = cards(outer, 2);
  cards(material, 3);
  outerCards.scale.set(1.25, 1.35, 1.35);
  haloCards.scale.set(1.5, 2.3, 2.3);
  // The core is a shorter, narrower cone inside the flame, in the flame group's own units.
  core.scale.set(0.55, 0.5, 0.5);
  group.add(flame);

  const puffs: THREE.Sprite[] = [];
  for (let i = 0; i < PUFFS; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, transparent: true, depthWrite: false, color: 0xd2d2d2 }));
    sprite.renderOrder = 2;
    sprite.frustumCulled = false;
    puffs.push(sprite);
    group.add(sprite);
  }

  const trail: MissileTrail = {
    group,
    layers: 3,
    update(inAir, length, diameter, now) {
      group.visible = inAir;
      if (!inAir) return;
      outerCards.visible = trail.layers >= 2;
      haloCards.visible = trail.layers >= 3;
      // The noise slides back along the plume. It is shared by every trail, which is harmless: it only depends on `now`.
      noiseTexture!.offset.x = -now * 1.7;
      noiseTexture!.offset.y = now * 0.4;
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
        const size = diameter * (1.6 + 4.4 * k);
        sprite.scale.set(size, size, 1);
        const spriteMaterial = sprite.material as THREE.SpriteMaterial;
        spriteMaterial.opacity = 0.7 * (1 - k) ** 1.2;
        // The plume lights the smoke near it: warm at the nozzle, fading to grey.
        spriteMaterial.color.setRGB(0.82, 0.82, 0.82).lerp(WARM_SMOKE, Math.max(0, 1 - k / LIT_SMOKE_SHARE) ** 1.5);
      }
    },
    dispose() {
      for (const sprite of puffs) sprite.material.dispose();
    },
  };
  return trail;
}

const WARM_SMOKE = new THREE.Color(1, 0.62, 0.32);
