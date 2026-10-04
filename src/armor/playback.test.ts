import { describe, expect, it } from 'vitest';
import { getPlateMaterial } from './materials';
import { impactState, type MunitionFamilyId } from './munitions';
import { SLOW_FACTOR } from '../sim/timeWarp';
import { IMPACT_SHARE, aftermathEnd, impactBeats, playbackAt, playheadForImpactTime, playheadSpeed } from './playback';
import { simulateArmor } from './simulate';
import { simulateStack } from './stack';

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

describe('impact slow-motion on the Armor lab clock (#238)', () => {
  const stack = () =>
    simulateStack({
      impact: impactState('ap-shot', 88),
      layers: [
        { material: getPlateMaterial('rha'), thicknessM: 0.02, gapBeforeM: 0 },
        { material: getPlateMaterial('rha'), thicknessM: 0.02, gapBeforeM: 0.2 },
      ],
      obliquityDeg: 0,
    });

  it('runs at a tenth of the chosen speed at the contact with each plate and full speed in between and in the aftermath', () => {
    const st = stack();
    expect(st.stages.length).toBe(2);
    const beats = impactBeats(st.stages);
    for (const stage of st.stages) {
      const u = playheadForImpactTime(st, stage.offsetT + 0.01 * stage.timeline.duration);
      expect(playheadSpeed(st, beats, u)).toBeCloseTo(SLOW_FACTOR, 9);
    }
    if (st.fragments) expect(playheadSpeed(st, beats, 0.99)).toBe(1);
    // Well after the first plate's beat and before the second's contact the clock is back at full speed.
    const first = st.stages[0];
    const tBetween = (first.offsetT + first.timeline.duration + st.stages[1].offsetT) / 2;
    expect(playheadSpeed(st, beats, playheadForImpactTime(st, tBetween))).toBe(1);
  });

  it('never stops, never exceeds full speed and is continuous', () => {
    const st = stack();
    const beats = impactBeats(st.stages);
    let previous = playheadSpeed(st, beats, 0);
    for (let i = 1; i <= 20_000; i++) {
      const w = playheadSpeed(st, beats, i / 20_000);
      expect(w).toBeGreaterThanOrEqual(SLOW_FACTOR - 1e-9);
      expect(w).toBeLessThanOrEqual(1);
      expect(Math.abs(w - previous)).toBeLessThan(0.05);
      previous = w;
    }
  });

  it('adds a bounded share to the play time of the whole clip', () => {
    const st = stack();
    const beats = impactBeats(st.stages);
    const n = 20_000;
    let real = 0;
    for (let i = 0; i < n; i++) real += 1 / n / playheadSpeed(st, beats, (i + 0.5) / n);
    // Linear play is 1; two beats lengthen it, but by far less than playing everything at a tenth.
    expect(real).toBeGreaterThan(1.05);
    expect(real).toBeLessThan(2.5);
  });
});
