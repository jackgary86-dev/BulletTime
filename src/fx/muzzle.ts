import * as THREE from 'three';

/** Muzzle flash fades with this time constant, in seconds of sim time. */
const FLASH_DECAY_S = 120e-6;
/** The flash is hidden entirely after this long. */
const FLASH_END_S = 700e-6;
/** The muzzle blast shockwave expands at about the speed of sound. */
const SOUND_SPEED = 343;
const SHOCK_END_S = 3e-3;

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255, 250, 230, 1)');
  g.addColorStop(0.2, 'rgba(255, 210, 120, 0.9)');
  g.addColorStop(0.5, 'rgba(255, 120, 30, 0.35)');
  g.addColorStop(1, 'rgba(255, 80, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A flame tongue for the forward plume: hot and narrow at the muzzle (left),
 * flaring and cooling toward its ragged tip, brightest at the Mach disc where
 * the jet re-compresses.
 */
function plumeTexture(): THREE.Texture {
  const w = 256;
  const h = 96;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = (y / h - 0.5) * 2;
      // Half-width of the flame at this distance: a cone that bulges after the Mach disc.
      const half = 0.12 + 0.55 * u ** 0.7 + 0.25 * Math.sin(u * Math.PI) * u;
      const edge = Math.max(0, 1 - Math.abs(v) / half);
      // Flicker: streaky tongues along the flame.
      const streak = 0.75 + 0.25 * Math.sin(v * 23 + u * 9) * Math.sin(v * 7 - u * 13);
      const mach = Math.exp(-(((u - 0.32) / 0.06) ** 2)) * 0.8;
      const a = Math.min(1, edge ** 1.5 * (1 - u) ** 1.2 * streak * 1.6 + mach * edge);
      const heat = Math.min(1, (1 - u) * 1.2 + mach);
      const i = (y * w + x) * 4;
      image.data[i] = 255;
      image.data[i + 1] = Math.round(120 + 130 * heat);
      image.data[i + 2] = Math.round(30 + 200 * heat ** 3);
      image.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Side petals: the star of flame that bursts out round the muzzle as the gas escapes past the bullet. */
function petalTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.translate(64, 64);
  ctx.globalCompositeOperation = 'lighter';
  const petals = 5;
  for (let i = 0; i < petals; i++) {
    ctx.save();
    ctx.rotate((i / petals) * Math.PI * 2 + (i % 2) * 0.3);
    const len = 44 + (i * 37) % 18;
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, 'rgba(255, 240, 200, 0.9)');
    g.addColorStop(0.5, 'rgba(255, 150, 50, 0.45)');
    g.addColorStop(1, 'rgba(255, 90, 10, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.quadraticCurveTo(len * 0.5, -9, len, 0);
    ctx.quadraticCurveTo(len * 0.5, 9, 0, 5);
    ctx.fill();
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The shot's start: a shaped muzzle flash (a white-hot core, a flame tongue
 * with its bright Mach disc, a star of side petals, and a burst of light that
 * briefly lights the lab) and the muzzle blast shockwave, an expanding shell
 * of compressed air drawn by the post-processing as a refraction (#65).
 * Driven by sim time, so it scrubs and replays with everything else.
 */
export class MuzzleEffect {
  readonly group = new THREE.Group();
  /** The blast shell this frame: centre (world), radius in metres and strength 0–1; strength 0 when gone. */
  readonly shock = { center: new THREE.Vector3(), radius: 0, strength: 0 };
  private readonly light = new THREE.PointLight(0xffb060, 0, 1.5, 2);
  private readonly glow: THREE.Sprite;
  private readonly plume: THREE.Sprite;
  private readonly petals: THREE.Sprite;

  constructor() {
    this.group.name = 'muzzle';
    const sprite = (map: THREE.Texture) =>
      new THREE.Sprite(new THREE.SpriteMaterial({ map, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.glow = sprite(glowTexture());
    this.plume = sprite(plumeTexture());
    this.petals = sprite(petalTexture());
    // Plume starts at the muzzle and reaches forward along the shot line.
    this.plume.center.set(0, 0.5);
    this.group.add(this.light, this.glow, this.plume, this.petals);
    this.group.visible = false;
  }

  /** Places the muzzle; the shot travels along +x from here. */
  setPosition(position: THREE.Vector3): void {
    this.group.position.copy(position);
  }

  update(t: number | null, camera: THREE.Camera): void {
    if (t === null || t > SHOCK_END_S) {
      this.group.visible = false;
      this.light.intensity = 0;
      this.shock.strength = 0;
      return;
    }
    this.group.visible = true;

    const flashOn = t < FLASH_END_S;
    const k = flashOn ? Math.exp(-t / FLASH_DECAY_S) : 0;
    this.light.intensity = 3 * k;
    this.glow.visible = this.plume.visible = this.petals.visible = flashOn;
    this.glow.scale.setScalar(0.03 + 0.05 * (1 - k));
    this.glow.material.opacity = k;
    // The flame tongue grows out of the muzzle, then dies back.
    this.plume.scale.set(0.06 + 0.22 * (1 - k), 0.03 + 0.04 * (1 - k), 1);
    this.plume.material.opacity = 0.9 * k;
    // The tongue is a sprite, so it faces the camera; turn it in screen space to lie along the shot line.
    this.plume.material.rotation = screenAngleOfX(this.group.position, camera);
    // The petals flash out first and fade fastest.
    const petalK = Math.exp(-t / (FLASH_DECAY_S * 0.6));
    this.petals.scale.setScalar(0.04 + 0.05 * (1 - petalK));
    this.petals.material.opacity = petalK;

    // The blast shell: strongest close to the muzzle, weakening as it spreads and with time.
    this.shock.center.copy(this.group.position);
    this.shock.radius = Math.max(1e-4, SOUND_SPEED * t);
    this.shock.strength = (1 - t / SHOCK_END_S) ** 2 / (1 + this.shock.radius / 0.3);
  }
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/** Angle on screen of the world +x direction at `p`, for turning sprites to follow the shot line. */
function screenAngleOfX(p: THREE.Vector3, camera: THREE.Camera): number {
  const a = tmpA.copy(p).project(camera);
  const b = tmpB.copy(p).setX(p.x + 0.1).project(camera);
  const aspect = (camera as THREE.PerspectiveCamera).aspect ?? 1;
  return Math.atan2(b.y - a.y, (b.x - a.x) * aspect);
}
