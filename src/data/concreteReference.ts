/**
 * Measured reference data for concrete panel perforation, read from the lab figures
 * (three concrete strengths, bullet at about 155 m/s). Point values read off plots are
 * good to about ±5 m/s. The illustrative comparison posters are NOT sources for this file.
 * See docs/material-reference/index.html for the matching visuals.
 */

export interface ConcretePanelReference {
  id: 'C35' | 'C75' | 'C110';
  /** Cube compressive strength, MPa. */
  cubeStrengthMPa: number;
  /** Test ballistic limit, m/s. */
  ballisticLimitMs: number;
  /** Recht–Ipson points: [initial, residual] velocity in m/s. */
  test: ReadonlyArray<readonly [number, number]>;
  /** Single shots with a section photo: initial and residual velocity, m/s. */
  section: { initialMs: number; residualMs: number };
  /** Front spall and back scab footprint, width × height in millimetres. */
  spallMm: readonly [number, number];
  scabMm: readonly [number, number];
}

export const CONCRETE_REFERENCE: readonly ConcretePanelReference[] = [
  {
    id: 'C35', cubeStrengthMPa: 47, ballisticLimitMs: 120,
    test: [[120, 0], [138, 45], [155, 55], [185, 105], [207, 122], [247, 173], [295, 219]],
    section: { initialMs: 155.3, residualMs: 55.3 }, spallMm: [80, 70], scabMm: [150, 130],
  },
  {
    id: 'C75', cubeStrengthMPa: 87, ballisticLimitMs: 140.5,
    test: [[117, 0], [158, 47], [170, 68], [207, 115], [252, 170], [298, 229]],
    section: { initialMs: 170.2, residualMs: 68.1 }, spallMm: [100, 100], scabMm: [180, 160],
  },
  {
    id: 'C110', cubeStrengthMPa: 123, ballisticLimitMs: 152.5,
    test: [[152, 0], [155, 27], [165, 15], [182, 51], [205, 83], [253, 152], [302, 209]],
    section: { initialMs: 153.6, residualMs: 43.3 }, spallMm: [80, 90], scabMm: [220, 200],
  },
];

/** Time for the bullet to lose most of its speed crossing the panel, in ms (all three strengths). */
export const CONCRETE_DECEL_MS = 0.5;
