import type { MediumSpec } from './media';

/** Manufacturers' Standard Gauge for sheet steel, in metres, thick to thin (#261). */
const STEEL_GAUGES: readonly { gauge: number; thicknessM: number }[] = [
  { gauge: 10, thicknessM: 0.00342 },
  { gauge: 11, thicknessM: 0.00304 },
  { gauge: 12, thicknessM: 0.00266 },
  { gauge: 14, thicknessM: 0.0019 },
  { gauge: 16, thicknessM: 0.00152 },
  { gauge: 18, thicknessM: 0.00121 },
  { gauge: 20, thicknessM: 0.00091 },
  { gauge: 22, thicknessM: 0.00076 },
  { gauge: 24, thicknessM: 0.00061 },
  { gauge: 26, thicknessM: 0.00046 },
];

/** The sheets that are sold by steel gauge. */
const GAUGED = new Set(['steel-mild', 'steel-stainless', 'steel-galvanised', 'sheet-metal']);

/** How close to a gauge a thickness must be to be called by it, as a fraction. */
const GAUGE_TOLERANCE = 0.04;

/** The steel gauge a thickness of `medium` goes by, or null when it is not a gauged sheet or sits between gauges. */
export function gaugeOf(medium: Pick<MediumSpec, 'id'>, thicknessM: number): number | null {
  if (!GAUGED.has(medium.id)) return null;
  const hit = STEEL_GAUGES.find((g) => Math.abs(g.thicknessM - thicknessM) / g.thicknessM <= GAUGE_TOLERANCE);
  return hit ? hit.gauge : null;
}

/** A length for the panels: millimetres below 3 cm, else centimetres. */
export function formatLength(metres: number): string {
  return metres < 0.03 ? `${(metres * 1000).toFixed(1)} mm` : `${(metres * 100).toFixed(1)} cm`;
}

/** A layer's thickness as the panels show it: the gauge first for gauged sheet steel, always the millimetres ("16 ga · 1.5 mm"). */
export function formatThickness(medium: Pick<MediumSpec, 'id'>, thicknessM: number): string {
  const gauge = gaugeOf(medium, thicknessM);
  return gauge === null ? formatLength(thicknessM) : `${gauge} ga · ${formatLength(thicknessM)}`;
}
