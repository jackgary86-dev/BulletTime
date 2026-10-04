/**
 * Armor lab (#157): the shared shape of an armor-lab simulation. Every
 * penetration model (full-bore shot #161, long rod #162, shaped-charge jet
 * #163, squash head #164, ricochet and fragments #165) takes an `ArmorShot`
 * and returns an `ArmorTimeline`: frames sampled over time for playback, the
 * key events with captions, and a summary result. The fields (#166), renderer
 * (#167) and results UI (#168) read only this shape, never a model's insides.
 * `simulate.ts` picks the model for a projectile family.
 *
 * Impact physics only: a shot is the projectile's state at the plate (from
 * `munitions.ts`) plus the plate's material, thickness and slope. Every number
 * is a simplified teaching model.
 *
 * This module holds only types and helpers and imports no model, so the
 * models can import it freely.
 */

import type { PlateMaterial } from './materials';
import type { ImpactState } from './munitions';

/**
 * Plate slopes the lab offers, degrees from the plate normal. Each model
 * clamps a shot to the part of this range it models (see `normalizeShot`).
 */
export const MIN_OBLIQUITY_DEG = 0;
export const MAX_OBLIQUITY_DEG = 85;

/** Every timeline has at least this many evenly spaced frames. */
export const TIMELINE_FRAMES = 160;
/**
 * No timeline has more frames than this. A model may sample more than
 * `TIMELINE_FRAMES` to keep a short phase visible inside a long playback.
 */
export const MAX_TIMELINE_FRAMES = 4000;
/** After the last event, playback runs on for this fraction of its time... */
export const TIMELINE_TAIL_FRACTION = 0.2;
/** ...or this long (s), whichever is longer. */
export const TIMELINE_MIN_TAIL_S = 30e-6;

/** Number of samples in a frame's `craterProfile`. */
export const CRATER_PROFILE_SAMPLES = 16;

export interface ArmorShot {
  /** The projectile (or jet) as it reaches the plate. */
  impact: ImpactState;
  material: PlateMaterial;
  /** Plate thickness normal to its face, m. */
  thicknessM: number;
  /** Plate slope, degrees from the normal (0 = square-on), 0 to `MAX_OBLIQUITY_DEG`; each model clamps it to the range it models. */
  obliquityDeg: number;
}

/** The state of the impact at one instant. Lengths in metres, speeds in m/s. */
export interface ArmorFrame {
  /** Time since impact, s. */
  t: number;
  /** Crater depth along the shot line, m (at most the line-of-sight thickness). */
  depth: number;
  /**
   * How far the penetrator's nose has moved along the shot line since impact,
   * m. Equal to `depth` while it is in the plate; after perforation it keeps
   * growing as the penetrator flies on behind the plate.
   */
  travel: number;
  /**
   * Speed of the penetrator body, m/s: a solid shot's speed, an eroding rod's
   * tail speed (Tate's v), or for a jet the speed of the element now arriving.
   * After perforation, its speed behind the plate.
   */
  speed: number;
  /**
   * Speed of the crater bottom, d(depth)/dt, m/s (Tate's u): equal to `speed`
   * for a rigid shot while it digs, lower for an eroding rod or a jet, and 0
   * once the penetrator has stopped or left the plate.
   */
  penetrationRate: number;
  /** Crater radius at its mouth on the plate face, m. */
  craterRadius: number;
  /**
   * Crater radius, m, at `CRATER_PROFILE_SAMPLES` evenly spaced depths along
   * the shot line, from the plate face (index 0) to `depth` (last index). When
   * a model leaves it out, draw a cylinder of `craterRadius` with a rounded
   * bottom.
   */
  craterProfile?: number[];
  /** Remaining penetrator length, m (constant for a solid shot, shrinking for an eroding rod or jet). */
  penetratorLength: number;
  /** Height of the bulge pushed out of the rear face, m. */
  rearBulge: number;
  /**
   * Energy the impact has deposited so far, J (cumulative): the plastic and
   * shear work done, most of which ends up as heat. It ends at the result's
   * `energy.plateWorkJ`.
   */
  energyDepositedJ: number;
  /**
   * Stress-wave models (HESH): how far the compressive front has travelled
   * along the shot line from the plate face, m (it stops at the line-of-sight
   * thickness when it reaches the rear face).
   */
  waveFrontM?: number;
  /** The reflected (tension) front's distance from the plate face, m: the line-of-sight thickness until the pulse reflects, then falling toward 0. */
  reflectedFrontM?: number;
  /** The largest tension in the plate at this instant, Pa (0 before the pulse reflects). */
  peakTensionPa?: number;
  /** Where that tension is, measured from the rear face, m. */
  tensionDepthM?: number;
}

