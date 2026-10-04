/**
 * Armor lab (#164): a HESH (high-explosive squash-head) round against plate.
 * It does not penetrate. A plastic charge flattens against the face and fires,
 * sending a compressive stress pulse through the plate. At the free rear face
 * the pulse reflects as tension; where the net tension reaches the plate's
 * spall strength a disc, a "scab", tears off the inside face and flies off.
 * It is the classic one-dimensional stress-wave example (see Meyers, "Dynamic
 * Behavior of Materials", ch. 6 on spalling; Zukas, "Impact Dynamics").
 *
 * The pulse is triangular: a sharp front of peak stress σ and a linear decay
 * over the pulse length λ behind it, travelling at the plate's longitudinal
 * sound speed c. Reflecting at the free face, the reflected pulse is the
 * incident one turned over, so at depth d from the rear face (d + c·s < λ,
 * s the time since the front arrived) the net tension is σ·2d/λ. Tension
 * grows with depth until it reaches the spall strength σs, which happens at
 *
 *   x_s = λ·σs / (2σ_rear)
 *
 * so a scab of that thickness tears off, if σ_rear > σs (x_s < λ/2). With
 * the free-surface velocity 2σ_rear/(ρc) less the pull-back that the spall
 * strength costs, 2σs/(ρc), the scab leaves at
 *
 *   v_scab = 2(σ_rear − σs) / (ρc).
 *
 * The scab is about as wide as the contact patch the charge spreads to.
 *
 * How the pulse weakens as it crosses the plate is a lab model: the stress
 * reaching the rear is the contact pressure σ0 (set by the explosive, not
 * the shell's size) divided by 1 + (path / decay length)², where the decay
 * length is `DECAY_PATCH_RADII` contact-patch radii, so it scales with the
 * calibre. The pulse length also scales with calibre. A slope spreads the
 * patch (so a wider scab), lowers the normal stress by cos θ and lengthens the
 * path the pulse has to cross to the line-of-sight thickness.
 *
 * Impact physics only. All values are a simplified teaching model, not
 * engineering data.
 */

import {
  MAX_TIMELINE_FRAMES,
  TIMELINE_FRAMES,
  losThickness,
  normalizeShot,
  sampleFrames,
  timelineDuration,
  type ArmorEjecta,
  type ArmorEvent,
  type ArmorFrame,
  type ArmorShot,
  type ArmorTimeline,
} from './model';
import type { PlateMaterial } from './materials';
import type { SolidImpact } from './munitions';

/** Steepest plate slope (degrees) the HESH model handles; steeper shots are clamped to it. */
export const HESH_MAX_OBLIQUITY_DEG = 70;

/** Peak stress the flattened charge puts into the face, Pa (illustrative lab value, set by the explosive and not by the calibre). */
export const HESH_CONTACT_PRESSURE_PA = 8e9;
/** Pulse length (m) as a multiple of the calibre. */
export const PULSE_LENGTH_RATIO = 0.25;
/** The flattened charge's contact patch is this many calibres wide. */
export const PATCH_DIAMETER_RATIO = 1;
/** The pulse falls to half its contact stress after crossing this many patch radii... when 1 + (x / (this · a))² = 2, so x equals this. */
export const DECAY_PATCH_RADII = 2.5;
/** How long (s) the timeline follows a scab after it tears off, at most. */
const MAX_SCAB_FLIGHT_S = 3e-3;

/** Contact patch radius, m: the charge flattens to about a calibre across. */
export function patchRadius(impact: SolidImpact): number {
  return (PATCH_DIAMETER_RATIO * impact.diameter) / 2;
}

/** Pulse length λ, m. */
export function pulseLength(impact: SolidImpact): number {
  return PULSE_LENGTH_RATIO * impact.diameter;
}

