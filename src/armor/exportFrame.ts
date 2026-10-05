import { getFamily } from './munitions';
import type { StackTimeline } from './stack';

/**
 * Saving a frame of the cross-section as a PNG for slides (#173): the file
 * name and the two caption lines burnt in under the picture. Pure, so the
 * wording can be tested; `ui/armorLab.ts` paints and downloads it.
 */

/** Width and height of the saved picture's section, px; the caption band goes below it. */
export const EXPORT_SIZE = { width: 1600, height: 900, band: 84 } as const;

const fmtTime = (s: number) => (s < 1e-3 ? `${(s * 1e6).toFixed(s < 1e-4 ? 1 : 0)} µs` : s < 1 ? `${(s * 1e3).toFixed(1)} ms` : `${s.toFixed(2)} s`);
const fmtMm = (m: number) => `${Math.round(m * 1000)} mm`;

/** What was fired at what, like "120 mm APFSDS long rod → 200 mm RHA (rolled homogeneous armor) at 0°" (plates joined with " + "). */
export function exportSubject(stack: StackTimeline): string {
  const impact = stack.shot.impact;
  const plates = stack.shot.layers.map((l) => `${fmtMm(l.thicknessM)} ${l.material.name.split(' (')[0]}`).join(' + ');
  return `${impact.calibreMm} mm ${getFamily(impact.family).name} → ${plates} at ${Math.round(stack.shot.obliquityDeg)}°`;
}

/** The two lines under the picture: the setup and the moment, then what is happening and the model note. */
export function exportCaption(stack: StackTimeline, t: number, eventLabel: string): [string, string] {
  return [`BulletTime Armor lab · ${exportSubject(stack)} · t = ${fmtTime(t)}`, `${eventLabel ? `${eventLabel}. ` : ''}Simplified teaching model, not engineering data.`];
}

/** A file name safe on every system, like "bullettime-armor-apfsds-120mm-63us.png". */
export function exportFileName(stack: StackTimeline, t: number): string {
  const impact = stack.shot.impact;
  const time = t < 1e-3 ? `${Math.round(t * 1e6)}us` : `${Math.round(t * 1e3)}ms`;
  return `bullettime-armor-${impact.family}-${impact.calibreMm}mm-${time}.png`.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
}
