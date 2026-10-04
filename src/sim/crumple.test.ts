import { describe, expect, it } from 'vitest';
import { bodyVisible, crumpledLength, crumpleDuration, crumpleProgress } from './crumple';

describe('missile crumple timing (#248)', () => {
  it('shortens monotonically and stays within the body length', () => {
    const d = crumpleDuration(3, 300, 0.8);
    let last = -1;
    let lastLen = Infinity;
    for (let t = -0.001; t < 0.1; t += 0.0005) {
      const p = crumpleProgress(t, d);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
      const len = crumpledLength(3, p);
      expect(len).toBeLessThanOrEqual(lastLen);
      expect(len).toBeGreaterThanOrEqual(0.2 * 3 - 1e-9);
      expect(len).toBeLessThanOrEqual(3);
      lastLen = len;
    }
    expect(crumpleProgress(d, d)).toBe(1);
  });

  it('folds faster at higher speed and against harder targets', () => {
    expect(crumpleDuration(1, 600, 0.8)).toBeLessThan(crumpleDuration(1, 150, 0.8));
    expect(crumpleDuration(1, 300, 1)).toBeLessThan(crumpleDuration(1, 300, 0.1));
  });

  it('is drawn for a while after folding, then clears', () => {
    const d = crumpleDuration(3, 300, 0.8);
    expect(bodyVisible(d, d)).toBe(true);
    expect(bodyVisible(d + 1, d)).toBe(false);
  });
});
