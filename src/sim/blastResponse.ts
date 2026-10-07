import type { MediumBehaviour, MediumSpec } from '../data/media';
import type { BlastSpec } from '../data/bullets';
import type { TargetLayer } from './engine';

/**
 * How the material in front of a charge responds to its blast (#196): the
 * overpressure that reaches each target layer from its own distance, shielded by
 * the layers in front of it, set against what that material can take; and
 * whether the blast's impulse is enough to roll the layer's stand over (#320).
 * Pure, so the results panel, the effects and the tests all agree.
 */

/** Overpressure (kPa) at which a material of its default thickness starts to fail, by behaviour: glass first, concrete and steel last. */
export const FAILURE_KPA: Record<MediumBehaviour, number> = {
  glass: 5,
  drywall: 12,
  ice: 25,
  wood: 40,
  bone: 300,
  concrete: 300,
  steel: 4000,
  sand: 2500,
  gel: 1500,
  water: 1500,
  plastic: 20,
};

export type BlastOutcome = 'intact' | 'cracked' | 'toppled' | 'destroyed';

export interface LayerBlast {
  /** Index in the user's stack (a cinder block's two shells count once). */
  stack: number;
  medium: MediumSpec;
  /** Distance from the charge to this layer's face, in metres. */
  rangeM: number;
  /** Overpressure reaching it after the layers in front, in kPa. */
  pressureKPa: number;
  /** Pressure over what the material takes: 1 is the start of failure. */
  k: number;
  /** The kinetic energy the blast's impulse gives the layer and its stand over the energy it takes to roll them over: 1 tips it. */
  tip: number;
  outcome: BlastOutcome;
  /** Seconds after detonation that the shock front reaches the face. */
  arriveS: number;
  /** How far it tips over, as an angle in radians (0 unless toppled). */
  tiltRad: number;
}

const SOUND_MS = 343;
const G = 9.81;
/** Fraction of the shock that gets past a layer, by how it fared: a wall that holds blocks most of it. */
const PASSES_INTACT = 0.15;
const PASSES_CRACKED = 0.5;
const PASSES_FAILED = 0.8;

/**
 * The fits below are far-field ones. Closer than this scaled range (m/kg^(1/3)) they are held at their value here
 * instead of being extrapolated toward contact, where they climb without limit: about 14 MPa for a 1 kg charge.
 */
export const NEAR_FIELD_Z = 0.5;

/** How big the debris from a burst is, as a multiple of a 1 kg charge's: tiny for a 20 mm shell, large for a 240 mm one. */
export function debrisScale(yieldKg: number): number {
  return Math.min(2.5, Math.max(0.15, Math.cbrt(Math.max(1e-6, yieldKg))));
}

/**
 * The TNT equivalent that goes into the free-air blast. A shaped or cutting charge drives much of its energy into the
 * jet along its axis and a cased charge into its fragments, so their sideways blast is a share of the total.
 */
export function airBlastYieldKg(blast: Pick<BlastSpec, 'yieldKg' | 'blastFraction'>): number {
  return blast.yieldKg * (blast.blastFraction ?? 1);
}

/** Scaled range, held at the near-field limit. */
function scaledRange(yieldKg: number, rangeM: number): number {
  return Math.max(NEAR_FIELD_Z, Math.max(0.3, rangeM) / Math.cbrt(Math.max(1e-6, yieldKg)));
}

/** Free-air overpressure (Mills fit) at a range from a yield of TNT, in kPa. */
export function overpressureKPa(yieldKg: number, rangeM: number): number {
  const z = scaledRange(yieldKg, rangeM);
  return Math.max(0, 1772 / z ** 3 - 114 / z ** 2 + 108 / z);
}

/**
 * Positive-phase impulse per square metre on a face turned to the charge, in Pa·s: Sadovsky's free-air estimate,
 * about 200 W^(2/3) / R, doubled for the reflection off the face, with the same near-field hold as the pressure.
 */
