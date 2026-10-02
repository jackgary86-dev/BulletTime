import * as THREE from 'three';
import { seededRandom } from '../sim/random';

/**
 * Deterministic, scrubbable particle bursts. Every particle is fully described
 * by its spawn time and initial state, and its position at any time is a closed
 * form (linear drag plus gravity), so playback can jump anywhere in the shot.
 * Each look is one InstancedMesh, so thousands of particles cost a few draw calls.
 */

export type ParticleLook = 'chunk' | 'droplet' | 'blob' | 'dust' | 'spark' | 'splinter' | 'shard' | 'grain' | 'flake';

/** Height of the lab floor; debris that reaches it stops there instead of falling through. */
export const FLOOR_Y = 0;

/** Looks that are solid bits of the target: they tumble on their own axes, land on the floor and stay. */
const SOLID: ReadonlySet<ParticleLook> = new Set(['chunk', 'splinter', 'shard', 'grain', 'flake']);

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
  /** Axis this bit tumbles about. */
  spinAxis: THREE.Vector3;
  /** Orientation at spawn: velocity-aligned for long bits, random otherwise. */
  start: THREE.Quaternion;
  /** Per-axis shape variation, so no two chips are the same. */
  aspect: THREE.Vector3;
  /** Age at which it lands on the floor (Infinity if it never does), and where. */
  landAge: number;
  landPos: THREE.Vector3 | null;
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
    // Faceted, irregular chips with flat-shaded fracture faces.
    chunk: { geometry: rockGeometry(0.5, 1, 0.32, 11), material: lit({ roughness: 0.78, metalness: 0, flatShading: true }), cap: 1500 },
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
    splinter: { geometry: splinterGeometry(), material: lit({ roughness: 0.85, flatShading: true }), cap: 1500 },
    // Paint and paper flakes: thin, ragged and two-sided, flashing as they turn.
    flake: { geometry: flakeGeometry(), material: lit({ roughness: 0.55, side: THREE.DoubleSide }), cap: 1200 },
    shard: {
      geometry: new THREE.TetrahedronGeometry(0.6, 0),
      material: new THREE.MeshPhysicalMaterial({ roughness: 0.02, metalness: 0, transparent: true, opacity: 0.55, clearcoat: 1 }),
      cap: 1500,
    },
    grain: { geometry: rockGeometry(0.5, 0, 0.25, 5), material: lit({ roughness: 0.95, flatShading: true }), cap: 3000 },
  };
}

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpMatrix = new THREE.Matrix4();
const tmpDir = new THREE.Vector3();
const tmpSpin = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);

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
      mesh.castShadow = look === 'chunk' || look === 'splinter' || look === 'grain' || look === 'flake';
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
      const v = dir.multiplyScalar(speed);
      const solid = SOLID.has(spec.look);
      const spinAxis = randomUnit(rand);
      // Long bits leave along their flight path, then tumble; chips start in any orientation.
      const start = (spec.stretch ?? 1) > 1 ? new THREE.Quaternion().setFromUnitVectors(X, dir.clone().normalize()) : new THREE.Quaternion().setFromAxisAngle(randomUnit(rand), rand() * Math.PI * 2);
      const aspect = solid ? new THREE.Vector3(0.7 + 0.6 * rand(), 0.6 + 0.6 * rand(), 0.7 + 0.6 * rand()) : new THREE.Vector3(1, 1, 1);
      const size = lerp(spec.size, rand());
      const q: Particle = {
        t0: spec.t0 + (spec.duration ?? 0) * rand(),
        life: lerp(spec.life, rand()),
        p,
        v,
        size,
        drag: spec.drag * (0.7 + 0.6 * rand()),
        gravity: spec.gravity ?? 0,
        stretch: spec.stretch ?? 1,
        grow: spec.grow ?? 1,
        // Small bits spin faster; a few thousand rad/s for a millimetre chip.
        spin: (rand() < 0.5 ? -1 : 1) * (800 + 2500 * rand()) * Math.min(2, 0.003 / Math.max(size, 0.0005)),
        spinAxis,
        start,
        aspect,
        landAge: Infinity,
        landPos: null,
        color: base.clone().multiplyScalar(shade),
      };
      if (solid) land(q);
      list.push(q);
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
        const landed = age >= q.landAge;
        // Once on the floor, a bit stays where it landed and stops turning.
        const moveAge = landed ? q.landAge : age;
        if (landed) tmpPos.copy(q.landPos!);
        else positionAt(q, age, tmpPos);
        const lifeK = age / q.life;
        let size = q.size * (1 + (q.grow - 1) * lifeK);
        // Dust thins out and vanishes rather than popping off at the end of its life.
        if (look === 'dust' && lifeK > 0.6) size *= (1 - lifeK) / 0.4;
        if (q.stretch > 1 && look !== 'splinter') {
          // Sparks and lead spray streak along their flight path.
          tmpDir.copy(q.v).normalize();
          tmpQuat.setFromUnitVectors(X, tmpDir);
          tmpScale.set(size * q.stretch, size, size);
        } else if (SOLID.has(look)) {
          tmpQuat.copy(q.start).premultiply(tmpSpin.setFromAxisAngle(q.spinAxis, q.spin * moveAge));
          tmpScale.set(size * q.stretch * q.aspect.x, size * q.aspect.y, size * q.aspect.z);
        } else {
          tmpQuat.setFromAxisAngle(q.spinAxis, q.spin * age);
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
const tmpLand = new THREE.Vector3();

/** Closed-form position under linear drag, p + v·(1 − e^(−kτ))/k, plus gravity. */
function positionAt(q: Particle, age: number, out: THREE.Vector3): THREE.Vector3 {
  const k = q.drag;
  const travel = k > 0 ? (1 - Math.exp(-k * age)) / k : age;
  out.copy(q.p).addScaledVector(q.v, travel);
  out.y -= 0.5 * q.gravity * age * age;
  return out;
}

/** Finds when (if ever, within its life) a bit reaches the floor, so it can come to rest there. */
function land(q: Particle): void {
  const rest = FLOOR_Y + q.size * 0.3;
  if (positionAt(q, q.life, tmpLand).y > rest) return;
  // Height is monotonic once falling, and the bits start above the floor, so bisect.
  let lo = 0;
  let hi = q.life;
  if (positionAt(q, 0, tmpLand).y <= rest) hi = 0;
  for (let i = 0; i < 24 && hi > 0; i++) {
    const mid = (lo + hi) / 2;
    if (positionAt(q, mid, tmpLand).y > rest) lo = mid;
    else hi = mid;
  }
  q.landAge = hi;
  q.landPos = positionAt(q, hi, new THREE.Vector3());
  q.landPos.y = rest;
}

function randomUnit(rand: () => number): THREE.Vector3 {
  const z = rand() * 2 - 1;
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), z);
}

