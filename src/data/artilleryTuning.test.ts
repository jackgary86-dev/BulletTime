import { describe, expect, it } from 'vitest';
import { ARTILLERY } from './artillery';
import { getBullet } from './bullets';
import { getMedium } from './media';
import { layersFor, simulate } from '../sim/engine';

function shoot(id: string, medium: string, thickness: number) {
  const bullet = getBullet(id);
  return simulate({
    bullet,
    layers: layersFor(getMedium(medium), thickness),
    angleDeg: 0,
    impactPoint: { x: -0.2, y: 0.16, z: 0 },
    standOffM: 0.5,
  }).summary;
}

/** Armour-piercing shot against armour plate (#189): rough published muzzle figures, within about 2x. */
const AP_RHA_MM: [string, number][] = [
  ['30mm-ap', 45],
  ['37mm-ap', 40],
  ['50mm-ap', 70],
  ['57mm-ap', 100],
  ['76mm-ap', 140],
  ['88mm-ap', 180],
];

describe('artillery tuning (#189)', () => {
  it.each(AP_RHA_MM)('%s penetrates armour plate to within 2x of %i mm', (id, mm) => {
    const s = shoot(id, 'rha', 1.0);
    const got = s.penetrationM * 1000;
    expect(got).toBeGreaterThan(mm / 2);
    expect(got).toBeLessThan(mm * 2);
  });

  it('orders armour-piercing shot by calibre and keeps it intact (hard core)', () => {
    const depth = (id: string) => shoot(id, 'rha', 1.0).penetrationM;
    expect(depth('37mm-ap')).toBeLessThan(depth('57mm-ap'));
    expect(depth('57mm-ap')).toBeLessThan(depth('76mm-ap'));
    for (const id of ['30mm-ap', '88mm-ap']) expect(shoot(id, 'rha', 0.5).finalState).not.toBe('splashed');
  });

  it('sends a long rod through plate that stops a solid shot, and HE shells do not get through', () => {
    expect(shoot('120mm-apfsds', 'rha', 0.4).passedThrough).toBe(true);
    expect(shoot('57mm-ap', 'rha', 0.4).passedThrough).toBe(false);
    for (const s of ARTILLERY.filter((b) => b.behaviour === 'explosive' && !b.blast?.jet)) expect(shoot(s.id, 'rha', 0.3).passedThrough).toBe(false);
  });
});

function detonation(id: string, medium: string, thickness: number) {
  const bullet = getBullet(id);
  const t = simulate({
    bullet,
    layers: layersFor(getMedium(medium), thickness),
    angleDeg: 0,
    impactPoint: { x: -0.2, y: 0.16, z: 0 },
    standOffM: 0.5,
  });
  return { t, boom: t.events.find((e) => e.type === 'detonate') };
}

describe('delay fuzes and HESH (#190, #191)', () => {
  it('bursts an APHE shell behind the plate it punched through, not on the face', () => {
    const { boom } = detonation('88mm-aphe', 'rha', 0.05);
    expect(boom).toBeDefined();
    // The plate's back face is at x = -0.2 + 0.05.
    expect(boom!.pos.x).toBeGreaterThan(-0.2 + 0.05);
  });

  it('buries a delay-fuzed howitzer shell in earth before it bursts, where a contact shell bursts on the face', () => {
    const delayed = detonation('155mm-he-delay', 'packed-earth', 2).boom!;
    const contact = detonation('155mm-he', 'packed-earth', 2).boom!;
    expect(contact.pos.x).toBeLessThan(-0.19);
    expect(delayed.pos.x).toBeGreaterThan(contact.pos.x + 0.3);
  });

  it('scabs the far side of plate thinner than the HESH limit, and not thicker plate', () => {
    const behindFace = (thickness: number) => {
      const { t } = detonation('120mm-rr-hesh', 'rha', thickness);
      const back = -0.2 + thickness;
      return t.tracks.filter((tr) => tr.kind === 'fragment' && tr.keyframes[0].pos.x >= back).length;
    };
    expect(behindFace(0.08)).toBeGreaterThan(10);
    expect(behindFace(0.4)).toBe(0);
  });
});

describe('framing for big rounds (#192)', () => {
  it('reaches back for the length of the shell and caps it for the longest missiles', async () => {
    const { framingReach } = await import('./modes');
    expect(framingReach(getBullet('9mm-fmj'))).toBe(0.5);
    expect(framingReach(getBullet('240mm-he'))).toBeCloseTo(1.2, 5);
    expect(framingReach(getBullet('missile:cruise:shaped'))).toBe(3.5);
    expect(framingReach(getBullet('charge-satchel'))).toBe(2);
  });
});
