/**
 * Armor lab (#161): full-bore AP shot against plate. A solid steel shot as
 * wide as the bore pushes into the plate, deforming it plastically round the
 * nose; if the plate is thin enough it shears out a plug and punches through.
 *
 * Classical open-literature models, simplified for teaching:
 * - De Marre's ballistic-limit formula (1886), v_bl = K · D^0.75 · T^0.7 / m^0.5,
 *   solved for the RHA thickness P the shot just gets through at a given speed
 *   (see Backman & Goldsmith's 1978 review "The mechanics of penetration of
 *   projectiles into targets", and Zukas, "Impact Dynamics").
 * - The Robins–Euler constant-resistance law (Poncelet's law without its
 *   velocity-squared term): the plate resists with a constant force, so v²
 *   falls linearly with depth.
 * - Recht & Ipson's (1963) momentum-sharing plugging model: once the plate
 *   ahead of the nose is thin enough, a plug shears out and shot and plug
 *   share the shot's momentum.
 *
 * How they fit together: P (in the plate's material, along the shot line) is
 * the plate the shot just gets through, so it perforates exactly when the
 * line-of-sight thickness is under P. The plug shears out once `PLUG_RATIO`
 * calibres of plate are left ahead of the nose, so a shot right at the limit
 * runs out of speed after digging P − PLUG_RATIO · D: that is how deep it
 * gets into a plate too thick to perforate. Getting through a plate takes less
 * than digging the same depth into a thick block, because the last part
 * shears out as a plug instead of being pushed aside.
 *
 * The plug onset and width, the shatter rule and the rear bulge are
 * illustrative lab heuristics chosen for the teaching model, not figures from
 * the cited sources.
 *
 * Impact physics only: the shot is its state at the plate (from `munitions.ts`).
 * All values are a simplified teaching model, not engineering data.
 */

import {
  CRATER_PROFILE_SAMPLES,
  MAX_TIMELINE_FRAMES,
  TIMELINE_FRAMES,
  normalizeShot,
  losThickness,
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

/** Steepest plate slope (degrees) the full-bore model handles; steeper shots are clamped to it. */
export const FULL_BORE_MAX_OBLIQUITY_DEG = 75;

/** A plug shears out when the plate left ahead of the nose is this many calibres thick (illustrative lab heuristic). */
export const PLUG_RATIO = 0.7;
/** Plug (and hole) diameter as a multiple of the shot diameter: the shear ring is a little wider than the shot (illustrative lab heuristic). */
export const PLUG_DIAMETER_RATIO = 1.05;
/**
 * Floor on the thick-plate stopping depth, as a fraction of the perforation
 * thickness, so it stays positive. It only binds outside the ap-shot family's
 * calibre and speed range (perforation thickness under about 0.74 calibres),
 * where the perforation limit then comes out a little above P.
 */
export const STOP_DEPTH_MIN_FRACTION = 0.05;

/** The rear face starts to bulge when the plate left ahead of the nose is under this many calibres (illustrative lab heuristic). */
export const REAR_BULGE_ONSET_RATIO = 1.5;
/** Bulge height per metre the remaining plate is under the onset thickness (illustrative lab heuristic). */
export const REAR_BULGE_GAIN = 0.25;

/**
 * Steel shot hitting a hard plate above this slope (degrees) partly shatters.
 * Steel shot breaking up on hard, steeply sloped plate is a well-known effect;
 * this threshold, the hardness and the factor below are illustrative lab
 * heuristics.
 */
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
 * m (kg) at `velocity` (m/s) just gets through square-on,
 * P = (v · m^0.5 / (K · D^0.75))^(1/0.7).
 */
export function deMarreRhaPenetration(diameterM: number, massKg: number, velocity: number): number {
  return ((velocity * massKg ** DE_MARRE_MASS_EXP) / (DE_MARRE_K * diameterM ** DE_MARRE_DIAMETER_EXP)) ** (1 / DE_MARRE_THICKNESS_EXP);
}

/** How many pieces a shattered shot breaks into (illustrative lab heuristic). */
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
  /** Line-of-sight thickness of this material the shot just gets through at this slope, m (its ballistic limit as a path length). */
  pathM: number;
  /** Depth along the shot line it stops at in a plate too thick to perforate, m: `pathM` less the `PLUG_RATIO` calibres a plug would shear out. */
  stopDepthM: number;
  shattered: boolean;
  fragments: number;
}

