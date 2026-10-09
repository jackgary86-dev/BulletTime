import { pulseLength, rearStress, spallOf } from '../armor/hesh';
import { SLUG_FRACTION, jetPenetration } from '../armor/jet';
import { longRodShot } from '../armor/longRod';
import { getPlateMaterial, type PlateMaterial, type PlateMaterialId } from '../armor/materials';
import { PENETRATOR_DENSITY, REFERENCE, impactState, type SolidImpact } from '../armor/munitions';
import type { MediumSpec } from '../data/media';

/**
 * The Armor lab's models inside the Artillery and Missile simulators (#204).
 * Where a long rod, a shaped-charge jet or a squash head meets metal plate,
 * the engine asks this module what the Armor lab says happens, instead of
 * using its own drag-and-resistance law for that layer:
 *
 * - A long rod (APFSDS dart, a missile's kinetic core) entering a plate runs
 *   the Alekseevskii–Tate model (`longRodShot`) for that plate at its speed and
 *   remaining length: it either gets through with Tate's residual speed and
 *   length, or stops at Tate's depth.
 * - A shaped-charge jet digs by the density law (`jetPenetration`): each plate
 *   takes the jet's speed at a steady rate set by how deep the whole jet would
 *   reach in that metal, so the jet's tip reaches exactly that depth.
 * - A squash head scabs the far face of a plate only when the one-dimensional
 *   stress-wave model (`spallOf`) says the reflected tension beats the metal's
 *   spall strength; the scab leaves at the model's speed.
 *
 * Only metal plate is handled: every other material keeps the engine's own
 * behaviour. Impact physics only, from the round's state at the plate.
 */

/** Which Armor lab plate each metal target medium stands for; media not listed (objects, gongs) keep the engine's law. */
const PLATE_FOR_MEDIUM: Record<string, PlateMaterialId> = {
  rha: 'rha',
  'rha-plate': 'rha',
  'tank-hull': 'rha',
  'turret-roof': 'rha',
  'hull-floor': 'rha',
  // Through-hardened plate: the lab's hardest steel is RHA.
  'steel-ar500': 'rha',
  'ar500-plate': 'rha',
  'steel-mild': 'mild-steel',
  'mild-plate': 'mild-steel',
  'sheet-metal': 'mild-steel',
  'shed-sheet': 'mild-steel',
  'shed-sheet-back': 'mild-steel',
  'cast-iron-plate': 'cast-iron',
  aluminum: 'al-5083',
};

/** The Armor lab plate a medium stands for, or null when the engine's own law applies. */
export function plateMaterialFor(medium: Pick<MediumSpec, 'id'>): PlateMaterial | null {
  const id = PLATE_FOR_MEDIUM[medium.id];
  return id ? getPlateMaterial(id) : null;
}

/** A jet slower than this (m/s) is a slug or a formed penetrator, not a stretching jet: the density law does not apply. */
export const MIN_JET_SPEED_MS = 5000;

/** A rod as the engine knows it at a plate. */
export interface RodState {
  speed: number;
  massKg: number;
  lengthM: number;
}

export interface RodOutcome {
  perforated: boolean;
  /** Depth along the path it reaches, m: the path length through the plate when it gets through. */
  depthM: number;
  residualSpeed: number;
  residualMassKg: number;
  residualLengthM: number;
}

/**
 * The rod as the Armor lab models it: tungsten heavy alloy of the round's mass
 * and remaining length, so its diameter follows from them.
 */
export function rodImpact(rod: RodState): SolidImpact {
  const density = PENETRATOR_DENSITY['tungsten-alloy'];
  const length = Math.max(1e-3, rod.lengthM);
  const diameter = Math.sqrt((4 * rod.massKg) / (Math.PI * density * length));
  return { family: 'apfsds', calibreMm: diameter * 1000, velocity: rod.speed, material: 'tungsten-alloy', density, diameter, length, mass: rod.massKg };
}

/**
 * What a rod does to `pathM` of this plate along its path (the line-of-sight thickness for a sloped plate). `rearRoomM`
 * is the air behind it before another plate along the path: a plate backed closely by another gives the rod almost no
 * free breakout at its rear face, so a stack of plates in contact bores like one solid plate (#325).
 */
export function rodThroughPlate(rod: RodState, material: PlateMaterial, pathM: number, rearRoomM?: number): RodOutcome {
  const { result } = longRodShot({ impact: rodImpact(rod), material, thicknessM: Math.max(1e-4, pathM), obliquityDeg: 0, rearRoomM });
  return {
    perforated: result.perforated,
    depthM: result.perforated ? pathM : result.penetrationM,
    residualSpeed: result.residualVelocity,
    residualMassKg: result.residualMassKg,
    residualLengthM: result.perforated ? (rod.lengthM * result.residualMassKg) / Math.max(1e-9, rod.massKg) : 0,
  };
}

/**
 * The steady deceleration (m/s²) that carries a body from `speed` to `exitSpeed`
 * over `pathM`, or brings it to rest after `depthM` when it does not get through.
 */
export function steadyDecel(speed: number, outcome: { perforated: boolean; depthM: number; exitSpeed: number }, pathM: number): number {
  if (outcome.perforated) return Math.max(0, (speed ** 2 - outcome.exitSpeed ** 2) / (2 * Math.max(1e-6, pathM)));
  return speed ** 2 / (2 * Math.max(1e-6, outcome.depthM));
}

/**
 * The effective length of a shaped-charge jet for a warhead of `calibreMm`, as
 * the Armor lab scales it (`impactState('heat')`, without its 150 mm clamp),
 * times the stand-off factor the warhead data gives.
 */
export function jetLengthFor(calibreMm: number, standoffFactor = 1): number {
  const coneDiameter = (calibreMm / 1000) * REFERENCE.coneToCalibre;
  return ((REFERENCE.jetRhaConeDiameters * coneDiameter) / Math.sqrt(PENETRATOR_DENSITY.copper / REFERENCE.rhaDensity)) * standoffFactor;
}

/** How deep a whole jet of this length digs into a thick plate of this metal, m: the density law on all of it but the slug. */
export function jetReachIn(jetLengthM: number, material: PlateMaterial): number {
  return jetPenetration((1 - SLUG_FRACTION) * jetLengthM, PENETRATOR_DENSITY.copper, material.density);
}

/** The deceleration (m/s²) a plate puts on every piece of a jet whose tip left at `tipSpeed`, so the tip stops at the jet's reach. */
export function jetDecel(tipSpeed: number, jetLengthM: number, material: PlateMaterial): number {
  return tipSpeed ** 2 / (2 * Math.max(1e-6, jetReachIn(jetLengthM, material)));
}

export interface HeshSpall {
  /** Whether the reflected tension tears a scab off the far face. */
  spalls: boolean;
  /** Scab speed, m/s, and thickness, m. */
  speed: number;
  thicknessM: number;
}

/** Whether a squash head of `calibreMm` arriving at `speed` scabs `pathM` of this plate, and how fast the scab leaves. */
export function heshSpall(calibreMm: number, speed: number, material: PlateMaterial, pathM: number): HeshSpall {
  const impact = impactState('hesh', calibreMm, speed) as SolidImpact;
  const spall = spallOf(pulseLength(impact), rearStress(impact, pathM, 0), material, pathM);
  return { spalls: spall.spalls, speed: spall.velocity, thicknessM: spall.thicknessM };
}
