import { describe, expect, it } from 'vitest';
import { fullBoreShot } from './fullBore';
import { getPlateMaterial } from './materials';
import { MAX_OBLIQUITY_DEG, frameAt, losThickness, normalizeShot, sampleFrames, timelineDuration, type ArmorFrame, type ArmorShot, type ArmorTimeline } from './model';
import { impactState } from './munitions';

const rhaShot = (overrides: Partial<ArmorShot> = {}): ArmorShot => ({
  impact: impactState('ap-shot', 88, 1000),
  material: getPlateMaterial('rha'),
  thicknessM: 0.1,
  obliquityDeg: 0,
  ...overrides,
});

const frame = (t: number, depth: number, speed: number): ArmorFrame => ({
  t,
  depth,
  travel: depth * 2,
  speed,
  penetrationRate: speed / 2,
  craterRadius: depth / 2,
  penetratorLength: 0.3 - depth,
  rearBulge: depth / 10,
  energyDepositedJ: depth * 1e6,
});

describe('line-of-sight thickness', () => {
  it('is T / cos θ', () => {
    expect(losThickness(0.1, 0)).toBe(0.1);
    expect(losThickness(0.1, 30)).toBeCloseTo(0.1 / Math.cos(Math.PI / 6), 12);
    expect(losThickness(0.1, 45)).toBeCloseTo(0.1 * Math.SQRT2, 12);
    expect(losThickness(0.1, 60)).toBeCloseTo(0.2, 12);
    expect(losThickness(0.08, 75)).toBeCloseTo(0.08 / Math.cos((75 * Math.PI) / 180), 12);
  });

  it('is pure geometry across the lab’s slopes, clamped only to 0–85° so it stays finite', () => {
    expect(MAX_OBLIQUITY_DEG).toBe(85);
    expect(losThickness(0.1, 80)).toBeCloseTo(0.1 / Math.cos((80 * Math.PI) / 180), 12);
    expect(losThickness(0.1, 89)).toBeCloseTo(losThickness(0.1, 85), 12);
    expect(losThickness(0.1, -20)).toBe(0.1);
  });
});

describe('shot checks', () => {
  it('clamps obliquity to the lab’s range, or a model’s own limit, and rejects impossible plates', () => {
    expect(normalizeShot(rhaShot({ obliquityDeg: 82 })).obliquityDeg).toBe(82);
    expect(normalizeShot(rhaShot({ obliquityDeg: 89 })).obliquityDeg).toBe(85);
    expect(normalizeShot(rhaShot({ obliquityDeg: 82 }), 75).obliquityDeg).toBe(75);
    expect(normalizeShot(rhaShot({ obliquityDeg: 89 }), 120).obliquityDeg).toBe(85);
    expect(normalizeShot(rhaShot({ obliquityDeg: -5 })).obliquityDeg).toBe(0);
    expect(() => normalizeShot(rhaShot({ thicknessM: 0 }))).toThrow();
    expect(() => normalizeShot(rhaShot({ thicknessM: Number.NaN }))).toThrow();
    expect(() => normalizeShot(rhaShot({ obliquityDeg: Number.NaN }))).toThrow();
  });
});

describe('timeline sampling', () => {
  it('runs on 20% past the last event, but at least 30 µs', () => {
    expect(timelineDuration(1e-3)).toBeCloseTo(1.2e-3, 15);
    expect(timelineDuration(50e-6)).toBeCloseTo(80e-6, 15);
  });

  it('samples evenly from 0 to the duration, inclusive', () => {
    const frames = sampleFrames(1e-3, (t) => frame(t, t * 100, 1000 - t * 1e5));
    expect(frames.length).toBeGreaterThanOrEqual(120);
    expect(frames[0].t).toBe(0);
    expect(frames[frames.length - 1].t).toBeCloseTo(1e-3, 15);
  });

  it('frameAt interpolates linearly between frames and clamps at the ends', () => {
    const tl = { frames: [frame(0, 0, 1000), frame(1e-4, 0.05, 600), frame(2e-4, 0.08, 0)], duration: 2e-4 } as ArmorTimeline;
    const mid = frameAt(tl, 0.5e-4);
    expect(mid.t).toBe(0.5e-4);
    expect(mid.depth).toBeCloseTo(0.025, 12);
    expect(mid.speed).toBeCloseTo(800, 9);
    expect(mid.craterRadius).toBeCloseTo(0.0125, 12);
    expect(mid.penetratorLength).toBeCloseTo(0.275, 12);
    expect(mid.rearBulge).toBeCloseTo(0.0025, 12);
    expect(mid.travel).toBeCloseTo(0.05, 12);
    expect(mid.penetrationRate).toBeCloseTo(400, 9);
    expect(mid.energyDepositedJ).toBeCloseTo(25_000, 6);
    const late = frameAt(tl, 1.25e-4);
    expect(late.depth).toBeCloseTo(0.05 + 0.25 * 0.03, 12);
    expect(late.speed).toBeCloseTo(450, 9);
    expect(frameAt(tl, 1e-4)).toEqual(frame(1e-4, 0.05, 600));
    expect(frameAt(tl, -1)).toEqual(tl.frames[0]);
    expect(frameAt(tl, 1)).toEqual(tl.frames[2]);
  });

  it('frameAt interpolates fields it does not know about, and number arrays element by element', () => {
    type Extended = ArmorFrame & { extraJ: number; label: string };
    const a: Extended = { ...frame(0, 0, 1000), craterProfile: [0, 0, 0], extraJ: 0, label: 'a' };
    const b: Extended = { ...frame(1e-4, 0.04, 600), craterProfile: [0.02, 0.01, 0], extraJ: 100, label: 'b' };
    const tl = { frames: [a, b], duration: 1e-4 } as unknown as ArmorTimeline;
    const early = frameAt(tl, 0.25e-4) as Extended;
    expect(early.extraJ).toBeCloseTo(25, 9);
    expect(early.craterProfile![0]).toBeCloseTo(0.005, 12);
    expect(early.craterProfile![1]).toBeCloseTo(0.0025, 12);
    expect(early.craterProfile).toHaveLength(3);
    // Values that cannot be mixed come from the nearer frame.
    expect(early.label).toBe('a');
    expect((frameAt(tl, 0.75e-4) as Extended).label).toBe('b');
    // An array only one frame has, or arrays of different lengths, also come from the nearer frame.
    const c = { ...frame(2e-4, 0.05, 0), craterProfile: [0.03, 0] };
    expect(frameAt({ frames: [b, c], duration: 2e-4 } as ArmorTimeline, 1.9e-4).craterProfile).toEqual([0.03, 0]);
    expect(frameAt({ frames: [frame(0, 0, 1), b], duration: 1e-4 } as ArmorTimeline, 0.9e-4).craterProfile).toEqual([0.02, 0.01, 0]);
    // Clamped frames are copies: changing one does not change the timeline.
    const copy = frameAt(tl, -1);
    copy.craterProfile![0] = 1;
    expect(a.craterProfile![0]).toBe(0);
  });

  it('frameAt on a real timeline matches its frames and stays between neighbours', () => {
    const tl = fullBoreShot(rhaShot({ thicknessM: 0.25 }));
    const f = tl.frames;
    expect(frameAt(tl, f[40].t)).toEqual(f[40]);
    const between = frameAt(tl, (f[40].t + f[41].t) / 2);
    expect(between.depth).toBeCloseTo((f[40].depth + f[41].depth) / 2, 12);
    expect(between.depth).toBeGreaterThan(f[40].depth);
    expect(between.depth).toBeLessThan(f[41].depth);
  });
});
