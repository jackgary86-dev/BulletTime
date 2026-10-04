import * as THREE from 'three';
import type { TargetLayer } from '../sim/engine';
import { sampleTrack } from '../sim/sample';
import type { ShotEvent, Timeline, Track } from '../sim/types';
import type { BurstSpec } from './particles';
import type { HoleMarks } from './holes';
import type { ParticleSystem } from './particles';

/**
 * Concrete, cinder block and steel plate: craters, cracks, dents, sparks, lead
 * splash and dust. Driven by the physics events, so ricochets, splashes, stops
 * and perforations each get their own look.
 *
 * Cinder block matches the reference in issue #10: blow-back dust at the entry,
 * dust billowing inside the hollow core, and a dense exit plume with a wide
 * fan of grit and chunks.
 */

const CONCRETE = { fresh: 0x9e9b94, dust: 0x8a8781, grit: 0x7d7a74, hole: 0x161616, crack: 0x2a2a2a };
const STEEL = { bright: 0xe4e8ec, bare: 0xb4bac2, lead: 0x9a9ea4, spark: 0xffb347, hole: 0x050505, paint: 0xd8d1bf };
/** A perforation's rim glows hot and cools over about this long, in seconds. */
const GLOW_COOL_S = 2.5e-3;
/** Peak brightness of the flash from a steel strike, in candela, and how fast it dies, in seconds. */
const FLASH_CD = 0.06;
const FLASH_DECAY_S = 150e-6;

export function loadHardEffect(timeline: Timeline, layers: TargetLayer[], particles: ParticleSystem, holes: HoleMarks): void {
  let seed = 101;
  for (const e of timeline.events) {
    if (e.layer === undefined) continue;
    const medium = layers[e.layer]?.medium;
    if (!medium) continue;
    // A bowling ball is concrete to the physics but draws its own effect (objectEffect.ts, #156).
    if (medium.shape && medium.behaviour === 'concrete') continue;
    // A hollow block's front shell: the next physics layer is the same block's back shell.
    const next = layers[e.layer + 1];
    const frontShell = !!next && next.stack === layers[e.layer].stack;
    const track = timeline.tracks.find((tr) => tr.id === e.trackId);
    if (!track || track.kind === 'fragment') continue;
    const ctx = makeContext(track, e);
    if (medium.behaviour === 'concrete') concreteEvent(ctx, e, frontShell, particles, holes, seed++);
    else if (medium.behaviour === 'steel') {
      const perforated = timeline.events.some((x) => x.type === 'exit' && x.layer === e.layer && x.trackId === e.trackId);
      steelEvent(ctx, e, medium.look === 'ar500', perforated, particles, holes, seed++);
    }
  }
}

interface Context {
  diameter: number;
  /** 0–1 scale of how violent the event is. */
  k: number;
  /** Pellets get lighter effects so buckshot stays readable. */
  weight: number;
  normal: THREE.Vector3;
  origin: THREE.Vector3;
  /** Bullet travel direction at the event. */
  dir: THREE.Vector3;
}

function makeContext(track: Track, e: ShotEvent): Context {
  const frame = sampleTrack(track, e.t);
  const energy = 0.5 * track.massKg * e.speed ** 2;
  const fallback = { x: e.type === 'exit' ? 1 : -1, y: 0, z: 0 };
  return {
    diameter: frame?.diameter ?? track.baseDiameter,
    k: Math.min(1, Math.sqrt(energy / 3000)),
    weight: track.kind === 'pellet' ? 0.3 : 1,
    normal: vec(e.normal ?? fallback).normalize(),
    origin: vec(e.pos),
    dir: frame ? vec(frame.dir) : new THREE.Vector3(1, 0, 0),
  };
}

