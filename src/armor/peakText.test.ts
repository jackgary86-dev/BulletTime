import { describe, expect, it } from 'vitest';
import { peakStressText, peakTemperatureText } from './peakText';

const peaks = { temperatureC: 1891.4, molten: true, stressRatio: 5.46, stressGPa: 5.46 };

describe('peak readouts in the Armor lab results (#157)', () => {
  it('writes the temperature to the degree, flagging a molten interface', () => {
    expect(peakTemperatureText(peaks)).toBe('1,891 °C (molten interface)');
    expect(peakTemperatureText({ ...peaks, temperatureC: 600.2, molten: false })).toBe('600 °C');
  });

  it('writes the stress in GPa and in multiples of yield', () => {
    expect(peakStressText(peaks, 'apfsds')).toBe('5.5 GPa (5.5 × yield)');
    expect(peakStressText({ ...peaks, stressGPa: 12.34, stressRatio: 12.3 }, 'heat')).toBe('12 GPa (12.3 × yield)');
  });

  it('does not quote a zero for the family whose stress is not modelled', () => {
    expect(peakStressText({ ...peaks, stressRatio: 0, stressGPa: 0 }, 'he-frag')).toBe('not modelled for fragments');
  });
});
