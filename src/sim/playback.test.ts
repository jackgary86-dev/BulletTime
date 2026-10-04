import { describe, expect, it } from 'vitest';
import { IMPACT_BEAT, SLOWEST_RATE, beatExtraRealS } from './impactBeat';
import { Playback } from './playback';
import type { Timeline } from './types';

/** A bare timeline: one shot, one track, first contact at `impactTime`, over at `duration`. */
function fake(duration: number, impactTime: number, extraEvents: { t: number; type: string }[] = []): Timeline {
  return {
    tracks: [{ endT: duration }],
    events: [{ t: impactTime, type: 'impact', trackId: 0 }, ...extraEvents.map((e) => ({ ...e, trackId: 0 }))],
    cavity: [],
    duration,
    impactTime,
    shots: [{ start: 0, impactTime, primaryId: 0, firstTrack: 0, trackCount: 1, bulletId: 'x', aim: { y: 0, z: 0 } }],
  } as unknown as Timeline;
}

/** Plays a timeline through at 60 fps and returns the real seconds it took and every sim time shown. */
function playThrough(playback: Playback): { realS: number; times: number[] } {
  const times: number[] = [];
  let realS = 0;
  for (let i = 0; i < 1e6 && playback.isPlaying; i++) {
    const t = playback.update(1 / 60)!;
    times.push(t);
    realS += 1 / 60;
  }
  return { realS, times };
}

describe('playback with the impact beat (#238)', () => {
  it('lingers on the impact: the shot takes longer in real time, by at most the whole beat window at the hold rate', () => {
    const timeline = fake(10e-3, 2e-3);
    const plain = new Playback();
    plain.impactBeat = false;
    plain.start(timeline);
    const beat = new Playback();
    beat.start(timeline);
    const a = playThrough(plain).realS;
    const b = playThrough(beat).realS;
    expect(b - a).toBeGreaterThan(1);
    expect(b - a).toBeLessThanOrEqual(beatExtraRealS(1 / 1000) + 1 / 60);
  });

  it('shows true simulated time, moving forward on every frame, and ends at the duration', () => {
    const playback = new Playback();
    playback.start(fake(10e-3, 2e-3));
    const { times } = playThrough(playback);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    expect(times[times.length - 1]).toBe(10e-3);
    expect(playback.time).toBe(10e-3);
  });

  it('is at a tenth of the chosen rate through the hold and the full rate elsewhere', () => {
    const playback = new Playback();
    playback.start(fake(10e-3, 2e-3));
    playback.seek(0);
    expect(playback.beat).toBe(1);
    expect(playback.effectiveRate).toBe(playback.rate);
    playback.seek(2e-3 + IMPACT_BEAT.holdS / 2);
    expect(playback.beat).toBe(IMPACT_BEAT.factor);
    expect(playback.effectiveRate).toBeCloseTo(playback.rate * IMPACT_BEAT.factor, 12);
    // The HUD's frame rate climbs through the beat, like a camera ramping.
    const fpsIn = playback.fps;
    playback.seek(0);
    expect(fpsIn).toBeCloseTo(playback.fps / IMPACT_BEAT.factor, 6);
  });

  it('never slows below the slowest preset: at 1/100,000 the beat is off, at 1/10,000 it bottoms out there', () => {
    const playback = new Playback();
    playback.start(fake(10e-3, 2e-3));
    playback.seek(2e-3 + 1e-4);
    playback.rate = SLOWEST_RATE;
    expect(playback.beat).toBe(1);
    expect(playback.beatSpans).toEqual([]);
    playback.rate = 1 / 10_000;
    expect(playback.effectiveRate).toBeCloseTo(SLOWEST_RATE, 15);
    playback.rate = 1 / 1000;
    expect(playback.effectiveRate).toBeCloseTo(1e-4, 15);
  });

  it('scrubbing, stepping and seeking land on the same sim times with the beat on or off', () => {
    const on = new Playback();
    const off = new Playback();
    off.impactBeat = false;
    on.start(fake(10e-3, 2e-3));
    off.start(fake(10e-3, 2e-3));
    on.seek(2.3e-3);
    off.seek(2.3e-3);
    expect(on.time).toBe(off.time);
    on.step(3);
    off.step(3);
    expect(on.time).toBe(off.time);
  });

  it('marks the beat on the scrubber and includes detonations, and switching it off clears the marks', () => {
    const playback = new Playback();
    playback.start(fake(20e-3, 2e-3, [{ t: 12e-3, type: 'detonate' }]));
    expect(playback.beatSpans).toHaveLength(2);
    expect(playback.beatSpans[1][0]).toBeCloseTo(12e-3 - IMPACT_BEAT.leadS, 12);
    playback.impactBeat = false;
    expect(playback.beatSpans).toEqual([]);
    expect(playback.beat).toBe(1);
  });
});
