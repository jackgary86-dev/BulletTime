/**
 * Armor lab (#161): full-bore AP shot against plate. A solid steel shot as
 * wide as the bore pushes into the plate, deforming it plastically round the
 * nose; if the plate is thin enough it shears out a plug and punches through.
 *
 * Three classical open-literature models, simplified for teaching:
 * - De Marre's ballistic-limit formula (1886), v_bl = K · D^0.75 · T^0.7 / m^0.5,
 *   solved for the RHA thickness the shot gets through at a given speed (see
 *   Backman & Goldsmith's 1978 review "The mechanics of penetration of
 *   projectiles into targets", and Zukas, "Impact Dynamics").
 * - Constant-force deceleration in the plate: v² falls linearly with depth.
 * - Recht & Ipson's (1963) momentum-sharing plugging model: once the plate
 *   ahead of the nose is thin enough, a plug shears out and shot and plug
 *   share the shot's momentum.
 *
 * Impact physics only: the shot is its state at the plate (from `munitions.ts`).
 * All values are a simplified teaching model, not engineering data.
 */

import { normalizeShot, losThickness, sampleFrames, timelineDuration, type ArmorEvent, type ArmorFrame, type ArmorShot, type ArmorTimeline } from './model';
import type { PlateMaterial } from './materials';
import type { SolidImpact } from './munitions';

/**
 * De Marre constant in SI units (v m/s, D m, T m, m kg). Fitted to the
 * historical figure of an 88 mm, ~10 kg shot at 1,000 m/s getting through
 * about 165 mm of RHA square-on; a teaching approximation.
 */
export const DE_MARRE_K = 70_000;
/** De Marre exponents on calibre, plate thickness and shot mass. */
export const DE_MARRE_DIAMETER_EXP = 0.75;
export const DE_MARRE_THICKNESS_EXP = 0.7;
export const DE_MARRE_MASS_EXP = 0.5;

/** A plug shears out when the plate left ahead of the nose is this many calibres thick. */
export const PLUG_RATIO = 0.7;
/** Plug (and hole) diameter as a multiple of the shot diameter: the shear ring is a little wider than the shot. */
export const PLUG_DIAMETER_RATIO = 1.05;

/** The rear face starts to bulge when the plate left ahead of the nose is under this many calibres. */
export const REAR_BULGE_ONSET_RATIO = 1.5;
/** Bulge height per metre the remaining plate is under the onset thickness. */
export const REAR_BULGE_GAIN = 0.25;

/** Steel shot hitting a hard plate above this slope (degrees) partly shatters. */
export const SHATTER_OBLIQUITY_DEG = 55;
/** A plate this hard (Brinell, HB) or harder can shatter steel shot: RHA, not the softer plates. */
export const SHATTER_HARDNESS_HB = 250;
/** A partly shattered shot only gets this fraction of its intact penetration. */
export const SHATTER_FACTOR = 0.75;

/** De Marre ballistic limit, m/s: the speed a shot of diameter D (m) and mass m (kg) needs to get through T (m) of RHA square-on. */
export function deMarreBallisticLimit(diameterM: number, thicknessM: number, massKg: number): number {
  return (DE_MARRE_K * diameterM ** DE_MARRE_DIAMETER_EXP * thicknessM ** DE_MARRE_THICKNESS_EXP) / massKg ** DE_MARRE_MASS_EXP;
}

/**
 * De Marre solved for thickness, m: the RHA a shot of diameter D (m) and mass
 * m (kg) at `velocity` (m/s) gets through square-on,
 * P = (v · m^0.5 / (K · D^0.75))^(1/0.7).
 */
export function deMarreRhaPenetration(diameterM: number, massKg: number, velocity: number): number {
  return ((velocity * massKg ** DE_MARRE_MASS_EXP) / (DE_MARRE_K * diameterM ** DE_MARRE_DIAMETER_EXP)) ** (1 / DE_MARRE_THICKNESS_EXP);
}

/** How many pieces a shattered shot breaks into. */
export function shatterFragments(calibreMm: number): number {
  return 8 + Math.round(calibreMm / 15);
}

/** Whether steel shot partly shatters on this plate at this slope (degrees). */
export function shotShatters(impact: SolidImpact, material: PlateMaterial, obliquityDeg: number): boolean {
  return impact.material === 'steel' && material.brinell >= SHATTER_HARDNESS_HB && obliquityDeg > SHATTER_OBLIQUITY_DEG;
}

export interface FullBorePenetration {
  /** De Marre RHA thickness at 0°, m. */
  rhaM: number;
  /** Path length the shot can push along its line in this material at this slope, m. */
  pathM: number;
  shattered: boolean;
  fragments: number;
}

/**
 * How far the shot can push along its line into this material at this slope:
 * the De Marre RHA figure divided by the material's RHA thickness factor, cut
 * by `SHATTER_FACTOR` if the shot shatters.
 */