/** Stress reaching the rear face, Pa, after the pulse has crossed `pathM` of plate at `obliquityDeg` from the normal. */
export function rearStress(impact: SolidImpact, pathM: number, obliquityDeg: number): number {
  const decayLength = DECAY_PATCH_RADII * patchRadius(impact);
  const cosTheta = Math.cos((obliquityDeg * Math.PI) / 180);
  return (HESH_CONTACT_PRESSURE_PA * cosTheta) / (1 + (pathM / decayLength) ** 2);
}

export interface Spall {
  /** Stress reaching the rear face, Pa. */
  rearStressPa: number;
  /** Whether the reflected tension reaches the spall strength. */
  spalls: boolean;
  /** Scab thickness, m (0 when there is no spall), at most the plate's own thickness. */
  thicknessM: number;
  /** Scab speed, m/s (0 when there is no spall). */
  velocity: number;
}

/** The spall for a pulse of length λ (m) and rear-face stress σ against a material (x_s = λσs / 2σ). */
export function spallOf(lambdaM: number, rearStressPa: number, material: PlateMaterial, losThicknessM: number): Spall {
  const spalls = rearStressPa > material.spallStrengthPa;
  if (!spalls) return { rearStressPa, spalls, thicknessM: 0, velocity: 0 };
  const xs = (lambdaM * material.spallStrengthPa) / (2 * rearStressPa);
  return {
    rearStressPa,
    spalls,
    thicknessM: Math.min(xs, losThicknessM),
    velocity: (2 * (rearStressPa - material.spallStrengthPa)) / (material.density * material.soundSpeed),
  };
}

/**
 * The thickest plate (normal thickness, m) of this material the round can still spall at this slope, from
 * σ_rear = σs. 0 when even a very thin plate would not spall.
 */
export function maxSpallThickness(impact: SolidImpact, material: PlateMaterial, obliquityDeg = 0): number {
  const cosTheta = Math.cos((obliquityDeg * Math.PI) / 180);
  const ratio = (HESH_CONTACT_PRESSURE_PA * cosTheta) / material.spallStrengthPa;
  if (ratio <= 1) return 0;
  const pathM = DECAY_PATCH_RADII * patchRadius(impact) * Math.sqrt(ratio - 1);
  return pathM * cosTheta;
}

/**
 * Net stress (Pa, compression positive) at depth d (m) from the rear face, a time s (s) after the front reached
 * it: the incident triangular pulse (stress σ at its front, falling linearly to zero over λ) less its
 * reflection, which has travelled c·s into the plate. Negative values are tension.
 */
export function netStress(d: number, s: number, sigmaPa: number, lambdaM: number, soundSpeed: number): number {
  const pulse = (b: number) => (b >= 0 && b <= lambdaM ? sigmaPa * (1 - b / lambdaM) : 0);
  const reach = soundSpeed * s;
  // Before the pulse has reflected (s < 0) there is only the incident wave, which has not yet reached d from the rear.
  if (s < 0) return pulse(-reach - d);
  return pulse(d + reach) - pulse(reach - d);
}