/** Event kinds. Later models extend this union with their own. */
export type ArmorEventType = 'impact' | 'shatter' | 'plug' | 'perforate' | 'stop' | 'skid' | 'reflect' | 'spall';

export interface ArmorEvent {
  /** Time since impact, s. */
  t: number;
  type: ArmorEventType;
  /** Crater depth along the shot line when it happens, m. */
  depth: number;
  /** Penetrator speed when it happens, m/s. */
  speed: number;
  /** A short caption for playback, like "Plug sheared". */
  label: string;
}

/** How the plate was defeated (or not). Later models extend this union with their own. */
export type ArmorMechanism = 'Plugging' | 'Plastic penetration' | 'Hydrodynamic erosion' | 'Jet penetration' | 'Spalling' | 'Surface damage';

/** A piece of plate thrown out of the rear face (a plug, or later a scab). */
export interface ArmorEjecta {
  massKg: number;
  /** Speed along the shot line, m/s. */
  velocity: number;
  /** Thickness along the shot line, m. */
  thicknessM: number;
  diameterM: number;
}

/** What sprays out behind a perforated plate (a jet's debris cone). */
export interface ArmorDebris {
  /** Half-angle of the cone, degrees. */
  halfAngleDeg: number;
  /** Jet particles: total mass (kg) and the speed they leave at (m/s). */
  jetParticles: { massKg: number; velocity: number };
  /** Plate material knocked off the rear face: total mass (kg) and speed (m/s). */
  spall: { massKg: number; velocity: number };
}

/**
 * Where the impact energy went, J. Together with the result's
 * `residualEnergyJ` these terms add up to its `impactEnergyJ`.
 */
export interface ArmorEnergy {
  /** Plastic and shear work done in the impact, most of which ends up as heat (for a shattered shot, also the work of breaking it up). */
  plateWorkJ: number;
  /** Kinetic energy of the plate material thrown out behind the plate (plug, scab or debris). */
  ejectaJ: number;
}

export interface ArmorResult {
  /** How the plate was defeated (or not). Whether the penetrator shattered is reported separately, in `shattered`. */
  mechanism: ArmorMechanism;
  /** Plate thickness along the shot line, m. */
  losThicknessM: number;
  /** Path depth the penetrator reached along the shot line, m (the line-of-sight thickness when perforated). */
  penetrationM: number;
  perforated: boolean;
  /** Penetrator speed behind the plate, m/s (0 when stopped). */
  residualVelocity: number;
  /** Penetrator mass that gets through the plate, kg (0 when stopped). */
  residualMassKg: number;
  /** The plug sheared out of the plate, when there is one. */
  plug?: ArmorEjecta;
  /** The debris cone behind a perforated plate, for a jet. */
  debris?: ArmorDebris;
  /** The scab torn off the rear face by a stress wave (HESH), when there is one. */
  scab?: ArmorEjecta;
  /** A shaped-charge round that hit too steeply to fuze and skidded off. */
  failedToFuze?: boolean;
  /** Whether the penetrator broke up on the plate. */
  shattered: boolean;
  /** How many pieces it broke into (0 when intact). */
  fragments: number;
  /** Penetrator kinetic energy at impact, J. */
  impactEnergyJ: number;
  /** Penetrator kinetic energy behind the plate, J (the plug's is in `energy.ejectaJ`). */
  residualEnergyJ: number;
  /** Where the rest of the impact energy went. */
  energy: ArmorEnergy;
}

