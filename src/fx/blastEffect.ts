import * as THREE from 'three';
import { getBullet, type BulletSpec } from '../data/bullets';
import { bodyDebris } from './bodyDebris';
import { TARGET_FRONT_X, layerGroupName } from '../models/targets';
import { blastResponse, debrisScale, type LayerBlast } from '../sim/blastResponse';
import type { TargetLayer } from '../sim/engine';
import type { ShotEvent, Timeline } from '../sim/types';
import { FLOOR_Y, type BurstSpec, type ParticleSystem } from './particles';

/**
 * Detonations (#180-#182): the fireball, smoke, sparks and flash at every
 * `detonate` event, plus, for charges in the test bed, how each material in
 * front of the blast responds to the overpressure that reaches it (debris, and
 * panels that topple or are blown away). Everything is driven by sim time, so
 * it scrubs and replays like the rest of the effects.
 */

/** Visual fireball radius per cube root of the yield (kg), in metres. */
const FIREBALL_M_PER_KG13 = 0.5;

const FIRE = { standard: 0xff9a3c, thermobaric: 0xffc060, incendiary: 0xff7a20 } as const;

/** The fireball's size in metres for an event. */
export function fireballRadius(yieldKg: number, kind: string | undefined): number {
  const base = FIREBALL_M_PER_KG13 * Math.cbrt(Math.max(0.01, yieldKg));
  return kind === 'thermobaric' ? base * 2.2 : kind === 'incendiary' ? Math.max(0.2, base * 3) : base;
}

/** The round that burst at `e`, if it is a missile or a shell (a body that crumples). */
function bodyOf(timeline: Timeline, e: ShotEvent): BulletSpec | undefined {
  const shot = timeline.shots.find((s) => e.trackId >= s.firstTrack && e.trackId < s.firstTrack + s.trackCount);
  const spec = shot ? getBullet(shot.bulletId) : undefined;
  return spec && (spec.shape === 'missile' || spec.mode === 'artillery') && e.trackId === shot!.primaryId ? spec : undefined;
}

export function loadBlastEffect(timeline: Timeline, layers: TargetLayer[], particles: ParticleSystem): void {
  let seed = 9000;
  for (const e of timeline.events) {
    if (e.type !== 'detonate') continue;
    const yieldKg = e.yieldKg ?? 0.01;
    const kind = e.fireball ?? 'standard';
    if (kind === 'none') continue;
    const origin = new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z);
    const charge = e.pressureKPa !== undefined;
    // A charge in mid-air goes off in every direction; a shell or warhead bursts on the face, back toward the shooter.
    const axis = charge ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(-1, 0, 0);
    const spread = charge ? Math.PI : 1.5;
    fireball(particles, e, origin, axis, spread, yieldKg, kind, seed++);
    // A missile or shell is torn apart by the face, not just lit up by its own blast (#248).
    const spec = bodyOf(timeline, e);
    if (spec && !charge) bodyDebris(particles, e, spec, e.layer !== undefined ? layers[e.layer]?.medium.hardness ?? 0.8 : 0.8, seed++);
    if (charge) {
      groundRing(particles, e, origin, yieldKg, kind, seed++);
      for (const response of responses(e, layers)) debris(particles, e, response, origin, layers, seed++);
    } else if (e.layer !== undefined && layers[e.layer]) {
      contactDebris(particles, e, layers, origin, yieldKg, seed++);
    }
  }
}

/** A shell or warhead bursting on the face throws up the material it is on, sized by its yield. */
function contactDebris(particles: ParticleSystem, e: ShotEvent, layers: TargetLayer[], origin: THREE.Vector3, yieldKg: number, seed: number): void {
  const layer = layers[e.layer!];
  const response: LayerBlast = { stack: layer.stack ?? 0, medium: layer.medium, rangeM: 0, pressureKPa: 0, k: 1 + 10 * Math.cbrt(Math.max(1e-6, yieldKg)), outcome: 'cracked', arriveS: 0, tiltRad: 0 };
  debris(particles, e, response, origin, layers, seed, debrisScale(yieldKg));
}

/** What each layer of the stack does when a charge detonates at `e`. */
export function responses(e: ShotEvent, layers: TargetLayer[]): LayerBlast[] {
  if (e.yieldKg === undefined || !layers.length) return [];
  const standoff = Math.max(0.05, TARGET_FRONT_X + layers[0].offset - e.pos.x);
  return blastResponse(e.yieldKg, standoff, layers).map((r) => ({ ...r, arriveS: r.arriveS }));
}

