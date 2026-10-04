/**
 * Armor lab (#171): spaced and layered plate stacks. A stack is up to
 * `MAX_LAYERS` plain plates with air gaps, each with its own material and
 * thickness. The round is run against each plate in turn with the single-plate
 * models, and every model carries its state from one plate to the next:
 * - a long rod arrives at the next plate with the length it has left, and
 *   yawed a few degrees by a thin plate;
 * - a shaped-charge jet arrives with what is left of it, and the longer the gap
 *   the more it has particulated and drifted, so the less it digs;
 * - full-bore shot arrives with the speed it got through with, and a shot that
 *   shattered on the first plate arrives as a small piece;
 * - a squash-head round only works on the first plate (it stays on the face):
 *   the lesson is that it spalls the first plate and nothing behind it.
 * A round that ricochets, skids or is stopped ends the stack there; the plates
 * behind it are not engaged.
 *
 * Generic textbook arrangements only: homogeneous plates with air gaps. Real
 * or proprietary armor packages are not modelled. Every number is a simplified
 * teaching model.
 */

import { withFragments } from './fragments';
import type { PlateMaterial, PlateMaterialId } from './materials';
import {
  MAX_OBLIQUITY_DEG,
  losThickness,
  type ArmorEjecta,
  type ArmorEvent,
  type ArmorMechanism,
  type ArmorShot,
  type ArmorTimeline,
  type FragmentField,
} from './model';
import type { ImpactState, JetImpact, SolidImpact } from './munitions';
import { penetrate } from './simulate';

/** Most plates in a stack. */
export const MAX_LAYERS = 4;

/** A shaped-charge jet's effectiveness across a gap falls to half at this many cone diameters of gap (particulation and drift). */
export const PARTICULATION_CONE_DIAMETERS = 8;
/** A thin plate yaws a long rod by up to this many degrees; the yaw falls off as the plate gets thicker than the rod is wide. */
export const MAX_ROD_YAW_DEG = 10;
/** Share of the shot's mass the biggest surviving piece keeps when it shatters on a plate. */
export const SHATTER_PIECE_SHARE = 0.25;
/** The longest a gap's flight is allowed to take on the timeline, s, so a crawling round does not stretch playback. */
export const MAX_GAP_TIME_S = 2e-3;

export interface PlateLayer {
  material: PlateMaterial;
  /** Plate thickness normal to its face, m. */
  thicknessM: number;
  /** Air gap in front of this plate (between it and the plate before), m, normal to the plates. Ignored for the first plate. */
  gapBeforeM: number;
}

export interface StackShot {
  /** The round as it reaches the first plate. */
  impact: ImpactState;
  /** Front to back, 1 to `MAX_LAYERS` plates. */
  layers: PlateLayer[];
  /** Slope of the plates, degrees from the normal (they are parallel). */
  obliquityDeg: number;
}

/** One plate's part of the stack's run. */
export interface StackStage {
  index: number;
  layer: PlateLayer;
  /** The shot this plate saw: the carried-over round, at the plate's slope plus any yaw. */
  shot: ArmorShot;
  /** The single-plate run. Only the last engaged stage has `fragments`. */
  timeline: ArmorTimeline;
  /** When this plate's impact starts on the stack's clock, s. */
  offsetT: number;
  /** Path distance from the first plate's front face to this plate's front face, along the line of sight, m. */
  startM: number;
  /** Air gap in front of this plate along the line of sight, m (0 for the first plate). */
  gapLosM: number;
  /** How long the round took to cross that gap, s (0 for the first plate). */
  gapTimeS: number;
}

