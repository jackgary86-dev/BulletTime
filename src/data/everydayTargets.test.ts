import { describe, expect, it } from 'vitest';
import { impactSound } from '../audio/cues';
import { outcomeFor } from '../sim/blastResponse';
import { fire } from '../sim/testUtil';
import { getMedium, MEDIA } from './media';
import { STACK_PRESETS, presetLayers, stackDepth } from './stacks';

const stack = (id: string) => presetLayers(STACK_PRESETS.find((p) => p.id === id)!);
const shoot = (bullet: string, id: string) => fire({ bullet, stack: stack(id) }).summary;
const kept = (bullet: string, id: string) => {
  const s = shoot(bullet, id);
  return s.passedThrough ? s.exitSpeed / s.impactSpeed : 0;
};

/** Everyday backyard targets (#240), pinned to what is commonly observed: who goes through, and how much they keep. */
describe('everyday targets (#240)', () => {
  it('offers the five targets as presets built from known media in their thickness ranges', () => {
    for (const id of ['car-door', 'drywall-wall', 'water-jug', 'smartphone', 'phone-book']) {
      const layers = stack(id);
      expect(layers.length).toBeGreaterThan(0);
      expect(stackDepth(layers)).toBeGreaterThan(0);
      for (const { medium, thickness } of layers) {
        expect(thickness).toBeGreaterThanOrEqual(medium.thickness.min - 1e-9);
        expect(thickness).toBeLessThanOrEqual(medium.thickness.max + 1e-9);
      }
    }
  });

  it('keeps the phone-only layers out of the material list but lists polyethylene', () => {
    for (const id of ['phone-glass', 'phone-cell', 'phone-frame']) expect(getMedium(id).dummyOnly).toBe(true);
    expect(MEDIA.some((m) => m.id === 'polyethylene' && !m.dummyOnly)).toBe(true);
  });

  it('car door: rifle rounds go through with most of their speed, pistols mostly stop or barely get out', () => {
    for (const id of ['556-m193', '762x39-fmj', '308-sp', '50bmg-fmj']) expect(kept(id, 'car-door')).toBeGreaterThan(0.5);
    expect(shoot('22lr-lrn', 'car-door').passedThrough).toBe(false);
    expect(shoot('45acp-fmj', 'car-door').passedThrough).toBe(false);
    expect(kept('9mm-fmj', 'car-door')).toBeLessThan(0.3);
  });

  it('drywall wall: every round goes through both sheets with little loss', () => {
    for (const id of ['22lr-lrn', '9mm-fmj', '45acp-fmj', '556-m193', '308-sp']) expect(kept(id, 'drywall-wall')).toBeGreaterThan(0.8);
  });

  it('water jug: goes through, but water takes most of a fast rifle round and a good part of a pistol round', () => {
    for (const id of ['22lr-lrn', '9mm-fmj', '45acp-fmj', '556-m193', '308-sp']) expect(shoot(id, 'water-jug').passedThrough).toBe(true);
    expect(kept('556-m193', 'water-jug')).toBeLessThan(0.4);
    expect(kept('9mm-fmj', 'water-jug')).toBeLessThan(0.9);
    expect(kept('22lr-lrn', 'water-jug')).toBeLessThan(0.7);
  });

  it('smartphone: every round goes straight through, pistols losing the most', () => {
    for (const id of ['22lr-lrn', '9mm-fmj', '45acp-fmj', '556-m193', '762x39-fmj', '308-sp']) expect(kept(id, 'smartphone')).toBeGreaterThan(0.5);
    expect(kept('556-m193', 'smartphone')).toBeGreaterThan(kept('9mm-fmj', 'smartphone'));
  });

  it('phone book: stops a .22 and a .45 but not rifle rounds', () => {
    expect(shoot('22lr-lrn', 'phone-book').passedThrough).toBe(false);
    expect(shoot('45acp-fmj', 'phone-book').passedThrough).toBe(false);
    for (const id of ['556-m193', '308-sp']) expect(kept(id, 'phone-book')).toBeGreaterThan(0.85);
  });

  it('thin polymer fails at the first overpressure and makes a sound', () => {
    expect(outcomeFor('plastic', 1).outcome).toBe('destroyed');
    expect(outcomeFor('plastic', 0.5).outcome).toBe('intact');
    expect(impactSound('plastic')).toBeTruthy();
  });

  it('each target has its own look, not a generic plank, plate or tank', () => {
    expect(getMedium('phonebook').look).toBe('paperStack');
    expect(getMedium('phone-frame').look).toBe('phoneBack');
    expect(getMedium('phone-cell').look).toBe('phoneCell');
    expect(getMedium('polyethylene').look).toBe('plasticJug');
    // The jug's water is drawn as a jug (neck, cap, handle); the skins on either side stay plastic.
    const jug = STACK_PRESETS.find((p) => p.id === 'water-jug')!;
    expect(jug.layers.map((l) => l.look)).toEqual([undefined, 'waterJug', undefined]);
  });
});
