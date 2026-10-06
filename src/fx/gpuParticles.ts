import * as THREE from 'three';
import type { BurstSpec } from './particles';

/**
 * Prototype: particles flown entirely on the GPU. Each particle's spawn state is uploaded once as per-instance
 * attributes; the vertex shader evaluates the same closed-form flight the CPU loop in particles.ts does (linear drag,
 * gravity, a tumble about a fixed axis, rest on the floor), so a frame costs one uniform (the sim time) instead of a
 * matrix per particle. Opt in with `?gpuparticles=N` (N times the usual count and cap).
 *
 * Two kinds: 'solid' bits that tumble and land (chunk, grain) and 'cloud' cards that billow and fade (dust, vapour).
 *
 * Shutter motion blur and velocity-stretched bits (stretch > 1) are done in the shader for solid bits. A solid look
 * whose stretch means something else (splinters stretch along their own length) must not be added without a flag.
 */

/** Largest boost accepted, which keeps the instance buffers of the four looks near 300 MB together. */
const MAX_BOOST = 100;

/** The `?gpuparticles=N` multiplier (`?gpuchunks=N` also works), or 0 when the GPU path is off. */
export function gpuParticleBoost(): number {
  if (typeof window === 'undefined') return 0;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('gpuparticles') ?? params.get('gpuchunks');
  if (raw === null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_BOOST, n) : 1;
}

export type GpuKind = 'solid' | 'cloud';

/** Seven vec4s per particle, see the shader for the layout. */
const ATTRIBUTES = ['aP', 'aV', 'aA', 'aAxis', 'aStart', 'aAspect', 'aLand'] as const;
const NEVER = 1e20;

/** The instance buffers a burst is written into: seven vec4 attributes and an rgb colour per particle. */
export interface SpawnBuffers {
  P: Float32Array;
  V: Float32Array;
  A: Float32Array;
  AX: Float32Array;
  ST: Float32Array;
  AS: Float32Array;
  LA: Float32Array;
  C: Float32Array;
}

export interface SpawnOptions {
  /** Solid bits get a random shape and come to rest on the floor. */
  solid: boolean;
  /** Flying free of the world's gravity and floor (a missile's own frame). */
  freeFlight: boolean;
  floorY: number;
}

const lerp = ([a, b]: [number, number], k: number) => a + (b - a) * k;

/** Distance along the launch velocity after `age` under linear drag, in units of that velocity. */
const travelOf = (drag: number, age: number) => (drag > 0 ? (1 - Math.exp(-drag * age)) / drag : age);
const heightAt = (y0: number, vy: number, drag: number, gravity: number, age: number) => y0 + vy * travelOf(drag, age) - 0.5 * gravity * age * age;

/**
 * Writes `count` particles of a burst into the buffers from index `start`, and returns the latest time any of them
 * dies. This is the CPU path's `ParticleSystem.add` as plain arithmetic: no objects per particle, and the same
 * random numbers in the same order, so a burst is identical either way (gpuSpawn.test.ts holds them together).
 */