function concreteEvent(c: Context, e: ShotEvent, frontShell: boolean, particles: ParticleSystem, holes: HoleMarks, seed: number): void {
  const { diameter: d, k, weight: w, normal, origin } = c;

  if (e.type === 'impact' || e.type === 'enter' || e.type === 'ricochet') {
    const glancing = e.type === 'ricochet';
    holes.add({
      t: e.t,
      pos: e.pos,
      normal,
      radius: d * 0.5,
      ragged: 0.8,
      color: CONCRETE.hole,
      noOpening: glancing,
      crater: { radius: d * (glancing ? 1.5 : 2 + 2.5 * k), color: CONCRETE.fresh },
      cracks: glancing ? undefined : { count: 3 + Math.round(4 * k), length: [d * 3, d * (5 + 8 * k)], width: 0.0007, color: CONCRETE.crack },
      seed,
    });
    // Blow-back: grey dust and fine grit fanning back up the shot line and outward.
    particles.add(dust(e.t, origin, normal, 1.0, 140 * w * (0.4 + k), 0.026, [2, 18 + 14 * k]));
    particles.add(bits('grain', e.t, origin, normal, 1.1, 120 * w * (0.4 + k), [8, 30 + 40 * k], [0.0008, 0.0025], CONCRETE.grit));
    particles.add(bits('chunk', e.t, origin, normal, 0.9, 14 * w * k, [4, 15], [0.002, 0.006], CONCRETE.fresh));
    if (glancing) particles.add(sparks(e.t, origin, normal, c.dir, 25 * w * k));
  } else if (e.type === 'exit') {
    holes.add({
      t: e.t,
      pos: e.pos,
      normal,
      radius: d * 0.7,
      ragged: 0.9,
      color: CONCRETE.hole,
      crater: { radius: d * (3 + 3 * k), color: CONCRETE.fresh },
      cracks: { count: 4 + Math.round(4 * k), length: [d * 4, d * (6 + 10 * k)], width: 0.0008, color: CONCRETE.crack },
      seed,
    });
    if (frontShell) {
      // Inside the hollow core: dust from the front-shell perforation billows slowly round the cell.
      particles.add({ ...dust(e.t, origin, normal, 1.5, 220 * w, 0.028, [1, 10]), duration: 1.2e-3, grow: 5, life: [3e-3, 9e-3], drag: 300 });
      particles.add(bits('grain', e.t, origin, normal, 0.6, 60 * w * (0.5 + k), [10, 50 + 60 * k], [0.0008, 0.002], CONCRETE.grit));
    } else {
      // Exit plume: a dense dust cone travelling with the bullet, and a wide fan of grit and chunks.
      const speed = Math.max(40, e.speed * 0.35);
      particles.add({ ...dust(e.t, origin, normal, 0.45, 380 * w * (0.5 + k), 0.034, [speed * 0.2, speed]), duration: 700e-6, grow: 4 });
      particles.add({ ...dust(e.t, origin, normal, 1.0, 160 * w, 0.03, [3, 25]), duration: 1.5e-3, grow: 5, life: [3e-3, 9e-3] });
      particles.add(bits('grain', e.t, origin, normal, 0.8, 260 * w * (0.4 + k), [20, 60 + e.speed * 0.15], [0.0008, 0.0028], CONCRETE.grit));
      particles.add(bits('chunk', e.t, origin, normal, 0.7, 45 * w * (0.3 + k), [8, 25 + e.speed * 0.05], [0.003, 0.012], CONCRETE.fresh));
    }
  } else if (e.type === 'stop') {
    // Bullet buried in the block: the entry crater already marks it; just a little extra grit.
    particles.add(dust(e.t, origin, normal.clone().negate(), 0.8, 20 * w, 0.012, [1, 5]));
  }
}

function steelEvent(
  c: Context,
  e: ShotEvent,
  painted: boolean,
  perforated: boolean,
  particles: ParticleSystem,
  holes: HoleMarks,
  seed: number,
): void {
  const { diameter: d, k, weight: w, normal, origin } = c;
  if (e.type === 'impact' || e.type === 'enter') {
    if (painted) {
      // The hit blasts the paint off in a ragged disc of bare steel, with lead sprayed in rays across it.
      holes.add({
        t: e.t,
        pos: e.pos,
        normal,
        radius: d,
        ragged: 0.5,
        color: STEEL.bare,
        noOpening: true,
        noHalo: true,
        crater: { radius: d * (2.6 + 2 * k), color: STEEL.bare, roughness: 0.5, metalness: 0.35, irregularity: 0.7 },
        streaks: { count: 18, length: [d * 2, d * (4 + 4 * k)], width: d * 0.35, color: STEEL.lead },
        seed: seed + 900,
      });
      // The blasted paint leaves as a cloud of curled flakes.
      particles.add({ ...bits('chunk', e.t, origin, normal, 1.2, 50 * w * (0.4 + k), [6, 30 + 30 * k], [0.0015, 0.004], STEEL.paint), look: 'flake', drag: 80 });
    }
    // A grey lead splatter with a bright, polished dent at its centre; the opening only appears if the plate is perforated.
    holes.add({
      t: e.t,
      pos: e.pos,
      normal,
      radius: d,
      ragged: 0.3,
      color: STEEL.lead,
      noOpening: true,
      noHalo: true,
      crater: { radius: d * (1.2 + 0.8 * k), color: STEEL.lead, roughness: 0.8, metalness: 0.1, irregularity: 0.3 },
      seed: seed + 500,
    });
    holes.add({
      t: e.t,
      pos: e.pos,
      normal,
      radius: d * 0.5,
      ragged: 0.2,
      color: STEEL.hole,
      noOpening: true,
      noHalo: true,
      crater: { radius: d * (0.5 + 0.3 * k), color: STEEL.bright, roughness: 0.3, metalness: 0.6, irregularity: 0.15 },
      glow: perforated ? { radius: d * 1.3, cool: GLOW_COOL_S } : undefined,
      seed,
    });
    particles.add(sparks(e.t, origin, normal, c.dir, 120 * w * (0.4 + k)));
    // The strike lights up the plate and the room for an instant.
    particles.addFlash(e.t, origin.clone().addScaledVector(normal, 0.03), FLASH_CD * w * (0.3 + k), FLASH_DECAY_S);
  } else if (e.type === 'splash') {
    // The bullet disintegrates against the plate: lead spray flies out flat along the face.
    particles.add(splash(e.t, origin, normal, 260 * w * (0.4 + k), e.speed));
    particles.add(sparks(e.t, origin, normal, c.dir, 60 * w * k));
  } else if (e.type === 'ricochet') {
    holes.add({
      t: e.t,
      pos: e.pos,
      normal,
      radius: d,
      stretch: 2.5,
      stretchAxis: c.dir,
      ragged: 0.3,
      color: STEEL.hole,
      noOpening: true,
      crater: { radius: d * 0.8, color: STEEL.bright, roughness: 0.3, metalness: 0.6, irregularity: 0.15 },
      noHalo: true,
      seed,
    });
    particles.add(sparks(e.t, origin, normal, c.dir, 90 * w * (0.4 + k)));
    particles.addFlash(e.t, origin.clone().addScaledVector(normal, 0.03), FLASH_CD * 0.5 * w * (0.3 + k), FLASH_DECAY_S);
  } else if (e.type === 'exit') {
    holes.add({
      t: e.t,
      pos: e.pos,
      normal,
      radius: d * 0.55,
      ragged: 0.4,
      color: STEEL.hole,
      crater: { radius: d * 1.1, color: STEEL.bright, roughness: 0.3, metalness: 0.6, irregularity: 0.2 },
      rim: { count: 8, length: [d * 0.3, d * 0.6], width: d * 0.5, color: STEEL.bright, lift: 1.1 },
      glow: { radius: d * 1.5, cool: GLOW_COOL_S },
      seed,
    });
    // Spall: hot steel flakes thrown off the back face.
    particles.add(sparks(e.t, origin, normal, normal, 160 * w * (0.4 + k)));
    particles.add(bits('shard', e.t, origin, normal, 0.9, 60 * w * k, [40, 120 + e.speed * 0.2], [0.001, 0.003], STEEL.bright));
  }
}