export interface ArmorTimeline {
  /** The shot as simulated (obliquity clamped to the range this model handles). */
  shot: ArmorShot;
  /** Evenly spaced from t = 0 (impact) to `duration`: at least `TIMELINE_FRAMES`, at most `MAX_TIMELINE_FRAMES`. */
  frames: ArmorFrame[];
  /** In time order, starting with the impact. */
  events: ArmorEvent[];
  result: ArmorResult;
  /** Playback length, s. */
  duration: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Line-of-sight thickness, m: the path through a plate of normal thickness
 * `thicknessM` sloped at `obliquityDeg`, T / cos θ. Pure geometry; the slope
 * is only clamped to the lab's 0 to `MAX_OBLIQUITY_DEG` so it stays finite.
 */
export function losThickness(thicknessM: number, obliquityDeg: number): number {
  const theta = (clamp(obliquityDeg, MIN_OBLIQUITY_DEG, MAX_OBLIQUITY_DEG) * Math.PI) / 180;
  return thicknessM / Math.cos(theta);
}

/**
 * Checks a shot and returns a copy with its obliquity clamped to the range a
 * model handles: 0 to `maxObliquityDeg` (at most the lab's `MAX_OBLIQUITY_DEG`).
 */
export function normalizeShot(shot: ArmorShot, maxObliquityDeg = MAX_OBLIQUITY_DEG): ArmorShot {
  if (!(Number.isFinite(shot.thicknessM) && shot.thicknessM > 0)) throw new Error(`Plate thickness must be a positive number of metres, got ${shot.thicknessM}`);
  if (!Number.isFinite(shot.obliquityDeg)) throw new Error(`Obliquity must be a number of degrees, got ${shot.obliquityDeg}`);
  return { ...shot, obliquityDeg: clamp(shot.obliquityDeg, MIN_OBLIQUITY_DEG, Math.min(maxObliquityDeg, MAX_OBLIQUITY_DEG)) };
}

/** Playback length for a timeline whose last event happens at `endTime` (s): the event plus a short tail. */
export function timelineDuration(endTime: number): number {
  return endTime + Math.max(TIMELINE_TAIL_FRACTION * endTime, TIMELINE_MIN_TAIL_S);
}

/** Samples `frameAtTime` at `count` evenly spaced times from 0 to `duration` inclusive. */
export function sampleFrames(duration: number, frameAtTime: (t: number) => ArmorFrame, count = TIMELINE_FRAMES): ArmorFrame[] {
  const n = Math.max(2, Math.round(count));
  const frames: ArmorFrame[] = [];
  for (let i = 0; i < n; i++) frames.push(frameAtTime((duration * i) / (n - 1)));
  return frames;
}

const isNumberArray = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number');

/** A copy of a frame that shares no arrays with it. */
function copyFrame(frame: ArmorFrame): ArmorFrame {
  const out: Record<string, unknown> = { ...frame };
  for (const [key, value] of Object.entries(frame)) if (Array.isArray(value)) out[key] = [...value];
  return out as unknown as ArmorFrame;
}

/**
 * Mixes two frames a fraction `f` of the way from `a` to `b`, field by field:
 * every number, and every pair of equal-length number arrays element by
 * element, so fields later models add are interpolated too. Anything else is
 * taken from the nearer frame.
 */
function mixFrames(a: ArmorFrame, b: ArmorFrame, f: number, t: number): ArmorFrame {
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  const nearer = f < 0.5 ? ra : rb;
  const out: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    const x = ra[key];
    const y = rb[key];
    if (typeof x === 'number' && typeof y === 'number') out[key] = x + (y - x) * f;
    else if (isNumberArray(x) && isNumberArray(y) && x.length === y.length) out[key] = x.map((xi, i) => xi + (y[i] - xi) * f);
    else {
      const value = nearer[key];
      if (value !== undefined) out[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  out.t = t;
  return out as unknown as ArmorFrame;
}

/**
 * The frame at time `t` (s) for playback: linear interpolation between the two
 * nearest frames, clamped to the first and last frame.
 */
export function frameAt(timeline: ArmorTimeline, t: number): ArmorFrame {
  const { frames } = timeline;
  if (frames.length === 0) throw new Error('Timeline has no frames');
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (!(t > first.t)) return copyFrame(first);
  if (t >= last.t) return copyFrame(last);
  // Binary search for the last frame at or before t.
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[hi];
  return mixFrames(a, b, b.t > a.t ? (t - a.t) / (b.t - a.t) : 0, t);
}
