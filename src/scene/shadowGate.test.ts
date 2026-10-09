import { describe, expect, it } from 'vitest';
import { ShadowGate } from './shadowGate';

const FRAME = 1 / 60;

describe('shadow maps redrawn only when a caster may move (#331)', () => {
  it('draws the first map, then none while nothing plays and nothing changes', () => {
    const gate = new ShadowGate(1);
    expect(gate.shouldUpdate(null, FRAME)).toBe(true);
    let updates = 0;
    // Half a second idle, the camera free to move: the map stays as it is.
    for (let i = 0; i < 30; i++) if (gate.shouldUpdate(null, FRAME)) updates++;
    expect(updates).toBe(0);
  });

  it('redraws every frame while the shot plays, and stops when it is parked', () => {
    const gate = new ShadowGate(1);
    gate.shouldUpdate(null, FRAME);
    let updates = 0;
    for (let i = 1; i <= 60; i++) if (gate.shouldUpdate(i * 1e-5, FRAME)) updates++;
    expect(updates).toBe(60);
    updates = 0;
    for (let i = 0; i < 30; i++) if (gate.shouldUpdate(60 * 1e-5, FRAME)) updates++;
    expect(updates).toBe(0);
  });

  it('redraws after the scene changes with the time unchanged: a new target, quality or lighting', () => {
    const gate = new ShadowGate(1);
    gate.shouldUpdate(null, FRAME);
    gate.shouldUpdate(null, FRAME);
    gate.invalidate();
    expect(gate.shouldUpdate(null, FRAME)).toBe(true);
    expect(gate.shouldUpdate(null, FRAME)).toBe(false);
  });

  it('refreshes an idle map about once a second, as a safety net', () => {
    const gate = new ShadowGate(1);
    gate.shouldUpdate(null, FRAME);
    let updates = 0;
    for (let i = 0; i < 600; i++) if (gate.shouldUpdate(null, FRAME)) updates++;
    expect(updates).toBeGreaterThanOrEqual(9);
    expect(updates).toBeLessThanOrEqual(11);
  });
});
