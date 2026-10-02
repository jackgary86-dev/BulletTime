import * as THREE from 'three';
import { seededRandom } from '../sim/random';

/**
 * Deterministic, scrubbable particle bursts. Every particle is fully described
 * by its spawn time and initial state, and its position at any time is a closed
 * form (linear drag plus gravity), so playback can jump anywhere in the shot.
 * Each look is one InstancedMesh, so thousands of particles cost a few draw calls.
 */

export type ParticleLook = 'chunk' | 'droplet' | 'blob' | 'dust' | 'spark' | 'splinter' | 'shard' | 'grain';

export interface BurstSpec {
  look: ParticleLook;
  /** Sim time the burst starts, in seconds. */
  t0: number;
  /** Spread of start times after t0, in seconds (for sprays that keep coming). */
  duration?: number;
  origin: THREE.Vector3;
  /** Spread of start positions around the origin, in metres. */
  originJitter?: number;
  /** Cone axis (unit) and half-angle in radians. */
  axis: THREE.Vector3;
  spread: number;
  count: number;
  speed: [number, number];
  size: [number, number];
  /** Lifetime range in seconds. */
  life: [number, number];
  /** Linear drag rate in 1/s (higher stops sooner). */
  drag: number;
  /** Downward acceleration in m/s². Real gravity is invisible at these timescales; dust uses a little. */
  gravity?: number;
  color: THREE.ColorRepresentation;
  /** Random brightness variation, 0–1. */
  colorJitter?: number;
  /** Stretch along the velocity (splinters, sparks), ≥ 1. */
  stretch?: number;
  /** Size growth over life, e.g. 3 for a dust puff that billows out. */
  grow?: number;
  seed?: number;
}

interface Particle {
  t0: number;
  life: number;
  p: THREE.Vector3;
  v: THREE.Vector3;
  size: number;
  drag: number;
  gravity: number;
  stretch: number;
  grow: number;
  spin: number;
  color: THREE.Color;
}

interface LookConfig {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  cap: number;
}

function lookConfigs(): Record<ParticleLook, LookConfig> {
  const lit = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  return {
    chunk: { geometry: new THREE.DodecahedronGeometry(0.5, 0), material: lit({ roughness: 0.4, metalness: 0 }), cap: 1500 },
    droplet: {
      geometry: new THREE.SphereGeometry(0.5, 8, 6),
      material: new THREE.MeshPhysicalMaterial({ roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.8 }),
      cap: 2500,
    },
    // Opaque wet blobs: these still show inside transmissive gel, where transparent droplets would vanish.
    blob: {
      geometry: new THREE.SphereGeometry(0.5, 10, 8),
      material: new THREE.MeshPhysicalMaterial({ roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1 }),
      cap: 2500,
    },
    dust: {
      geometry: new THREE.IcosahedronGeometry(0.5, 1),
      material: lit({ roughness: 1, transparent: true, opacity: 0.2, depthWrite: false }),
      cap: 2500,
    },
    spark: {
      geometry: new THREE.BoxGeometry(1, 0.15, 0.15),
      material: new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
      cap: 1200,
    },
    splinter: { geometry: new THREE.BoxGeometry(1, 0.18, 0.12), material: lit({ roughness: 0.8 }), cap: 1500 },
    shard: {
      geometry: new THREE.TetrahedronGeometry(0.6, 0),
      material: new THREE.MeshPhysicalMaterial({ roughness: 0.02, metalness: 0, transparent: true, opacity: 0.55, clearcoat: 1 }),
      cap: 1500,
    },
    grain: { geometry: new THREE.IcosahedronGeometry(0.5, 0), material: lit({ roughness: 0.95 }), cap: 3000 },
  };
}

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpMatrix = new THREE.Matrix4();
const tmpDir = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const spinAxis = new THREE.Vector3(0.3, 1, 0.2).normalize();

export class ParticleSystem {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<ParticleLook, THREE.InstancedMesh>();
  private readonly particles = new Map<ParticleLook, Particle[]>();
  /** Multiplies every burst's particle count (the quality setting, #16). */
  density = 1;
  /** Fraction of each look's instance capacity that bursts may fill (the quality setting, #16). */
  capScale = 1;
  /** The time the instances were last laid out for, so a paused frame costs nothing. */
  private shownT = NaN;

