/** Width of the preview window at scale 1, in metres: wide enough for the 75 mm cannon shell. */
export const BASE_VIEW_WIDTH_M = 0.09;
/** Room kept either side of the round along the ruler, and the tallest round that fits at scale 1 (the window is short), in metres. */
const LENGTH_MARGIN_M = 0.012;
const FIT_HEIGHT_M = 0.028;
/** Zoom-out steps: the ruler keeps its 1 mm ticks times this, so each step is a whole number of millimetres. */
const SCALES = [1, 2, 5, 10, 20, 50, 100];

/** The smallest zoom-out at which a round of this length and diameter (metres) fits the preview (#preview-fit). */
export function previewScale(lengthM: number, diameterM: number): number {
  const need = Math.max((lengthM + LENGTH_MARGIN_M) / (BASE_VIEW_WIDTH_M - LENGTH_MARGIN_M / 2), (diameterM * 1.1) / FIT_HEIGHT_M);
  return SCALES.find((s) => s >= need) ?? SCALES[SCALES.length - 1];
}

/** The note under the preview: true scale, with what each ruler tick is. */
export function scaleNote(scale: number): string {
  return scale === 1 ? 'True scale, ruler in mm' : `True scale, ruler ticks ${scale} mm`;
}
