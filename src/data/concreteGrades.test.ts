import { describe, expect, it } from 'vitest';
import { CONCRETE_REFERENCE, CONCRETE_REFERENCE_BULLET } from './concreteReference';
import { getMedium } from './media';
import { layersFor, simulate } from '../sim/engine';

/** Pins the three concrete grades (#222) to the lab ballistic limits and residual velocities. */
const THICKNESS_M = 0.045;

function exitSpeed(grade: string, v: number): number {
  const m = getMedium(`concrete-${grade.toLowerCase()}`);
  const s = simulate({
    bullet: { ...CONCRETE_REFERENCE_BULLET, muzzleVelocityMs: v },
    layers: layersFor(m, THICKNESS_M),
    angleDeg: 0,
    impactPoint: { x: -0.2, y: 0.16, z: 0 },
    standOffM: 0.5,
  }).summary;
  return s.passedThrough ? s.exitSpeed : 0;
}

describe('concrete grades (#222)', () => {
  it.each(CONCRETE_REFERENCE)('$id stops below its ballistic limit and perforates above it', ({ id, ballisticLimitMs: limit }) => {
    expect(exitSpeed(id, limit - 8)).toBe(0);
    expect(exitSpeed(id, limit + 8)).toBeGreaterThan(0);
  });

  it.each(CONCRETE_REFERENCE)('$id ballistic limit is within 3 m/s of the test', ({ id, ballisticLimitMs: limit }) => {
    let found = 0;
    for (let v = 90; v < 200; v += 1) if (exitSpeed(id, v) > 0) { found = v; break; }
    expect(Math.abs(found - limit)).toBeLessThanOrEqual(3);
  });

  it.each(CONCRETE_REFERENCE)('$id residual speed follows the test points', ({ id, test, ballisticLimitMs: limit }) => {
    // The plots are read by eye and scatter near the limit, so the band is wide there.
    for (const [vi, vr] of test) {
      if (vi < limit + 5) continue;
      const tol = vi < limit + 30 ? 35 : 25;
      expect(Math.abs(exitSpeed(id, vi) - vr), `${id} at ${vi} m/s`).toBeLessThanOrEqual(tol);
    }
  });

  it('the ballistic limit rises with strength', () => {
    const limits = CONCRETE_REFERENCE.map(({ id }) => {
      for (let v = 90; v < 220; v += 1) if (exitSpeed(id, v) > 0) return v;
      return Infinity;
    });
    expect(limits[0]).toBeLessThan(limits[1]);
    expect(limits[1]).toBeLessThan(limits[2]);
  });

  it('a stronger grade lets less through at the same speed (up to 207 m/s: the test data crosses over above that)', () => {
    for (const v of [170, 207]) {
      expect(exitSpeed('C35', v)).toBeGreaterThan(exitSpeed('C75', v));
      expect(exitSpeed('C75', v)).toBeGreaterThan(exitSpeed('C110', v));
    }
  });

  it('residual speed rises with impact speed', () => {
    for (const { id } of CONCRETE_REFERENCE) {
      let last = 0;
      for (let v = 160; v <= 300; v += 20) {
        const r = exitSpeed(id, v);
        expect(r).toBeGreaterThan(last);
        last = r;
      }
    }
  });
});
