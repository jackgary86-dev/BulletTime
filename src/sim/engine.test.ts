import { describe, expect, it } from 'vitest';
import { BULLETS } from '../data/bullets';
import { getMedium } from '../data/media';
import { appendShot, priorDamage } from './session';
import { fire } from './testUtil';

/** A gel block deep enough that nothing in the reference cases reaches the back. */
const DEEP_GEL = 0.9;

describe('penetration in 10% gel (reference ranges)', () => {
  const cases: [string, number, number][] = [
    ['9mm-fmj', 0.6, 0.7],
    ['9mm-jhp', 0.3, 0.4],
    ['22lr-lrn', 0.25, 0.3],
    // Not in the brief, but pinned so the tuning can't drift unnoticed.
    ['45acp-fmj', 0.55, 0.7],
    ['357mag-jsp', 0.35, 0.5],
    ['12ga-slug', 0.33, 0.48],
  ];
  it.each(cases)('%s stops between %s and %s m', (bullet, lo, hi) => {
    const { summary } = fire({ bullet, thickness: DEEP_GEL });
    expect(summary.passedThrough).toBe(false);
    expect(summary.penetrationM).toBeGreaterThanOrEqual(lo);
    expect(summary.penetrationM).toBeLessThanOrEqual(hi);
  });

  it('a hollow point penetrates less than the same round in FMJ', () => {
    const fmj = fire({ bullet: '9mm-fmj', thickness: DEEP_GEL }).summary.penetrationM;
    const jhp = fire({ bullet: '9mm-jhp', thickness: DEEP_GEL }).summary.penetrationM;
    expect(jhp).toBeLessThan(fmj * 0.7);
  });
});

describe('deceleration', () => {
  it.each(['9mm-fmj', '9mm-jhp', '22lr-lrn', '556-m193', '308-sp'])('%s only slows down inside gel', (bullet) => {
    const { summary } = fire({ bullet, thickness: DEEP_GEL });
    const points = summary.velocityVsDepth;
    expect(points.length).toBeGreaterThan(10);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].depth).toBeGreaterThanOrEqual(points[i - 1].depth);
      expect(points[i].speed).toBeLessThanOrEqual(points[i - 1].speed + 1e-9);
    }
  });

  it('the bullet track never speeds up after impact', () => {
    const timeline = fire({ bullet: '9mm-fmj', thickness: DEEP_GEL });
    const frames = timeline.tracks[0].keyframes.filter((k) => k.t >= timeline.impactTime);
    for (let i = 1; i < frames.length; i++) expect(frames[i].speed).toBeLessThanOrEqual(frames[i - 1].speed + 1e-9);
  });

  it('more gel never means a faster exit', () => {
    const exit = (thickness: number) => fire({ bullet: '9mm-fmj', thickness }).summary.exitSpeed;
    expect(exit(0.15)).toBeGreaterThan(exit(0.3));
    expect(exit(0.3)).toBeGreaterThan(exit(0.45));
  });
});

describe('expansion', () => {
  const expanding = BULLETS.filter((b) => b.expansionThresholdMs !== undefined && b.behaviour === 'expand');
  it('covers the soft points and hollow points', () => {
    expect(expanding.map((b) => b.id)).toEqual(expect.arrayContaining(['9mm-jhp', '357mag-jsp', '308-sp']));
  });
  it.each(expanding.map((b) => [b.id, b.expansionThresholdMs!] as const))('%s expands above %s m/s and not below', (bullet, threshold) => {
    const above = fire({ bullet, speed: threshold * 1.15, thickness: DEEP_GEL }).summary;
    const below = fire({ bullet, speed: threshold * 0.85, thickness: DEEP_GEL }).summary;
    expect(above.finalState).toBe('expanded');
    expect(above.finalDiameter).toBeGreaterThan(below.finalDiameter);
    expect(below.finalState).not.toBe('expanded');
  });
  it('FMJ rounds never expand', () => {
    for (const bullet of ['9mm-fmj', '45acp-fmj']) expect(fire({ bullet, thickness: DEEP_GEL }).summary.finalState).toBe('intact');
  });
});

