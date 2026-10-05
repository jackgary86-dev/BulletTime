import * as THREE from 'three';
import type { TargetLayer } from '../sim/engine';
import { sampleTrack } from '../sim/sample';
import type { ShotEvent, Timeline, Track } from '../sim/types';
import type { BurstSpec } from './particles';
import type { HoleMarks } from './holes';
import type { ParticleSystem } from './particles';
import type { MediumSpec } from '../data/media';
import { concreteFootprint } from './concreteDamage';
import { planDishes } from './plateDishMath';
import { scaleBurst, shellScale } from './shellScale';

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
const STEEL = { bright: 0xe4e8ec, bare: 0xb4bac2, lead: 0x9a9ea4, spark: 0xffb347, hole: 0x050505, paint: 0xd8d1bf, soot: 0x26262a };
/** A perforation's rim glows hot and cools over about this long, in seconds. */
const GLOW_COOL_S = 2.5e-3;
/** Peak brightness of the flash from a steel strike, in candela, and how fast it dies, in seconds. */
const FLASH_CD = 0.06;
const FLASH_DECAY_S = 150e-6;

export function loadHardEffect(timeline: Timeline, layers: TargetLayer[], particles: ParticleSystem, holes: HoleMarks): void {
  let seed = 101;
  const dishes = planDishes(timeline, layers);
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
    if (medium.behaviour === 'concrete') {
      const struck = timeline.events.find((x) => (x.type === 'impact' || x.type === 'enter') && x.layer === e.layer && x.trackId === e.trackId);
      concreteEvent(ctx, e, frontShell, medium, layers[e.layer].thickness, struck?.t ?? e.t, particles, holes, seed++);
    }
    else if (medium.behaviour === 'steel') {
      const perforated = timeline.events.some((x) => x.type === 'exit' && x.layer === e.layer && x.trackId === e.trackId);
      // The fragments the round shed on the way out (#188) are the source of truth for how many bright chips fly.
      const shed = e.type === 'exit' ? timeline.tracks.filter((tr) => tr.kind === 'fragment' && Math.abs(tr.spawnT - e.t) < 1e-5).length : 0;
      // The back face is bulged by the time the plate gives way (#221): the exit hole sits on top of the bulge.
      const dish = e.type === 'exit' ? dishes.find((x) => x.layer === e.layer && x.trackId === e.trackId) : undefined;
      steelEvent(ctx, e, medium.look === 'ar500', perforated, shed, dish?.depthM ?? 0, particles, holes, seed++, !!medium.brittle);
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

function concreteEvent(c: Context, e: ShotEvent, frontShell: boolean, medium: MediumSpec, thicknessM: number, impactT: number, particles: ParticleSystem, holes: HoleMarks, seed: number): void {
  const { diameter: d, k, weight: w, normal, origin } = c;
  const debris = medium.concreteDamage?.debris;

  if (e.type === 'impact' || e.type === 'enter' || e.type === 'ricochet') {
    const glancing = e.type === 'ricochet';
    // Measured panels leave a spall crater of a known size; every other concrete scales with the bullet.
    const spall = glancing ? undefined : concreteFootprint(medium, thicknessM, 'spall');
    holes.add({
      t: e.t,
      pos: e.pos,
      normal,
      radius: d * 0.5,
      ragged: 0.8,
      color: CONCRETE.hole,
      noOpening: glancing,
      crater: spall
        ? { radius: spall.w / 2, color: CONCRETE.fresh, irregularity: 0.35, stretch: spall.h / spall.w }
        : { radius: d * (glancing ? 1.5 : 2 + 2.5 * k), color: CONCRETE.fresh },
      cracks: glancing
        ? undefined
        : spall
          ? { count: 5, length: [spall.w * 0.6, spall.w * 1.1], width: 0.0007, color: CONCRETE.crack }
          : { count: 3 + Math.round(4 * k), length: [d * 3, d * (5 + 8 * k)], width: 0.0007, color: CONCRETE.crack },
      seed,
    });
    // Blow-back: grey dust and fine grit fanning back up the shot line and outward.
    if (debris && !glancing) {
      // A measured panel: a big pale cloud (4-5 bullet lengths across by 1 ms) that lingers longer the stronger the concrete.
      const puff = dust(e.t, origin, normal, 1.35, debris.frontDust * w, 0.04, [40, 190]);
      particles.add({ ...puff, duration: 1.2e-3, grow: 2.2, life: [3e-3 * debris.frontLife, 6e-3 * debris.frontLife], drag: 90 });
    } else particles.add(dust(e.t, origin, normal, 1.0, 140 * w * (0.4 + k), 0.026, [2, 18 + 14 * k]));
    particles.add(bits('grain', e.t, origin, normal, 1.1, 120 * w * (0.4 + k), [8, 30 + 40 * k], [0.0008, 0.0025], CONCRETE.grit));
    particles.add(bits('chunk', e.t, origin, normal, 0.9, 14 * w * k, [4, 15], [0.002, 0.006], CONCRETE.fresh));
    if (glancing) particles.add(sparks(e.t, origin, normal, c.dir, 25 * w * k));
  } else if (e.type === 'exit') {
    // The back scab is the wider half of the hourglass; its cracks run out toward the scab edge.
    const scab = concreteFootprint(medium, thicknessM, 'scab');
    // The scab bulges and cracks, then lets go some ms after impact; the bullet is long gone by then.
    const releaseT = debris ? Math.max(e.t, impactT + debris.scabReleaseS) : e.t;
    holes.add({
      t: releaseT,
      pos: e.pos,
      normal,
      radius: d * 0.7,
      ragged: 0.9,
      color: CONCRETE.hole,
      crater: scab
        ? { radius: scab.w / 2, color: CONCRETE.fresh, irregularity: 0.35, stretch: scab.h / scab.w }
        : { radius: d * (3 + 3 * k), color: CONCRETE.fresh },
      cracks: scab
        ? { count: 8, length: [scab.w * 0.55, scab.w * 0.85], width: 0.0009, color: CONCRETE.crack }
        : { count: 4 + Math.round(4 * k), length: [d * 4, d * (6 + 10 * k)], width: 0.0008, color: CONCRETE.crack },
      seed,
    });
    if (frontShell) {
      // Inside the hollow core: dust from the front-shell perforation billows slowly round the cell.
      particles.add({ ...dust(e.t, origin, normal, 1.5, 220 * w, 0.028, [1, 10]), duration: 1.2e-3, grow: 5, life: [3e-3, 9e-3], drag: 300 });
      particles.add(bits('grain', e.t, origin, normal, 0.6, 60 * w * (0.5 + k), [10, 50 + 60 * k], [0.0008, 0.002], CONCRETE.grit));
    } else if (debris && scab) {
      // The hole the bullet leaves: a short, fast jet of dust along the axis.
      particles.add({ ...dust(e.t, origin, normal, 0.3, 90 * w, 0.02, [25, 70]), duration: 600e-6, grow: 2, life: [3e-3, 6e-3] });
      // Then the scab lets go: a cloud and angular chips over its whole footprint, and for strong concrete a few big slabs.
      const scatter = scab.w * 0.35;
      const at = (t0: number): BurstSpec => ({ ...dust(t0, origin, normal, 1.2, debris.rearDust * w, 0.035, [30, 150]), originJitter: scatter, duration: 1.4e-3, grow: 2.3, life: [3e-3 * debris.rearLife, 7e-3 * debris.rearLife], drag: 110 });
      particles.add(at(releaseT));
      particles.add({ ...bits('chunk', releaseT, origin, normal, 0.9, debris.chips.count * w, [...debris.chips.speed], [...debris.chips.size], CONCRETE.fresh), originJitter: scatter, duration: 800e-6, life: [8e-3, 20e-3] });
      if (debris.slabs)
        particles.add({ ...bits('chunk', releaseT, origin, normal, 0.6, debris.slabs.count, [...debris.slabs.speed], [...debris.slabs.size], CONCRETE.fresh), originJitter: scatter, duration: 200e-6, life: [10e-3, 25e-3], drag: 4 });
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
  shed: number,
  bulgeM: number,
  system: ParticleSystem,
  holes: HoleMarks,
  seed: number,
  brittle = false,
): void {
  const { diameter: d, k, weight: w, normal, origin } = c;
  // Particle sizes are tuned for bullets: chips, sparks and the flash grow with the round (#234).
  const s = shellScale(d);
  const particles = {
    add: (spec: BurstSpec) => system.add(scaleBurst(spec, s)),
    addFlash: (t: number, pos: THREE.Vector3, intensity: number, decay: number) => system.addFlash(t, pos, intensity * s, decay),
  };
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
    if (brittle) {
      // Cast iron (#296) cracks rather than dents: dark cracks run out from the hit and angular chunks fly off the face.
      holes.add({
        t: e.t,
        pos: e.pos,
        normal,
        radius: d * 0.6,
        ragged: 0.4,
        color: STEEL.hole,
        noOpening: true,
        noHalo: true,
        streaks: { count: 22, length: [d * 2.5, d * (7 + 10 * k)], width: d * 0.12, color: STEEL.soot },
        seed: seed + 700,
      });
      particles.add(bits('chunk', e.t, origin, normal, 1.1, 60 * w * (0.5 + k), [6, 30 + 40 * k], [0.003, 0.009], 0x4a4b50));
      particles.add(dust(e.t, origin, normal, 1.2, 45 * w * (0.4 + k), 0.02, [2, 12]));
    }
    particles.add(sparks(e.t, origin, normal, c.dir, 120 * w * (0.4 + k)));
    // Blow-back (#219): a dark cloud of jacket, lead and plate dust thrown back at wide angles, and thin droplet
    // sheets that run up and down the face. Both are gone in about 100 us.
    particles.add(blowBack(e.t, origin, normal, 45 * w * (0.4 + k)));
    for (const up of [1, -1] as const) particles.add(faceSheet(e.t, origin, normal, c.dir, up, 28 * w * (0.4 + k)));
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
      pos: { x: e.pos.x + normal.x * bulgeM, y: e.pos.y + normal.y * bulgeM, z: e.pos.z + normal.z * bulgeM },
      normal,
      radius: d * 0.55,
      ragged: 0.4,
      color: STEEL.hole,
      crater: { radius: d * 1.1, color: STEEL.bright, roughness: 0.3, metalness: 0.6, irregularity: 0.2 },
      // The plate is pushed out into a few petals (#220): fewer for a gentle perforation, more for a violent one.
      rim: { count: Math.min(8, 3 + Math.round(5 * k)), length: [d * 0.3, d * 0.6], width: d * 0.5, color: STEEL.bright, lift: 1.1 },
      glow: { radius: d * 1.5, cool: GLOW_COOL_S },
      seed,
    });
    // Spall: hot steel flakes thrown off the back face.
    particles.add(sparks(e.t, origin, normal, normal, 160 * w * (0.4 + k)));
    particles.add(bits('shard', e.t, origin, normal, 0.9, 60 * w * k, [40, 120 + e.speed * 0.2], [0.001, 0.003], STEEL.bright));
    // Cast iron fails brittle (#296): heavy spall, angular grey chunks, thrown from the back face.
    if (brittle) particles.add(bits('chunk', e.t, origin, normal, 1.0, 70 * w * (0.5 + k), [10, 50 + e.speed * 0.08], [0.005, 0.018], 0x55565b));
    // The plug the bullet punches out leaves ahead of it, and a thin dark string of debris trails along the axis (#220).
    particles.add({ ...bits('chunk', e.t, origin, normal, 0.05, 1, [e.speed * 0.8, e.speed * 0.8], [0.002, 0.003], STEEL.bright), duration: 1e-6, life: [4e-3, 10e-3], drag: 0 });
    particles.add(debrisString(e.t, origin, normal, e.speed, 30 * w * (0.4 + k)));
    // About 10 of 14 shed fragments show as bright chips thrown sideways.
    if (shed > 0) particles.add(sideChips(e.t, origin, normal, Math.round(shed * 0.7), e.speed));
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

/** Dark blow-back thrown out of the struck face: a cone about 1.3 rad wide that thins to haze in 60-100 us. */
function blowBack(t: number, origin: THREE.Vector3, normal: THREE.Vector3, count: number): BurstSpec {
  return {
    look: 'dust',
    t0: t,
    duration: 30e-6,
    origin: origin.clone().addScaledVector(normal, 0.001),
    originJitter: 0.003,
    axis: normal.clone(),
    spread: 1.3,
    count: Math.round(count),
    speed: [20, 110],
    size: [0.004, 0.012],
    life: [60e-6, 100e-6],
    drag: 400,
    color: STEEL.soot,
    colorJitter: 0.2,
    grow: 3,
  };
}

/** A thin sheet of droplets running along the face, up (+1) or down (-1) the plate. */
function faceSheet(t: number, origin: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3, up: 1 | -1, count: number): BurstSpec {
  const world = new THREE.Vector3(0, 1, 0);
  const inPlane = world.addScaledVector(normal, -world.dot(normal));
  // A plate lying flat has no vertical on its face: run along the bullet's travel instead.
  if (inPlane.lengthSq() < 1e-6) inPlane.copy(dir).addScaledVector(normal, -dir.dot(normal));
  inPlane.normalize().multiplyScalar(up);
  return {
    look: 'droplet',
    t0: t,
    duration: 30e-6,
    origin: origin.clone().addScaledVector(normal, 0.0008),
    originJitter: 0.002,
    axis: inPlane.addScaledVector(normal, 0.15).normalize(),
    spread: 0.3,
    count: Math.round(count),
    speed: [40, 160],
    size: [0.0005, 0.0012],
    life: [60e-6, 100e-6],
    drag: 100,
    color: STEEL.lead,
    colorJitter: 0.3,
    stretch: 5,
  };
}

/** A thin dark string of debris trailing behind the bullet along the axis, at 0.2-0.8 of its speed, gone in ~100 us. */
function debrisString(t: number, origin: THREE.Vector3, normal: THREE.Vector3, speed: number, count: number): BurstSpec {
  return {
    look: 'grain',
    t0: t,
    duration: 60e-6,
    origin: origin.clone(),
    originJitter: 0.0015,
    axis: normal.clone(),
    spread: 0.12,
    count: Math.round(count),
    speed: [speed * 0.2, speed * 0.8],
    size: [0.0006, 0.0016],
    life: [80e-6, 120e-6],
    drag: 0,
    color: STEEL.soot,
    colorJitter: 0.3,
    stretch: 6,
  };
}

/** Bright plate chips flung sideways off the back face, about 1.3 rad round the normal. */
function sideChips(t: number, origin: THREE.Vector3, normal: THREE.Vector3, count: number, speed: number): BurstSpec {
  return {
    look: 'shard',
    t0: t,
    duration: 40e-6,
    origin: origin.clone(),
    originJitter: 0.003,
    axis: normal.clone(),
    spread: 1.3,
    innerSpread: 0.7,
    count,
    speed: [speed * 0.1, speed * 0.3],
    size: [0.0012, 0.003],
    life: [3e-3, 8e-3],
    drag: 15,
    gravity: 9.8,
    color: STEEL.bright,
    colorJitter: 0.3,
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
