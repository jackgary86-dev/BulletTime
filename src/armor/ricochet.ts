/**
 * Armor lab (#165): ricochet. Sloped armor adds line-of-sight thickness
 * (T / cos θ), and above a critical slope a kinetic round glances off the face
 * instead of biting: it cuts a shallow gouge and leaves at a shallow angle with
 * less speed. Rods bend rather than break; full-bore steel shot on hard plate
 * also shatters.
 *
 * Everything here is an empirical teaching rule, labelled as such in the UI:
 * the critical slopes follow the open rules of thumb (long rods rarely
 * ricochet below about 75-80 degrees, full-bore shot from about 60-70, softer
 * plates raise the threshold), and the exit is a simple restitution-and-
 * friction model of the glancing contact, not a calculation of the contact.
 * Shaped-charge rounds do not ricochet in this sense: past
 * `FUZE_FAIL_OBLIQUITY_DEG` they fail to fuze and skid, which `jet.ts` models.
 * Squash-head rounds stick to the face and never ricochet.
 *
 * The timeline is drawn in the same unfolded cross-section as the other
 * models: the nose digs a shallow scoop at the front face, turns round at its
 * deepest point and backs out of the face, while its tangential speed carries
 * it away (the fragment tracks show where it goes).
 */

import {
  CRATER_PROFILE_SAMPLES,
  MAX_OBLIQUITY_DEG,
  losThickness,
  normalizeShot,
  sampleFrames,
  timelineDuration,
  type ArmorEvent,
  type ArmorFrame,
  type ArmorShot,
  type ArmorTimeline,
} from './model';
import type { PlateMaterial } from './materials';
import type { ImpactState } from './munitions';
import { shatterFragments, shotShatters } from './fullBore';

/** Slope (degrees from the normal) above which a round of each family glances off a 300 HB plate at its default speed. */
export const RICOCHET_BASE_DEG = { 'ap-shot': 65, apfsds: 78 } as const;
/** The hardness the base slopes are for (RHA), Brinell. */
export const RICOCHET_REFERENCE_HB = 300;
/** A plate softer than RHA raises the threshold, up to this many degrees for a plate of no hardness at all. */
export const RICOCHET_SOFT_GAIN_DEG = { 'ap-shot': 8, apfsds: 5 } as const;
/** A faster round bites more: the threshold moves by up to this many degrees across the family's speed range. */
export const RICOCHET_SPEED_GAIN_DEG = { 'ap-shot': 3, apfsds: 2 } as const;
/** The speed at which the speed term is zero, and its half-range, m/s. */
export const RICOCHET_SPEED_REF = { 'ap-shot': { mid: 875, half: 175 }, apfsds: { mid: 1600, half: 200 } } as const;

/** Share of the normal-to-the-plate speed a ricochet keeps, and of the speed along the plate. */
export const RICOCHET_NORMAL_RESTITUTION = 0.3;
export const RICOCHET_TANGENT_RETENTION = 0.8;
/** A shattered shot loses more speed in breaking up. */
export const RICOCHET_SHATTER_RETENTION = 0.85;

/** Depth of the gouge, in calibres, at the critical slope: it shallows to a third of that at the steepest slope. */
export const GOUGE_DEPTH_CALIBRES = 0.3;
export const GOUGE_MIN_FRACTION = 0.3;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

type RicochetFamily = keyof typeof RICOCHET_BASE_DEG;
const isRicochetFamily = (family: string): family is RicochetFamily => family in RICOCHET_BASE_DEG;

/**
 * The slope (degrees from the normal) above which this round ricochets off
 * this plate, or null when the family does not ricochet that way (a
 * shaped-charge round skids instead; a squash head sticks; fragments are not
 * modelled against plate).
 */
