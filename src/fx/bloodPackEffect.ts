import * as THREE from 'three';
import { PACK_BURST_MIN_CAVITY_M, PACK_BURST_SQUEEZE_M, PACK_DRAIN_S } from '../data/organic';
import { BLOOD_PACK_PREFIX, BONE_ROD_NAME } from '../models/targets';
import { activeShot } from '../sim/session';
import type { CavitySample, Timeline } from '../sim/types';
import { cavityRiseTime, type GelEffect } from './gelEffect';
import type { ParticleSystem } from './particles';

/**
 * Fake blood packs in gel (issue #19). A pack ruptures when the bullet passes
 * through it, or when the temporary cavity balloons far enough into it. The
 * burst pack drains, red fluid is squeezed along the wound channel (staining
 * it) and squirts out of the entry and exit holes. A bone rod on the path
 * throws bone fragments.
 */

export interface OrganicResult {
  packs: number;
  hit: number;
  burstByCavity: number;
  /** Whether the target has a bone rod at all. */
  bone: boolean;
  boneStruck: boolean;
}

const BLOOD = 0x7a0a12;
const BLOOD_DARK = 0x8a0812;
const BONE = 0xe9dfc8;
/** How fast fluid is driven along the channel from a burst pack, in m/s. */
const SQUEEZE_SPEED = 25;

interface Burst {
  mesh: THREE.Mesh;
  t: number;
}

export class BloodPackEffect {
  private bursts: Burst[] = [];

  constructor(
    private readonly particles: ParticleSystem,
    private readonly gelEffect: GelEffect,
  ) {}

  load(timeline: Timeline, gel: THREE.Mesh, layer: number): OrganicResult | null {
    this.clear();
    const packs = gel.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.name.startsWith(BLOOD_PACK_PREFIX));
    const bone = gel.getObjectByName(BONE_ROD_NAME) as THREE.Mesh | undefined;
    if (!packs.length && !bone) return null;

    const samples = timeline.cavity.filter((c) => c.layer === layer).sort((a, b) => a.t - b.t);
    const result: OrganicResult = { packs: packs.length, hit: 0, burstByCavity: 0, bone: !!bone, boneStruck: false };
    gel.updateWorldMatrix(true, true);
    // The entry and exit holes of the shot that burst a pack, for the sprays.
    const holesFor = (t: number) => {
      const id = activeShot(timeline, t).primaryId;
      const ofShot = timeline.events.filter((e) => e.layer === layer && e.trackId === id);
      return {
        entry: ofShot.find((e) => e.type === 'impact' || e.type === 'enter'),
        exit: ofShot.find((e) => e.type === 'exit'),
      };
    };

    for (const mesh of packs) {
      const rest = mesh.userData.rest as THREE.Vector3;
      mesh.scale.copy(rest);
      const centre = mesh.getWorldPosition(new THREE.Vector3());
      const burst = findBurst(samples, centre, rest);
      if (!burst) continue;
      if (burst.direct) result.hit++;
      else result.burstByCavity++;
      this.bursts.push({ mesh, t: burst.t });
      const { entry, exit } = holesFor(burst.sample.t);
      this.spill(burst.t, rest, burst.sample, samples, entry?.pos, exit?.pos);
    }