export function reflectedImpulsePaS(yieldKg: number, rangeM: number): number {
  const w = Math.max(1e-6, yieldKg);
  const r = scaledRange(w, rangeM) * Math.cbrt(w);
  return (2 * 200 * w ** (2 / 3)) / r;
}

/** What the blast has to roll over: a layer's body, the holder it stands in, and where they sit. */
export interface Stand {
  /** Body plus holder plus ballast, in kilograms; Infinity for what no lab charge moves (a berm, a tank, a building). */
  massKg: number;
  /** Height of the combined centre of mass above the floor, in metres. */
  comM: number;
  /** Distance from the centre of mass to the far edge of the base, along the blast, in metres: what it pivots about. */
  halfBaseM: number;
  /** Height above the floor where the blast pushes (the middle of the face), in metres. */
  loadM: number;
  /** The face the blast pushes on, in square metres. */
  areaM2: number;
}

/** The bench line: the middle of a lab target, above the floor (models/targets SHOT_Y). */
const BENCH_Y = 0.16;
/** Ballast sits on the feet of the holder, this high. */
const BALLAST_Y = 0.05;

/**
 * Each kind of holder (models/stands.ts), as the blast sees it. The test bed's holders are anchored the way a real
 * one is, with sandbags on their feet; masonry stands loose on its risers or mat and tips about its own thickness.
 */
const HOLDERS = {
  // Two posts and a beam on 25 cm feet, the plate on chains.
  hanger: { massKg: 10, halfBaseM: 0.125, ballastKg: 60 },
  // A clamping frame for glass, wood, drywall and composites.
  frame: { massKg: 8, halfBaseM: 0.15, ballastKg: 40 },
  // The lab cart under gel, water and other blocks.
  cart: { massKg: 25, halfBaseM: 0.25, ballastKg: 40 },
  // Timber risers or a rubber mat under masonry: nothing holds it but its own weight.
  floor: { massKg: 3, halfBaseM: 0, ballastKg: 0 },
} as const;

type Holder = keyof typeof HOLDERS | 'fixed';

/** Which holder a medium stands in: the same choice as `createSupport` in models/stands.ts. */
export function holderFor(spec: MediumSpec): Holder {
  switch (spec.look) {
    case 'mildSteel':
    case 'ar500':
    case 'gong':
      return 'hanger';
    case 'carDoorOuter':
    case 'carDoorInner':
    case 'glass':
    case 'phoneScreen':
    case 'polycarbonate':
    case 'fibreglass':
    case 'kevlar':
    case 'pine':
    case 'oak':
    case 'drywall':
    case 'paperStack':
    case 'mdf':
    case 'osb':
    case 'phoneBack':
    case 'phoneCell':
      return 'frame';
    case 'concrete':
    case 'brickWall':
    case 'sandbag':
    case 'cinderBlock':
    case 'cementBoard':
    case 'ceramicTile':
      return 'floor';
    case 'earthBerm':
    case 'tankHull':
    case 'blockHouse':
    case 'frameInfill':
    case 'frameColumn':
    case 'shedSheet':
      return 'fixed';
    default:
      return 'cart';
  }
}

/** The body, holder and ballast of a layer of `thickness`, as the blast sees them. */
export function standFor(spec: MediumSpec, thickness: number): Stand {
  const areaM2 = spec.heightM * spec.widthM;
  const holderKind = holderFor(spec);
  // Proving-ground targets (large plates in concrete footings, walls, berms, a tank) are not moved by a lab charge.
  if (holderKind === 'fixed' || spec.heavy) return { massKg: Infinity, comM: BENCH_Y, halfBaseM: 1, loadM: BENCH_Y, areaM2 };
  const holder = HOLDERS[holderKind];
  const body = spec.density * thickness * areaM2;
  // Masonry on the floor stands on its own base; held bodies sit at the bench line.
  const loadM = holderKind === 'floor' ? Math.max(BENCH_Y, spec.heightM / 2) : BENCH_Y;
  const massKg = body + holder.massKg + holder.ballastKg;
  const comM = (body * loadM + holder.massKg * loadM + holder.ballastKg * BALLAST_Y) / massKg;
  const halfBaseM = holderKind === 'floor' ? Math.max(0.02, thickness / 2) : holder.halfBaseM;
  return { massKg, comM, halfBaseM, loadM, areaM2 };
}

