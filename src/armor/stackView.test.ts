import { describe, expect, it } from 'vitest';
import { getPlateMaterial, type PlateMaterialId } from './materials';
import { impactState, type MunitionFamilyId } from './munitions';
import { sectionLayout } from './section';
import { simulateArmor } from './simulate';
import { simulateStack, type PlateLayer, type StackTimeline } from './stack';
import { activeStage, extendedFrame, stackDimensions, stackLayout, stackPathM, stackShapes } from './stackView';

const layer = (material: PlateMaterialId, thicknessMm: number, gapMm = 0): PlateLayer => ({ material: getPlateMaterial(material), thicknessM: thicknessMm / 1000, gapBeforeM: gapMm / 1000 });
const run = (family: MunitionFamilyId, layers: PlateLayer[], calibreMm = 120, obliquityDeg = 0): StackTimeline =>
  simulateStack({ impact: impactState(family, calibreMm), layers, obliquityDeg });

const SPACED = () => run('apfsds', [layer('mild-steel', 20), layer('rha', 250, 300)], 50);

describe('stack layout (#171)', () => {
  it('lays a single plate out exactly as the single-plate layout does', () => {
    for (const [w, h] of [[900, 500], [900, 300], [500, 700]]) {
      const single = simulateArmor({ impact: impactState('apfsds', 120), material: getPlateMaterial('rha'), thicknessM: 0.1, obliquityDeg: 0 });
      const s = run('apfsds', [layer('rha', 100)]);
      const a = sectionLayout(single, w, h);
      const b = stackLayout(s, w, h).stages[0];
      expect(b).toEqual(a);
    }
  });

  it('puts the plates side by side with the gaps at scale, in order, inside the canvas, centred', () => {
    const s = SPACED();
    const l = stackLayout(s, 900, 500);
    expect(l.stages).toHaveLength(2);
    const [a, b] = l.stages;
    expect(a.rearX).toBeGreaterThan(a.frontX);
    expect((b.frontX - a.rearX) / l.pxPerM).toBeCloseTo(0.3, 9);
    expect((a.rearX - a.frontX) / l.pxPerM).toBeCloseTo(s.stages[0].timeline.result.losThicknessM, 9);
    expect(a.frontX).toBeGreaterThan(0);
    expect(b.rearX).toBeLessThan(900);
    expect(a.frontX).toBeCloseTo(900 - b.rearX, 6);
    expect((b.rearX - a.frontX) / l.pxPerM).toBeCloseTo(stackPathM(s), 9);
    for (const st of l.stages) {
      expect(st.pxPerM).toBe(l.pxPerM);
      expect(st.axisY).toBe(250);
    }
  });

  it('draws a longer stack smaller in the same canvas', () => {
    const short = stackLayout(run('apfsds', [layer('rha', 100)], 50), 900, 500);
    const long = stackLayout(run('apfsds', [layer('rha', 20), layer('rha', 20, 300), layer('rha', 20, 300)], 50), 900, 500);
    expect(long.pxPerM).toBeLessThan(short.pxPerM);
  });

  it('only lays out the plates the round reached', () => {
    const s = run('heat', [layer('rha', 300), layer('rha', 20, 100)], 60);
    expect(s.plates[1].engaged).toBe(false);
    expect(stackLayout(s, 900, 500).stages).toHaveLength(1);
  });
});

describe('active plate (#171)', () => {
  it('follows the stack clock: first until the next plate is hit, then the next', () => {
    const s = SPACED();
    expect(activeStage(s, 0)).toBe(0);
    expect(activeStage(s, s.stages[1].offsetT - 1e-9)).toBe(0);
    expect(activeStage(s, s.stages[1].offsetT)).toBe(1);
    expect(activeStage(s, s.duration)).toBe(1);
    expect(activeStage(s, -1)).toBe(0);
  });
});

