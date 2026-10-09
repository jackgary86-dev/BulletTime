import { describe, expect, it } from 'vitest';
import { ResolutionGovernor } from './resolutionGovernor';

const TARGET = 1000 / 60;
const feed = (g: ResolutionGovernor, ms: number, frames: number) => {
  let changes = 0;
  for (let i = 0; i < frames; i++) if (g.frame(ms)) changes++;
  return changes;
};

describe('adaptive render resolution (#332)', () => {
  it('stays at full resolution while frames keep up', () => {
    const g = new ResolutionGovernor();
    expect(feed(g, TARGET, 1000)).toBe(0);
    expect(g.scale).toBe(1);
  });

  it('steps down under load, one step at a time, and stops at the floor', () => {
    const g = new ResolutionGovernor();
    feed(g, 40, 40);
    expect(g.scale).toBe(0.85);
    feed(g, 40, 2000);
    expect(g.scale).toBe(0.5);
  });

  it('holds full resolution on a display slower than 60 Hz, aimed at its own refresh', () => {
    // The app measures the refresh at start-up (displayFrameMs) and aims at the slower of it and 60 fps.
    const g = new ResolutionGovernor(Math.max(TARGET, 1000 / 30));
    expect(feed(g, 1000 / 30, 2000)).toBe(0);
    expect(g.scale).toBe(1);
  });

  it('ignores stalls: a shader compile or a hidden tab is not load', () => {
    const g = new ResolutionGovernor();
    for (let i = 0; i < 100; i++) {
      g.frame(TARGET);
      if (i % 10 === 0) g.frame(2000);
    }
    expect(g.scale).toBe(1);
  });

  it('steps back up once frames have kept up for a while', () => {
    const g = new ResolutionGovernor();
    feed(g, 40, 40);
    expect(g.scale).toBe(0.85);
    feed(g, TARGET, 200);
    expect(g.scale).toBe(1);
  });

  it('does not flicker: a step up that runs slow makes the next try wait twice as long', () => {
    const g = new ResolutionGovernor();
    // Too slow at full size, fine one step down: the true balance point.
    const frameAt = (scale: number) => (scale === 1 ? 30 : TARGET);
    const changesIn = (frames: number) => {
      let n = 0;
      for (let i = 0; i < frames; i++) if (g.frame(frameAt(g.scale))) n++;
      return n;
    };
    changesIn(60);
    expect(g.scale).toBe(0.85);
    // Over ten seconds at 60 fps it tries full size only a few times, with longer gaps each time.
    const changes = changesIn(600);
    expect(changes).toBeLessThanOrEqual(6);
    // And over the next minute, fewer still.
    expect(changesIn(3600)).toBeLessThanOrEqual(6);
  });

  it('starts fresh at full resolution after a reset', () => {
    const g = new ResolutionGovernor();
    feed(g, 40, 500);
    g.reset();
    expect(g.scale).toBe(1);
  });
});
