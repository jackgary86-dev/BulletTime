import { describe, expect, it } from 'vitest';
import { scaleBurst, shellScale } from './shellScale';
import type { BurstSpec } from './particles';

const burst = { size: [0.002, 0.004], life: [0.004, 0.01], originJitter: 0.004 } as BurstSpec;

describe('shell-scale steel effects (#234)', () => {
  it('leaves bullet-sized rounds alone and caps very large ones', () => {
    expect(shellScale(0.009)).toBe(1);
    expect(shellScale(0.155)).toBe(12);
    expect(shellScale(0.5)).toBe(12);
    expect(scaleBurst(burst, 1)).toBe(burst);
  });

  it('a 155 mm shell throws bigger, longer-lived chips from a wider area than a bullet', () => {
    const big = scaleBurst(burst, shellScale(0.155));
    expect(big.size[1]).toBeGreaterThan(burst.size[1] * 10);
    expect(big.life[1]).toBeGreaterThan(burst.life[1]);
    expect(big.originJitter!).toBeGreaterThan(burst.originJitter! * 10);
  });
});
