/**
 * The mark a shell's burst leaves on a steel face (#240): not one flat grey shape, but layers a viewer reads as a
 * blast on metal: a wide sooty scorch, a patch of scoured bare steel, a scorched inner ring, a bright pitted
 * centre, soot streaks thrown outward and fine shrapnel scratches. Sized by the yield, so a 40 mm shell leaves a
 * palm-sized mark and a 127 mm shell a dinner-plate one. Pure layout: `hardEffect.ts` draws it.
 */

/** Bursts below this yield (kg of TNT) leave the ordinary strike mark: it is primer and fuze, not a blast. */
export const MIN_SCAR_YIELD_KG = 0.03;
/** Scar radius per cube root of the yield, in metres. */
const SCAR_M_PER_KG13 = 0.16;

export interface ScarLayer {
  /** Fraction of the scar radius. */
  radius: number;
  color: number;
  roughness: number;
  metalness: number;
  /** Edge irregularity, 0 to 1. */
  irregularity: number;
  /** Drawn as a soft-edged soot cloud instead of a hard-edged shape. */
  soft?: boolean;
}

/** Back to front: each layer is drawn a hair above the one before, so the order is the stacking. */
export const SCAR_LAYERS: readonly ScarLayer[] = [
  { radius: 2.6, color: 0x24211f, roughness: 1, metalness: 0, irregularity: 0.5, soft: true },
  { radius: 1.45, color: 0x7f858c, roughness: 0.4, metalness: 0.85, irregularity: 0.35 },
  { radius: 0.95, color: 0x3a3631, roughness: 0.95, metalness: 0.1, irregularity: 0.3 },
  { radius: 0.5, color: 0xdfe3e7, roughness: 0.28, metalness: 0.75, irregularity: 0.22 },
];

/** Radius of the scar a burst of `yieldKg` leaves, or 0 when it is too small to scar. At least a calibre across. */
export function scarRadiusM(yieldKg: number, calibreM: number): number {
  if (yieldKg < MIN_SCAR_YIELD_KG) return 0;
  return Math.max(calibreM * 0.9, SCAR_M_PER_KG13 * Math.cbrt(yieldKg));
}
