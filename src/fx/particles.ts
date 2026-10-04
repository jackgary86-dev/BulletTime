import * as THREE from 'three';
import { seededRandom } from '../sim/random';

/**
 * Deterministic, scrubbable particle bursts. Every particle is fully described
 * by its spawn time and initial state, and its position at any time is a closed
 * form (linear drag plus gravity), so playback can jump anywhere in the shot.
 * Each look is one InstancedMesh, so thousands of particles cost a few draw calls.
 */

export type ParticleLook = 'chunk' | 'droplet' | 'blob' | 'dust' | 'spark' | 'splinter' | 'shard' | 'grain' | 'flake' | 'vapour' | 'chain';

/** Looks drawn as soft, camera-facing cloud cards. */
const CLOUD: ReadonlySet<ParticleLook> = new Set(['dust', 'vapour']);

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
  /** Leaves the middle of the cone empty out to this half-angle, for hollow crowns of spray. */
  innerSpread?: number;
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
  /** Sparks skip off the floor rather than stopping: velocity just after the bounce. */
  bounceV: THREE.Vector3 | null;
  /** Which way the surface it landed on faces: the floor (y) or the board (z). */
  landNormal: 'y' | 'z';
  /** Liquid that can spatter on the board as well as the floor. */
  wall: boolean;
  color: THREE.Color;
}

interface Flash {
  t: number;
  pos: THREE.Vector3;
  intensity: number;
  decay: number;
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
      material: new THREE.MeshPhysicalMaterial({ roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.4, sheenColor: new THREE.Color(0xffd0d0) }),
      cap: 2500,
    },
    // Soft, lit puffs: camera-facing cards with a billowy alpha, fading out as they spread.
    dust: { geometry: dustGeometry(2500 * MAX_CAP_SCALE), material: dustMaterial(0.85), cap: 2500 },
    // The faint heat-shimmer and vapour trail a bullet leaves in the air (#72).
    vapour: { geometry: dustGeometry(1500 * MAX_CAP_SCALE), material: dustMaterial(0.09), cap: 1500 },
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
    // A grain carrying load in a force chain: drawn glowing and on top, as an X-ray view through the opaque target.
    chain: {
      geometry: new THREE.SphereGeometry(0.5, 10, 8),
      material: new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }),
      cap: 800,
    },
  };
}

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpMatrix = new THREE.Matrix4();
const tmpDir = new THREE.Vector3();
const tmpSpin = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);

/** Instance buffers are allocated this many times each look's cap, so Ultra can raise the caps (#38). */
export const MAX_CAP_SCALE = 2;

export class ParticleSystem {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<ParticleLook, THREE.InstancedMesh>();
  private readonly particles = new Map<ParticleLook, Particle[]>();
  /** Multiplies every burst's particle count (the quality setting, #16). */
  density = 1;
  /** Multiplies each look's particle cap, up to MAX_CAP_SCALE (the quality setting, #16; Ultra goes above 1, #38). */
  capScale = 1;
  /** The time the instances were last laid out for, so a paused frame costs nothing. */
  private shownT = NaN;
  private shownShutter = 0;
  /** Brief flashes of light from hot impacts (steel sparks); one light shows the brightest. */
  private flashes: Flash[] = [];
  /** Always in the scene (dark when idle), so lighting a flash never recompiles the materials. */
  readonly flashLight = new THREE.PointLight(0xffb060, 0, 0.8, 2);

