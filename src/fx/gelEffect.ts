import * as THREE from 'three';
import { isPrimary } from '../sim/session';
import type { CavitySample, ShotEvent, Timeline } from '../sim/types';
import { crinkleNormalMap } from './crinkleTexture';
import type { ParticleSystem } from './particles';

/**
 * The ballistic gelatin showcase: a crinkled, spindle-shaped temporary cavity
 * that balloons after the bullet passes, then collapses and pulses down to the
 * permanent wound channel; the block bulging around it; a splash at the entry
 * face; the exit face drawn out into a cone on a pass-through; and gel debris.
 * Everything is a pure function of sim time, so it scrubs and replays.
 *
 * Visual target: a high-speed camera frame of a gel block at peak cavity
 * (see issue #8).
 */

/** Time for a cavity section to reach its peak: base + per metre of radius, in seconds. */
const RISE_BASE_S = 0.35e-3;
const RISE_PER_M_S = 25e-3;
/** Each collapse–rebound pulse is this many rise times long, and decays at this rate. */
const PULSE_PERIOD = 1.6;
const PULSE_DECAY = 2.4;
/** Block cross-section grows by this fraction of the cavity's excess radius. */
const BULGE_GAIN = 0.45;
/** The cavity starts to push the block out once it passes this fraction of the half-width. */
const BULGE_ONSET = 0.35;
/** Keep the cavity wall at least this far inside the (bulged) block surface, in metres. */
const WALL_MARGIN = 0.006;
/** Exit cone: base radius, peak length cap and how long it holds before springing back, in metres / seconds. */
const CONE_RADIUS = 0.04;
const CONE_MAX = 0.12;
const CONE_SPRING_S = 1.6e-3;
/** Entry splash: crater depth on the front face and how long it lasts. */
const SPLASH_DEPTH = 0.01;
const SPLASH_S = 0.8e-3;

const RING_SEGMENTS = 40;

/** 'gel': crinkled amber cavity in a bulging block. 'water': a silvery air cavity that closes into bubbles. */
export type CavityStyle = 'gel' | 'water';

interface Ring {
  centre: THREE.Vector3;
  t: number;
  peak: number;
  channel: number;
  rise: number;
}

export class GelEffect {
  readonly group = new THREE.Group();
  private rings: Ring[] = [];
  private radii = new Float32Array(0);
  private block: THREE.Mesh | null = null;
  private blockRest: Float32Array | null = null;
  /** Block-local transform: world x of the block centre. */
  private blockCentre = new THREE.Vector3();
  private half = { x: 0, y: 0, z: 0 };
  /** Each shot's entry splash and exit cone, positioned in the block's own frame. */
  private entries: { t: number; y: number; z: number }[] = [];
  private exits: { t: number; speed: number; y: number; z: number }[] = [];
  private readonly material: THREE.MeshPhysicalMaterial;
  private readonly waterMaterial: THREE.MeshPhysicalMaterial;
  private style: CavityStyle = 'gel';
  /** Blood stains spreading along the cavity from burst packs: centre x (world), start time. */
  private stains: { x: number; t: number; reach: number }[] = [];