/**
 * How far the shot gets along its line into this material at this slope: the
 * De Marre RHA figure divided by the material's RHA thickness factor, cut by
 * `SHATTER_FACTOR` if the shot shatters, and the thick-plate stopping depth
 * that follows from it.
 */
export function fullBorePenetration(impact: SolidImpact, material: PlateMaterial, obliquityDeg: number): FullBorePenetration {
  const rhaM = deMarreRhaPenetration(impact.diameter, impact.mass, impact.velocity);
  const shattered = shotShatters(impact, material, obliquityDeg);
  const pathM = (rhaM / material.rhaThicknessFactor) * (shattered ? SHATTER_FACTOR : 1);
  const stopDepthM = Math.max(pathM - PLUG_RATIO * impact.diameter, STOP_DEPTH_MIN_FRACTION * pathM);
  return { rhaM, pathM, stopDepthM, shattered, fragments: shattered ? shatterFragments(impact.calibreMm) : 0 };
}

/** Simulates a full-bore AP shot against the plate. */
export function fullBoreShot(input: ArmorShot): ArmorTimeline {
  const shot = normalizeShot(input, FULL_BORE_MAX_OBLIQUITY_DEG);
  const { impact, material } = shot;
  if (impact.family !== 'ap-shot') throw new Error(`fullBoreShot models full-bore AP shot, not '${impact.family}'`);

  const { diameter: D, mass: m, velocity: v0, length } = impact;
  const tLos = losThickness(shot.thicknessM, shot.obliquityDeg);
  const { stopDepthM: S, shattered, fragments } = fullBorePenetration(impact, material, shot.obliquityDeg);
  const impactEnergyJ = 0.5 * m * v0 ** 2;

  // Digging: constant resisting force, so v² = v0²(1 − x/S) and in a thick plate the shot stops at S after 2S/v0.
  const tStop = (2 * S) / v0;
  const digDepth = (t: number) => S * (1 - (1 - (v0 * t) / (2 * S)) ** 2);
  const digSpeed = (t: number) => v0 * (1 - (v0 * t) / (2 * S));
  const timeToDepth = (x: number) => tStop * (1 - Math.sqrt(1 - x / S));

  // The plug shears once PLUG_RATIO calibres of plate are left ahead of the nose, if the shot is still moving
  // then. In the family's range that is exactly when the line-of-sight thickness is under P.
  const xPlug = Math.max(0, tLos - PLUG_RATIO * D);
  const vPlug = xPlug < S ? v0 * Math.sqrt(1 - xPlug / S) : 0;
  const perforated = vPlug > 0;

  // Plugging: shot and plug share the shot's momentum (Recht–Ipson).
  const holeRadius = (PLUG_DIAMETER_RATIO * D) / 2;
  let plug: ArmorEjecta | undefined;
  let tPlug = Infinity;
  let tExit = Infinity;
  let vResidual = 0;
  let plateWorkJ = impactEnergyJ;
  let ejectaJ = 0;
  if (perforated) {
    tPlug = timeToDepth(xPlug);
    const thicknessM = tLos - xPlug;
    const massKg = material.density * Math.PI * holeRadius ** 2 * thicknessM;
    vResidual = (vPlug * m) / (m + massKg);
    plug = { massKg, velocity: vResidual, thicknessM, diameterM: 2 * holeRadius };
    tExit = tPlug + thicknessM / vResidual;
    ejectaJ = 0.5 * massKg * vResidual ** 2;
    // Work done digging to the plug, plus the kinetic energy lost when shot and plug share momentum (an inelastic shear).
    plateWorkJ = 0.5 * m * (v0 ** 2 - vPlug ** 2) + (0.5 * m * vPlug ** 2 - 0.5 * (m + massKg) * vResidual ** 2);
  }
  const endTime = perforated ? tExit : tStop;

  // Rear-face bulge: grows once the plate ahead of the nose is under 1.5 calibres. A judgement call on spec point 7:
  // it is frozen when the plug shears, not at exit, because after that the plug moves out rather than the face
  // bulging; the renderer draws the plug riding ahead of the nose (its rear face is at `travel`).
  const rearBulge = (depth: number) => {
    const remaining = tLos - (perforated ? Math.min(depth, xPlug) : depth);
    return REAR_BULGE_GAIN * Math.max(0, REAR_BULGE_ONSET_RATIO * D - remaining);
  };
  // The crater is a bore of the plug diameter with a round nose at the bottom: radius at height s above the bottom.
  const boreRadius = (s: number) => (s >= holeRadius ? holeRadius : Math.sqrt(s * (2 * holeRadius - s)));
  const craterProfile = (depth: number, through: boolean) =>
    Array.from({ length: CRATER_PROFILE_SAMPLES }, (_, i) => (through ? holeRadius : boreRadius(depth * (1 - i / (CRATER_PROFILE_SAMPLES - 1)))));

  const frameAtTime = (t: number): ArmorFrame => {
    let travel: number;
    let speed: number;
    let penetrationRate: number;
    let energyDepositedJ: number;
    if (perforated && t >= tPlug) {
      // Shot and plug move on together at v_r; the shot leaves the plate at tExit.
      travel = xPlug + vResidual * (t - tPlug);
      speed = vResidual;
      penetrationRate = t < tExit ? vResidual : 0;
      energyDepositedJ = plateWorkJ;
    } else if (!perforated && t >= tStop) {
      travel = S;
      speed = 0;
      penetrationRate = 0;
      energyDepositedJ = plateWorkJ;
    } else {
      travel = digDepth(t);
      speed = digSpeed(t);
      penetrationRate = speed;
      energyDepositedJ = 0.5 * m * (v0 ** 2 - speed ** 2);
    }
    const depth = Math.min(tLos, travel);
    const through = perforated && t >= tExit;
    return {
      t,
      depth,
      travel,
      speed,
      penetrationRate,
      craterRadius: through ? holeRadius : boreRadius(depth),
      craterProfile: craterProfile(depth, through),
      penetratorLength: length,
      rearBulge: rearBulge(depth),
      energyDepositedJ,
    };
  };

  const events: ArmorEvent[] = [{ t: 0, type: 'impact', depth: 0, speed: v0, label: 'Impact' }];
  if (shattered) events.push({ t: 0, type: 'shatter', depth: 0, speed: v0, label: 'Shot shatters on the slope' });
  if (perforated) {
    events.push({ t: tPlug, type: 'plug', depth: xPlug, speed: vPlug, label: 'Plug sheared' });
    events.push({ t: tExit, type: 'perforate', depth: tLos, speed: vResidual, label: 'Shot and plug exit' });
  } else {
    events.push({ t: tStop, type: 'stop', depth: S, speed: 0, label: 'Shot stops in the plate' });
  }

  const duration = timelineDuration(endTime);
  // Just inside the perforation limit v_r is tiny and the shot crawls out, so playback gets long. Sample more
  // frames then, about TIMELINE_FRAMES per thick-plate stop time (up to MAX_TIMELINE_FRAMES), so the dig stays visible.
  const frameCount = Math.min(MAX_TIMELINE_FRAMES, Math.max(TIMELINE_FRAMES, Math.ceil((TIMELINE_FRAMES * duration) / timelineDuration(tStop))));
  const residualEnergyJ = 0.5 * m * vResidual ** 2;
  return {
    shot,
    frames: sampleFrames(duration, frameAtTime, frameCount),
    events,
    result: {
      mechanism: perforated ? 'Plugging' : 'Plastic penetration',
      losThicknessM: tLos,
      penetrationM: perforated ? tLos : S,
      perforated,
      residualVelocity: vResidual,
      // A partly shattered shot's pieces travel on together, so its mass is kept.
      residualMassKg: perforated ? m : 0,
      plug,
      shattered,
      fragments,
      impactEnergyJ,
      residualEnergyJ,
      energy: { plateWorkJ, ejectaJ },
    },
    duration,
  };
}
