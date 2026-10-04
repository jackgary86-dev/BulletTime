import { describe, expect, it } from 'vitest';
import { bodyDebrisPlan } from './bodyDebris';

const missile = { caliberMm: 127, lengthMm: 1600, shape: 'missile' } as const;

describe('missile body debris (#248)', () => {
  it('sheds four fins and a spray of skin, sized to the body', () => {
    const p = bodyDebrisPlan(missile, 280, 0.8);
    expect(p.fins.count).toBe(4);
    expect(p.skin.count).toBeGreaterThan(20);
    expect(p.skin.size[1]).toBeLessThan(0.127 * 0.3);
    expect(p.fins.size[0]).toBeGreaterThan(p.skin.size[1]);
  });

  it('a shell has no fins, and the fins come off partway through the crumple', () => {
    expect(bodyDebrisPlan({ ...missile, shape: 'roundNose' } as never, 500, 0.8).fins.count).toBe(0);
    const p = bodyDebrisPlan(missile, 280, 0.8);
    expect(p.skinAtS).toBeLessThan(p.finsAtS);
    expect(p.finsAtS).toBeGreaterThan(0);
  });

  it('is thrown harder at higher speed, capped', () => {
    expect(bodyDebrisPlan(missile, 600, 0.8).skin.speed[1]).toBeGreaterThan(bodyDebrisPlan(missile, 150, 0.8).skin.speed[1]);
    expect(bodyDebrisPlan(missile, 5000, 0.8).skin.speed[1]).toBeLessThanOrEqual(80);
  });
});
