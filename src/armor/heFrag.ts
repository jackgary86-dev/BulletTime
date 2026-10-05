/**
 * Armor lab (#170): HE fragmentation against plate. Plenty of energy reaches
 * the plate, but spread over a spray of small steel fragments and a weak blast
 * load, so none of it is concentrated. Each fragment is checked on its own
 * against the plate's ballistic limit for a body that small: against thick
 * armor it only pits the face and bounces off, and only thin plate is holed.
 *
 * The model takes the fragments as they reach the face (how many, their mass
 * and speed ranges, from `munitions.ts`) and nothing about the shell itself:
 * - A compact steel fragment of mass m is a body about (m/ρ)^(1/3) across.
 * - Its ballistic limit is De Marre's formula, the same one the full-bore
 *   shot uses (`fullBore.ts`), applied at fragment scale as a teaching
 *   approximation: the RHA it just gets through, divided by the material's
 *   RHA thickness factor, is the plate it perforates.
 * - A fragment short of that stops where it runs out of speed, as a shot does,
 *   less the plug it never shears out: it embeds if it buries deeper than its
 *   own size, and otherwise it only pits the face and rebounds.
 * - A perforating fragment keeps v_r = √(v² − v_bl²) (Lambert–Jonas with an
 *   exponent of 2).
 * - The blast load dishes a thin plate: a lab heuristic scaled with the
 *   calibre squared over the plate's thickness squared and its yield, so it
 *   is several millimetres on thin mild steel and nothing on armor, where the
 *   only sign of it is the elastic wave crossing the plate.
 *
 * The section is a slice through the spray: the fragments are spread over the
 * part of the face the view shows. Impact physics only. All values are a
 * simplified teaching model, not engineering data.
 */

import { DE_MARRE_DIAMETER_EXP, DE_MARRE_K, DE_MARRE_MASS_EXP, DE_MARRE_THICKNESS_EXP, PLUG_RATIO, STOP_DEPTH_MIN_FRACTION } from './fullBore';
import { ROOM_HALF_HEIGHT_FACTOR } from './fragments';
import type { PlateMaterial } from './materials';
import {
  MAX_TIMELINE_FRAMES,
  TIMELINE_FRAMES,
  losThickness,
  normalizeShot,
  sampleFrames,
  timelineDuration,
  viewMargin,
  type ArmorEvent,
  type ArmorFrame,
  type ArmorPit,
  type ArmorShot,
  type ArmorTimeline,
} from './model';
import type { FragmentImpact } from './munitions';

/** Steepest plate slope (degrees) the fragment model handles. */
export const HE_FRAG_MAX_OBLIQUITY_DEG = 70;
/** Density of the steel fragments, kg/m³. */
export const FRAGMENT_DENSITY = 7850;
/** A compact fragment presents a little more than a cube's face: its effective diameter over the cube side. */
export const FRAGMENT_SHAPE_FACTOR = 1.1;
/** Share of the view's half-height the spray is spread over, so every pit is on screen. */
export const SPRAY_VIEW_SHARE = 0.85;
/** Pit radius at the mouth: this much of the fragment's diameter, plus this much of the depth. */
export const PIT_RADIUS_RATIO = 0.6;
export const PIT_DEPTH_WIDENING = 0.3;
/** Blast dish (lab heuristic): this much (m) for a 155 mm burst on 10 mm of 250 MPa steel, scaling as calibre² / (thickness² · yield). */
export const BLAST_DISH_REF_M = 0.012;
const DISH_REF = { calibreMm: 155, thicknessM: 0.01, yieldPa: 250e6 } as const;
/** A dish shallower than this (m) is not drawn: the plate only rings. */
export const MIN_DISH_M = 2e-4;
/** A dish is never deeper than this many plate thicknesses. */
export const MAX_DISH_THICKNESSES = 2;

export type PitOutcome = 'pit' | 'embed' | 'perforate';

export interface SprayFragment {
  massKg: number;
  velocity: number;
  diameterM: number;
  /** Where it strikes the face, m from the shot line, in the section plane. */
  yM: number;
}

/** A compact steel fragment's effective diameter, m. */
export function fragmentDiameter(massKg: number): number {
  return FRAGMENT_SHAPE_FACTOR * (massKg / FRAGMENT_DENSITY) ** (1 / 3);
}

/** Fractional part, for the low-discrepancy sequences that spread the spray evenly. */
const frac = (x: number) => x - Math.floor(x);

/**
 * The fragments reaching the face, deterministic for a shot: masses spread
 * evenly on a log scale over the range, speeds evenly over theirs, strike
 * points evenly over `halfSpanM` either side of the shot line.
 */