describe('fragmentation', () => {
  it('5.56 M193 fragments at full velocity', () => {
    const { summary, tracks } = fire({ bullet: '556-m193', thickness: DEEP_GEL });
    expect(summary.finalState).toBe('fragmented');
    expect(summary.fragments).toBeGreaterThan(2);
    expect(tracks.some((t) => t.kind === 'fragment')).toBe(true);
  });
  it('5.56 M193 stays in one piece well below its fragmentation velocity', () => {
    const { summary } = fire({ bullet: '556-m193', speed: 600, thickness: DEEP_GEL });
    expect(summary.finalState).toBe('intact');
    expect(summary.fragments).toBe(0);
  });
});

describe('ricochet', () => {
  it.each(['steel-ar500', 'concrete'])('glances off %s at a shallow angle', (medium) => {
    const { summary, events } = fire({ bullet: '9mm-fmj', medium, angleDeg: 70 });
    expect(summary.ricocheted).toBe(true);
    expect(summary.penetrationM).toBe(0);
    expect(events.some((e) => e.type === 'ricochet')).toBe(true);
  });
  it.each(['steel-ar500', 'concrete'])('does not ricochet off %s head-on or at a steep angle', (medium) => {
    for (const angleDeg of [0, 30]) expect(fire({ bullet: '9mm-fmj', medium, angleDeg }).summary.ricocheted).toBe(false);
  });
  it('follows each medium’s ricochet angle', () => {
    const steel = getMedium('steel-ar500').ricochetAngleDeg!;
    expect(fire({ bullet: '9mm-fmj', medium: 'steel-ar500', angleDeg: steel - 10 }).summary.ricocheted).toBe(false);
    expect(fire({ bullet: '9mm-fmj', medium: 'steel-ar500', angleDeg: Math.min(75, steel + 10) }).summary.ricocheted).toBe(true);
  });
  it('never ricochets off water at the angles the app allows', () => {
    for (const angleDeg of [0, 45, 75]) expect(fire({ bullet: '9mm-fmj', medium: 'water', angleDeg }).summary.ricocheted).toBe(false);
  });
});

describe('hard targets', () => {
  it('AR500 steel stops a 9mm and splashes it', () => {
    const { summary } = fire({ bullet: '9mm-fmj', medium: 'steel-ar500' });
    expect(summary.passedThrough).toBe(false);
    expect(summary.finalState).toBe('splashed');
  });
  it('.50 BMG goes through a wooden board', () => {
    expect(fire({ bullet: '50bmg-fmj', medium: 'pine' }).summary.passedThrough).toBe(true);
  });
});

describe('determinism and sessions', () => {
  it('the same shot gives the same timeline', () => {
    const a = fire({ bullet: '556-m193', thickness: DEEP_GEL });
    const b = fire({ bullet: '556-m193', thickness: DEEP_GEL });
    expect(b.summary).toEqual(a.summary);
    expect(b.tracks.length).toBe(a.tracks.length);
  });
  it('a second shot down the same channel meets less resistance', () => {
    const first = fire({ bullet: '9mm-fmj', thickness: DEEP_GEL });
    const session = appendShot(null, first, 0);
    const repeat = fire({ bullet: '9mm-fmj', thickness: DEEP_GEL, damage: priorDamage(session) });
    expect(priorDamage(session).length).toBeGreaterThan(0);
    expect(repeat.summary.penetrationM).toBeGreaterThan(first.summary.penetrationM);
  });
  it('appended shots get their own ids and start times', () => {
    const one = fire({ bullet: '9mm-fmj', thickness: DEEP_GEL });
    const two = fire({ bullet: '9mm-jhp', thickness: DEEP_GEL, aim: { y: 0.03, z: 0 } });
    const session = appendShot(appendShot(null, one, 0), two, one.duration + 0.05);
    expect(session.shots).toHaveLength(2);
    expect(session.shots[1].start).toBeCloseTo(one.duration + 0.05);
    expect(session.shots[1].firstTrack).toBe(session.shots[0].trackCount);
    expect(session.tracks.map((t) => t.id)).toEqual(session.tracks.map((_, i) => i));
  });
});
