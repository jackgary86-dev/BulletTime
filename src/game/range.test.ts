import { describe, expect, it } from 'vitest';
import { getBullet } from '../data/bullets';
import { physicsLayers } from '../data/stacks';
import { simulate } from '../sim/engine';
import { MAX_SCORE, RANGE_STAGES, SHOTS_PER_STAGE, describeImpact, scoreShot, stageRound, stageSetup, swayAt } from './range';

describe('scoring', () => {
  it('gives 10 in the centre ring and 1 at the edge', () => {
    expect(scoreShot(0, 0)).toBe(10);
    expect(scoreShot(0.05, 0.05)).toBe(10);
    expect(scoreShot(0.15, 0)).toBe(9);
    expect(scoreShot(0, -0.55)).toBe(5);
    expect(scoreShot(0.99, 0)).toBe(1);
    expect(scoreShot(0.6, 0.8)).toBe(1);
  });

  it('scores a miss outside the face as 0', () => {
    expect(scoreShot(1.01, 0)).toBe(0);
    expect(scoreShot(0.8, 0.8)).toBe(0);
  });

  it('is the same in every direction', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.3) expect(scoreShot(0.42 * Math.cos(a), 0.42 * Math.sin(a))).toBe(6);
  });

  it('adds up to 100 for a perfect run', () => {
    expect(MAX_SCORE).toBe(100);
    expect(RANGE_STAGES.length * SHOTS_PER_STAGE).toBe(10);
  });
});

describe('stages', () => {
  it.each(RANGE_STAGES.map((s) => [s.name, s] as const))('%s has a valid round and target', (_, stage) => {
    expect(() => getBullet(stage.bulletId)).not.toThrow();
    expect(stageRound(stage).length).toBeGreaterThan(3);
    const setup = stageSetup(stage);
    expect(setup.layers.length).toBeGreaterThan(0);
    // Every layer is at least 6 cm across, so a shot inside the scoring circle hits the whole stack.
    for (const l of setup.layers) {
      expect(l.medium.heightM).toBeGreaterThan(0.06);
      expect(l.medium.widthM).toBeGreaterThan(0.06);
    }
  });

  it('gets harder: sway grows stage by stage', () => {
    for (let i = 1; i < RANGE_STAGES.length; i++) expect(RANGE_STAGES[i].sway).toBeGreaterThan(RANGE_STAGES[i - 1].sway);
  });

  it.each(RANGE_STAGES.map((s) => [s.name, s] as const))('%s produces a describable impact', (_, stage) => {
    const setup = stageSetup(stage);
    const timeline = simulate({
      bullet: getBullet(stage.bulletId),
      layers: physicsLayers(setup.layers),
      angleDeg: 0,
      impactPoint: { x: 0, y: 1, z: 0 },
      standOffM: 0.5,
    });
    const text = describeImpact(timeline.summary);
    expect(text).toMatch(/\.$/);
    expect(text).not.toMatch(/NaN|undefined/);
  });
});

describe('sway', () => {
  it('stays within its amplitude and shrinks while the breath is held', () => {
    let maxNormal = 0;
    let maxHeld = 0;
    for (let t = 0; t < 60; t += 0.05) {
      const n = swayAt(t, 0.1, 'normal');
      const h = swayAt(t, 0.1, 'held');
      maxNormal = Math.max(maxNormal, Math.hypot(n.x, n.y));
      maxHeld = Math.max(maxHeld, Math.hypot(h.x, h.y));
    }
    expect(maxNormal).toBeLessThanOrEqual(0.1 * Math.SQRT2 + 1e-9);
    expect(maxNormal).toBeGreaterThan(0.05);
    expect(maxHeld).toBeLessThan(maxNormal / 3);
  });

  it('is worse while recovering', () => {
    const n = swayAt(1, 0.1, 'normal');
    const r = swayAt(1, 0.1, 'recover');
    expect(Math.hypot(r.x, r.y)).toBeGreaterThan(Math.hypot(n.x, n.y));
  });
});