  constructor(private readonly particles: ParticleSystem) {
    this.group.name = 'gel-effect';
    // An air cavity in water looks silvery: its wall reflects like a mirror (total internal reflection).
    this.waterMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x7d8d98,
      roughness: 0.35,
      metalness: 0.35,
      envMapIntensity: 1,
      clearcoat: 0.2,
      clearcoatRoughness: 0.4,
      side: THREE.DoubleSide,
    });
    const normalMap = crinkleNormalMap();
    normalMap.repeat.set(10, 3);
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0x6e5638,
      roughness: 0.22,
      metalness: 0,
      normalMap,
      normalScale: new THREE.Vector2(1.6, 1.6),
      clearcoat: 0.6,
      clearcoatRoughness: 0.3,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
  }

  /**
   * Sets up the effect for a shot. `block` is the gel mesh (centred at its own
   * origin, thickness along x) and `layer` the gel's index in the target stack.
   */
  load(timeline: Timeline, block: THREE.Mesh, layer: number, style: CavityStyle = 'gel'): void {
    this.clear();
    this.style = style;
    const samples = timeline.cavity.filter((c) => c.layer === layer);
    if (samples.length < 2) return;

    // Only the main projectile's path draws the big cavity (pellets each leave their own small one).
    const byTrack = groupByPath(samples);
    block.updateWorldMatrix(true, false);
    this.blockCentre.setFromMatrixPosition(block.matrixWorld);
    const box = (block.geometry as THREE.BoxGeometry).parameters;
    this.half = { x: box.width / 2, y: box.height / 2, z: box.depth / 2 };
    this.block = block;
    this.blockRest = Float32Array.from(block.geometry.attributes.position.array as Float32Array);

    const allRings: Ring[] = [];
    for (const path of byTrack) {
      // Water closes up completely behind the bullet: no permanent channel, just a trail of bubbles.
      const rings = path.map((c) => toRing(c, style === 'water' ? 0 : undefined));
      // Close the entry end with a zero-radius ring at the face.
      const first = rings[0];
      rings.unshift({ ...first, centre: first.centre.clone().setX(this.blockCentre.x - this.half.x), peak: 0, channel: 0 });
      allRings.push(...rings);
      this.group.add(this.buildCavityMesh(rings));
    }
    this.rings = allRings.sort((a, b) => a.centre.x - b.centre.x);
    this.radii = new Float32Array(this.rings.length);

    const local = (e: ShotEvent) => ({ y: e.pos.y - this.blockCentre.y, z: e.pos.z - this.blockCentre.z });
    for (const e of primaryEvents(timeline, layer, 'entry')) this.entries.push({ t: e.t, ...local(e) });
    for (const e of primaryEvents(timeline, layer, 'exit')) this.exits.push({ t: e.t, speed: e.speed, ...local(e) });
    if (style === 'water') this.addWaterDebris(timeline, layer, samples);
    else this.addDebris(timeline, layer);
  }

  clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }
    if (this.block && this.blockRest) {
      const pos = this.block.geometry.attributes.position;
      (pos.array as Float32Array).set(this.blockRest);
      pos.needsUpdate = true;
      this.block.geometry.computeVertexNormals();
    }
    this.block = null;
    this.blockRest = null;
    this.rings = [];
    this.stains = [];
    this.entries = [];
    this.exits = [];
  }

  update(t: number): void {
    if (!this.rings.length) return;
    this.updateRadii(t);
    if (this.style === 'gel') this.deformBlock(t);
    for (const child of this.group.children) this.updateCavityMesh(child as THREE.Mesh, t);
  }

  /** Frees the materials (the cavity meshes go in `clear`). */
  dispose(): void {
    this.clear();
    this.material.dispose();
    this.waterMaterial.dispose();
  }

  /** Blood from a pack burst at world x spreads along the cavity wall from time t, up to `reach` metres each way. */
  addStain(x: number, t: number, reach: number): void {
    this.stains.push({ x, t, reach });
  }

  /** How blood-stained the cavity is at world x and time t, 0–1. */
  private stainAt(x: number, t: number): number {
    let k = 0;
    for (const s of this.stains) {
      const age = t - s.t;
      if (age <= 0) continue;
      const front = Math.min(s.reach, age * 30);
      const d = Math.abs(x - s.x);
      if (d < front) k = Math.max(k, Math.min(1, age / 0.6e-3) * (1 - (d / s.reach) ** 2));
    }
    return k;
  }

  /** Cavity radius of one section at time t: rises to its peak, then pulses down to the channel. */
  private radiusAt(ring: Ring, t: number): number {
    return cavityRadiusAt(ring.peak, ring.channel, ring.t, t);
  }

  private updateRadii(t: number): void {
    for (let i = 0; i < this.rings.length; i++) this.radii[i] = this.radiusAt(this.rings[i], t);
  }

  /** Current cavity radius at block-local x, from the nearest rings. */
  private radiusAtX(localX: number): number {
    const worldX = localX + this.blockCentre.x;
    const rings = this.rings;
    let best = 0;
    // Rings are sorted by x and ~5 mm apart; a short scan around the estimate is enough.
    let lo = 0;
    let hi = rings.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (rings[mid].centre.x <= worldX) lo = mid;
      else hi = mid;
    }
    for (let i = Math.max(0, lo - 2); i <= Math.min(rings.length - 1, hi + 2); i++) {
      const d = Math.abs(rings[i].centre.x - worldX);
      const weight = Math.max(0, 1 - d / 0.012);
      best = Math.max(best, this.radii[i] * weight);
    }
    return best;
  }

  private bulgeAt(radius: number): number {
    const halfMin = Math.min(this.half.y, this.half.z);
    return BULGE_GAIN * Math.max(0, radius - BULGE_ONSET * halfMin);
  }

  private deformBlock(t: number): void {
    const block = this.block;
    const rest = this.blockRest;
    if (!block || !rest) return;
    const pos = block.geometry.attributes.position;
    const arr = pos.array as Float32Array;
    const halfMin = Math.min(this.half.y, this.half.z);

    const splashes = this.entries
      .map((e) => ({ ...e, depth: t - e.t > 0 && t - e.t < SPLASH_S ? SPLASH_DEPTH * Math.sin((Math.PI * (t - e.t)) / SPLASH_S) : 0 }))
      .filter((e) => e.depth > 0);
    const cones = this.exits.map((e) => ({ ...e, length: coneLength(e.t, e.speed, t) })).filter((e) => e.length > 0);

    for (let i = 0; i < arr.length; i += 3) {
      const x = rest[i];
      const y = rest[i + 1];
      const z = rest[i + 2];
      const bulge = this.bulgeAt(this.radiusAtX(x));
      const s = 1 + bulge / halfMin;
      let nx = x;
      if (x <= -this.half.x + 1e-5) {
        for (const sp of splashes) nx -= sp.depth * Math.max(0, 1 - Math.hypot(y - sp.y, z - sp.z) / (CONE_RADIUS * 0.8)) ** 2;
      } else if (x >= this.half.x - 1e-5) {
        let pull = 0;
        for (const c of cones) pull = Math.max(pull, c.length * Math.max(0, 1 - Math.hypot(y - c.y, z - c.z) / CONE_RADIUS) ** 2.2);
        nx += pull;
      }
      arr[i] = nx;
      arr[i + 1] = y * s;
      arr[i + 2] = z * s;
    }
    pos.needsUpdate = true;
    block.geometry.computeVertexNormals();
  }

  private buildCavityMesh(rings: Ring[]): THREE.Mesh {
    const n = rings.length;
    const positions = new Float32Array(n * RING_SEGMENTS * 3);
    const uvs = new Float32Array(n * RING_SEGMENTS * 2);
    const index: number[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < RING_SEGMENTS; j++) {
        uvs[(i * RING_SEGMENTS + j) * 2] = i / (n - 1);
        uvs[(i * RING_SEGMENTS + j) * 2 + 1] = j / RING_SEGMENTS;
        if (i < n - 1) {
          const a = i * RING_SEGMENTS + j;
          const b = i * RING_SEGMENTS + ((j + 1) % RING_SEGMENTS);
          const c = a + RING_SEGMENTS;
          const d = b + RING_SEGMENTS;
          index.push(a, c, b, b, c, d);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    // Per-vertex tint so blood from burst packs can stain the cavity wall (#19).
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * RING_SEGMENTS * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(index);
    const mesh = new THREE.Mesh(geometry, this.style === 'water' ? this.waterMaterial : this.material);
    mesh.frustumCulled = false;
    mesh.userData.rings = rings;
    // Per-vertex wrinkle offsets so the silhouette crumples, not just the shading.
    const wrinkle = new Float32Array(n * RING_SEGMENTS);
    for (let k = 0; k < wrinkle.length; k++) wrinkle[k] = Math.abs((Math.sin(k * 12.9898) * 43758.5453) % 1);
    mesh.userData.wrinkle = wrinkle;
    return mesh;
  }

  private updateCavityMesh(mesh: THREE.Mesh, t: number): void {
    const rings = mesh.userData.rings as Ring[];
    const wrinkle = mesh.userData.wrinkle as Float32Array;
    const pos = mesh.geometry.attributes.position;
    const arr = pos.array as Float32Array;
    const colours = mesh.geometry.attributes.color;
    const carr = colours.array as Float32Array;
    let visible = false;
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i];
      const stain = this.stains.length ? this.stainAt(ring.centre.x, t) : 0;
      // White leaves the amber material as is; stained sections go a deep wet red.
      const cr = 1 + 0.6 * stain;
      const cg = 1 - 0.85 * stain;
      const cb = 1 - 0.8 * stain;
      for (let j = 0; j < RING_SEGMENTS; j++) {
        const c = (i * RING_SEGMENTS + j) * 3;
        carr[c] = cr;
        carr[c + 1] = cg;
        carr[c + 2] = cb;
      }
      let r = this.radiusAt(ring, t);
      if (r > 0) visible = true;
      // Stay inside the block walls as they bulge.
      const limit = Math.min(this.half.y, this.half.z) + this.bulgeAt(r) - WALL_MARGIN;
      r = Math.min(r, Math.max(0, limit));
      for (let j = 0; j < RING_SEGMENTS; j++) {
        const a = (j / RING_SEGMENTS) * Math.PI * 2;
        const crumple = 1 + 0.07 * (wrinkle[i * RING_SEGMENTS + j] - 0.5) * Math.min(1, r / 0.01);
        const k = (i * RING_SEGMENTS + j) * 3;
        arr[k] = ring.centre.x;
        arr[k + 1] = ring.centre.y + Math.sin(a) * r * crumple;
        arr[k + 2] = ring.centre.z + Math.cos(a) * r * crumple;
      }
    }
    pos.needsUpdate = true;
    colours.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.visible = visible;
  }

  private addWaterDebris(timeline: Timeline, layer: number, samples: CavitySample[]): void {
    const waterColour = 0x8fb4c8;
    for (const impact of primaryEvents(timeline, layer, 'entry')) {
      // Splash: a jet of water squirts back out of the entry hole.
      this.particles.add({
        look: 'droplet',
        t0: impact.t + 60e-6,
        duration: 1.5e-3,
        origin: new THREE.Vector3(impact.pos.x - 0.004, impact.pos.y, impact.pos.z),
        axis: new THREE.Vector3(-1, 0.1, 0),
        spread: 0.35,
        count: 140,
        speed: [3, 12 + impact.speed * 0.02],
        size: [0.0015, 0.004],
        life: [3e-3, 9e-3],
        drag: 80,
        gravity: 9.8,
        color: waterColour,
      });
    }
    // The surface heaves above the cavity and throws up a sheet of spray.
    const surfaceY = this.blockCentre.y + this.half.y;
    let peak = samples[0];
    for (const s of samples) if (s.radius > peak.radius) peak = s;
    const reach = peak.radius - (surfaceY - peak.pos.y) * 0.5;
    if (reach > 0) {
      this.particles.add({
        look: 'droplet',
        t0: peak.t + RISE_BASE_S + RISE_PER_M_S * peak.radius * 0.6,
        duration: 2e-3,
        origin: new THREE.Vector3(peak.pos.x, surfaceY, peak.pos.z),
        originJitter: Math.min(0.08, peak.radius * 1.5),
        axis: new THREE.Vector3(0, 1, 0),
        spread: 0.5,
        count: Math.round(Math.min(400, 3000 * reach)),
        speed: [1, 3 + 120 * reach],
        size: [0.002, 0.006],
        life: [4e-3, 10e-3],
        drag: 20,
        gravity: 9.8,
        color: waterColour,
      });
    }
    // Cavitation bubbles left along the path after the cavity collapses, drifting up slowly.
    for (const s of samples) {
      if (s.radius < 0.002) continue;
      this.particles.add({
        look: 'droplet',
        t0: s.t + 2.2 * (RISE_BASE_S + RISE_PER_M_S * s.radius),
        duration: 1e-3,
        origin: new THREE.Vector3(s.pos.x, s.pos.y, s.pos.z),
        originJitter: Math.min(0.03, s.radius * 0.8),
        axis: new THREE.Vector3(0, 1, 0),
        spread: Math.PI,
        count: Math.round(Math.min(18, 2 + s.radius * 300)),
        speed: [0.05, 0.6],
        size: [0.0008, 0.003],
        life: [20e-3, 40e-3],
        drag: 5,
        gravity: -2,
        color: 0x8fa0aa,
        colorJitter: 0.15,
        seed: Math.round(s.depth * 1e4) + 17,
      });
    }
  }

  private addDebris(timeline: Timeline, layer: number): void {
    const gelColour = 0xe8c48a;
    for (const impact of primaryEvents(timeline, layer, 'entry')) {
      const energy = 0.5 * timeline.tracks[impact.trackId].massKg * impact.speed ** 2;
      const scale = Math.min(1, Math.sqrt(energy / 3000));
      this.particles.add({
        look: 'droplet',
        t0: impact.t + 40e-6,
        duration: 600e-6,
        origin: new THREE.Vector3(impact.pos.x - 0.002, impact.pos.y, impact.pos.z),
        axis: new THREE.Vector3(-1, 0.15, 0),
        spread: 0.9,
        count: Math.round(40 + 160 * scale),
        speed: [3, 10 + 40 * scale],
        size: [0.0012, 0.004],
        life: [3e-3, 8e-3],
        drag: 300,
        gravity: 9.8,
        color: gelColour,
      });
    }
    for (const exit of primaryEvents(timeline, layer, 'exit')) {
      this.particles.add({
        look: 'droplet',
        t0: exit.t + 100e-6,
        duration: 1.2e-3,
        origin: new THREE.Vector3(exit.pos.x + 0.02, exit.pos.y, exit.pos.z),
        originJitter: 0.01,
        axis: new THREE.Vector3(1, 0, 0),
        spread: 0.45,
        count: Math.round(60 + Math.min(200, exit.speed / 2)),
        speed: [5, 15 + exit.speed * 0.25],
        size: [0.001, 0.0035],
        life: [3e-3, 8e-3],
        drag: 250,
        gravity: 9.8,
        color: gelColour,
      });
    }
  }
}