    if (bone) {
      const p = bone.getWorldPosition(new THREE.Vector3());
      const r = (bone.geometry as THREE.CylinderGeometry).parameters.radiusTop;
      const half = (bone.geometry as THREE.CylinderGeometry).parameters.height / 2;
      const hit = samples.find(
        (s) => Math.abs(s.pos.x - p.x) < r * 1.5 && Math.abs(s.pos.z - p.z) < r + s.channelRadius && Math.abs(s.pos.y - p.y) < half,
      );
      if (hit) {
        result.boneStruck = true;
        const origin = new THREE.Vector3(hit.pos.x, hit.pos.y, hit.pos.z);
        // Bone fragments are driven forward with the bullet and out sideways into the cavity.
        this.particles.add({
          look: 'chunk',
          t0: hit.t,
          duration: 100e-6,
          origin,
          originJitter: r,
          axis: new THREE.Vector3(1, 0, 0),
          spread: 1.0,
          count: 40,
          speed: [20, 90],
          size: [0.001, 0.005],
          life: [5e-3, 1],
          drag: 900,
          color: BONE,
          colorJitter: 0.2,
        });
      }
    }
    return result;
  }

  /** Red fluid from a burst pack: blobs in the cavity, a stain along the channel, sprays out of the holes. */
  private spill(
    t: number,
    size: THREE.Vector3,
    at: CavitySample,
    samples: CavitySample[],
    entry?: { x: number; y: number; z: number },
    exit?: { x: number; y: number; z: number },
  ): void {
    const volume = size.x * size.y * size.z;
    const amount = Math.min(1, volume / 4e-5);
    const origin = new THREE.Vector3(at.pos.x, at.pos.y, at.pos.z);
    // Fluid bursting into the cavity: blobs fan out but stop within the cavity radius.
    const reach = Math.max(at.radius, 0.01);
    this.particles.add({
      look: 'blob',
      t0: t,
      duration: PACK_DRAIN_S * 0.5,
      origin,
      originJitter: Math.min(size.y, size.z) * 0.6,
      axis: new THREE.Vector3(1, 0, 0),
      spread: Math.PI / 2,
      count: Math.round(60 + 140 * amount),
      speed: [reach * 50, reach * 150],
      size: [0.0015, 0.004],
      life: [1, 1],
      drag: 150,
      color: BLOOD,
      colorJitter: 0.35,
      // Drawn out along their path into ligaments of liquid, not round dots.
      stretch: 2.4,
    });
    // Stain: fluid driven along the permanent channel, front and back, staying after the shot.
    const along = 0.05 + 0.1 * amount;
    this.gelEffect.addStain(at.pos.x, t, along * 1.5);
    for (const s of samples) {
      const d = Math.abs(s.pos.x - at.pos.x);
      // Only this shot's channel: other shots' paths run elsewhere in the block.
      const offPath = Math.hypot(s.pos.y - at.pos.y, s.pos.z - at.pos.z) > 0.02;
      if (d > along || s.channelRadius <= 0 || offPath) continue;
      this.particles.add({
        look: 'blob',
        t0: t + d / SQUEEZE_SPEED,
        duration: 300e-6,
        origin: new THREE.Vector3(s.pos.x, s.pos.y, s.pos.z),
        originJitter: s.channelRadius * 1.6,
        axis: new THREE.Vector3(1, 0, 0),
        spread: Math.PI,
        count: Math.round(14 * (1 - d / along) + 4),
        speed: [0, 0.5],
        size: [s.channelRadius * 0.35, s.channelRadius * 0.9],
        life: [1, 1],
        drag: 50,
        color: BLOOD_DARK,
        colorJitter: 0.3,
        seed: Math.round(s.pos.x * 1e5) + 3,
      });
    }
    // Sprays: squeezed out of the entry hole back toward the shooter, and out of the exit if there is one.
    for (const [hole, axis] of [
      [entry, new THREE.Vector3(-1, 0.05, 0)],
      [exit, new THREE.Vector3(1, 0.05, 0)],
    ] as const) {
      if (!hole) continue;
      const travel = Math.abs(hole.x - at.pos.x);
      if (travel > 0.25) continue;
      this.particles.add({
        look: 'droplet',
        t0: t + travel / (SQUEEZE_SPEED * 2),
        duration: 1.5e-3,
        origin: new THREE.Vector3(hole.x + axis.x * 0.004, hole.y, hole.z),
        originJitter: 0.004,
        axis,
        spread: 0.35,
        count: Math.round(80 + 200 * amount),
        speed: [3, 12 + 20 * amount],
        size: [0.0015, 0.005],
        life: [4e-3, 12e-3],
        drag: 40,
        gravity: 9.8,
        color: BLOOD,
        colorJitter: 0.3,
        stretch: 2.5,
      });
    }
  }

  clear(): void {
    for (const { mesh } of this.bursts) mesh.scale.copy(mesh.userData.rest as THREE.Vector3);
    this.bursts = [];
  }

  update(t: number): void {
    for (const { mesh, t: tb } of this.bursts) {
      const rest = mesh.userData.rest as THREE.Vector3;
      const k = Math.min(1, Math.max(0, (t - tb) / PACK_DRAIN_S));
      // The sachet empties and collapses into a crumpled, mostly flat film.
      const e = 1 - (1 - k) ** 2;
      mesh.scale.set(rest.x * (1 - 0.7 * e), rest.y * (1 - 0.35 * e), rest.z * (1 - 0.35 * e));
    }
  }
}

/** When (if ever) a pack bursts: direct hit by the bullet, or squeezed by the temporary cavity. */
function findBurst(
  samples: CavitySample[],
  centre: THREE.Vector3,
  size: THREE.Vector3,
): { t: number; direct: boolean; sample: CavitySample } | null {
  let best: { t: number; direct: boolean; sample: CavitySample } | null = null;
  for (const s of samples) {
    const dx = (s.pos.x - centre.x) / size.x;
    if (Math.abs(dx) >= 1) continue;
    // Cross-section of the ellipsoid at this depth.
    const shrink = Math.sqrt(1 - dx * dx);
    const dy = s.pos.y - centre.y;
    const dz = s.pos.z - centre.z;
    const dist = Math.hypot(dy, dz);
    const edge = dist < 1e-6 ? 0 : shrink / Math.hypot(dy / dist / size.y, dz / dist / size.z);
    const gap = dist - edge;
    let t: number;
    let direct: boolean;
    if (gap <= s.channelRadius) {
      t = s.t;
      direct = true;
    } else if (s.radius >= PACK_BURST_MIN_CAVITY_M && s.radius - gap >= PACK_BURST_SQUEEZE_M) {
      // Time for the growing cavity wall to reach gap + squeeze.
      const f = Math.min(1, (gap + PACK_BURST_SQUEEZE_M) / s.radius);
      t = s.t + cavityRiseTime(s.radius) * (2 / Math.PI) * Math.asin(f);
      direct = false;
    } else continue;
    if (!best || t < best.t) best = { t, direct, sample: s };
  }
  return best;
}