export function fragmentSpray(impact: FragmentImpact, halfSpanM: number): SprayFragment[] {
  const { count, mass, velocity } = impact.fragments;
  const out: SprayFragment[] = [];
  const logMin = Math.log(mass[0]);
  const logMax = Math.log(mass[1]);
  for (let i = 0; i < count; i++) {
    const m = Math.exp(logMin + (logMax - logMin) * frac(0.5 + i * 0.618034));
    const v = velocity[0] + (velocity[1] - velocity[0]) * frac(0.3 + i * 0.754878);
    out.push({ massKg: m, velocity: v, diameterM: fragmentDiameter(m), yM: (frac(0.25 + i * 0.569840) * 2 - 1) * halfSpanM });
  }
  return out;
}

/** The RHA a fragment just gets through square-on, m: De Marre solved for thickness. */
export function fragmentRhaPenetration(f: Pick<SprayFragment, 'massKg' | 'velocity' | 'diameterM'>): number {
  return ((f.velocity * f.massKg ** DE_MARRE_MASS_EXP) / (DE_MARRE_K * f.diameterM ** DE_MARRE_DIAMETER_EXP)) ** (1 / DE_MARRE_THICKNESS_EXP);
}

/** The speed a fragment needs to get through `losM` of this material, m/s. */
export function fragmentBallisticLimit(f: Pick<SprayFragment, 'massKg' | 'diameterM'>, material: PlateMaterial, losM: number): number {
  const rhaM = losM * material.rhaThicknessFactor;
  return (DE_MARRE_K * f.diameterM ** DE_MARRE_DIAMETER_EXP * rhaM ** DE_MARRE_THICKNESS_EXP) / f.massKg ** DE_MARRE_MASS_EXP;
}

export interface FragmentHit {
  outcome: PitOutcome;
  /** How deep it gets along the shot line, m (the line-of-sight thickness when it perforates). */
  depthM: number;
  /** Pit radius at the face, m. */
  radiusM: number;
  /** Speed behind the plate, m/s (0 unless it perforates). */
  residualVelocity: number;
}

/** What one fragment does to a plate of line-of-sight thickness `losM`. */
export function fragmentHit(f: SprayFragment, material: PlateMaterial, losM: number): FragmentHit {
  const pathM = fragmentRhaPenetration(f) / material.rhaThicknessFactor;
  const radius = (depth: number) => Math.min(1.2 * f.diameterM, PIT_RADIUS_RATIO * f.diameterM + PIT_DEPTH_WIDENING * depth);
  if (pathM > losM) {
    const vbl = fragmentBallisticLimit(f, material, losM);
    return { outcome: 'perforate', depthM: losM, radiusM: radius(losM), residualVelocity: Math.sqrt(Math.max(0, f.velocity ** 2 - vbl ** 2)) };
  }
  const depthM = Math.min(losM, Math.max(pathM - PLUG_RATIO * f.diameterM, STOP_DEPTH_MIN_FRACTION * pathM));
  return { outcome: depthM > f.diameterM ? 'embed' : 'pit', depthM, radiusM: radius(depthM), residualVelocity: 0 };
}

/** Depth of the dish the blast load pushes into the plate, m (0 when it only rings). */
export function blastDish(impact: FragmentImpact, material: PlateMaterial, thicknessM: number): number {
  const dish =
    BLAST_DISH_REF_M * (impact.calibreMm / DISH_REF.calibreMm) ** 2 * (DISH_REF.thicknessM / thicknessM) ** 2 * (DISH_REF.yieldPa / material.yieldPa);
  return dish < MIN_DISH_M ? 0 : Math.min(dish, MAX_DISH_THICKNESSES * thicknessM);
}

/** Half-height of the face the section shows, m: the spray is spread over most of it. */
export function sprayHalfSpan(losM: number): number {
  return SPRAY_VIEW_SHARE * ROOM_HALF_HEIGHT_FACTOR * viewMargin(losM);
}