/** Time for a cavity section of this peak radius to reach its peak, in seconds. */
export function cavityRiseTime(peak: number): number {
  return RISE_BASE_S + RISE_PER_M_S * peak;
}

/**
 * Radius of one section of the temporary cavity at time t: it rises to its
 * peak after the bullet passes (at `bornT`), then pulses down to the channel.
 */
export function cavityRadiusAt(peak: number, channel: number, bornT: number, t: number): number {
  const rise = cavityRiseTime(peak);
  const age = t - bornT;
  if (age <= 0) return 0;
  if (age < rise) return Math.max(channel, peak * Math.sin((Math.PI / 2) * (age / rise)));
  const after = (age - rise) / rise;
  const envelope = Math.exp(-after / PULSE_DECAY);
  const wave = 0.5 + 0.5 * Math.cos((Math.PI * 2 * after) / PULSE_PERIOD);
  return channel + (peak - channel) * envelope * wave;
}

/** Exit cone length: shoots out with the bullet, holds, then springs back with a wobble. */
function coneLength(exitT: number, exitSpeed: number, t: number): number {
  const age = t - exitT;
  if (age <= 0) return 0;
  const peak = Math.min(CONE_MAX, 0.00012 * exitSpeed + 0.03);
  const grow = Math.min(1, (age * exitSpeed * 0.5) / peak);
  if (age < CONE_SPRING_S) return peak * grow;
  const after = (age - CONE_SPRING_S) / CONE_SPRING_S;
  return peak * Math.exp(-after * 1.5) * (0.6 + 0.4 * Math.cos(after * Math.PI * 2));
}

