import * as THREE from 'three';
import { TARGET_FRONT_X } from '../models/targets';
import type { MediumBehaviour } from '../data/media';
import type { TargetLayer } from '../sim/engine';
import type { ShotEvent, Timeline } from '../sim/types';
import type { BurstSpec, ParticleSystem } from './particles';

/**
 * Detonations (#180-#182): the fireball, smoke, sparks and flash at every
 * `detonate` event, plus, for charges in the test bed, how the material in front
 * of the blast responds to the overpressure that reaches it. Everything is a
 * scrubbable particle burst, like the rest of the effects.
 */

/** Visual fireball radius per cube root of the yield (kg), in metres. */
const FIREBALL_M_PER_KG13 = 0.5;
/** Speed of sound in air, m/s. */
const SOUND_MS = 343;

const FIRE = { standard: 0xff9a3c, thermobaric: 0xffc060, incendiary: 0xff7a20 } as const;

/** Overpressure (kPa) at which a material starts to fail, by behaviour: glass first, concrete and steel last. */
const FAILURE_KPA: Record<MediumBehaviour, number> = {
  glass: 5,
  drywall: 12,
  ice: 25,
  wood: 40,
  bone: 300,
  concrete: 300,
  steel: 4000,
  sand: 2500,
  gel: 1500,
  water: 1500,
};

/** The fireball's size in metres for an event. */
export function fireballRadius(yieldKg: number, kind: string | undefined): number {
  const base = FIREBALL_M_PER_KG13 * Math.cbrt(Math.max(0.01, yieldKg));
  return kind === 'thermobaric' ? base * 2.2 : kind === 'incendiary' ? Math.max(0.2, base * 3) : base;
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
    if (charge) targetResponse(particles, e, layers, origin, seed++);
  }
}

function fireball(particles: ParticleSystem, e: ShotEvent, origin: THREE.Vector3, axis: THREE.Vector3, spread: number, yieldKg: number, kind: string, seed: number): void {
  const radius = fireballRadius(yieldKg, kind);
  const slow = kind === 'thermobaric' ? 3 : 1;
  const fire = FIRE[kind as keyof typeof FIRE] ?? FIRE.standard;
  const base: Omit<BurstSpec, 'look' | 'count' | 'speed' | 'size' | 'life' | 'drag' | 'color'> = { t0: e.t, origin, axis, spread, originJitter: radius * 0.1, seed };

  // The fireball: hot cloud swelling out to its full size.
  particles.add({ ...base, look: 'dust', duration: 200e-6 * slow, count: 70, speed: [radius * 80, radius * 300], size: [radius * 0.35, radius * 0.7], life: [2e-3 * slow, 6e-3 * slow], drag: 700 / slow, color: fire, colorJitter: 0.25, grow: 2.4 });
  // Smoke: dark and slow, hanging after the flame has gone.
  particles.add({ ...base, look: 'dust', t0: e.t + 400e-6, duration: 1.5e-3, count: 50, speed: [radius * 30, radius * 120], size: [radius * 0.4, radius * 0.9], life: [8e-3, 20e-3], drag: 300, color: 0x3a3733, colorJitter: 0.2, grow: 2.2, seed: seed + 1 });
  if (kind !== 'thermobaric') {
    // Sparks and hot bits thrown out by the burst.
    particles.add({ ...base, look: 'spark', duration: 100e-6, count: kind === 'incendiary' ? 160 : 100, speed: [radius * 150, radius * 900], size: [0.003, 0.008], life: [4e-3, 12e-3], drag: 90, color: 0xffc070, stretch: 3, seed: seed + 2 });
  }
  const lightPos = origin.clone().addScaledVector(axis, e.pressureKPa === undefined ? radius * 0.4 : 0);
  particles.addFlash(e.t, lightPos, 6 * Math.cbrt(Math.max(0.05, yieldKg)), 500e-6 * slow, fire);
}

/** Debris thrown off the front of each material the blast reaches, if the overpressure is above what it can take. */
function targetResponse(particles: ParticleSystem, e: ShotEvent, layers: TargetLayer[], origin: THREE.Vector3, seed: number): void {
  const pressure = e.pressureKPa ?? 0;
  const front = layers.filter((l) => l.stack === undefined || l.stack === layers[0].stack).slice(0, 1);
  for (const layer of front) {
    const medium = layer.medium;
    const k = pressure / FAILURE_KPA[medium.behaviour];
    if (k < 1) continue;
    const faceX = TARGET_FRONT_X + layer.offset;
    const range = Math.max(0.1, faceX - origin.x);
    // The shock reaches the face a little before the sound would.
    const arrive = e.t + range / (SOUND_MS + 0.6 * pressure);
    const face = new THREE.Vector3(faceX, origin.y, origin.z);
    const strength = Math.min(1, Math.log10(k) / 1.5 + 0.35);
    const burst = (look: BurstSpec['look'], count: number, speed: [number, number], size: [number, number], color: number, life: [number, number], extra: Partial<BurstSpec> = {}): BurstSpec => ({
      look,
      t0: arrive,
      duration: 300e-6,
      origin: face,
      originJitter: Math.min(medium.heightM, medium.widthM) * 0.3,
      axis: new THREE.Vector3(-1, 0, 0),
      spread: 1.3,
      count: Math.round(count * strength),
      speed,
      size,
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
}
