import { describe, expect, it } from 'vitest';
import { LESSONS, lessonStack, type Lesson } from './lessons';
import { OVERLAYS } from './sectionDraw';
import { STACK_PRESETS, simulateStack, type StackTimeline } from './stack';
import { MAX_CALIBRE_MM, MIN_CALIBRE_MM } from './munitions';

const fire = (lesson: Lesson, i: 0 | 1): StackTimeline => simulateStack(lessonStack(lesson.setups[i]));
const lesson = (id: string) => LESSONS.find((l) => l.id === id)!;
/** Depth the round reached into the last plate it got to, m. */
const lastDepth = (st: StackTimeline) => st.plates.filter((p) => p.engaged).at(-1)!.penetrationM;

describe('classroom lessons (#173)', () => {
  it('has the six lessons in order, each with a caption, a question and two setups the lab can show', () => {
    expect(LESSONS.map((l) => l.id)).toEqual(['shot-vs-rod', 'slope', 'heat-density', 'hesh-thickness', 'ricochet', 'jet-gap']);
    for (const l of LESSONS) {
      expect(l.caption.length).toBeGreaterThan(40);
      expect(l.question.trim().endsWith('?')).toBe(true);
      for (const s of l.setups) {
        expect(STACK_PRESETS.some((p) => p.id === s.arrangement)).toBe(true);
        expect(s.calibreMm).toBeGreaterThanOrEqual(MIN_CALIBRE_MM);
        expect(s.calibreMm).toBeLessThanOrEqual(MAX_CALIBRE_MM);
        // The lab's thickness slider runs 10 to 300 mm in 5 mm steps.
        expect(s.thicknessMm % 5).toBe(0);
        expect(s.thicknessMm).toBeGreaterThanOrEqual(10);
        expect(s.thicknessMm).toBeLessThanOrEqual(300);
        if (s.overlay) expect(OVERLAYS.find((o) => o.id === s.overlay)?.ready).toBe(true);
        expect(() => fire(l, l.setups.indexOf(s) as 0 | 1)).not.toThrow();
      }
    }
  });

  it('1: the full-bore shot stops in the plate the long rod goes through', () => {
    const l = lesson('shot-vs-rod');
    expect(fire(l, 0).result.perforated).toBe(false);
    expect(fire(l, 1).result.perforated).toBe(true);
  });

  it('2: the same plate stops the shot once it is sloped, with twice the path', () => {
    const l = lesson('slope');
    const flat = fire(l, 0);
    const sloped = fire(l, 1);
    expect(flat.result.perforated).toBe(true);
    expect(sloped.result.perforated).toBe(false);
    expect(sloped.result.totalLosThicknessM / flat.result.totalLosThicknessM).toBeCloseTo(2, 6);
  });

  it('3: the jet stops in steel but goes through the same thickness of aluminium', () => {
    const l = lesson('heat-density');
    expect(fire(l, 0).result.perforated).toBe(false);
    expect(fire(l, 1).result.perforated).toBe(true);
  });

  it('4: the squash head spalls the thin plate and only marks the thick one', () => {
    const l = lesson('hesh-thickness');
    expect(fire(l, 0).plates[0].mechanism).toBe('Spalling');
    expect(fire(l, 1).plates[0].mechanism).toBe('Surface damage');
  });

  it('5: the shot bites in below its critical slope and glances off above it', () => {
    const l = lesson('ricochet');
    expect(fire(l, 0).plates[0].mechanism).not.toBe('Ricochet');
    expect(fire(l, 1).plates[0].mechanism).toBe('Ricochet');
  });

  it('6: across a gap the jet digs much less into the same main plate', () => {
    const l = lesson('jet-gap');
    const alone = fire(l, 0);
    const spaced = fire(l, 1);
    expect(spaced.plates).toHaveLength(2);
    expect(spaced.plates[0].perforated).toBe(true);
    expect(lastDepth(spaced)).toBeLessThan(0.6 * lastDepth(alone));
  });
});
