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
 * The shot's start: a brief muzzle flash (a hot glow, a forward flame plume and
 * a burst of light that briefly lights the lab) and the muzzle blast
 * shockwave ring expanding at the speed of sound. Driven by sim time, so it
 * scrubs and replays with everything else.
 */
export class MuzzleEffect {
  readonly group = new THREE.Group();
  private readonly light = new THREE.PointLight(0xffb060, 0, 1.5, 2);
  private readonly glow: THREE.Sprite;
  private readonly plume: THREE.Sprite;
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;

  constructor() {
    this.group.name = 'muzzle';
    const map = glowTexture();
    const spriteMaterial = () =>
      new THREE.SpriteMaterial({ map, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.glow = new THREE.Sprite(spriteMaterial());
    this.plume = new THREE.Sprite(spriteMaterial());
    // Plume sits ahead of the muzzle, stretched along the shot line.
    this.plume.center.set(0.1, 0.5);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.96, 1, 96),
      new THREE.MeshBasicMaterial({
        color: 0xcfe3ff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.group.add(this.light, this.glow, this.plume, this.ring);
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
      return;
    }
    this.group.visible = true;

    const flashOn = t < FLASH_END_S;
    const k = flashOn ? Math.exp(-t / FLASH_DECAY_S) : 0;
    this.light.intensity = 3 * k;
    this.glow.visible = this.plume.visible = flashOn;
    this.glow.scale.setScalar(0.05 + 0.12 * (1 - k));
    this.glow.material.opacity = k;
    this.plume.scale.set(0.12 + 0.25 * (1 - k), 0.05 + 0.03 * (1 - k), 1);
    this.plume.material.opacity = 0.8 * k;

    // The shockwave ring always faces the camera, like a high-speed schlieren image.
    const radius = Math.max(1e-4, SOUND_SPEED * t);
    this.ring.scale.setScalar(radius);
    this.ring.quaternion.copy(camera.quaternion);
    this.ring.material.opacity = 0.35 * (1 - t / SHOCK_END_S);
  }
}
