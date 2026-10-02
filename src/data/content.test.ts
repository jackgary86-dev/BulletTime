import { describe, expect, it } from 'vitest';
import { bloodColor, onReducedGoreChange, reducedGore, setReducedGore, SIMULANT_COLOR } from './content';

describe('reduced gore', () => {
  it('swaps blood for the simulant colour and notifies listeners', () => {
    const seen: boolean[] = [];
    onReducedGoreChange((on) => seen.push(on));
    expect(reducedGore()).toBe(false);
    expect(bloodColor(0x7a0a12)).toBe(0x7a0a12);
    setReducedGore(true);
    expect(bloodColor(0x7a0a12)).toBe(SIMULANT_COLOR);
    setReducedGore(true); // no change, no second notification
    setReducedGore(false);
    expect(bloodColor(0x7a0a12)).toBe(0x7a0a12);
    expect(seen).toEqual([true, false]);
  });
});
