/**
 * Hard-coded shot for the end-to-end slice (#2): a 9mm 124 gr JHP into a 10%
 * ballistic gelatin block. The bullet (#3) and media (#4) catalogues replace this.
 */
export const SLICE_BULLET = {
  name: '9mm Luger 124 gr JHP',
  massKg: 0.00804, // 124 grains
  diameterM: 0.00901,
  muzzleVelocity: 360, // m/s (≈ 1,180 ft/s)
  expandedDiameterM: 0.0155, // typical recovered JHP diameter in gel
  expansionDistanceM: 0.02, // the petals open over roughly the first 2 cm
} as const;

export const SLICE_GEL = {
  name: '10% ballistic gelatin',
  density: 1030, // kg/m³
  // Tuned together so the expanded 9mm JHP stops at about 33 cm, inside the
  // usual 30–40 cm reference range for this round.
  dragCoefficient: 0.3,
  resistancePa: 2.0e6,
} as const;

/** The bullet starts this far in front of the target face, in metres. */
export const SLICE_STAND_OFF_M = 0.5;
