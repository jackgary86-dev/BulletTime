import { describe, expect, it } from 'vitest';
import { QUALITY } from '../scene/quality';
import { motorLight } from './missileTrail';

describe('missile motor light (#247)', () => {
  it('is brighter and reaches further for a bigger motor', () => {
    const small = motorLight(1, 0.07, 0);
    const big = motorLight(6, 0.52, 0);
    expect(big.intensity).toBeGreaterThan(small.intensity);
    expect(big.distance).toBeGreaterThan(small.distance);
  });

  it('keeps its reach between 3 and 30 m and sits behind the nozzle', () => {
    for (const [length, diameter] of [[0.3, 0.02], [1, 0.07], [1.75, 0.178], [6, 0.52], [40, 3]]) {
      const light = motorLight(length, diameter, 1.3);
      expect(light.distance).toBeGreaterThanOrEqual(3);
      expect(light.distance).toBeLessThanOrEqual(30);
      expect(light.offset).toBeGreaterThan(length);
    }
  });

  it('flickers a little but never dies or doubles', () => {
    const base = motorLight(1.6, 0.127, 0).intensity;
    for (let now = 0; now < 5; now += 0.013) {
      const i = motorLight(1.6, 0.127, now).intensity;
      expect(i).toBeGreaterThan(0.7 * base);
      expect(i).toBeLessThan(1.4 * base);
    }
  });
});

describe('plume quality (#247)', () => {
  it('draws fewer layers and no light on Low, more as quality rises', () => {
    expect(QUALITY.low.plumeLayers).toBe(1);
    expect(QUALITY.low.motorLight).toBe(false);
    expect(QUALITY.medium.plumeLayers).toBeGreaterThan(QUALITY.low.plumeLayers);
    expect(QUALITY.high.plumeLayers).toBeGreaterThanOrEqual(QUALITY.medium.plumeLayers);
    expect(QUALITY.ultra.plumeLayers).toBe(3);
    expect(QUALITY.medium.motorLight && QUALITY.high.motorLight && QUALITY.ultra.motorLight).toBe(true);
  });
});