function fireball(particles: ParticleSystem, e: ShotEvent, origin: THREE.Vector3, axis: THREE.Vector3, spread: number, yieldKg: number, kind: string, seed: number): void {
  const radius = fireballRadius(yieldKg, kind);
  const slow = kind === 'thermobaric' ? 3 : 1;
  const fire = FIRE[kind as keyof typeof FIRE] ?? FIRE.standard;
  const base: Omit<BurstSpec, 'look' | 'count' | 'speed' | 'size' | 'life' | 'drag' | 'color'> = { t0: e.t, origin, axis, spread, originJitter: radius * 0.1, seed };

  // The fireball: hot cloud swelling out to its full size.
  particles.add({ ...base, look: 'dust', duration: 200e-6 * slow, count: 70, speed: [radius * 80, radius * 300], size: [radius * 0.35, radius * 0.7], life: [2e-3 * slow, 6e-3 * slow], drag: 700 / slow, color: fire, colorJitter: 0.25, grow: 2.4 });
  if (kind === 'thermobaric') {
    // The fuel cloud keeps burning: a second, slower swell of flame inside the first, then a rolling smoke head.
    particles.add({ ...base, look: 'dust', t0: e.t + 1.5e-3, duration: 3e-3, count: 60, speed: [radius * 20, radius * 90], size: [radius * 0.5, radius * 0.9], life: [10e-3, 22e-3], drag: 200, color: 0xff8a2a, colorJitter: 0.2, grow: 2, seed: seed + 3 });
  }
  if (kind === 'thermobaric') {
    // The burnt fuel rolls up into a dark, rising smoke head.
    particles.add({ ...base, look: 'dust', t0: e.t + 4e-3, duration: 4e-3, axis: new THREE.Vector3(0, 1, 0), spread: 0.9, count: 45, speed: [radius * 15, radius * 50], size: [radius * 0.5, radius], life: [14e-3, 30e-3], drag: 120, color: 0x2e2b28, colorJitter: 0.15, grow: 2.5, seed: seed + 4 });
  }
  // No lingering grey smoke card: against a face it read as a big dark splat pasted on the material.
  if (kind !== 'thermobaric') {
    // Sparks and hot bits thrown out by the burst.
    particles.add({ ...base, look: 'spark', duration: 100e-6, count: kind === 'incendiary' ? 160 : 100, speed: [radius * 150, radius * 900], size: [0.003, 0.008], life: [4e-3, 12e-3], drag: 90, color: 0xffc070, stretch: 3, seed: seed + 2 });
  }
  const lightPos = origin.clone().addScaledVector(axis, e.pressureKPa === undefined ? radius * 0.4 : 0);
  particles.addFlash(e.t, lightPos, 6 * Math.cbrt(Math.max(0.05, yieldKg)), 500e-6 * slow, fire);
}

/** The ring of dust the blast wave kicks up off the floor, rolling outward. */
function groundRing(particles: ParticleSystem, e: ShotEvent, origin: THREE.Vector3, yieldKg: number, kind: string, seed: number): void {
  // In a frame turned onto a missile's path (#250) the floor is not below: no ground ring there.
  if (kind === 'incendiary' || particles.freeFlight) return;
  const radius = fireballRadius(yieldKg, kind);
  const floor = new THREE.Vector3(origin.x, FLOOR_Y + 0.01, origin.z);
  particles.add({
    look: 'dust',
    t0: e.t + 200e-6,
    duration: 800e-6,
    origin: floor,
    originJitter: radius * 0.15,
    axis: new THREE.Vector3(0, 1, 0),
    spread: 1.5,
    innerSpread: 1.2,
    count: 60,
    speed: [radius * 60, radius * 200],
    size: [radius * 0.25, radius * 0.5],
    life: [6e-3, 16e-3],
    drag: 220,
    color: 0x8a8378,
    colorJitter: 0.2,
    grow: 2.4,
    seed,
  });
}

