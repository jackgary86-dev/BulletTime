import { describe, expect, it } from 'vitest';
import { getPlateMaterial } from './materials';
import { impactState, type MunitionFamilyId } from './munitions';
import { IMPACT_SHARE, aftermathEnd, playbackAt, playheadForImpactTime } from './playback';
import { simulateArmor } from './simulate';

const run = (family: MunitionFamilyId, thicknessM: number, obliquityDeg = 0, calibreMm = 120) =>
  simulateArmor({ impact: impactState(family, calibreMm), material: getPlateMaterial('rha'), thicknessM, obliquityDeg });

describe('playback clock (#165)', () => {
  it('is linear when nothing is thrown', () => {
    const tl = run('apfsds', 0.3, 0, 40);
    expect(tl.fragments).toBeUndefined();
    expect(playbackAt(tl, 0.5)).toEqual({ t: tl.duration / 2, fragmentT: tl.duration / 2, aftermath: false });
    expect(playbackAt(tl, 1).t).toBe(tl.duration);
  });

  it('plays the impact first, in linear time, then the aftermath with the section held at its last frame', () => {
    const tl = run('heat', 0.1);
    expect(tl.fragments).toBeDefined();
    const mid = playbackAt(tl, IMPACT_SHARE / 2);
    expect(mid.aftermath).toBe(false);
    expect(mid.t).toBeCloseTo(tl.duration / 2, 12);
    expect(mid.fragmentT).toBe(mid.t);
    const end = playbackAt(tl, IMPACT_SHARE);
    expect(end.t).toBeCloseTo(tl.duration, 12);
    const later = playbackAt(tl, IMPACT_SHARE + 0.1);
    expect(later.aftermath).toBe(true);
    expect(later.t).toBe(tl.duration);
    expect(later.fragmentT).toBeGreaterThan(tl.duration);
  });

  it('runs the aftermath on a log scale up to when the last piece rests', () => {
    const tl = run('heat', 0.1);
    const end = aftermathEnd(tl);
    expect(end).toBeGreaterThanOrEqual(tl.fragments!.restS);
    expect(playbackAt(tl, 1).fragmentT).toBeCloseTo(end, 9);
    // Equal steps of playhead multiply the time by the same factor.
    const a = playbackAt(tl, 0.7).fragmentT;
    const b = playbackAt(tl, 0.8).fragmentT;
    const c = playbackAt(tl, 0.9).fragmentT;
    expect(b / a).toBeCloseTo(c / b, 9);
  });

  it('never goes backwards in time and is continuous at the phase change', () => {
    const tl = run('ap-shot', 0.04, 60);
    let prev = -1;
    for (let i = 0; i <= 1000; i++) {
      const { fragmentT } = playbackAt(tl, i / 1000);
      expect(fragmentT).toBeGreaterThanOrEqual(prev);
      prev = fragmentT;
    }
    const before = playbackAt(tl, IMPACT_SHARE - 1e-9).fragmentT;
    const after = playbackAt(tl, IMPACT_SHARE + 1e-9).fragmentT;
    expect(after).toBeCloseTo(before, 6);
  });

  it('clamps the playhead to 0 to 1', () => {
    const tl = run('heat', 0.1);
    expect(playbackAt(tl, -1).fragmentT).toBe(0);
    expect(playbackAt(tl, 5).fragmentT).toBeCloseTo(aftermathEnd(tl), 9);
  });

  it('finds the playhead for a time in the impact phase', () => {
    const tl = run('heat', 0.1);
    expect(playheadForImpactTime(tl, tl.duration)).toBeCloseTo(IMPACT_SHARE, 12);
    expect(playbackAt(tl, playheadForImpactTime(tl, tl.duration / 3)).t).toBeCloseTo(tl.duration / 3, 12);
  });
});
