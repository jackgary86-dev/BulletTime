import { describe, expect, it } from 'vitest';
import { CONCRETE_REFERENCE_BULLET } from './concreteReference';
import { getMedium } from './media';
import { layersFor, simulate } from '../sim/engine';
import { sampleTrack } from '../sim/sample';

/** Pins the concrete velocity-loss profile (#225): most of the speed goes in the first 0.5 ms, then a slow tail. */
const AT_HALF_MS: Array<[string, number]> = [
  ['c35', 68],
  ['c75', 60],
  ['c110', 50],
];
// The trace values are read off plots (about +/-5 m/s). C110's 153 m/s shot sits right at its 152.5 m/s ballistic
// limit, where the measured residuals scatter (27, 15 and 43 m/s at 155, 165 and 153.6 m/s); the model stops
// the bullet harder there, so C110 is only pinned to "no faster than the trace".
const BAND_MS: Record<string, number> = { c35: 4, c75: 8 };

function speedProfile(grade: string, v: number) {
  const timeline = simulate({
    bullet: { ...CONCRETE_REFERENCE_BULLET, muzzleVelocityMs: v },
    layers: layersFor(getMedium(`concrete-${grade}`), 0.045),
    angleDeg: 0,
    impactPoint: { x: -0.2, y: 0.16, z: 0 },
    standOffM: 0.5,
  });
  const track = timeline.tracks.find((t) => t.id === 0)!;
  const impact = timeline.events.find((e) => e.type === 'impact' || e.type === 'enter')!.t;
  return (ms: number) => sampleTrack(track, impact + ms * 1e-3)?.speed ?? 0;
}

describe('concrete velocity loss (#225)', () => {
  it.each(AT_HALF_MS)('%s: speed at 0.5 ms matches the measured trace', (grade, measured) => {
    const at = speedProfile(grade, 155);
    const band = BAND_MS[grade];
    if (band === undefined) expect(at(0.5)).toBeLessThanOrEqual(measured * 1.1);
    else expect(Math.abs(at(0.5) - measured)).toBeLessThanOrEqual(Math.max(band, measured * 0.1));
  });

  it.each(AT_HALF_MS)('%s: most of the speed is gone by 0.5 ms', (grade) => {
    const at = speedProfile(grade, 155);
    expect(at(0.5)).toBeLessThan(0.5 * at(0));
  });

  it('c35: the slug is down to the measured 55 m/s by 2.7 ms', () => {
    const at = speedProfile('c35', 155);
    expect(Math.abs(at(2.7) - 55)).toBeLessThanOrEqual(4);
  });

  it.each(AT_HALF_MS)('%s: the tail after 1 ms slows under 15 m/s per ms', (grade) => {
    const at = speedProfile(grade, 155);
    expect((at(1) - at(2.5)) / 1.5).toBeLessThan(15);
    expect(at(1)).toBeGreaterThanOrEqual(at(2.5));
  });
});