export function criticalRicochetDeg(impact: ImpactState, material: PlateMaterial): number | null {
  if (!isRicochetFamily(impact.family)) return null;
  const family = impact.family;
  const soft = clamp((RICOCHET_REFERENCE_HB - material.brinell) / RICOCHET_REFERENCE_HB, 0, 1);
  const { mid, half } = RICOCHET_SPEED_REF[family];
  const fast = clamp((impact.velocity - mid) / half, -1, 1);
  const deg = RICOCHET_BASE_DEG[family] + RICOCHET_SOFT_GAIN_DEG[family] * soft + RICOCHET_SPEED_GAIN_DEG[family] * fast;
  return Math.min(deg, MAX_OBLIQUITY_DEG - 1);
}

/** Whether the shot glances off at its slope: kinetic families only, strictly above the critical slope (so never at 0°). */
export function ricochets(shot: ArmorShot): boolean {
  const critical = criticalRicochetDeg(shot.impact, shot.material);
  return critical !== null && shot.obliquityDeg > critical;
}

export interface RicochetOutcome {
  criticalDeg: number;
  /** Speed the round leaves with, m/s, and its two parts: away from the plate and along it. */
  exitSpeed: number;
  exitNormalSpeed: number;
  exitTangentSpeed: number;
  /** Angle it leaves at, degrees from the plate face. */
  exitAngleDeg: number;
  gougeDepthM: number;
  shattered: boolean;
  fragments: number;
}

/** How a round that glances off leaves: a restitution-and-friction model of the contact. */
export function ricochetOutcome(impact: ImpactState, material: PlateMaterial, obliquityDeg: number): RicochetOutcome {
  const critical = criticalRicochetDeg(impact, material);
  if (critical === null || impact.family === 'heat' || impact.family === 'hesh' || impact.family === 'he-frag') {
    throw new Error(`'${impact.family}' does not ricochet in the armor lab`);
  }
  const theta = (obliquityDeg * Math.PI) / 180;
  const vn0 = impact.velocity * Math.cos(theta);
  const vt0 = impact.velocity * Math.sin(theta);
  const shattered = shotShatters(impact, material, obliquityDeg);
  const keep = shattered ? RICOCHET_SHATTER_RETENTION : 1;
  const exitNormalSpeed = RICOCHET_NORMAL_RESTITUTION * vn0 * keep;
  const exitTangentSpeed = RICOCHET_TANGENT_RETENTION * vt0 * keep;
  // The gouge is deepest just above the critical slope and shallows towards grazing.
  const closeness = clamp(1 - (obliquityDeg - critical) / (MAX_OBLIQUITY_DEG - critical), GOUGE_MIN_FRACTION, 1);
  return {
    criticalDeg: critical,
    exitSpeed: Math.hypot(exitNormalSpeed, exitTangentSpeed),
    exitNormalSpeed,
    exitTangentSpeed,
    exitAngleDeg: (Math.atan2(exitNormalSpeed, exitTangentSpeed) * 180) / Math.PI,
    gougeDepthM: GOUGE_DEPTH_CALIBRES * impact.diameter * closeness,
    shattered,
    fragments: shattered ? shatterFragments(impact.calibreMm) : 0,
  };
}