  constructor() {
    this.group.name = 'particles';
    for (const [look, config] of Object.entries(lookConfigs()) as [ParticleLook, LookConfig][]) {
      const mesh = new THREE.InstancedMesh(config.geometry, config.material, config.cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = look === 'chunk' || look === 'splinter' || look === 'grain';
      // Instance colours need an initialised buffer before the first draw.
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.meshes.set(look, mesh);
      this.particles.set(look, []);
      this.group.add(mesh);
    }
  }

  /** Sim time when the last particle dies. */
  get endTime(): number {
    let end = 0;
    for (const list of this.particles.values()) for (const q of list) end = Math.max(end, q.t0 + q.life);
    return end;
  }

  clear(): void {
    for (const list of this.particles.values()) list.length = 0;
    for (const mesh of this.meshes.values()) mesh.count = 0;
    this.shownT = NaN;
  }

  add(spec: BurstSpec): void {
    const list = this.particles.get(spec.look)!;
    const cap = Math.floor(this.meshes.get(spec.look)!.instanceMatrix.count * this.capScale);
    const rand = seededRandom(spec.seed ?? Math.floor(spec.t0 * 1e7) + list.length * 7919);
    const count = Math.max(0, Math.min(Math.round(spec.count * this.density), cap - list.length));
    this.shownT = NaN;
    const base = new THREE.Color(spec.color);
    const axis = spec.axis.clone().normalize();
    const helper = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(axis, helper).normalize();
    const w = new THREE.Vector3().crossVectors(axis, u);
    for (let i = 0; i < count; i++) {
      // Uniform direction inside the cone.
      const cosA = 1 - rand() * (1 - Math.cos(spec.spread));
      const sinA = Math.sqrt(1 - cosA * cosA);
      const phi = rand() * Math.PI * 2;
      const dir = axis
        .clone()
        .multiplyScalar(cosA)
        .addScaledVector(u, sinA * Math.cos(phi))
        .addScaledVector(w, sinA * Math.sin(phi));
      const speed = lerp(spec.speed, rand());
      const jitter = spec.originJitter ?? 0;
      const p = spec.origin.clone().add(new THREE.Vector3((rand() - 0.5) * jitter, (rand() - 0.5) * jitter, (rand() - 0.5) * jitter));
      const shade = 1 - (spec.colorJitter ?? 0.15) * rand();
      list.push({
        t0: spec.t0 + (spec.duration ?? 0) * rand(),
        life: lerp(spec.life, rand()),
        p,
        v: dir.multiplyScalar(speed),
        size: lerp(spec.size, rand()),
        drag: spec.drag * (0.7 + 0.6 * rand()),
        gravity: spec.gravity ?? 0,
        stretch: spec.stretch ?? 1,
        grow: spec.grow ?? 1,
        spin: (rand() - 0.5) * 3000,
        color: base.clone().multiplyScalar(shade),
      });
    }
  }

  update(t: number): void {
    if (t === this.shownT) return;
    this.shownT = t;
    for (const [look, list] of this.particles) {
      const mesh = this.meshes.get(look)!;
      let n = 0;
      for (const q of list) {
        const age = t - q.t0;
        if (age < 0 || age > q.life) continue;
        // Closed-form position under linear drag: p + v·(1 − e^(−kτ))/k, plus gravity.
        const k = q.drag;
        const travel = k > 0 ? (1 - Math.exp(-k * age)) / k : age;
        tmpPos.copy(q.p).addScaledVector(q.v, travel);
        tmpPos.y -= 0.5 * q.gravity * age * age;
        const lifeK = age / q.life;
        let size = q.size * (1 + (q.grow - 1) * lifeK);
        // Dust thins out and vanishes rather than popping off at the end of its life.
        if (look === 'dust' && lifeK > 0.6) size *= (1 - lifeK) / 0.4;
        if (q.stretch > 1) {
          tmpDir.copy(q.v).normalize();
          tmpQuat.setFromUnitVectors(X, tmpDir);
          tmpScale.set(size * q.stretch, size, size);
        } else {
          tmpQuat.setFromAxisAngle(spinAxis, q.spin * age);
          tmpScale.setScalar(size);
        }
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        mesh.setMatrixAt(n, tmpMatrix);
        mesh.setColorAt(n, look === 'spark' ? tmpColor.copy(q.color).multiplyScalar(1 - lifeK * 0.8) : q.color);
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

const tmpColor = new THREE.Color();
const lerp = ([a, b]: [number, number], k: number) => a + (b - a) * k;
