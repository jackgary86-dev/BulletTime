import { describe, expect, it } from 'vitest';
import { exportCaption, exportFileName, exportSubject } from './exportFrame';
import { LESSONS, lessonStack } from './lessons';
import { simulateStack } from './stack';

const stackOf = (lessonId: string, i: 0 | 1) => simulateStack(lessonStack(LESSONS.find((l) => l.id === lessonId)!.setups[i]));

describe('saving a frame as a PNG (#173)', () => {
  it('names the round, the plates and the slope', () => {
    expect(exportSubject(stackOf('shot-vs-rod', 1))).toBe('120 mm APFSDS long rod → 200 mm RHA at 0°');
    expect(exportSubject(stackOf('jet-gap', 1))).toMatch(/^50 mm .+ → 20 mm Mild steel \+ 300 mm RHA at 0°$/);
    expect(exportSubject(stackOf('slope', 1))).toMatch(/at 60°$/);
  });

  it('captions the moment and always carries the model note', () => {
    const st = stackOf('shot-vs-rod', 1);
    const [a, b] = exportCaption(st, 63e-6, 'Rod breaks out of the rear face');
    expect(a).toBe('BulletTime Armor lab · 120 mm APFSDS long rod → 200 mm RHA at 0° · t = 63.0 µs');
    expect(b).toBe('Rod breaks out of the rear face. Simplified teaching model, not engineering data.');
    expect(exportCaption(st, 0, '')[1]).toBe('Simplified teaching model, not engineering data.');
    expect(exportCaption(st, 0.0123, '')[0]).toMatch(/t = 12\.3 ms$/);
  });

  it('gives a file name safe on every system', () => {
    const st = stackOf('shot-vs-rod', 1);
    expect(exportFileName(st, 63e-6)).toBe('bullettime-armor-apfsds-120mm-63us.png');
    expect(exportFileName(st, 0.0123)).toBe('bullettime-armor-apfsds-120mm-12ms.png');
    for (const l of LESSONS) for (const i of [0, 1] as const) expect(exportFileName(stackOf(l.id, i), 1e-4)).toMatch(/^[a-z0-9.-]+\.png$/);
  });
});