/**
 * How hard a blast impulse of `impulsePaS` (per square metre of face) pushes a stand toward going over: the kinetic
 * energy the impulse gives it as it starts to rock about the far edge of its base, over the energy it takes to lift
 * its centre of mass over that edge. 1 or more and it goes over.
 */
export function tipRatio(stand: Stand, impulsePaS: number): number {
  if (!Number.isFinite(stand.massKg)) return 0;
  const { massKg: m, comM: h, halfBaseM: b, loadM, areaM2 } = stand;
  // A rigid block rocking about its far bottom edge (a uniform box's moment of inertia about an edge).
  const inertia = (4 / 3) * m * (h * h + b * b);
  const angularImpulse = impulsePaS * areaM2 * loadM;
  const energy = (angularImpulse * angularImpulse) / (2 * inertia);
  const lift = m * G * (Math.hypot(h, b) - h);
  return energy / lift;
}

/**
 * What a material does under a pressure ratio `k`, by its kind: light panels shatter or break up, heavy materials
 * crack. Whether a layer also goes over is the impulse's business (`tipRatio`), not the pressure's.
 */
export function outcomeFor(behaviour: MediumBehaviour, k: number): { outcome: 'intact' | 'cracked' | 'destroyed' } {
  if (k < 1) return { outcome: 'intact' };
  if (behaviour === 'glass' || behaviour === 'ice' || behaviour === 'drywall' || behaviour === 'plastic') return { outcome: 'destroyed' };
  if (behaviour === 'wood') return { outcome: k >= 2.5 ? 'destroyed' : 'cracked' };
  return { outcome: 'cracked' };
}

/** How far a layer that goes over ends up tipped: past its balance point, further the harder it was pushed. */
function tiltFor(stand: Stand, tip: number): number {
  const balance = Math.atan2(stand.halfBaseM, stand.comM);
  return Math.min(1.3, balance + 0.25 * Math.log2(1 + tip));
}

/**
 * Responds each stack layer to a charge whose free-air blast is `yieldKg` of TNT (see `airBlastYieldKg`) and whose
 * front-most face is `standoffM` away. Layers are taken front to back, one entry per stack layer.
 */
export function blastResponse(yieldKg: number, standoffM: number, layers: TargetLayer[]): LayerBlast[] {
  const out: LayerBlast[] = [];
  const seen = new Set<number>();
  let passes = 1;
  for (const layer of layers) {
    const stack = layer.stack ?? out.length;
    if (seen.has(stack)) continue;
    seen.add(stack);
    const rangeM = Math.max(0.1, standoffM + layer.offset);
    const pressureKPa = overpressureKPa(yieldKg, rangeM) * passes;
    // Thicker material than its default takes proportionally more.
    const limit = FAILURE_KPA[layer.medium.behaviour] * Math.max(0.25, layer.thickness / layer.medium.thickness.default);
    const k = pressureKPa / limit;
    const stand = standFor(layer.medium, layer.thickness);
    const tip = tipRatio(stand, reflectedImpulsePaS(yieldKg, rangeM) * passes);
    const material = outcomeFor(layer.medium.behaviour, k).outcome;
    const outcome: BlastOutcome = material !== 'destroyed' && tip >= 1 ? 'toppled' : material;
    const tiltRad = outcome === 'toppled' ? tiltFor(stand, tip) : 0;
    out.push({ stack, medium: layer.medium, rangeM, pressureKPa, k, tip, outcome, arriveS: rangeM / (SOUND_MS + 0.6 * pressureKPa), tiltRad });
    passes *= outcome === 'intact' ? PASSES_INTACT : outcome === 'cracked' ? PASSES_CRACKED : PASSES_FAILED;
  }
  return out;
}
