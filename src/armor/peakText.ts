import type { FieldPeaks } from './fields';

/** `1,340 °C`, with a note when the hottest metal is the molten interface of a jet or a rod. */
export function peakTemperatureText(peaks: FieldPeaks): string {
  return `${Math.round(peaks.temperatureC).toLocaleString('en-US')} °C${peaks.molten ? ' (molten interface)' : ''}`;
}

/**
 * `5.5 GPa (5.5 × yield)`: the von Mises stress and how far past plastic flow it is. The stress field has no model
 * for a spray of small fragments (it reads zero everywhere), so the panel says so instead of quoting a false zero.
 */
export function peakStressText(peaks: FieldPeaks, family: string): string {
  if (family === 'he-frag') return 'not modelled for fragments';
  return `${peaks.stressGPa.toFixed(peaks.stressGPa >= 10 ? 0 : 1)} GPa (${peaks.stressRatio.toFixed(1)} × yield)`;
}
