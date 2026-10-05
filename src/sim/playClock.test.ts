import { describe, expect, it } from 'vitest';
import { PlayClock } from './playClock';

const run = (clock: PlayClock, seconds: number, dt = 1 / 60) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) clock.update(dt);
};

describe('shared playback clock (#242)', () => {
  it('plays at its rate, stops at the end and restarts from the start on play', () => {
    const c = new PlayClock();
    c.rate = 0.5;
    c.load({ duration: 1 });
    run(c, 1);
    expect(c.position).toBeCloseTo(0.5, 6);
    expect(c.isPlaying).toBe(true);
    run(c, 2);
    expect(c.position).toBe(1);
    expect(c.isPlaying).toBe(false);
    expect(c.atEnd).toBe(true);
    c.play();
    expect(c.position).toBe(0);
    expect(c.isPlaying).toBe(true);
  });

  it('is slowed by its beat and jumps its gaps while playing, but not when seeking', () => {
    const c = new PlayClock();
    c.rate = 1;
    c.load({ duration: 10, beat: (p) => (p < 1 ? 0.25 : 1), gaps: [[2, 8]] });
    run(c, 1);
    expect(c.position).toBeCloseTo(0.25, 6);
    expect(c.effectiveRate).toBe(0.25);
    c.seek(1.5);
    expect(c.isPlaying).toBe(false);
    c.play();
    run(c, 1);
    expect(c.position).toBeGreaterThanOrEqual(8);
    c.seek(5);
    expect(c.position).toBe(5);
  });

  it('seeks and steps clamped to the source, and pauses', () => {
    const c = new PlayClock();
    c.load({ duration: 2 });
    c.seek(5);
    expect(c.position).toBe(2);
    c.stepBy(-3, 0.25);
    expect(c.position).toBe(1.25);
    c.stepBy(-100, 0.25);
    expect(c.position).toBe(0);
    expect(c.isPlaying).toBe(false);
  });

  it('does nothing with no source', () => {
    const c = new PlayClock();
    expect(c.update(1)).toBeNull();
    c.play();
    c.seek(1);
    expect(c.isPlaying).toBe(false);
    expect(c.position).toBe(0);
    expect(c.beat).toBe(1);
  });
});