/** What one plate did, for the results table. */
export interface StackPlateResult {
  index: number;
  materialId: PlateMaterialId;
  materialName: string;
  thicknessM: number;
  losThicknessM: number;
  /** Whether the round reached this plate. */
  engaged: boolean;
  /** The round's speed at this plate (the jet tip's for a jet), m/s; 0 when not engaged. */
  entrySpeed: number;
  mechanism: ArmorMechanism | null;
  /** How deep it dug along the line of sight, m. */
  penetrationM: number;
  perforated: boolean;
  /** Speed behind the plate, m/s. */
  residualVelocity: number;
  residualMassKg: number;
  plug?: ArmorEjecta;
  scab?: ArmorEjecta;
  shattered: boolean;
  /** How much of the round's length is left behind the plate, for a rod or a jet, m (0 otherwise). */
  residualLengthM: number;
}

export interface StackResult {
  /** Every plate perforated. */
  perforated: boolean;
  /** How many plates the round got through. */
  platesDefeated: number;
  /** The plate the round stopped, glanced off or was spent at (0-based), or null when it got through all of them. */
  stoppedAt: number | null;
  /** What gets through the whole stack. */
  residualVelocity: number;
  residualMassKg: number;
  impactEnergyJ: number;
  residualEnergyJ: number;
  /** Total line-of-sight thickness of the plates, m. */
  totalLosThicknessM: number;
}

export interface StackTimeline {
  shot: StackShot;
  /** Plates the round reached, front to back. */
  stages: StackStage[];
  /** One entry per plate in the stack, engaged or not. */
  plates: StackPlateResult[];
  /** Every stage's events on the stack's clock, in time order, labelled by plate when there is more than one. */
  events: ArmorEvent[];
  result: StackResult;
  /** Playback length on the stack's clock, s. */
  duration: number;
  /** What the last engaged plate threw clear, on the stack's clock (positions are in that plate's own coordinates, see `fragmentStage`). */
  fragments?: FragmentField;
  /** The stage the fragments belong to. */
  fragmentStage: number;
}

/** Residual jet length behind a plate, m, from its mass and the jet's cross-section. */
function jetLengthOf(impact: JetImpact, massKg: number): number {
  const area = Math.PI * (impact.jetDiameter / 2) ** 2;
  return massKg / (impact.density * area);
}

/** How much of a jet is still effective after crossing a gap of `gapM` (m) and `coneDiameterM`: 1 with no gap, half at `PARTICULATION_CONE_DIAMETERS` cone diameters. */
export function jetGapEfficiency(gapM: number, coneDiameterM: number): number {
  if (!(gapM > 0)) return 1;
  return 1 / (1 + (gapM / (PARTICULATION_CONE_DIAMETERS * coneDiameterM)) ** 2);
}

/** How far a thin plate yaws a rod it perforates, degrees. */
export function rodYawDeg(plateThicknessM: number, rodDiameterM: number): number {
  return MAX_ROD_YAW_DEG * Math.exp(-plateThicknessM / (2 * rodDiameterM));
}

/** The round that leaves a perforated plate, or null when nothing is left to carry on. `gapLosM` is the gap it crosses next. */
export function carryOver(stage: ArmorTimeline, gapLosM: number): { impact: ImpactState; yawDeg: number } | null {
  const { result, shot } = stage;
  if (!result.perforated || result.ricochet || result.failedToFuze) return null;
  const impact = shot.impact;
  const v = result.residualVelocity;
  if (!(v > 0) || !(result.residualMassKg > 0)) return null;
  switch (impact.family) {
    case 'ap-shot': {
      const share = result.shattered ? SHATTER_PIECE_SHARE : 1;
      const mass = impact.mass * share;
      const diameter = impact.diameter * Math.cbrt(share);
      const length = mass / (impact.density * Math.PI * (diameter / 2) ** 2);
      const next: SolidImpact = { ...impact, velocity: v, mass, diameter, length };
      return { impact: next, yawDeg: 0 };
    }
    case 'apfsds': {
      const length = stage.frames[stage.frames.length - 1].penetratorLength;
      if (!(length > impact.diameter)) return null;
      const mass = impact.density * Math.PI * (impact.diameter / 2) ** 2 * length;
      const next: SolidImpact = { ...impact, velocity: v, length, mass };
      return { impact: next, yawDeg: rodYawDeg(shot.thicknessM, impact.diameter) };
    }
    case 'heat': {
      const remaining = jetLengthOf(impact, result.residualMassKg);
      const effective = remaining * jetGapEfficiency(gapLosM, impact.coneDiameter);
      if (!(v > impact.jetTailVelocity * 1.05) || !(effective > 0)) return null;
      const next: JetImpact = { ...impact, jetTipVelocity: v, jetLength: effective };
      return { impact: next, yawDeg: 0 };
    }
    default:
      // A squash head stays on the first face; nothing else is modelled against plate.
      return null;
  }
}