/** Simulates a kinetic round glancing off the plate. */
export function ricochetShot(input: ArmorShot): ArmorTimeline {
  const shot = normalizeShot(input);
  const { impact, material } = shot;
  if (impact.family === 'heat' || impact.family === 'hesh' || impact.family === 'he-frag') {
    throw new Error(`ricochetShot models kinetic rounds, not '${impact.family}'`);
  }
  const out = ricochetOutcome(impact, material, shot.obliquityDeg);
  const { diameter: D, mass: m, velocity: v0, length } = impact;
  const tLos = losThickness(shot.thicknessM, shot.obliquityDeg);
  const theta = (shot.obliquityDeg * Math.PI) / 180;
  const vn0 = v0 * Math.cos(theta);
  const vt0 = v0 * Math.sin(theta);
  const vn1 = out.exitNormalSpeed;
  const vt1 = out.exitTangentSpeed;
  const d = out.gougeDepthM;

  // The normal speed runs from +vn0 (in) to -vn1 (out) at a steady rate over the contact, tC. The nose turns round at
  // t* = vn0·tC/(vn0 + vn1), at the deepest point d, which fixes tC. It backs out of the face after the contact ends.
  const tC = (2 * d * (vn0 + vn1)) / vn0 ** 2;
  const tTurn = (vn0 * tC) / (vn0 + vn1);
  const travelDuring = (t: number) => vn0 * t - ((vn0 + vn1) * t ** 2) / (2 * tC);
  const travelAtEnd = travelDuring(tC);
  const tOut = tC + travelAtEnd / vn1;
  const travelAt = (t: number) => (t <= tC ? travelDuring(t) : travelAtEnd - vn1 * (t - tC));
  const normalSpeedAt = (t: number) => (t <= tC ? vn0 - ((vn0 + vn1) * t) / tC : -vn1);
  const tangentSpeedAt = (t: number) => (t <= tC ? vt0 - ((vt0 - vt1) * t) / tC : vt1);

  const impactEnergyJ = 0.5 * m * v0 ** 2;
  const residualEnergyJ = 0.5 * m * out.exitSpeed ** 2;
  const plateWorkJ = impactEnergyJ - residualEnergyJ;

  // The gouge is a shallow scoop: wide at the face, tapering to nothing at its deepest point.
  const mouthRadius = Math.max(D / 2, 2 * d);
  const scoopProfile = (depth: number) =>
    Array.from({ length: CRATER_PROFILE_SAMPLES }, (_, i) => (depth > 0 ? mouthRadius * Math.sqrt(Math.max(0, 1 - i / (CRATER_PROFILE_SAMPLES - 1))) * Math.min(1, depth / d) : 0));

  const frameAtTime = (t: number): ArmorFrame => {
    const travel = travelAt(t);
    const depth = Math.min(d, Math.max(0, t < tTurn ? travel : d));
    const vn = normalSpeedAt(t);
    const vt = tangentSpeedAt(t);
    return {
      t,
      depth,
      travel,
      speed: Math.hypot(vn, vt),
      penetrationRate: t < tTurn ? Math.max(0, vn) : 0,
      craterRadius: depth > 0 ? mouthRadius * Math.min(1, depth / d) : 0,
      craterProfile: scoopProfile(depth),
      penetratorLength: length,
      rearBulge: 0,
      energyDepositedJ: plateWorkJ * Math.min(1, t / tC),
    };
  };

  const events: ArmorEvent[] = [{ t: 0, type: 'impact', depth: 0, speed: v0, label: 'Impact' }];
  if (out.shattered) events.push({ t: 0, type: 'shatter', depth: 0, speed: v0, label: 'Shot shatters on the slope' });
  events.push({
    t: tTurn,
    type: 'ricochet',
    depth: d,
    speed: Math.hypot(normalSpeedAt(tTurn), tangentSpeedAt(tTurn)),
    label: `Ricochet: leaves at ${out.exitAngleDeg.toFixed(0)}° to the face`,
  });

  const duration = timelineDuration(tOut);
  return {
    shot,
    frames: sampleFrames(duration, frameAtTime),
    events,
    result: {
      mechanism: 'Ricochet',
      losThicknessM: tLos,
      penetrationM: d,
      perforated: false,
      residualVelocity: 0,
      residualMassKg: 0,
      shattered: out.shattered,
      fragments: out.fragments,
      impactEnergyJ,
      residualEnergyJ,
      energy: { plateWorkJ, ejectaJ: 0 },
      ricochet: { criticalDeg: out.criticalDeg, exitAngleDeg: out.exitAngleDeg, exitSpeed: out.exitSpeed, gougeDepthM: d },
    },
    duration,
  };
}