/** Each shot's main projectile entering (or leaving) this layer. */
export function primaryEvents(timeline: Timeline, layer: number, which: 'entry' | 'exit'): ShotEvent[] {
  return timeline.events.filter(
    (e) =>
      e.layer === layer &&
      (which === 'exit' ? e.type === 'exit' : e.type === 'impact' || e.type === 'enter') &&
      isPrimary(timeline, e.trackId),
  );
}

function toRing(c: CavitySample, channel?: number): Ring {
  return {
    centre: new THREE.Vector3(c.pos.x, c.pos.y, c.pos.z),
    t: c.t,
    peak: c.radius,
    channel: channel ?? c.channelRadius,
    rise: RISE_BASE_S + RISE_PER_M_S * c.radius,
  };
}

/** Splits cavity samples into one ordered path per projectile (consecutive samples close together). */
function groupByPath(samples: CavitySample[]): CavitySample[][] {
  const paths: CavitySample[][] = [];
  for (const s of samples) {
    const path = paths.find((p) => {
      const last = p[p.length - 1];
      return Math.hypot(last.pos.x - s.pos.x, last.pos.y - s.pos.y, last.pos.z - s.pos.z) < 0.02 && s.t >= last.t;
    });
    if (path) path.push(s);
    else paths.push([s]);
  }
  return paths.filter((p) => p.length >= 2);
}
