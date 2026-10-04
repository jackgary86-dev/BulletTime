import { describe, expect, it } from 'vitest';
import { ARMOR_BEAT_SHARES, IMPACT_BEAT, armorBeat, beatExtraRealS, beatFactor, beatSpans } from './impactBeat';

const { leadS, holdS, rampS, factor } = IMPACT_BEAT;

describe('impact beat (#238)', () => {
  it('is full speed away from impacts and a tenth speed through the hold', () => {
    const impacts = [2e-3];
    expect(beatFactor(0, impacts)).toBe(1);
    expect(beatFactor(2e-3 - leadS - 1e-9, impacts)).toBe(1);
    expect(beatFactor(2e-3, impacts)).toBe(factor);
    expect(beatFactor(2e-3 + holdS / 2, impacts)).toBe(factor);
    expect(beatFactor(2e-3 + holdS + rampS, impacts)).toBe(1);
    expect(beatFactor(1, impacts)).toBe(1);
    expect(beatFactor(0.5, [])).toBe(1);
  });

  it('is continuous and stays between the hold factor and 1', () => {
    const impacts = [1e-3, 1.05e-3, 6e-3];
    const dt = 1e-6;
    let prev = beatFactor(-1e-3, impacts);
    for (let t = -1e-3; t < 12e-3; t += dt) {
      const f = beatFactor(t, impacts);
      expect(f).toBeGreaterThanOrEqual(factor);
      expect(f).toBeLessThanOrEqual(1);
      // The steepest slope is the lead-in: (1 − factor) × 1.5 / leadS per second.
      expect(Math.abs(f - prev)).toBeLessThanOrEqual(((1 - factor) * 1.5 * dt) / leadS + 1e-9);
      prev = f;
    }
  });

  it('eases in before contact and ramps out after the hold, monotonically on each side', () => {
    const impacts = [0];
    let prev = 1;
    for (let t = -leadS; t <= 0; t += leadS / 50) {
      const f = beatFactor(t, impacts);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
    prev = factor;
    for (let t = holdS; t <= holdS + rampS; t += rampS / 50) {
      const f = beatFactor(t, impacts);
      expect(f).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = f;
    }
  });

  it('a cluster of pellet strikes is one beat, with the deepest slow-down winning', () => {
    const pellets = Array.from({ length: 9 }, (_, i) => 1e-3 + i * 1.2e-5);
    expect(beatFactor(1e-3 + 5e-5, pellets)).toBe(factor);
    for (let t = 1e-3; t < 1e-3 + holdS; t += 1e-5) expect(beatFactor(t, pellets)).toBe(factor);
    expect(beatSpans(pellets)).toHaveLength(1);
    const [[from, to]] = beatSpans(pellets);
    expect(from).toBeCloseTo(1e-3 - leadS, 12);
    expect(to).toBeCloseTo(pellets[8] + holdS + rampS, 12);
  });

  it('merges overlapping spans and keeps separate ones apart, in time order', () => {
    const spans = beatSpans([10e-3, 1e-3, 1.5e-3]);
    expect(spans).toEqual([
      [1e-3 - leadS, 1.5e-3 + holdS + rampS],
      [10e-3 - leadS, 10e-3 + holdS + rampS],
    ]);
  });

  it('adds at most the whole window at the hold rate to the real play time', () => {
    const rate = 1 / 1000;
    const impacts = [2e-3];
    const duration = 10e-3;
    const integrate = (beat: boolean) => {
      let t = 0;
      let real = 0;
      const frame = 1 / 60;
      while (t < duration) {
        t += frame * rate * (beat ? beatFactor(t, impacts) : 1);
        real += frame;
      }
      return real;
    };
    const extra = integrate(true) - integrate(false);
    expect(extra).toBeGreaterThan(1);
    expect(extra).toBeLessThanOrEqual(beatExtraRealS(rate) + 1 / 60);
  });

  it('the Armor lab beat scales with the playback length', () => {
    const shape = armorBeat(200e-6);
    expect(shape.leadS).toBeCloseTo(ARMOR_BEAT_SHARES.lead * 200e-6, 15);
    expect(shape.holdS).toBeCloseTo(ARMOR_BEAT_SHARES.hold * 200e-6, 15);
    expect(shape.rampS).toBeCloseTo(ARMOR_BEAT_SHARES.ramp * 200e-6, 15);
    expect(shape.factor).toBe(factor);
    expect(beatFactor(0, [0], shape)).toBe(factor);
    expect(beatFactor(100e-6, [0], shape)).toBe(1);
  });
});
