import { describe, expect, it } from 'vitest';
import {
  SLOW_FACTOR,
  WARP_HOLD_S,
  WARP_LEAD_S,
  WARP_RAMP_S,
  advanceWarped,
  warpAfter,
  warpAt,
  warpedPlayTimeS,
} from './timeWarp';

const RATE = 1 / 1000;

describe('impact slow-motion warp (#238)', () => {
  it('runs at full speed well before and well after the beat', () => {
    expect(warpAfter(-1)).toBe(1);
    expect(warpAfter(WARP_HOLD_S + WARP_RAMP_S)).toBe(1);
    expect(warpAfter(1)).toBe(1);
  });

  it('holds at a tenth of the chosen speed from first contact', () => {
    expect(warpAfter(0)).toBeCloseTo(SLOW_FACTOR, 12);
    expect(warpAfter(WARP_HOLD_S / 2)).toBeCloseTo(SLOW_FACTOR, 12);
    expect(warpAfter(WARP_HOLD_S)).toBeCloseTo(SLOW_FACTOR, 12);
  });

  it('is continuous and stays between the slow factor and 1', () => {
    let previous = warpAfter(-2 * WARP_LEAD_S);
    for (let tau = -2 * WARP_LEAD_S; tau < WARP_HOLD_S + 2 * WARP_RAMP_S; tau += 1e-7) {
      const w = warpAfter(tau);
      expect(w).toBeGreaterThanOrEqual(SLOW_FACTOR - 1e-12);
      expect(w).toBeLessThanOrEqual(1 + 1e-12);
      expect(Math.abs(w - previous)).toBeLessThan(0.01);
      previous = w;
    }
  });

  it('eases down into the hold and back out, never speeding up on the way in or slowing on the way out', () => {
    let previous = 1;
    for (let tau = -WARP_LEAD_S; tau <= 0; tau += 1e-7) {
      const w = warpAfter(tau);
      expect(w).toBeLessThanOrEqual(previous + 1e-12);
      previous = w;
    }
    previous = SLOW_FACTOR;
    for (let tau = WARP_HOLD_S; tau <= WARP_HOLD_S + WARP_RAMP_S; tau += 1e-7) {
      const w = warpAfter(tau);
      expect(w).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = w;
    }
  });

  it('uses the slowest of overlapping beats from a burst of rounds', () => {
    const impacts = [0, 0.08];
    expect(warpAt(0.08 + WARP_HOLD_S / 2, impacts)).toBeCloseTo(SLOW_FACTOR, 12);
    expect(warpAt(0.04, impacts)).toBe(1);
    expect(warpAt(0.5, [])).toBe(1);
  });

  it('advances the clock monotonically and slower inside the beat', () => {
    const impacts = [1e-3];
    let t = 0;
    let previous = t;
    for (let i = 0; i < 20_000; i++) {
      t = advanceWarped(t, 1 / 60, RATE, impacts);
      expect(t).toBeGreaterThan(previous);
      previous = t;
      if (t > 20e-3) break;
    }
    const before = advanceWarped(0, 1 / 60, RATE, impacts);
    expect(before).toBeCloseTo(RATE / 60, 12);
    const inHold = advanceWarped(1e-3 + 1e-6, 1 / 60, RATE, impacts) - (1e-3 + 1e-6);
    expect(inHold).toBeCloseTo((RATE / 60) * SLOW_FACTOR, 9);
  });

  it('does not skip the slow stretch on one long frame', () => {
    // A 0.1 s stall at 1/1,000 is 100 µs of sim time, half the hold.
    const t = advanceWarped(1e-3, 0.1, RATE, [1e-3]);
    expect(t - 1e-3).toBeLessThan(0.2 * 100e-6);
  });

  it('adds only a bounded amount of play time', () => {
    const impacts = [1e-3];
    const linear = 10e-3 / RATE;
    const warped = warpedPlayTimeS(0, 10e-3, RATE, impacts);
    expect(warped).toBeGreaterThan(linear);
    // The hold alone lingers about two seconds; the whole beat adds about six at the default rate.
    expect(warped - linear).toBeLessThan(8);
    expect(warped - linear).toBeGreaterThan(3);
    // The warp never costs more than 1/SLOW_FACTOR times the unwarped time.
    expect(warped).toBeLessThan(linear / SLOW_FACTOR);
  });

  it('adds nothing when no round makes contact in the shot', () => {
    expect(warpedPlayTimeS(0, 10e-3, RATE, [])).toBeCloseTo(10e-3 / RATE, 6);
  });
});