/** Debris thrown off the front of a layer that fails, by what it is made of. */
function debris(particles: ParticleSystem, e: ShotEvent, r: LayerBlast, origin: THREE.Vector3, layers: TargetLayer[], seed: number, scale = 1): void {
  if (r.outcome === 'intact') return;
  const medium = r.medium;
  const layer = layers.find((l) => (l.stack ?? 0) === r.stack) ?? layers[0];
  const faceX = TARGET_FRONT_X + layer.offset;
  const face = new THREE.Vector3(faceX, origin.y, origin.z);
  // How hard it fails, 0.35 at the threshold up to 1 well past it.
  const strength = Math.min(1, Math.log10(Math.max(1, r.k)) / 1.5 + 0.35);
  const arrive = e.t + r.arriveS;
  const burst = (look: BurstSpec['look'], count: number, speed: [number, number], size: [number, number], color: number, life: [number, number], extra: Partial<BurstSpec> = {}): BurstSpec => ({
    look,
    t0: arrive,
    duration: 300e-6,
    origin: face,
    originJitter: Math.min(medium.heightM, medium.widthM) * 0.3,
    axis: new THREE.Vector3(-1, 0, 0),
    spread: 1.3,
    count: Math.round(count * strength * (0.4 + 0.6 * scale)),
    speed: [speed[0] * (0.6 + 0.4 * scale), speed[1] * (0.6 + 0.4 * scale)],
    size: [size[0] * scale, size[1] * scale],
    life,
    drag: 30,
    color,
    colorJitter: 0.2,
    seed,
    ...extra,
  });
  const dust = (color: number) => burst('dust', 60, [3, 25], [0.04, 0.12], color, [4e-3, 14e-3], { grow: 3, drag: 200 });
  switch (medium.behaviour) {
    case 'glass':
    case 'ice':
      particles.add(burst('shard', 120, [20, 140], [0.008, 0.03], medium.behaviour === 'ice' ? 0xdcecf6 : 0xcfe8ee, [20e-3, 40e-3]));
      break;
    case 'wood':
      particles.add(burst('splinter', 80, [15, 90], [0.01, 0.05], 0xc59a62, [20e-3, 40e-3], { stretch: 3 }));
      particles.add(dust(0xa08258));
      break;
    case 'drywall':
      particles.add(dust(0xe6e3dc));
      particles.add(burst('chunk', 40, [5, 40], [0.015, 0.05], 0xdedad0, [20e-3, 40e-3]));
      break;
    case 'concrete':
      particles.add(burst('chunk', 70, [10, 80], [0.015, 0.06], 0x9a978f, [20e-3, 40e-3]));
      particles.add(dust(0xa8a59d));
      break;
    case 'sand':
      particles.add(burst('grain', 160, [8, 60], [0.006, 0.014], 0xb09a70, [20e-3, 40e-3]));
      particles.add(dust(0xa89468));
      break;
    default:
      particles.add(burst('spark', 80, [30, 160], [0.004, 0.01], 0xffc070, [4e-3, 10e-3], { stretch: 3 }));
      break;
  }
}

/** Seconds a toppling panel takes to reach most of its final tilt. */
const TOPPLE_TAU_S = 4e-3;

interface Moving {
  group: THREE.Object3D;
  home: THREE.Vector3;
  pivot: THREE.Vector3;
  response: LayerBlast;
  arrive: number;
}

/**
 * Moves the target's layers when a charge goes off (#196): panels the blast
 * destroys vanish as the shock reaches them, heavy and tall ones that it
 * topples tip over away from the charge. Pure functions of sim time.
 */
export class BlastDamage {
  private moving: Moving[] = [];

  load(timeline: Timeline, target: THREE.Group, layers: TargetLayer[]): void {
    this.clear();
    const e = timeline.events.find((x) => x.type === 'detonate' && x.pressureKPa !== undefined);
    if (!e) return;
    for (const response of responses(e, layers)) {
      if (response.outcome !== 'destroyed' && response.outcome !== 'toppled') continue;
      const group = target.getObjectByName(layerGroupName(response.stack));
      if (!group) continue;
      // Tips about the bottom edge of the panel, on the far side from the charge.
      const pivot = new THREE.Vector3(group.position.x + response.medium.thickness.default / 2, -response.medium.heightM / 2 - 0.02, 0);
      this.moving.push({ group, home: group.position.clone(), pivot, response, arrive: e.t + response.arriveS });
    }
  }

  update(t: number): void {
    for (const m of this.moving) {
      const { group, home, pivot, response } = m;
      const since = t - m.arrive;
      if (response.outcome === 'destroyed') {
        group.visible = since < 0;
        continue;
      }
      const angle = since > 0 ? response.tiltRad * (1 - Math.exp(-since / TOPPLE_TAU_S)) : 0;
      // Rotate about the base: the top swings toward +x, away from the charge.
      group.rotation.z = -angle;
      const rel = home.clone().sub(pivot).applyAxisAngle(new THREE.Vector3(0, 0, 1), -angle);
      group.position.copy(pivot).add(rel);
    }
  }

  clear(): void {
    for (const { group, home } of this.moving) {
      group.visible = true;
      group.rotation.z = 0;
      group.position.copy(home);
    }
    this.moving = [];
  }
}