  constructor() {
    this.group.name = 'particles';
    this.flashLight.name = 'impact-flash';
    this.group.add(this.flashLight);
    for (const [look, config] of Object.entries(lookConfigs()) as [ParticleLook, LookConfig][]) {
      const mesh = new THREE.InstancedMesh(config.geometry, config.material, config.cap * MAX_CAP_SCALE);
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

  /** A flash of light at `pos`, peaking at `intensity` (candela) and dying away over about `decay` seconds. */
  addFlash(t: number, pos: THREE.Vector3, intensity: number, decay: number, color: THREE.ColorRepresentation = 0xffb060): void {
    this.flashes.push({ t, pos: pos.clone(), intensity, decay, color: new THREE.Color(color) });
    this.shownT = NaN;
  }

  clear(): void {
    this.flashes = [];
    this.flashLight.intensity = 0;
    for (const list of this.particles.values()) list.length = 0;
    for (const mesh of this.meshes.values()) mesh.count = 0;
    this.shownT = NaN;
  }

  add(spec: BurstSpec): void {
    const list = this.particles.get(spec.look)!;
    const cap = Math.floor((this.meshes.get(spec.look)!.instanceMatrix.count / MAX_CAP_SCALE) * this.capScale);
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
      const cosInner = Math.cos(spec.innerSpread ?? 0);
      const cosA = cosInner - rand() * (cosInner - Math.cos(spec.spread));
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
      const aspect = solid || spec.look === 'droplet' ? new THREE.Vector3(0.7 + 0.6 * rand(), 0.6 + 0.6 * rand(), 0.7 + 0.6 * rand()) : new THREE.Vector3(1, 1, 1);
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
        bounceV: null,
        landNormal: 'y',
        wall: spec.look === 'droplet',
        color: base.clone().multiplyScalar(shade),
      };
      if (solid || spec.look === 'spark' || spec.look === 'droplet') land(q);
      // A drop that lands leaves its splat for the rest of the shot.
      if (spec.look === 'droplet' && q.landPos) q.life = Math.max(q.life, q.landAge + SPLAT_LIFE_S);
      if (spec.look === 'spark' && q.landPos) {
        // Skip off the floor, losing most of the vertical speed and some of the rest.
        const decay = Math.exp(-q.drag * q.landAge);
        q.bounceV = new THREE.Vector3(q.v.x * decay * 0.7, -(q.v.y * decay - q.gravity * q.landAge) * 0.35, q.v.z * decay * 0.7);
      }
      list.push(q);
    }
  }