describe('extended frame (#171)', () => {
  it('is the stage frame up to its duration, then carries on at its last speed', () => {
    const s = SPACED();
    const st = s.stages[0];
    const inside = extendedFrame(st, st.timeline.duration * 0.5);
    expect(inside.t).toBeCloseTo(st.timeline.duration * 0.5, 12);
    const last = st.timeline.frames[st.timeline.frames.length - 1];
    const later = extendedFrame(st, st.timeline.duration + 1e-5);
    expect(later.travel).toBeCloseTo(last.travel + last.speed * 1e-5, 9);
    expect(later.depth).toBe(last.depth);
  });

  it('shows nothing dug before the round gets there', () => {
    const s = SPACED();
    const f = extendedFrame(s.stages[1], -1e-4);
    expect(f.depth).toBe(0);
  });
});

describe('stack shapes (#171)', () => {
  it('digs the first plate while the second is untouched, and the other way round later', () => {
    const s = SPACED();
    const l = stackLayout(s, 900, 500);
    const early = stackShapes(s, s.stages[0].timeline.duration * 0.3, s.stages[0].timeline.duration * 0.3, l);
    expect(early[0].shapes.crater.length).toBeGreaterThan(0);
    expect(early[1].shapes.crater).toHaveLength(0);
    const late = stackShapes(s, s.stages[1].offsetT + s.stages[1].timeline.duration * 0.5, s.stages[1].offsetT + s.stages[1].timeline.duration * 0.5, l);
    expect(late[0].shapes.throughHole).toBe(true);
    expect(late[1].shapes.crater.length).toBeGreaterThan(0);
  });

  it('draws the round in one plate at a time', () => {
    const s = SPACED();
    const l = stackLayout(s, 900, 500);
    for (let i = 0; i <= 40; i++) {
      const t = (s.duration * i) / 40;
      const shown = stackShapes(s, t, t, l).filter((x) => !x.shapes.penetrator.hidden);
      expect(shown.length).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the round from passing the front of the next plate before it hits it', () => {
    const s = SPACED();
    const l = stackLayout(s, 900, 500);
    const t = s.stages[1].offsetT - 1e-9;
    const first = stackShapes(s, t, t, l)[0].shapes.penetrator;
    expect(first.hidden).toBe(false);
    expect(first.noseX).toBeLessThanOrEqual(l.stages[1].frontX + 1e-6);
  });

  it('moves the round across the gap, nose between the plates', () => {
    const s = SPACED();
    const l = stackLayout(s, 900, 500);
    const exit = s.stages[0].timeline.events.find((e) => e.type === 'perforate')!.t;
    const mid = s.stages[0].offsetT + exit + s.stages[1].gapTimeS / 2;
    const p = stackShapes(s, mid, mid, l)[0].shapes.penetrator;
    expect(p.noseX).toBeGreaterThan(l.stages[0].rearX);
    expect(p.noseX).toBeLessThanOrEqual(l.stages[1].frontX + 1e-6);
  });

  it('hands the last plate its pieces to draw, timed on its own clock', () => {
    const s = run('heat', [layer('rha', 30), layer('rha', 80, 100)], 60);
    const l = stackLayout(s, 900, 500);
    const last = s.stages[s.fragmentStage];
    const t = s.duration;
    const shapes = stackShapes(s, t, t, l);
    expect(shapes[s.fragmentStage].shapes.penetrator.hidden).toBe(true);
    expect(last.timeline.fragments).toBeDefined();
  });
});

describe('stack dimensions (#171)', () => {
  it('labels each plate and each gap', () => {
    const s = SPACED();
    const l = stackLayout(s, 900, 500);
    const lines = stackDimensions(s, l);
    expect(lines).toHaveLength(3);
    expect(lines[0].label).toBe('20 mm');
    expect(lines[1].label).toBe('gap 300 mm');
    // The rod is yawed a little by the first plate, so the second plate's line of sight is a touch over its 250 mm.
    expect(lines[2].label).toMatch(/^25\d mm$/);
    for (const d of lines) expect(d.x1).toBeGreaterThan(d.x0);
    expect(lines[1].x0).toBeCloseTo(l.stages[0].rearX, 9);
    expect(lines[1].x1).toBeCloseTo(l.stages[1].frontX, 9);
  });
});
