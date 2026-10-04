import type { MediumBehaviour, MediumSpec } from '../data/media';
import type { TargetLayer } from './engine';

/**
 * How the material in front of a charge responds to its blast (#196): the
 * overpressure that reaches each target layer from its own distance, shielded by
 * the layers in front of it, set against what that material can take. Pure, so
 * the results panel, the effects and the tests all agree.
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
  outcome: BlastOutcome;
  /** Seconds after detonation that the shock front reaches the face. */
  arriveS: number;
  /** How far it tips over, as an angle in radians (0 unless toppled). */
  tiltRad: number;
}

const SOUND_MS = 343;
/** Fraction of the shock that gets past a layer, by how it fared: a wall that holds blocks most of it. */
const PASSES_INTACT = 0.15;
const PASSES_CRACKED = 0.5;
const PASSES_FAILED = 0.8;

/** How big the debris from a burst is, as a multiple of a 1 kg charge's: tiny for a 20 mm shell, large for a 240 mm one. */
export function debrisScale(yieldKg: number): number {
  return Math.min(2.5, Math.max(0.15, Math.cbrt(Math.max(1e-6, yieldKg))));
}

/** Free-air overpressure (Mills fit) at a range from a yield of TNT, in kPa. */
export function overpressureKPa(yieldKg: number, rangeM: number): number {
  const z = Math.max(0.3, rangeM) / Math.cbrt(Math.max(1e-6, yieldKg));
  return Math.max(0, 1772 / z ** 3 - 114 / z ** 2 + 108 / z);
}

/** Outcome of a layer for a pressure ratio `k`, by the kind of material. */
export function outcomeFor(behaviour: MediumBehaviour, k: number): { outcome: BlastOutcome; tiltRad: number } {
  if (k < 1) return { outcome: 'intact', tiltRad: 0 };
  if (behaviour === 'glass' || behaviour === 'ice' || behaviour === 'drywall' || behaviour === 'plastic') return { outcome: 'destroyed', tiltRad: 0 };
  if (behaviour === 'wood') return k >= 2.5 ? { outcome: 'destroyed', tiltRad: 0 } : { outcome: 'toppled', tiltRad: Math.min(1.3, 0.35 * k) };
  // Heavy materials crack first, and only go over when the ratio is very high.
  if (k < 6) return { outcome: 'cracked', tiltRad: 0 };
  return { outcome: 'toppled', tiltRad: Math.min(1.1, 0.15 * k) };
}

/**
 * Responds each stack layer to a charge of `yieldKg` whose front-most face is
 * `standoffM` away. Layers are taken front to back, one entry per stack layer.
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
    const { outcome, tiltRad } = outcomeFor(layer.medium.behaviour, k);
    out.push({ stack, medium: layer.medium, rangeM, pressureKPa, k, outcome, arriveS: rangeM / (SOUND_MS + 0.6 * pressureKPa), tiltRad });
    passes *= outcome === 'intact' ? PASSES_INTACT : outcome === 'cracked' ? PASSES_CRACKED : PASSES_FAILED;
  }
  return out;
}
