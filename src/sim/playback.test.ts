import { describe, expect, it } from 'vitest';
import { Playback } from './playback';
import { SLOW_FACTOR } from './timeWarp';
import type { Timeline } from './types';

/** The bare minimum of a timeline the clock reads: one shot that makes contact at `impactTime`. */
function timelineWithImpact(impactTime: number, duration = 0.02): Timeline {
  return {
    duration,
    impactTime,
    tracks: [],
    events: [],
    cavity: [],
    shots: [{ start: 0, impactTime, firstTrack: 0, trackCount: 0, primaryId: 0 }],
  } as unknown as Timeline;
}

describe('Playback impact slow-motion (#238)', () => {
  it('plays at the chosen rate before contact and a tenth of it just after', () => {
    const playback = new Playback();
    playback.start(timelineWithImpact(1e-3));
    expect(playback.update(1 / 60)).toBeCloseTo(playback.rate / 60, 12);

    const inBeat = new Playback();
    inBeat.start(timelineWithImpact(1e-3), 1e-3 + 1e-6);
    const before = inBeat.time;
    inBeat.update(1 / 60);
    expect(inBeat.time - before).toBeCloseTo((inBeat.rate / 60) * SLOW_FACTOR, 9);
  });

  it('plays at the chosen rate throughout when switched off', () => {
    const playback = new Playback();
    playback.slowMo = false;
    playback.start(timelineWithImpact(1e-3), 1e-3 + 1e-6);
    const before = playback.time;
    playback.update(1 / 60);
    expect(playback.time - before).toBeCloseTo(playback.rate / 60, 12);
  });

  it('seeks and steps to the same sim times as before', () => {
    const on = new Playback();
    const off = new Playback();
    off.slowMo = false;
    for (const p of [on, off]) {
      p.start(timelineWithImpact(1e-3));
      p.seek(1.1e-3);
    }
    expect(on.time).toBe(off.time);
    on.step(3);
    off.step(3);
    expect(on.time).toBe(off.time);
  });

  it('reports the slowed rate as a higher frame rate and a shorter shutter, like a faster camera', () => {
    const playback = new Playback();
    playback.start(timelineWithImpact(1e-3), 1e-3 + 1e-6);
    expect(playback.fps).toBeCloseTo(1 / ((1 / 60) * playback.rate * SLOW_FACTOR), 3);
    playback.seek(10e-3);
    const calm = playback.shutterS;
    playback.seek(1e-3 + 1e-6);
    expect(playback.shutterS).toBeCloseTo(calm * SLOW_FACTOR, 12);
  });

  it('still reaches the end of the shot and stops', () => {
    const playback = new Playback();
    playback.rate = 1 / 100;
    playback.start(timelineWithImpact(1e-3, 0.01));
    for (let i = 0; i < 2000 && playback.isPlaying; i++) playback.update(1 / 60);
    expect(playback.isPlaying).toBe(false);
    expect(playback.time).toBe(0.01);
  });
});