/** The speed that counts as the round's speed at the plate, m/s. */
const entrySpeedOf = (impact: ImpactState): number => (impact.family === 'heat' ? impact.jetTipVelocity : impact.velocity);

/** Moves a fragment field to another clock: every time is later by `dt` (s). */
export function shiftFragments(field: FragmentField, dt: number): FragmentField {
  return {
    ...field,
    tracks: field.tracks.map((tr) => ({ ...tr, t0: tr.t0 + dt, segments: tr.segments.map((s) => ({ ...s, t0: s.t0 + dt })) })),
    handoffS: field.handoffS === null ? null : field.handoffS + dt,
    restS: field.restS + dt,
  };
}

/** The slope a plate sees, degrees: the stack's slope plus any yaw, at most the lab's steepest. */
const slopeOf = (baseDeg: number, yawDeg: number) => Math.min(MAX_OBLIQUITY_DEG, baseDeg + yawDeg);

/** Runs a round against a stack of plates. */
export function simulateStack(input: StackShot): StackTimeline {
  const { layers } = input;
  if (layers.length < 1 || layers.length > MAX_LAYERS) throw new Error(`A stack has 1 to ${MAX_LAYERS} plates, got ${layers.length}`);
  const cosBase = Math.cos((Math.min(MAX_OBLIQUITY_DEG, Math.max(0, input.obliquityDeg)) * Math.PI) / 180);

  const stages: StackStage[] = [];
  let impact = input.impact;
  let yaw = 0;
  let offsetT = 0;
  let startM = 0;
  let gapLosM = 0;
  let gapTimeS = 0;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const stageShot: ArmorShot = { impact, material: layer.material, thicknessM: layer.thicknessM, obliquityDeg: slopeOf(input.obliquityDeg, yaw) };
    const timeline = penetrate(stageShot);
    stages.push({ index: i, layer, shot: stageShot, timeline, offsetT, startM, gapLosM, gapTimeS });
    const nextGap = i + 1 < layers.length ? Math.max(0, layers[i + 1].gapBeforeM) / cosBase : 0;
    const carry = i + 1 < layers.length ? carryOver(timeline, nextGap) : null;
    if (!carry) break;
    const exit = timeline.events.find((e) => e.type === 'perforate');
    const exitT = exit ? exit.t : timeline.duration;
    gapLosM = nextGap;
    gapTimeS = Math.min(MAX_GAP_TIME_S, nextGap / Math.max(1, timeline.result.residualVelocity));
    startM += timeline.result.losThicknessM + nextGap;
    offsetT += exitT + gapTimeS;
    impact = carry.impact;
    yaw += carry.yawDeg;
  }

  // The last plate the round reached throws its pieces clear.
  const last = stages[stages.length - 1];
  last.timeline = withFragments(last.timeline);

  const multiple = layers.length > 1;
  const events: ArmorEvent[] = [];
  for (const stage of stages) {
    for (const e of stage.timeline.events) {
      events.push({ ...e, t: e.t + stage.offsetT, label: multiple ? `Plate ${stage.index + 1}: ${e.label}` : e.label });
    }
  }
  events.sort((a, b) => a.t - b.t);

  const plates: StackPlateResult[] = layers.map((layer, index) => {
    const stage = stages[index];
    const losThicknessM = losThickness(layer.thicknessM, input.obliquityDeg);
    if (!stage) {
      return {
        index,
        materialId: layer.material.id,
        materialName: layer.material.name,
        thicknessM: layer.thicknessM,
        losThicknessM,
        engaged: false,
        entrySpeed: 0,
        mechanism: null,
        penetrationM: 0,
        perforated: false,
        residualVelocity: 0,
        residualMassKg: 0,
        shattered: false,
        residualLengthM: 0,
      };
    }
    const r = stage.timeline.result;
    const imp = stage.shot.impact;
    const residualLengthM = !r.perforated ? 0 : imp.family === 'heat' ? jetLengthOf(imp, r.residualMassKg) : imp.family === 'apfsds' ? stage.timeline.frames[stage.timeline.frames.length - 1].penetratorLength : 0;
    return {
      index,
      materialId: layer.material.id,
      materialName: layer.material.name,
      thicknessM: layer.thicknessM,
      losThicknessM: r.losThicknessM,
      engaged: true,
      entrySpeed: entrySpeedOf(imp),
      mechanism: r.mechanism,
      penetrationM: r.penetrationM,
      perforated: r.perforated,
      residualVelocity: r.residualVelocity,
      residualMassKg: r.residualMassKg,
      plug: r.plug,
      scab: r.scab,
      shattered: r.shattered,
      residualLengthM,
    };
  });

  const defeated = plates.filter((p) => p.engaged && p.perforated).length;
  const all = defeated === layers.length;
  const lastResult = last.timeline.result;
  const result: StackResult = {
    perforated: all,
    platesDefeated: defeated,
    stoppedAt: all ? null : last.index,
    residualVelocity: all ? lastResult.residualVelocity : 0,
    residualMassKg: all ? lastResult.residualMassKg : 0,
    impactEnergyJ: stages[0].timeline.result.impactEnergyJ,
    residualEnergyJ: all ? lastResult.residualEnergyJ : 0,
    totalLosThicknessM: plates.reduce((sum, p) => sum + p.losThicknessM, 0),
  };

  return {
    shot: input,
    stages,
    plates,
    events,
    result,
    duration: last.offsetT + last.timeline.duration,
    fragments: last.timeline.fragments ? shiftFragments(last.timeline.fragments, last.offsetT) : undefined,
    fragmentStage: last.index,
  };
}