  /** Lays the particles out for sim time `t`; moving bits smear over a `shutterS` exposure (#74). */
  update(t: number, shutterS = 0): void {
    if (t === this.shownT && shutterS === this.shownShutter) return;
    this.shownT = t;
    this.shownShutter = shutterS;
    let best = 0;
    for (const f of this.flashes) {
      const age = t - f.t;
      if (age < 0 || age > f.decay * 6) continue;
      const level = f.intensity * Math.exp(-age / f.decay);
      if (level <= best) continue;
      best = level;
      this.flashLight.position.copy(f.pos);
      this.flashLight.color.copy(f.color);
    }
    this.flashLight.intensity = best;
    for (const [look, list] of this.particles) {
      const mesh = this.meshes.get(look)!;
      const fade = CLOUD.has(look) ? (mesh.geometry.getAttribute('instanceFade') as THREE.InstancedBufferAttribute) : null;
      let n = 0;
      for (const q of list) {
        const age = t - q.t0;
        if (age < 0 || age > q.life) continue;
        // Closed-form position under linear drag: p + v·(1 − e^(−kτ))/k, plus gravity.
        const landed = age >= q.landAge;
        // Once on the floor, a bit stays where it landed and stops turning; a spark skips on.
        const moveAge = landed ? q.landAge : age;
        if (landed && q.bounceV) {
          const after = age - q.landAge;
          const travel = (1 - Math.exp(-q.drag * after)) / q.drag;
          tmpPos.copy(q.landPos!).addScaledVector(q.bounceV, travel);
          tmpPos.y = Math.max(q.landPos!.y, tmpPos.y - 0.5 * q.gravity * after * after);
        } else if (landed) tmpPos.copy(q.landPos!);
        else positionAt(q, age, tmpPos);
        const lifeK = age / q.life;
        // Clouds billow fast at first and slow as they spread.
        const size = q.size * (1 + (q.grow - 1) * (CLOUD.has(look) ? Math.sqrt(lifeK) : lifeK));
        if (CLOUD.has(look)) {
          // Thickens over the first moments, then thins away rather than popping off.
          fade!.setX(n, Math.min(1, lifeK * 8) * (1 - lifeK) ** 1.5);
          // Each card keeps a roll in its matrix; the shader turns it to face the camera.
          tmpQuat.setFromAxisAngle(Z, q.spinAxis.x * Math.PI + q.spin * 0.15 * age);
          tmpMatrix.compose(tmpPos, tmpQuat, tmpScale.setScalar(size));
          mesh.setMatrixAt(n, tmpMatrix);
          mesh.setColorAt(n, q.color);
          n++;
          continue;
        }
        if (look === 'droplet' && landed) {
          // A splat: flattened against the surface it hit, spread wide, with a random outline turn.
          const spread = size * SPLAT_SPREAD * q.aspect.x;
          if (q.landNormal === 'y') {
            tmpQuat.setFromAxisAngle(Y, q.spin);
            tmpScale.set(spread * q.stretch, size * 0.12, spread);
          } else {
            tmpQuat.setFromAxisAngle(Z, q.spin);
            tmpScale.set(spread * q.stretch, spread, size * 0.12);
          }
        } else if (look === 'spark') {
          // A streak as long as the spark travels in a short exposure, so fast sparks are long and slowing ones shrink to dots.
          const v = landed && q.bounceV ? tmpDir.copy(q.bounceV).multiplyScalar(Math.exp(-q.drag * (age - q.landAge))) : velocityAt(q, age, tmpDir);
          const exposure = Math.max(SPARK_EXPOSURE_S, shutterS);
          const streak = Math.min(Math.max(q.stretch * 1.5, MAX_BLUR), Math.max(1, (v.length() * exposure) / size));
          tmpQuat.setFromUnitVectors(X, v.normalize());
          tmpScale.set(size * streak, size, size);
        } else if (shutterS > 0 && !landed && !CLOUD.has(look) && velocityAt(q, age, tmpDir).length() * shutterS > size * 0.5) {
          // Motion blur: a fast bit smears along its path over the frame's exposure.
          const smear = Math.min(MAX_BLUR, 1 + (tmpDir.length() * shutterS) / size);
          tmpQuat.setFromUnitVectors(X, tmpDir.normalize());
          tmpScale.set(size * Math.max(q.stretch, smear), size, size);
        } else if (q.stretch > 1 && look !== 'splinter') {
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
        mesh.setColorAt(n, look === 'spark' ? sparkColor(q, lifeK) : look === 'chain' ? tmpColor.copy(q.color).multiplyScalar(Math.min(1, lifeK * 12) * (1 - lifeK) ** 1.2) : q.color);
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (fade) fade.needsUpdate = true;
    }
  }
}

const tmpColor = new THREE.Color();
const tmpLand = new THREE.Vector3();
/** The measurement board behind the target (see studio.ts): liquid spatters on it. */
const BOARD = { z: -0.35, x: 0, halfWidth: 0.6, top: 0.5 };
/** A landed drop spreads into a thin splat this many times its size. */
const SPLAT_SPREAD = 2.2;
/** Landed drops stay this long, so spatter is still there at the end of the shot. */
const SPLAT_LIFE_S = 1;
/** The streak a spark draws is its travel over this long, as a camera shutter would smear it. */
const SPARK_EXPOSURE_S = 80e-6;
/** Longest motion-blur smear, in multiples of a particle's size. */
const MAX_BLUR = 14;
/** Glowing steel cooling: white-hot, yellow, orange, dull red, then nearly dark. */
const SPARK_RAMP = [
  { k: 0, c: new THREE.Color(3, 2.7, 2.2) },
  { k: 0.15, c: new THREE.Color(2.4, 1.6, 0.6) },
  { k: 0.4, c: new THREE.Color(1.6, 0.55, 0.1) },
  { k: 0.75, c: new THREE.Color(0.6, 0.1, 0.02) },
  { k: 1, c: new THREE.Color(0.12, 0.02, 0) },
];

function sparkColor(q: Particle, lifeK: number): THREE.Color {
  // Each spark cools at its own rate: small, fast ones go dark first.
  const k = Math.min(1, lifeK * (0.8 + 0.4 * Math.abs(q.spinAxis.y)));
  let i = 1;
  while (i < SPARK_RAMP.length - 1 && SPARK_RAMP[i].k < k) i++;
  const a = SPARK_RAMP[i - 1];
  const b = SPARK_RAMP[i];
  tmpColor.copy(a.c).lerp(b.c, (k - a.k) / (b.k - a.k));
  // Keep the burst's own tint and brightness jitter (relative to the default spark orange).
  return tmpColor.multiplyScalar(0.6 + 0.4 * q.color.r);
}

function velocityAt(q: Particle, age: number, out: THREE.Vector3): THREE.Vector3 {
  out.copy(q.v).multiplyScalar(Math.exp(-q.drag * age));
  out.y -= q.gravity * age;
  return out;
}

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
  if (positionAt(q, q.life, tmpLand).y <= rest) {
    // Height is monotonic once falling, and the bits start above the floor, so bisect.
    const hit = positionAt(q, 0, tmpLand).y <= rest ? 0 : firstAge(q, (p) => p.y <= rest);
    q.landAge = hit;
    q.landPos = positionAt(q, hit, new THREE.Vector3());
    q.landPos.y = rest;
    q.landNormal = 'y';
  }
  // Liquid can also reach the grid board behind the target and spatter on it.
  if (q.wall) {
    const face = BOARD.z + q.size * 0.3;
    const end = positionAt(q, Math.min(q.life, q.landAge), tmpLand);
    if (end.z <= face && Math.abs(end.x - BOARD.x) < BOARD.halfWidth && end.y < BOARD.top && positionAt(q, 0, tmpLand).z > face) {
      const hit = firstAge(q, (p) => p.z <= face);
      q.landAge = hit;
      q.landPos = positionAt(q, hit, new THREE.Vector3());
      q.landPos.z = face;
      q.landNormal = 'z';
    }
  }
}

/** Earliest age within the particle's life at which `reached` holds, assuming it stays true after. */
function firstAge(q: Particle, reached: (p: THREE.Vector3) => boolean): number {
  let lo = 0;
  let hi = Math.min(q.life, q.landAge);
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (reached(positionAt(q, mid, tmpLand))) hi = mid;
    else lo = mid;
  }
  return hi;
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

function dustGeometry(cap: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1);
  g.setAttribute('instanceFade', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
  return g;
}

/**
 * Lit cloud cards. The vertex shader drops each card's rotation and lays it
 * flat to the camera (keeping only its roll), and bends the normal outward
 * from the centre so the puff is shaded like a ball of smoke, lit on the side
 * facing the lights.
 */
function dustMaterial(opacity: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    roughness: 1,
    transparent: true,
    opacity,
    depthWrite: false,
    alphaMap: puffTexture(),
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float instanceFade;
varying float vFade;`,
      )
      .replace(
        '#include <defaultnormal_vertex>',
        `float bbScale = length(instanceMatrix[0].xyz);
float bbRoll = atan(instanceMatrix[0].y, instanceMatrix[0].x);
vec2 bbLocal = mat2(cos(bbRoll), sin(bbRoll), -sin(bbRoll), cos(bbRoll)) * position.xy;
vec3 transformedNormal = normalize(vec3(bbLocal * 1.6, 0.5));`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
mvPosition.xy += bbLocal * bbScale;
gl_Position = projectionMatrix * mvPosition;
vFade = instanceFade;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vFade;`,
      )
      .replace(
        '#include <alphamap_fragment>',
        `#include <alphamap_fragment>
diffuseColor.a *= vFade;`,
      );
  };
  return material;
}

/** A soft, lumpy puff: layered value noise under a round falloff, as an alpha map. */
function puffTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  const rand = seededRandom(77);
  const grid = 8;
  const lattice = Array.from({ length: (grid + 1) ** 2 }, () => rand());
  const noise = (x: number, y: number) => {
    const ix = Math.floor(x) % grid;
    const iy = Math.floor(y) % grid;
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const at = (i: number, j: number) => lattice[((iy + j) % grid) * (grid + 1) + ((ix + i) % grid)];
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    return (at(0, 0) * (1 - sx) + at(1, 0) * sx) * (1 - sy) + (at(0, 1) * (1 - sx) + at(1, 1) * sx) * sy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const r = Math.hypot(u - 0.5, v - 0.5) * 2;
      let n = 0;
      let amp = 0.5;
      for (let o = 1; o <= 8; o *= 2) {
        n += amp * noise(u * grid * o * 0.5, v * grid * o * 0.5);
        amp /= 2;
      }
      // Lumpy edge: the noise eats into the falloff, so the outline is billowy, not a disc.
      const a = Math.max(0, Math.min(1, (1 - r) * 1.6 - (1 - n) * 0.9)) ** 1.3;
      const i = (y * size + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = Math.round(a * 255);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}
