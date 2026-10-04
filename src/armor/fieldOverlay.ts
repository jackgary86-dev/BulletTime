/**
 * Armor lab (#167): turns a field (#166) into pixels for the cross-section.
 * Pure: it samples the field on a coarse grid over the plate, maps each value
 * to a colour with a palette that reads on the dark lab background and is
 * colour-blind friendly (inferno for heat, viridis for stress, a blue-red
 * diverging map for pressure, tension blue and compression red), and hands
 * back an RGBA buffer the canvas upscales. `sectionDraw.ts` paints it with its
 * legend; nothing here touches a canvas.
 */

import { fieldContext, fieldGrid, fieldScale, type FieldKind, type FieldScale } from './fields';
import type { ArmorTimeline } from './model';
import type { SectionLayout } from './section';

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

/** Palette stops, evenly spaced from 0 to 1. */
const INFERNO: Rgb[] = [
  [0, 0, 4],
  [40, 11, 84],
  [101, 21, 110],
  [159, 42, 99],
  [212, 72, 66],
  [245, 125, 21],
  [250, 193, 39],
  [252, 255, 164],
];
const VIRIDIS: Rgb[] = [
  [68, 1, 84],
  [70, 50, 126],
  [54, 92, 141],
  [39, 127, 142],
  [31, 161, 135],
  [74, 193, 109],
  [160, 218, 57],
  [253, 231, 37],
];
/** Pressure: tension is blue, compression is red; both brighten away from zero. */
const TENSION: Rgb = [66, 135, 245];
const COMPRESSION: Rgb = [245, 80, 60];
/** Molten metal in a jet or rod interface. */
export const MOLTEN_RGB: Rgb = [255, 248, 225];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Interpolates a palette at `v` (0 to 1). */
export function paletteColor(stops: Rgb[], v: number): Rgb {
  const x = clamp01(v) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** The palette behind each field's scale, for the legend. */
export function palette(kind: FieldKind): Rgb[] {
  return kind === 'temperature' ? INFERNO : kind === 'stress' ? VIRIDIS : [TENSION, [24, 26, 32], COMPRESSION];
}

/**
 * Colour of a value on a field's scale, with an alpha that fades the
 * unremarkable values (cold metal, elastic stress, no pressure) so the sawn
 * plate shows through them.
 */
export function fieldColor(scale: FieldScale, value: number, molten = false): Rgba {
  if (molten) return [...MOLTEN_RGB, 0.95];
  const span = scale.max - scale.min;
  if (scale.diverging) {
    const m = clamp01(Math.abs(value) / Math.max(Math.abs(scale.max), Math.abs(scale.min)));
    const base = value < 0 ? TENSION : COMPRESSION;
    const k = 0.35 + 0.65 * m;
    return [base[0] * k, base[1] * k, base[2] * k, 0.95 * m ** 0.4];
  }
  const v = clamp01((value - scale.min) / span);
  const [r, g, b] = paletteColor(palette(scale.kind), v);
  return [r, g, b, 0.9 * clamp01(v * 5)];
}

/** What the renderer needs: the colours of a field over the plate, and its legend. */
export interface FieldOverlay {
  kind: FieldKind;
  scale: FieldScale;
  cols: number;
  rows: number;
  /** RGBA bytes, `cols` × `rows`, row 0 at the top, straight (not premultiplied) alpha. */
  rgba: Uint8ClampedArray;
  /** The field's real-unit values behind it, in the same order. */
  values: Float32Array;
  /** Number of cells that are molten (temperature only). */
  moltenCells: number;
}

/** Cells across the plate at most, and cells per pixel-row aspect: coarse on purpose, the canvas upscales it. */
export const OVERLAY_MAX_COLS = 110;
export const OVERLAY_CELL_PX = 6;

/**
 * The overlay for a field at time `t` (s since impact): sampled over the whole
 * plate section, full height of the view, on a grid about `OVERLAY_CELL_PX`
 * pixels a cell.
 */
export function buildOverlay(timeline: ArmorTimeline, t: number, kind: FieldKind, layout: SectionLayout): FieldOverlay {
  const ctx = fieldContext(timeline, t);
  const scale = fieldScale(kind, timeline);
  const cols = Math.max(8, Math.min(OVERLAY_MAX_COLS, Math.round(layout.plate.width / OVERLAY_CELL_PX)));
  const rows = Math.max(8, Math.round(layout.height / OVERLAY_CELL_PX));
  const halfHeightM = layout.height / 2 / layout.pxPerM;
  const grid = fieldGrid(ctx, kind, cols, rows, halfHeightM);
  const rgba = new Uint8ClampedArray(cols * rows * 4);
  let moltenCells = 0;
  for (let k = 0; k < grid.values.length; k++) {
    const molten = grid.molten[k] === 1;
    if (molten) moltenCells++;
    const [r, g, b, a] = fieldColor(scale, grid.values[k], molten);
    rgba[4 * k] = r;
    rgba[4 * k + 1] = g;
    rgba[4 * k + 2] = b;
    rgba[4 * k + 3] = Math.round(a * 255);
  }
  return { kind, scale, cols, rows, rgba, values: grid.values, moltenCells };
}

/** Legend ticks for a scale: value, position along the bar (0 at the bottom, 1 at the top) and label. */
export interface LegendTick {
  value: number;
  position: number;
  label: string;
}

const fmt = (v: number, unit: string) => {
  const rounded = Math.abs(v) >= 100 ? Math.round(v) : Math.abs(v) >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;
  return `${rounded} ${unit}`.trim();
};

/** Ticks for the legend: the two ends, the middle, and for stress the yield line and for pressure zero. */
export function legendTicks(scale: FieldScale): LegendTick[] {
  const span = scale.max - scale.min;
  const at = (value: number, label?: string): LegendTick => ({ value, position: (value - scale.min) / span, label: label ?? fmt(value, scale.unit) });
  const ticks = [at(scale.max), at(scale.min)];
  if (scale.diverging) ticks.splice(1, 0, at(0, `0 ${scale.unit}`));
  else if (scale.kind === 'stress') ticks.splice(1, 0, at(1, '1 (yield)'));
  else ticks.splice(1, 0, at((scale.min + scale.max) / 2));
  return ticks;
}

/** The note shown under every legend, so nobody mistakes the colours for a finite-element solve. */
export const TEACHING_NOTE = 'Teaching approximation, not a finite-element solve';

/** A round length for the scale bar (m): the biggest of 1, 2, 5 times a power of ten that fits `maxPx` pixels at `pxPerM`. */
export function niceScaleLength(pxPerM: number, maxPx: number): number {
  const maxM = maxPx / pxPerM;
  if (!(maxM > 0) || !Number.isFinite(maxM)) return 0.01;
  const exp = Math.floor(Math.log10(maxM));
  for (const m of [5, 2, 1]) {
    const length = m * 10 ** exp;
    if (length <= maxM) return length;
  }
  return 10 ** exp;
}

/** Text for a scale bar length: millimetres, or metres from a metre up. */
export function scaleLabel(lengthM: number): string {
  return lengthM >= 1 ? `${lengthM} m` : `${Math.round(lengthM * 1000 * 100) / 100} mm`;
}
