import type { MediumSpec } from '../data/media';

/**
 * Size of the damage a bullet leaves on a concrete panel (#223): a spall crater on the struck face and a larger
 * scab on the back. The measured footprints are at the reference thickness; thicker panels grow the scab most
 * (its cone is wider the further the crack fan travels) and the front spall only a little.
 */
export interface Footprint {
  /** Width and height across the face, in metres. */
  w: number;
  h: number;
}

const SCALE_MIN = 0.5;
const SCALE_MAX = 2;

export function concreteFootprint(medium: MediumSpec, thicknessM: number, side: 'spall' | 'scab'): Footprint | undefined {
  const d = medium.concreteDamage;
  if (!d) return undefined;
  const k = Math.min(SCALE_MAX, Math.max(SCALE_MIN, thicknessM / d.refThicknessM));
  const scale = side === 'spall' ? 0.85 + 0.15 * k : 0.5 + 0.5 * k;
  const [w, h] = side === 'spall' ? d.spallM : d.scabM;
  return { w: w * scale, h: h * scale };
}