/** Presets for the classic spaced and layered arrangements; each returns the layers for a given main plate. */
export interface StackPreset {
  id: string;
  name: string;
  description: string;
  build(main: PlateMaterial, mainThicknessM: number, extra: { spaced: PlateMaterial; soft: PlateMaterial; hard: PlateMaterial }): PlateLayer[];
}

export const STACK_PRESETS: StackPreset[] = [
  {
    id: 'single',
    name: 'Single plate',
    description: 'One plate, as before.',
    build: (main, t) => [{ material: main, thicknessM: t, gapBeforeM: 0 }],
  },
  {
    id: 'spaced',
    name: 'Spaced plate + main plate',
    description: 'A thin plate 300 mm in front of the main plate: it shatters shot, yaws a rod and lets a jet spread before it reaches the main plate.',
    build: (main, t, x) => [
      { material: x.spaced, thicknessM: 0.02, gapBeforeM: 0 },
      { material: main, thicknessM: t, gapBeforeM: 0.3 },
    ],
  },
  {
    id: 'hard-soft',
    name: 'Hard face + soft backing',
    description: 'A hard plate over a soft one, touching: the hard face breaks the round up and the soft backing catches what is left.',
    build: (_main, t, x) => [
      { material: x.hard, thicknessM: Math.max(0.01, t * 0.5), gapBeforeM: 0 },
      { material: x.soft, thicknessM: Math.max(0.01, t * 0.5), gapBeforeM: 0 },
    ],
  },
  {
    id: 'two-equal',
    name: 'Two plates, one thickness',
    description: 'Two equal plates with a small gap, against one plate of the same total thickness.',
    build: (main, t) => [
      { material: main, thicknessM: Math.max(0.005, t / 2), gapBeforeM: 0 },
      { material: main, thicknessM: Math.max(0.005, t / 2), gapBeforeM: 0.05 },
    ],
  },
];
