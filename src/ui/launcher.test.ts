import { describe, expect, it } from 'vitest';
import { nextCard } from './launcher';

describe('launcher keyboard navigation (#202)', () => {
  it('steps across a row and wraps at the ends', () => {
    expect(nextCard(0, 'ArrowRight', 4, 4)).toBe(1);
    expect(nextCard(3, 'ArrowRight', 4, 4)).toBe(0);
    expect(nextCard(0, 'ArrowLeft', 4, 4)).toBe(3);
  });

  it('moves down and up by a row when the cards wrap, and stays put at the edge', () => {
    expect(nextCard(0, 'ArrowDown', 4, 2)).toBe(2);
    expect(nextCard(2, 'ArrowUp', 4, 2)).toBe(0);
    expect(nextCard(1, 'ArrowUp', 4, 2)).toBe(1);
    expect(nextCard(3, 'ArrowDown', 4, 2)).toBe(3);
  });

  it('jumps to the first and last card, and ignores other keys', () => {
    expect(nextCard(2, 'Home', 4, 4)).toBe(0);
    expect(nextCard(1, 'End', 4, 4)).toBe(3);
    expect(nextCard(1, 'x', 4, 4)).toBe(1);
  });
});