/** Simulates a HESH round against the plate. */
export function heshShot(input: ArmorShot): ArmorTimeline {
  const shot = normalizeShot(input, HESH_MAX_OBLIQUITY_DEG);
  const { impact, material } = shot;
  if (impact.family !== 'hesh') throw new Error(`heshShot models squash-head rounds, not '${impact.family}'`);

  const { mass, velocity: v0 } = impact;
  const tLos = losThickness(shot.thicknessM, shot.obliquityDeg);
  const c = material.soundSpeed;
  const lambda = pulseLength(impact);
  const sigmaRear = rearStress(impact, tLos, shot.obliquityDeg);
  const spall = spallOf(lambda, sigmaRear, material, tLos);
  const patch = patchRadius(impact) / Math.cos((shot.obliquityDeg * Math.PI) / 180);
  const impactEnergyJ = 0.5 * mass * v0 ** 2;

  const tArrive = tLos / c;
  const tau = lambda / c;
  const tSpall = tArrive + (spall.spalls ? spall.thicknessM / c : 0);

  // The scab is a disc about as wide as the contact patch.
  let scab: ArmorEjecta | undefined;
  let ejectaJ = 0;
  if (spall.spalls) {
    const massKg = material.density * Math.PI * patch ** 2 * spall.thicknessM;
    scab = { massKg, velocity: spall.velocity, thicknessM: spall.thicknessM, diameterM: 2 * patch };
    ejectaJ = 0.5 * massKg * spall.velocity ** 2;
  }
  const plateWorkJ = impactEnergyJ - ejectaJ;

  // The largest tension in the plate a time s after the front reached the rear face, and where it is.
  const peakTension = (s: number): { pa: number; depthM: number } => {
    let pa = 0;
    let depthM = 0;
    const samples = 96;
    for (let i = 0; i <= samples; i++) {
      const d = (tLos * i) / samples;
      const tension = -netStress(d, s, sigmaRear, lambda, c);
      if (tension > pa) {
        pa = tension;
        depthM = d;
      }
    }
    return { pa, depthM };
  };

  // How long to follow it: until the scab has flown a while, or the pulse has passed the whole plate.
  const flightS = spall.spalls ? Math.min(MAX_SCAB_FLIGHT_S, patch / spall.velocity) : 0;
  const endTime = spall.spalls ? tSpall + flightS : tArrive + 2 * Math.max(tau, tLos / c);
  const duration = timelineDuration(endTime);

  const frameAtTime = (t: number): ArmorFrame => {
    const s = t - tArrive;
    const reflected = s >= 0;
    const waveFrontM = Math.min(tLos, c * t);
    const tension = reflected ? peakTension(s) : { pa: 0, depthM: 0 };
    const scabOffset = spall.spalls && t > tSpall ? spall.velocity * (t - tSpall) : 0;
    return {
      t,
      depth: 0,
      travel: 0,
      speed: 0,
      penetrationRate: 0,
      // The charge flattens into its contact patch while the pulse is being driven in.
      craterRadius: patch * Math.min(1, t / tau),
      penetratorLength: 0,
      rearBulge: scabOffset,
      energyDepositedJ: plateWorkJ * Math.min(1, t / Math.max(tau, 1e-12)),
      waveFrontM,
      reflectedFrontM: reflected ? Math.max(0, tLos - c * s) : tLos,
      peakTensionPa: tension.pa,
      tensionDepthM: tension.depthM,
    };
  };

  const events: ArmorEvent[] = [
    { t: 0, type: 'impact', depth: 0, speed: v0, label: 'Charge flattens on the face and fires' },
    { t: tArrive, type: 'reflect', depth: tLos, speed: 0, label: 'Pulse reaches the rear face and reflects as tension' },
  ];
  if (spall.spalls) events.push({ t: tSpall, type: 'spall', depth: tLos - spall.thicknessM, speed: spall.velocity, label: 'Scab torn off the rear face' });
  else events.push({ t: tArrive + tau, type: 'stop', depth: 0, speed: 0, label: 'Tension stays below the spall strength: the plate holds' });

  // A scab flies off at a few tens of m/s, much slower than the stress wave, so the wave's events sit in the first
  // few microseconds of a long timeline. Sample more frames then, up to the cap, so they stay visible.
  const frameCount = Math.min(MAX_TIMELINE_FRAMES, Math.max(TIMELINE_FRAMES, Math.ceil((TIMELINE_FRAMES * duration) / timelineDuration(tSpall))));
  return {
    shot,
    frames: sampleFrames(duration, frameAtTime, frameCount),
    events,
    result: {
      mechanism: spall.spalls ? 'Spalling' : 'Surface damage',
      losThicknessM: tLos,
      penetrationM: 0,
      perforated: false,
      residualVelocity: 0,
      residualMassKg: 0,
      scab,
      shattered: false,
      fragments: 0,
      impactEnergyJ,
      residualEnergyJ: 0,
      energy: { plateWorkJ, ejectaJ },
    },
    duration,
  };
}
