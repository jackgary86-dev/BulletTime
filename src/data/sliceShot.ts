/**
 * Hard-coded medium for the end-to-end slice (#2): a 10% ballistic gelatin
 * block. The media catalogue (#4) replaces this.
 */
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
