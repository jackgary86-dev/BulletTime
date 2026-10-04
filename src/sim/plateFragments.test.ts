import { describe, expect, it } from 'vitest';
import { getBullet } from '../data/bullets';
import { fire } from './testUtil';

/** Punching through a steel plate tears the round into a cone of fragments (#188). */
const PLATE = { medium: 'steel-mild', thickness: 0.002 };

const fragmentsOf = (shot: Parameters<typeof fire>[0]) => fire(shot).tracks.filter((t) => t.kind === 'fragment');

describe('plate fragmentation on exit', () => {
  it.each(['9mm-fmj', '308-sp', '556-m193'])('%s sheds 14 fragments through mild steel', (bullet) => {
    const timeline = fire({ bullet, ...PLATE });
    expect(timeline.summary.passedThrough).toBe(true);
    expect(timeline.summary.fragments).toBe(14);
    expect(timeline.tracks.filter((t) => t.kind === 'fragment')).toHaveLength(14);
    expect(timeline.events.filter((e) => e.type === 'exit')).toHaveLength(1);
    expect(timeline.events.filter((e) => e.type === 'fragment')).toHaveLength(1);
  });

  it('the fragments carry roughly 45% of the bullet mass', () => {
    for (const bullet of ['9mm-fmj', '308-sp']) {
      const bulletKg = getBullet(bullet).massGrains * 6.479891e-5;
      const total = fragmentsOf({ bullet, ...PLATE }).reduce((sum, t) => sum + t.massKg, 0);
      // Each fragment gets (0.5 + rand) of an equal share, so the sum wanders around 45%.
      expect(total / bulletKg).toBeGreaterThan(0.3);
      expect(total / bulletKg).toBeLessThan(0.6);
    }
  });

  it('every fragment is lighter than the bullet that shed it', () => {
    const bulletKg = getBullet('9mm-fmj').massGrains * 6.479891e-5;
    for (const t of fragmentsOf({ bullet: '9mm-fmj', ...PLATE })) {
      expect(t.massKg).toBeGreaterThan(0);
      expect(t.massKg).toBeLessThan(bulletKg * 0.45);
    }
  });

  it('each buckshot pellet sheds 4 fragments', () => {
    const timeline = fire({ bullet: '12ga-00buck', medium: 'steel-mild', thickness: 0.001 });
    const pelletsThrough = timeline.events.filter((e) => e.type === 'exit').length;
    expect(pelletsThrough).toBeGreaterThan(0);
    expect(timeline.tracks.filter((t) => t.kind === 'fragment')).toHaveLength(pelletsThrough * 4);
  });

  it('a round stopped by the plate sheds no exit fragments', () => {
    const timeline = fire({ bullet: '9mm-fmj', medium: 'steel-mild', thickness: 0.05 });
    expect(timeline.summary.passedThrough).toBe(false);
    expect(timeline.events.filter((e) => e.type === 'exit')).toHaveLength(0);
  });

  it('only steel does it: a round through a thin gel block sheds nothing on exit', () => {
    const timeline = fire({ bullet: '9mm-fmj', medium: 'gel10', thickness: 0.05 });
    expect(timeline.summary.passedThrough).toBe(true);
    expect(timeline.summary.fragments).toBe(0);
  });

  it('fragments do not shed fragments of their own', () => {
    expect(fire({ bullet: '9mm-fmj', ...PLATE }).events.filter((e) => e.type === 'fragment')).toHaveLength(1);
  });

  it('is deterministic', () => {
    const a = fire({ bullet: '308-sp', ...PLATE });
    const b = fire({ bullet: '308-sp', ...PLATE });
    expect(b.tracks.map((t) => t.massKg)).toEqual(a.tracks.map((t) => t.massKg));
  });
});