export function writeBurst(buf: SpawnBuffers, start: number, spec: BurstSpec, rand: () => number, count: number, opts: SpawnOptions): number {
  const { P, V, A, AX, ST, AS, LA, C } = buf;
  const base = new THREE.Color(spec.color);
  const axis = new THREE.Vector3().copy(spec.axis).normalize();
  const helper = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(axis, helper).normalize();
  const w = new THREE.Vector3().crossVectors(axis, u);
  const cosInner = Math.cos(spec.innerSpread ?? 0);
  const cosOuter = Math.cos(spec.spread);
  const jitter = spec.originJitter ?? 0;
  const colorJitter = spec.colorJitter ?? 0.15;
  const stretch = spec.stretch ?? 1;
  const grow = spec.grow ?? 1;
  const gravity = opts.freeFlight ? 0 : (spec.gravity ?? 0);
  const duration = spec.duration ?? 0;
  const lands = opts.solid && !opts.freeFlight;
  let latest = 0;

  for (let i = 0; i < count; i++) {
    // Uniform direction inside the cone.
    const cosA = cosInner - rand() * (cosInner - cosOuter);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const phi = rand() * Math.PI * 2;
    const dx = axis.x * cosA + u.x * (sinA * Math.cos(phi)) + w.x * (sinA * Math.sin(phi));
    const dy = axis.y * cosA + u.y * (sinA * Math.cos(phi)) + w.y * (sinA * Math.sin(phi));
    const dz = axis.z * cosA + u.z * (sinA * Math.cos(phi)) + w.z * (sinA * Math.sin(phi));
    const speed = lerp(spec.speed, rand());
    const px = spec.origin.x + (rand() - 0.5) * jitter;
    const py = spec.origin.y + (rand() - 0.5) * jitter;
    const pz = spec.origin.z + (rand() - 0.5) * jitter;
    const shade = 1 - colorJitter * rand();
    const vx = dx * speed;
    const vy = dy * speed;
    const vz = dz * speed;

    // The tumble axis.
    let z = rand() * 2 - 1;
    let a = rand() * Math.PI * 2;
    let r = Math.sqrt(1 - z * z);
    const sx = r * Math.cos(a);
    const sy = r * Math.sin(a);
    const sz = z;

    // Long bits leave along their flight path, then tumble; chips start in any orientation.
    let qx: number, qy: number, qz: number, qw: number;
    if (stretch > 1) {
      // Rounded as three.js's normalize() does it (multiply by the reciprocal), so this matches the CPU path bit for bit.
      const inv = 1 / (Math.sqrt(vx * vx + vy * vy + vz * vz) || 1);
      const nx = vx * inv;
      const ny = vy * inv;
      const nz = vz * inv;
      // setFromUnitVectors(+x, n), with three.js's own cut-off for "pointing straight back".
      const rr = nx + 1;
      if (rr < 1e-8) {
        qx = 0; // |from.x| > |from.z|, so three.js takes (-from.y, from.x, 0)
        qy = 1;
        qz = 0;
        qw = 0;
      } else {
        qx = 0;
        qy = -nz;
        qz = ny;
        qw = rr;
      }
      const ql = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
      if (ql === 0) {
        qx = qy = qz = 0;
        qw = 1;
      } else {
        const qi = 1 / ql;
        qx *= qi;
        qy *= qi;
        qz *= qi;
        qw *= qi;
      }
    } else {
      z = rand() * 2 - 1;
      a = rand() * Math.PI * 2;
      r = Math.sqrt(1 - z * z);
      const ax = r * Math.cos(a);
      const ay = r * Math.sin(a);
      const az = z;
      const angle = rand() * Math.PI * 2;
      const sin = Math.sin(angle / 2);
      qx = ax * sin;
      qy = ay * sin;
      qz = az * sin;
      qw = Math.cos(angle / 2);
    }

    let asx = 1;
    let asy = 1;
    let asz = 1;
    if (opts.solid) {
      asx = 0.7 + 0.6 * rand();
      asy = 0.6 + 0.6 * rand();
      asz = 0.7 + 0.6 * rand();
    }
    const size = lerp(spec.size, rand());
    const t0 = spec.t0 + duration * rand();
    const life = lerp(spec.life, rand());
    const drag = spec.drag * (0.7 + 0.6 * rand());
    // Small bits spin faster; a few thousand rad/s for a millimetre chip.
    const spin = (rand() < 0.5 ? -1 : 1) * (800 + 2500 * rand()) * Math.min(2, 0.003 / Math.max(size, 0.0005));

    // When (if ever, within its life) a solid bit reaches the floor, so it can come to rest there.
    let landAge = NEVER;
    let lx = 0;
    let ly = 0;
    let lz = 0;
    if (lands) {
      const rest = opts.floorY + size * 0.3;
      if (heightAt(py, vy, drag, gravity, life) <= rest) {
        // Height is monotonic once falling, and the bits start above the floor, so bisect.
        let hit = 0;
        if (heightAt(py, vy, drag, gravity, 0) > rest) {
          let lo = 0;
          let hi = life;
          for (let k = 0; k < 24; k++) {
            const mid = (lo + hi) / 2;
            if (heightAt(py, vy, drag, gravity, mid) <= rest) hi = mid;
            else lo = mid;
          }
          hit = hi;
        }
        const travel = travelOf(drag, hit);
        landAge = hit;
        lx = px + vx * travel;
        ly = rest;
        lz = pz + vz * travel;
      }
    }

    const o = (start + i) * 4;
    P[o] = px;
    P[o + 1] = py;
    P[o + 2] = pz;
    P[o + 3] = t0;
    V[o] = vx;
    V[o + 1] = vy;
    V[o + 2] = vz;
    V[o + 3] = life;
    A[o] = drag;
    A[o + 1] = gravity;
    A[o + 2] = size;
    A[o + 3] = spin;
    AX[o] = sx;
    AX[o + 1] = sy;
    AX[o + 2] = sz;
    AX[o + 3] = landAge;
    ST[o] = qx;
    ST[o + 1] = qy;
    ST[o + 2] = qz;
    ST[o + 3] = qw;
    AS[o] = asx;
    AS[o + 1] = asy;
    AS[o + 2] = asz;
    AS[o + 3] = stretch;
    LA[o] = lx;
    LA[o + 1] = ly;
    LA[o + 2] = lz;
    LA[o + 3] = grow;
    const c = (start + i) * 3;
    C[c] = base.r * shade;
    C[c + 1] = base.g * shade;
    C[c + 2] = base.b * shade;
    latest = Math.max(latest, t0 + life);
  }
  return latest;
}

