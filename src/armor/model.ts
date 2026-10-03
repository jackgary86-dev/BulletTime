/**
 * Armor lab (#157): the shared shape of an armor-lab simulation. Every
 * penetration model (full-bore shot #161, long rod #162, shaped-charge jet
 * #163, squash head #164, ricochet and fragments #165) takes an `ArmorShot`
 * and returns an `ArmorTimeline`: frames sampled over time for playback, the
 * key events with captions, and a summary result. The fields (#166), renderer
 * (#167) and results UI (#168) read only this shape, never a model's insides.
 *
 * Impact physics only: a shot is the projectile's state at the plate (from
 * `munitions.ts`) plus the plate's material, thickness and slope. Every number
 * is a simplified teaching model.
 *
 * The model files import helpers from here and `simulateArmor` imports the
 * models, so this module and the models form an import cycle. That is safe
 * because only function declarations (hoisted) cross it: keep it that way, and
 * never read one of this module's constants at a model's top level.
 */

import { fullBoreShot } from './fullBore';
import type { PlateMaterial } from './materials';
import type { ImpactState } from './munitions';

/** Plate slopes the lab models, degrees from the plate normal. */
export const MIN_OBLIQUITY_DEG = 0;
export const MAX_OBLIQUITY_DEG = 75;

/** Every timeline has at least this many evenly spaced frames. */
export const TIMELINE_FRAMES = 160;
/** After the last event, playback runs on for this fraction of its time... */
export const TIMELINE_TAIL_FRACTION = 0.2;
/** ...or this long (s), whichever is longer. */
export const TIMELINE_MIN_TAIL_S = 30e-6;

export interface ArmorShot {
  /** The projectile (or jet) as it reaches the plate. */
  impact: ImpactState;
  material: PlateMaterial;
  /** Plate thickness normal to its face, m. */
  thicknessM: number;
  /** Plate slope, degrees from the normal (0 = square-on), 0–75. */
  obliquityDeg: number;
}

/** The state of the impact at one instant. Lengths in metres, speeds in m/s. */
export interface ArmorFrame {
  /** Time since impact, s. */
  t: number;
  /** Crater depth along the shot line, m (at most the line-of-sight thickness). */
  depth: number;
  /** Penetrator speed, m/s (after perforation, its speed behind the plate). */
  speed: number;
  /** Crater radius at its mouth on the plate face, m. */
  craterRadius: number;
  /** Remaining penetrator length, m (constant for a solid shot, shrinking for an eroding rod or jet). */
  penetratorLength: number;
  /** Height of the bulge pushed out of the rear face, m. */
  rearBulge: number;
}

/** Event kinds. Later models extend this union with their own. */
export type ArmorEventType = 'impact' | 'shatter' | 'plug' | 'perforate' | 'stop';

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

export interface ArmorResult {
  /** How the plate was defeated (or not), e.g. 'Plugging' or 'Plastic penetration'. */
  mechanism: string;
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
  plug?: { massKg: number; velocity: number; thicknessM: number; diameterM: number };
  /** Whether the penetrator broke up on the plate. */
  shattered: boolean;
  /** How many pieces it broke into (0 when intact). */
  fragments: number;
  /** Penetrator kinetic energy at impact, J. */
  impactEnergyJ: number;
  /** Penetrator kinetic energy behind the plate, J (the plug's is not included). */
  residualEnergyJ: number;
}

export interface ArmorTimeline {
  /** The shot as simulated (obliquity clamped to the modelled range). */
  shot: ArmorShot;
  /** Evenly spaced from t = 0 (impact) to `duration`. */
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
 * `thicknessM` sloped at `obliquityDeg` (clamped to 0–75°), T / cos θ.
 */
export function losThickness(thicknessM: number, obliquityDeg: number): number {
  const theta = (clamp(obliquityDeg, MIN_OBLIQUITY_DEG, MAX_OBLIQUITY_DEG) * Math.PI) / 180;
  return thicknessM / Math.cos(theta);
}

/** Checks a shot and returns a copy with its obliquity clamped to the modelled range. */
export function normalizeShot(shot: ArmorShot): ArmorShot {
  if (!(Number.isFinite(shot.thicknessM) && shot.thicknessM > 0)) throw new Error(`Plate thickness must be a positive number of metres, got ${shot.thicknessM}`);
  if (!Number.isFinite(shot.obliquityDeg)) throw new Error(`Obliquity must be a number of degrees, got ${shot.obliquityDeg}`);
  return { ...shot, obliquityDeg: clamp(shot.obliquityDeg, MIN_OBLIQUITY_DEG, MAX_OBLIQUITY_DEG) };
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

/**
 * The frame at time `t` (s) for playback: linear interpolation between the two
 * nearest frames, clamped to the first and last frame.
 */
export function frameAt(timeline: ArmorTimeline, t: number): ArmorFrame {
  const { frames } = timeline;
  if (frames.length === 0) throw new Error('Timeline has no frames');
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (!(t > first.t)) return { ...first };
  if (t >= last.t) return { ...last };
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
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  const mix = (x: number, y: number) => x + (y - x) * f;
  return {
    t,
    depth: mix(a.depth, b.depth),
    speed: mix(a.speed, b.speed),
    craterRadius: mix(a.craterRadius, b.craterRadius),
    penetratorLength: mix(a.penetratorLength, b.penetratorLength),
    rearBulge: mix(a.rearBulge, b.rearBulge),
  };
}

/** Runs the model for the shot's projectile family. */
export function simulateArmor(shot: ArmorShot): ArmorTimeline {
  const family = shot.impact.family;
  switch (family) {
    case 'ap-shot':
      return fullBoreShot(shot);
    default:
      throw new Error(`The armor lab does not model '${family}' against plate yet`);
  }
}