/** Moves each vertex by a hash of where it is, so faces that share a corner stay joined. */
function jitterVertices(geometry: THREE.BufferGeometry, amount: (p: THREE.Vector3, rand: () => number) => THREE.Vector3, seed: number): void {
  const pos = geometry.getAttribute('position');
  const moved = new Map<string, THREE.Vector3>();
  const rand = seededRandom(seed);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const key = `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`;
    let to = moved.get(key);
    if (!to) {
      to = amount(p.clone(), rand);
      moved.set(key, to);
    }
    pos.setXYZ(i, to.x, to.y, to.z);
  }
  geometry.computeVertexNormals();
}

/** A lumpy, faceted stone: an icosahedron with each corner pushed in or out. */
function rockGeometry(radius: number, detail: number, roughness: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  jitterVertices(g, (p, rand) => p.multiplyScalar(1 - roughness + 2 * roughness * rand()), seed);
  return g;
}

/** A long sliver of wood: tapered to ragged points at both ends, thicker in the middle. */
function splinterGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 0.28, 0.14, 6, 1, 1);
  jitterVertices(
    g,
    (p, rand) => {
      const along = Math.abs(p.x) * 2;
      // Thick middle narrowing to frayed tips that end off-centre.
      const taper = Math.max(0.08, 1 - along ** 1.6);
      const fray = along > 0.7 ? (rand() - 0.5) * 0.12 : 0;
      return new THREE.Vector3(p.x + (rand() - 0.5) * 0.05, p.y * taper * (0.8 + 0.4 * rand()) + fray, p.z * taper * (0.8 + 0.4 * rand()));
    },
    23,
  );
  return g;
}

/** A thin, ragged-edged flake lying in the xz plane. */
function flakeGeometry(): THREE.BufferGeometry {
  const rand = seededRandom(41);
  const shape = new THREE.Shape();
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 0.5 * (0.55 + 0.45 * rand());
    if (i === 0) shape.moveTo(r * Math.cos(a), r * Math.sin(a));
    else shape.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  // A slight curl, as paint flakes peel.
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setY(i, 0.25 * pos.getX(i) ** 2);
  g.computeVertexNormals();
  return g;
}
const lerp = ([a, b]: [number, number], k: number) => a + (b - a) * k;