const SHADER_COMMON = /* glsl */ `
uniform float uTime;
uniform float uShutter; // exposure of the frame in sim seconds, 0 for none
uniform float uMaxBlur; // longest smear, in multiples of a bit's size
attribute vec4 aP;     // spawn position, spawn time
attribute vec4 aV;      // launch velocity, life
attribute vec4 aA;      // drag, gravity, size, spin rate
attribute vec4 aAxis;   // spin axis, landing age
attribute vec4 aStart;  // starting orientation (quaternion)
attribute vec4 aAspect; // per-axis shape, stretch
attribute vec4 aLand;   // landing position, size growth
mat4 gpuMat;

vec4 qmul(vec4 a, vec4 b) {
  return vec4(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
}

// The shortest turn from +x to the unit vector d (a half turn about y when it points straight back).
vec4 qFromX(vec3 d) {
  return d.x < -0.9999 ? vec4(0.0, 1.0, 0.0, 0.0) : normalize(vec4(0.0, -d.z, d.y, 1.0 + d.x));
}

bool gpuAlive(float age) {
  return age >= 0.0 && age <= aV.w;
}

// Closed-form position under linear drag, p + v (1 - e^(-k t)) / k, plus gravity.
vec3 gpuFlight(float age) {
  float drag = aA.x;
  float travel = drag > 0.0 ? (1.0 - exp(-drag * age)) / drag : age;
  vec3 pos = aP.xyz + aV.xyz * travel;
  pos.y -= 0.5 * aA.y * age * age;
  return pos;
}

// A tumbling solid bit: rests where it landed, and stops turning there.
mat4 gpuSolidMatrix() {
  float age = uTime - aP.w;
  if (!gpuAlive(age)) return mat4(0.0);
  float landAge = aAxis.w;
  bool landed = age >= landAge;
  float moveAge = landed ? landAge : age;
  vec3 pos = landed ? aLand.xyz : gpuFlight(age);
  float size = aA.z * (1.0 + (aLand.w - 1.0) * age / aV.w);
  vec4 q;
  vec3 s;
  vec3 vel = aV.xyz * exp(-aA.x * age);
  vel.y -= aA.y * age;
  float speed = length(vel);
  if (uShutter > 0.0 && !landed && speed * uShutter > size * 0.5) {
    // Motion blur: a fast bit smears along its path over the frame's exposure, and stops tumbling while it does.
    float smear = min(uMaxBlur, 1.0 + speed * uShutter / size);
    q = qFromX(vel / speed);
    s = vec3(size * max(aAspect.w, smear), size, size);
  } else if (aAspect.w > 1.0) {
    // Streaks along the way it was launched, and stays that way once landed.
    q = qFromX(normalize(aV.xyz));
    s = vec3(size * aAspect.w, size, size);
  } else {
    float half_ = 0.5 * aA.w * moveAge;
    q = qmul(vec4(aAxis.xyz * sin(half_), cos(half_)), aStart);
    s = size * aAspect.xyz * vec3(aAspect.w, 1.0, 1.0);
  }
  float xx = q.x * q.x, yy = q.y * q.y, zz = q.z * q.z;
  float xy = q.x * q.y, xz = q.x * q.z, yz = q.y * q.z;
  float wx = q.w * q.x, wy = q.w * q.y, wz = q.w * q.z;
  return mat4(
    vec4((1.0 - 2.0 * (yy + zz)) * s.x, 2.0 * (xy + wz) * s.x, 2.0 * (xz - wy) * s.x, 0.0),
    vec4(2.0 * (xy - wz) * s.y, (1.0 - 2.0 * (xx + zz)) * s.y, 2.0 * (yz + wx) * s.y, 0.0),
    vec4(2.0 * (xz + wy) * s.z, 2.0 * (yz - wx) * s.z, (1.0 - 2.0 * (xx + yy)) * s.z, 0.0),
    vec4(pos, 1.0));
}

// A cloud card: a roll about z and a uniform scale; the dust shader turns it to face the camera.
mat4 gpuCloudMatrix() {
  float age = uTime - aP.w;
  if (!gpuAlive(age)) return mat4(0.0);
  float lifeK = age / aV.w;
  // Billows fast at first and slows as it spreads.
  float size = aA.z * (1.0 + (aLand.w - 1.0) * sqrt(lifeK));
  float roll = aAxis.x * 3.14159265 + aA.w * 0.15 * age;
  float c = cos(roll) * size, s = sin(roll) * size;
  return mat4(vec4(c, s, 0.0, 0.0), vec4(-s, c, 0.0, 0.0), vec4(0.0, 0.0, size, 0.0), vec4(gpuFlight(age), 1.0));
}

// Thickens over the first moments, then thins away rather than popping off.
float gpuFade() {
  float lifeK = (uTime - aP.w) / aV.w;
  return min(1.0, lifeK * 8.0) * pow(max(0.0, 1.0 - lifeK), 1.5);
}
`;

