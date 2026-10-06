import { describe, expect, it } from 'vitest';
import { CAP_POP_SPEED_MS, jugSpray } from './jugSpray';

describe('closed jug spray (#240)', () => {
  it('sprays much harder from a rifle round than a .22', () => {
    const rifle = jugSpray(900, 600);
    const small = jugSpray(330, 120);
    expect(rifle.exitCount).toBeGreaterThan(small.exitCount * 1.5);
    expect(rifle.entryScale).toBeGreaterThan(small.entryScale);
    expect(rifle.exitSpeed[1]).toBeGreaterThan(small.exitSpeed[1]);
  });

  it('pops the cap only for a fast round', () => {
    expect(jugSpray(CAP_POP_SPEED_MS - 1, 100).capPops).toBe(false);
    expect(jugSpray(CAP_POP_SPEED_MS, 100).capPops).toBe(true);
  });

  it('still sprays out the exit when the round stops inside, in a wider, softer cone', () => {
    const stopped = jugSpray(500, null);
    const through = jugSpray(500, 200);
    expect(stopped.exitCount).toBeGreaterThan(0);
    expect(stopped.exitSpread).toBeGreaterThan(through.exitSpread);
    expect(stopped.exitCount).toBeLessThan(through.exitCount);
  });
});
