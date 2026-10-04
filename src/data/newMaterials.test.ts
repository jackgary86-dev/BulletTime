import { describe, expect, it } from 'vitest';
import { getBullet } from './bullets';
import { getMedium } from './media';
import { layersFor, simulate } from '../sim/engine';

function shoot(bullet: string, medium: string) {
  const m = getMedium(medium);
  return simulate({
    bullet: getBullet(bullet),
    layers: layersFor(m, m.thickness.default),
    angleDeg: 0,
    impactPoint: { x: -0.2, y: 0.16, z: 0 },
    standOffM: 0.5,
  }).summary;
}

/** Pins the tuning of the materials added in #187 to what is known about them: who stops, who goes through. */
describe('new material tuning (#187)', () => {
  it('stops handguns in aluminium plate (6 mm) and lets rifles through', () => {
    expect(shoot('22lr-lrn', 'aluminum').passedThrough).toBe(false);
    expect(shoot('45acp-fmj', 'aluminum').passedThrough).toBe(false);
    expect(shoot('556-m193', 'aluminum').passedThrough).toBe(true);
    expect(shoot('762x39-fmj', 'aluminum').passedThrough).toBe(true);
  });

  it('only chips a brick with handguns, buries rifle rounds, and lets heavy rifle rounds through', () => {
    for (const id of ['22lr-lrn', '9mm-fmj', '45acp-fmj']) expect(shoot(id, 'brick').penetrationM).toBeLessThan(0.05);
    expect(shoot('762x39-fmj', 'brick').passedThrough).toBe(false);
    expect(shoot('308-sp', 'brick').passedThrough).toBe(true);
    expect(shoot('50bmg-fmj', 'brick').passedThrough).toBe(true);
  });

  it('puts brick between drywall and concrete', () => {
    expect(shoot('9mm-fmj', 'brick').penetrationM).toBeGreaterThan(shoot('9mm-fmj', 'concrete').penetrationM);
    expect(shoot('9mm-fmj', 'drywall').passedThrough).toBe(true);
  });

  it('lets every round through cardboard, sheet metal and plywood with little loss', () => {
    for (const medium of ['cardboard', 'sheet-metal', 'plywood'])
      for (const id of ['9mm-fmj', '556-m193', '308-sp']) {
        const s = shoot(id, medium);
        expect(s.passedThrough).toBe(true);
        expect(s.exitSpeed).toBeGreaterThan(s.impactSpeed * 0.8);
      }
  });

  it('stops pistol rounds in a phone book more often than not, but not rifles', () => {
    expect(shoot('45acp-fmj', 'phonebook').passedThrough).toBe(false);
    expect(shoot('556-m193', 'phonebook').passedThrough).toBe(true);
  });
});