/**
 * Points three's instancing at the matrix computed above instead of the (unused) instanceMatrix buffer. Runs after the
 * material's own onBeforeCompile, so the dust shader's billboard code sees the GPU matrix too.
 */
function patchVertexShader(kind: GpuKind, shader: { vertexShader: string; uniforms: Record<string, THREE.IUniform> }, uniforms: Record<string, THREE.IUniform>): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${SHADER_COMMON}\n#define instanceMatrix gpuMat`)
    .replace('void main() {', `void main() {\n  gpuMat = ${kind === 'cloud' ? 'gpuCloudMatrix' : 'gpuSolidMatrix'}();`);
  if (kind === 'cloud') shader.vertexShader = shader.vertexShader.replace('vFade = instanceFade;', 'vFade = gpuFade();');
}

export interface GpuLookMesh {
  mesh: THREE.InstancedMesh;
  /** Particles spawned so far. */
  readonly count: number;
  /** Sim time the last particle dies. */
  readonly endTime: number;
  /** Writes up to `count` particles of a burst after the existing ones (fewer if the buffers are full). */
  spawn(spec: BurstSpec, rand: () => number, count: number, opts: SpawnOptions): void;
  /** Uploads what `spawn` has written since the last flush; cheap when there is nothing new. */
  flush(): void;
  /** Forgets every particle. */
  clear(): void;
  /** Sets the sim time everything is drawn at, and the exposure (sim seconds) fast solid bits smear over. */
  setTime(t: number, shutterS: number): void;
}

/** `maxBlur` is the longest smear a fast solid bit gets, in multiples of its size. */
export function createGpuMesh(kind: GpuKind, geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, castShadow: boolean, maxBlur: number): GpuLookMesh {
  const uniforms = { uTime: { value: 0 }, uShutter: { value: 0 }, uMaxBlur: { value: maxBlur } };
  const attributes = ATTRIBUTES.map((name) => {
    const attribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
    return attribute;
  });
  const own = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    own(shader, renderer);
    patchVertexShader(kind, shader, uniforms);
  };

  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  if (castShadow) {
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = (shader) => patchVertexShader('solid', shader, uniforms);
    mesh.customDepthMaterial = depth;
  }
  mesh.castShadow = castShadow;
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  const colors = mesh.instanceColor!;

  const [P, V, A, AX, ST, AS, LA] = attributes.map((a) => a.array as Float32Array);
  const buffers: SpawnBuffers = { P, V, A, AX, ST, AS, LA, C: colors.array as Float32Array };
  let count = 0;
  let endTime = 0;
  /** The span of particles written since the last upload. */
  let dirtyFrom = 0;
  let dirtyTo = 0;

  return {
    mesh,
    get count() {
      return count;
    },
    get endTime() {
      return endTime;
    },
    setTime(t, shutterS) {
      uniforms.uTime.value = t;
      uniforms.uShutter.value = shutterS;
    },
    spawn(spec, rand, n, opts) {
      const room = Math.min(n, capacity - count);
      if (room <= 0) return;
      endTime = Math.max(endTime, writeBurst(buffers, count, spec, rand, room, opts));
      if (dirtyTo === dirtyFrom) dirtyFrom = count;
      count += room;
      dirtyTo = count;
    },
    flush() {
      mesh.count = count;
      if (dirtyTo === dirtyFrom) return;
      for (const a of attributes) {
        a.clearUpdateRanges();
        a.addUpdateRange(dirtyFrom * 4, (dirtyTo - dirtyFrom) * 4);
        a.needsUpdate = true;
      }
      colors.clearUpdateRanges();
      colors.addUpdateRange(dirtyFrom * 3, (dirtyTo - dirtyFrom) * 3);
      colors.needsUpdate = true;
      dirtyFrom = dirtyTo = count;
    },
    clear() {
      count = 0;
      endTime = 0;
      dirtyFrom = dirtyTo = 0;
      mesh.count = 0;
    },
  };
}