export function fullBorePenetration(impact: SolidImpact, material: PlateMaterial, obliquityDeg: number): FullBorePenetration {
  const rhaM = deMarreRhaPenetration(impact.diameter, impact.mass, impact.velocity);
  const shattered = shotShatters(impact, material, obliquityDeg);
  const pathM = (rhaM / material.rhaThicknessFactor) * (shattered ? SHATTER_FACTOR : 1);
  return { rhaM, pathM, shattered, fragments: shattered ? shatterFragments(impact.calibreMm) : 0 };
}

/** Simulates a full-bore AP shot against the plate. */
export function fullBoreShot(input: ArmorShot): ArmorTimeline {
  const shot = normalizeShot(input);
  const { impact, material } = shot;
  if (impact.family !== 'ap-shot') throw new Error(`fullBoreShot models full-bore AP shot, not '${impact.family}'`);

  const { diameter: D, mass: m, velocity: v0, length } = impact;
  const tLos = losThickness(shot.thicknessM, shot.obliquityDeg);
  const { pathM: P, shattered, fragments } = fullBorePenetration(impact, material, shot.obliquityDeg);

  // The plug starts once the plate left ahead of the nose is PLUG_RATIO calibres thick.
  const xPlug = Math.max(0, tLos - PLUG_RATIO * D);
  const perforated = P > xPlug;

  // Penetration phase: constant retarding force, so v² = v0²(1 − x/P) and the shot stops at P after 2P/v0.
  const tStop = (2 * P) / v0;
  const penDepth = (t: number) => P * (1 - (1 - (v0 * t) / (2 * P)) ** 2);
  const penSpeed = (t: number) => v0 * (1 - (v0 * t) / (2 * P));
  const timeToDepth = (x: number) => tStop * (1 - Math.sqrt(1 - x / P));

  // Plugging: shot and plug share the shot's momentum (Recht–Ipson).
  const holeRadius = (PLUG_DIAMETER_RATIO * D) / 2;
  let plug: { massKg: number; velocity: number; thicknessM: number; diameterM: number } | undefined;
  let tPlug = Infinity;
  let tExit = Infinity;
  let vPlug = 0;
  let vResidual = 0;
  if (perforated) {
    tPlug = timeToDepth(xPlug);
    vPlug = v0 * Math.sqrt(1 - xPlug / P);
    const thicknessM = tLos - xPlug;
    const massKg = material.density * Math.PI * holeRadius ** 2 * thicknessM;
    vResidual = (vPlug * m) / (m + massKg);
    plug = { massKg, velocity: vResidual, thicknessM, diameterM: 2 * holeRadius };
    tExit = tPlug + thicknessM / vResidual;
  }
  const endTime = perforated ? tExit : tStop;

  // Rear-face bulge: grows once the plate ahead of the nose is under 1.5 calibres; frozen once the plug shears.
  const rearBulge = (depth: number) => {
    const remaining = tLos - (perforated ? Math.min(depth, xPlug) : depth);
    return REAR_BULGE_GAIN * Math.max(0, REAR_BULGE_ONSET_RATIO * D - remaining);
  };
  // The hole mouth opens over the first nose radius of depth, as a round nose would, to the plug diameter.
  const craterRadius = (depth: number) => (depth >= holeRadius ? holeRadius : Math.sqrt(depth * (2 * holeRadius - depth)));

  const frameAtTime = (t: number): ArmorFrame => {
    let depth: number;
    let speed: number;
    if (perforated && t >= tPlug) {
      depth = Math.min(tLos, xPlug + vResidual * (t - tPlug));
      speed = vResidual;
    } else if (!perforated && t >= tStop) {
      depth = P;
      speed = 0;
    } else {
      depth = penDepth(t);
      speed = penSpeed(t);
    }
    return { t, depth, speed, craterRadius: craterRadius(depth), penetratorLength: length, rearBulge: rearBulge(depth) };
  };

  const events: ArmorEvent[] = [{ t: 0, type: 'impact', depth: 0, speed: v0, label: 'Impact' }];
  if (shattered) events.push({ t: 0, type: 'shatter', depth: 0, speed: v0, label: 'Shot shatters on the slope' });
  if (perforated) {
    events.push({ t: tPlug, type: 'plug', depth: xPlug, speed: vPlug, label: 'Plug sheared' });
    events.push({ t: tExit, type: 'perforate', depth: tLos, speed: vResidual, label: 'Shot and plug exit' });
  } else {
    events.push({ t: tStop, type: 'stop', depth: P, speed: 0, label: 'Shot stops in the plate' });
  }

  const duration = timelineDuration(endTime);
  return {
    shot,
    frames: sampleFrames(duration, frameAtTime),
    events,
    result: {
      mechanism: (perforated ? 'Plugging' : 'Plastic penetration') + (shattered ? ' (shot partly shattered)' : ''),
      losThicknessM: tLos,
      penetrationM: perforated ? tLos : P,
      perforated,
      residualVelocity: vResidual,
      // A partly shattered shot's pieces travel on together, so its mass is kept.
      residualMassKg: perforated ? m : 0,
      plug,
      shattered,
      fragments,
      impactEnergyJ: 0.5 * m * v0 ** 2,
      residualEnergyJ: 0.5 * m * vResidual ** 2,
    },
    duration,
  };
}
