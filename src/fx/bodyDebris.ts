import * as THREE from 'three';
import type { BulletSpec } from '../data/bullets';
import { crumpleDuration } from '../sim/crumple';
import type { ShotEvent } from '../sim/types';
import type { ParticleSystem } from './particles';

/** How much skin and how many fins a missile or shell body sheds when it hits (#248). */
export interface BodyDebrisPlan {
  skin: { count: number; size: [number, number]; speed: [number, number] };
  fins: { count: number; size: [number, number]; speed: [number, number] };
  /** Seconds after contact that the fins shear off and the skin starts to tear. */
  finsAtS: number;
  skinAtS: number;
}

/** Pure sizing of the debris from the body and the crumple, so it can be tested without a renderer. */
export function bodyDebrisPlan(spec: Pick<BulletSpec, 'caliberMm' | 'lengthMm' | 'shape'>, impactSpeed: number, hardness: number): BodyDebrisPlan {
  const d = spec.caliberMm / 1000;
  const length = spec.lengthMm / 1000;
  const crumple = crumpleDuration(length, impactSpeed, hardness);
  // Shed pieces are a fraction of the body's width; faster impacts throw them harder.
  const v = Math.min(80, 6 + impactSpeed * 0.12);
  return {
    skin: { count: Math.round(Math.min(80, 20 + 60 * d)), size: [d * 0.06, d * 0.22], speed: [v * 0.3, v] },
    fins: { count: spec.shape === 'missile' ? 4 : 0, size: [d * 0.3, d * 0.55], speed: [v * 0.15, v * 0.5] },
    finsAtS: crumple * 0.25,
    skinAtS: crumple * 0.1,
  };
}

const METAL = 0x8a8f94;
const PAINT = 0x5b6650;

/** Skin shards and fins thrown off a missile or shell as its body crumples against the face; tumble and fall on the sim clock. */
export function bodyDebris(particles: ParticleSystem, e: ShotEvent, spec: BulletSpec, hardness: number, seed: number): void {
  const plan = bodyDebrisPlan(spec, e.speed, hardness);
  const origin = new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z);
  // Pieces fly back toward the shooter and sideways off the face, then fall.
  const axis = new THREE.Vector3(-1, 0.15, 0).normalize();
  const base = { origin, originJitter: spec.caliberMm / 1000 * 0.3, axis, gravity: 9.8, drag: 1.5, life: [40e-3, 140e-3] as [number, number] };
  particles.add({ ...base, look: 'shard', t0: e.t + plan.skinAtS, duration: plan.finsAtS * 2, spread: 1.4, count: plan.skin.count, speed: plan.skin.speed, size: plan.skin.size, color: PAINT, colorJitter: 0.3, seed });
  particles.add({ ...base, look: 'shard', t0: e.t + plan.skinAtS, duration: plan.finsAtS * 2, spread: 1.4, count: Math.round(plan.skin.count / 2), speed: plan.skin.speed, size: plan.skin.size, color: METAL, colorJitter: 0.3, seed: seed + 1 });
  if (plan.fins.count > 0) {
    particles.add({ ...base, look: 'chunk', t0: e.t + plan.finsAtS, duration: 1e-4, spread: 1.0, count: plan.fins.count, speed: plan.fins.speed, size: plan.fins.size, life: [80e-3, 180e-3], color: METAL, colorJitter: 0.2, seed: seed + 2 });
  }
}