/** Simulates an HE fragment spray and its blast load against the plate. */
export function heFragShot(input: ArmorShot): ArmorTimeline {
  const shot = normalizeShot(input, HE_FRAG_MAX_OBLIQUITY_DEG);
  const { impact, material } = shot;
  if (impact.family !== 'he-frag') throw new Error(`heFragShot models fragment sprays, not '${impact.family}'`);

  const tLos = losThickness(shot.thicknessM, shot.obliquityDeg);
  const spray = fragmentSpray(impact, sprayHalfSpan(tLos));
  const cal = impact.calibreMm / 1000;

  // Each fragment arrives a little after the first, by how much further it had to come, and digs in at about half its speed.
  const roomHalf = ROOM_HALF_HEIGHT_FACTOR * viewMargin(tLos);
  const placed: { y: number; r: number }[] = [];
  const raw = spray.map((f) => {
    const hit = fragmentHit(f, material, tLos);
    // Keep the whole mouth of the pit on the face the section shows.
    const reach = Math.max(0, 0.97 * roomHalf - hit.radiusM);
    const yM = Math.sign(f.yM) * Math.min(Math.abs(f.yM), reach);
    // The real spray covers far more face than the cut: the section shows the fragments that strike along it, so no two pits overlap.
    const inSection = placed.every((q) => Math.abs(q.y - yM) >= 1.3 * (q.r + hit.radiusM));
    if (inSection) placed.push({ y: yM, r: hit.radiusM });
    // Each arrives a little after the first, by how much further it had to come, and digs in at about half its speed.
    const arrive = (0.5 * cal + Math.abs(yM)) / f.velocity;
    return { yM, massKg: f.massKg, velocity: f.velocity, diameterM: f.diameterM, ...hit, arrive, digS: hit.depthM / Math.max(1, 0.5 * f.velocity), inSection };
  });
  const firstArrival = raw.reduce((t, p) => Math.min(t, p.arrive), Infinity);
  const pits: ArmorPit[] = raw.map(({ arrive, ...p }) => ({ ...p, t0: arrive - firstArrival }));

  const impactEnergyJ = pits.reduce((e, p) => e + 0.5 * p.massKg * p.velocity ** 2, 0);
  const through = pits.filter((p) => p.outcome === 'perforate');
  const residualEnergyJ = through.reduce((e, p) => e + 0.5 * p.massKg * p.residualVelocity ** 2, 0);
  const residualMassKg = through.reduce((m, p) => m + p.massKg, 0);
  const plateWorkJ = impactEnergyJ - residualEnergyJ;
  const dish = blastDish(impact, material, shot.thicknessM);

  const c = material.soundSpeed;
  const lastDone = pits.reduce((t, p) => Math.max(t, p.t0 + p.digS), 0);
  // The blast pushes the dish in over a few transits of the elastic wave.
  const dishS = (8 * tLos) / c;
  const endTime = Math.max(lastDone, 2 * tLos / c, dish > 0 ? dishS : 0);
  const duration = timelineDuration(endTime);
  const depthAt = (p: ArmorPit, t: number) => (t <= p.t0 ? 0 : p.depthM * Math.min(1, (t - p.t0) / Math.max(p.digS, 1e-12)));

  const frameAtTime = (t: number): ArmorFrame => {
    const pitDepths = pits.map((p) => depthAt(p, t));
    const deepest = pitDepths.reduce((d, x) => Math.max(d, x), 0);
    const work = pits.reduce((e, p, i) => {
      const share = p.depthM > 0 ? pitDepths[i] / p.depthM : t > p.t0 ? 1 : 0;
      return e + share * (0.5 * p.massKg * (p.velocity ** 2 - p.residualVelocity ** 2));
    }, 0);
    const reach = c * t;
    return {
      t,
      depth: deepest,
      travel: deepest,
      speed: 0,
      penetrationRate: 0,
      craterRadius: 0,
      penetratorLength: 0,
      rearBulge: dish * Math.min(1, t / dishS),
      energyDepositedJ: work,
      // The blast's elastic wave, bouncing between the faces.
      waveFrontM: Math.min(tLos, reach),
      reflectedFrontM: reach > tLos ? Math.max(0, 2 * tLos - reach) : tLos,
      peakTensionPa: 0,
      tensionDepthM: 0,
      pitDepths,
    };
  };

  const first = pits.reduce((t, p) => Math.min(t, p.t0), Infinity);
  const events: ArmorEvent[] = [{ t: first, type: 'impact', depth: 0, speed: impact.fragments.velocity[1], label: `${pits.length} fragments strike the face` }];
  const firstThrough = through.reduce<ArmorPit | null>((a, p) => (!a || p.t0 + p.digS < a.t0 + a.digS ? p : a), null);
  if (firstThrough) {
    events.push({ t: firstThrough.t0 + firstThrough.digS, type: 'perforate', depth: tLos, speed: firstThrough.residualVelocity, label: `${through.length} of ${pits.length} fragments get through` });
  }
  events.push({
    t: lastDone,
    type: 'stop',
    depth: pits.reduce((d, p) => Math.max(d, p.outcome === 'perforate' ? 0 : p.depthM), 0),
    speed: 0,
    label: through.length ? 'The rest pit the face and bounce off' : 'Every fragment is below the ballistic limit: the face is pitted',
  });
  events.sort((a, b) => a.t - b.t);

  const frameCount = Math.min(MAX_TIMELINE_FRAMES, Math.max(TIMELINE_FRAMES, Math.ceil((TIMELINE_FRAMES * duration) / timelineDuration(Math.max(lastDone, 1e-9)))));
  return {
    shot,
    frames: sampleFrames(duration, frameAtTime, frameCount),
    events,
    result: {
      mechanism: through.length ? 'Fragment perforation' : 'Fragment pitting',
      losThicknessM: tLos,
      penetrationM: pits.reduce((d, p) => Math.max(d, p.depthM), 0),
      perforated: through.length > 0,
      residualVelocity: through.reduce((v, p) => Math.max(v, p.residualVelocity), 0),
      residualMassKg,
      shattered: false,
      fragments: pits.length,
      pits,
      blastDishM: dish,
      impactEnergyJ,
      residualEnergyJ,
      energy: { plateWorkJ, ejectaJ: 0 },
    },
    duration,
  };
}
