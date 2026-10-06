/**
 * A blast on a thin panel (#240): a shell or warhead bursting on drywall, board or plastic blows a ragged hole
 * through it, sized by the yield, instead of leaving the sheet looking untouched while the fragments go through.
 */

/** Hole radius per cube root of the TNT-equivalent yield in kilograms, by how well the panel stands up to it. */
const BREACH_M_PER_KG13: Record<string, number> = { drywall: 0.22, plastic: 0.18, wood: 0.13 };
/** Bursts below this yield are fuze and primer noise, not a breach. */
export const MIN_BREACH_YIELD_KG = 0.03;
/** Most small fragment holes drawn in one panel, so a big shell does not tile the sheet with marks. */
export const MAX_FRAGMENT_HOLES = 30;

/** Radius of the hole a burst of `yieldKg` blows in a panel of this behaviour, capped at 45% of the face's short side. */
export function breachRadiusM(yieldKg: number, behaviour: string, faceM: number): number {
  if (yieldKg < MIN_BREACH_YIELD_KG) return 0;
  const k = BREACH_M_PER_KG13[behaviour] ?? 0;
  return Math.min(k * Math.cbrt(yieldKg), 0.45 * faceM);
}

/** Radius of the small hole a fragment of this diameter (metres) punches. */
export function fragmentHoleRadiusM(diameterM: number): number {
  return Math.max(0.003, diameterM * 0.6);
}