function vec(v: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function dust(t: number, origin: THREE.Vector3, axis: THREE.Vector3, spread: number, count: number, size: number, speed: [number, number]): BurstSpec {
  return {
    look: 'dust',
    t0: t,
    duration: 300e-6,
    origin: origin.clone(),
    originJitter: 0.006,
    axis: axis.clone(),
    spread,
    count: Math.round(count),
    speed,
    size: [size * 0.4, size],
    life: [2e-3, 6e-3],
    drag: 150,
    gravity: 2,
    color: CONCRETE.dust,
    colorJitter: 0.15,
    grow: 3,
  };
}

function bits(look: 'grain' | 'chunk' | 'shard', t: number, origin: THREE.Vector3, axis: THREE.Vector3, spread: number, count: number, speed: [number, number], size: [number, number], color: number): BurstSpec {
  return {
    look,
    t0: t,
    duration: 150e-6,
    origin: origin.clone(),
    originJitter: 0.004,
    axis: axis.clone(),
    spread,
    count: Math.round(count),
    speed,
    size,
    life: [4e-3, 15e-3],
    drag: 20,
    gravity: 9.8,
    color,
    colorJitter: 0.35,
  };
}

/** Sparks spray off the face, biased along the bullet's travel deflected into the plate's plane. */
function sparks(t: number, origin: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3, count: number): BurstSpec {
  const along = dir.clone().addScaledVector(normal, -dir.dot(normal));
  const axis = normal.clone().multiplyScalar(0.6).add(along.multiplyScalar(0.8)).normalize();
  return {
    look: 'spark',
    t0: t,
    duration: 200e-6,
    origin: origin.clone(),
    originJitter: 0.003,
    axis,
    spread: 1.3,
    count: Math.round(count),
    speed: [40, 220],
    size: [0.0006, 0.0014],
    life: [1e-3, 4e-3],
    drag: 30,
    gravity: 9.8,
    color: STEEL.spark,
    colorJitter: 0.3,
    stretch: 10,
  };
}

/** Lead splash: a thin disc of droplets racing outward almost flat along the face. */
function splash(t: number, origin: THREE.Vector3, normal: THREE.Vector3, count: number, speed: number): BurstSpec {
  return {
    look: 'grain',
    t0: t,
    duration: 80e-6,
    origin: origin.clone().addScaledVector(normal, 0.002),
    originJitter: 0.002,
    axis: normal.clone(),
    // Almost 90°: the spray hugs the plate.
    spread: 1.45,
    count: Math.round(count),
    speed: [speed * 0.3, speed * 0.8],
    size: [0.0006, 0.002],
    life: [1e-3, 4e-3],
    drag: 40,
    gravity: 9.8,
    color: STEEL.lead,
    colorJitter: 0.3,
    stretch: 3,
  };
}
