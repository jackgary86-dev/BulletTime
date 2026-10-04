import { describe, expect, it } from 'vitest';
import { ALL_MUNITIONS, BULLETS, getBullet } from '../data/bullets';
import { ARTILLERY } from '../data/artillery';
import { EXPLOSIVES } from '../data/explosives';
import { AIRFRAMES, MISSILES, WARHEADS, findMissile, missileId } from '../data/missiles';
import { MODES, roundsForMode } from '../data/modes';
import { getMedium } from '../data/media';
import { blastOverpressureKPa, layersFor, simulate } from './engine';

function shoot(id: string, medium: string, thickness: number) {
  const m = getMedium(medium);
  const bullet = getBullet(id);
  return simulate({
    bullet,
    layers: layersFor(m, thickness),
    angleDeg: 0,
    impactPoint: { x: -0.2, y: 0.16, z: 0 },
    standOffM: bullet.standoffM ?? 0.5,
  });
}

describe('simulator catalogues', () => {
  it('lists unique ids and every id resolves', () => {
    const ids = [...ALL_MUNITIONS, ...MISSILES].map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(getBullet(id).id).toBe(id);
  });

  it('covers the ranges: bullets to 20 mm, artillery 20 to 240 mm', () => {
    expect(Math.min(...BULLETS.map((b) => b.caliberMm))).toBeLessThan(6);
    expect(Math.max(...BULLETS.map((b) => b.caliberMm))).toBe(20);
    const calibres = roundsForMode('artillery').map((b) => b.caliberMm);
    expect(Math.min(...calibres)).toBe(20);
    expect(Math.max(...calibres)).toBe(240);
  });

  it('builds five airframes with five warheads each', () => {
    expect(AIRFRAMES).toHaveLength(5);
    expect(WARHEADS).toHaveLength(5);
    expect(MISSILES).toHaveLength(25);
    expect(findMissile(missileId('cruise', 'thermobaric'))?.mode).toBe('missile');
    expect(findMissile('missile:nope:shaped')).toBeUndefined();
  });

  it('gives every mode a default round that exists', () => {
    for (const mode of Object.values(MODES)) expect(getBullet(mode.defaultId).id).toBe(mode.defaultId);
  });

  it('offers charges in the test bed with a stand-off', () => {
    for (const c of EXPLOSIVES) {
      expect(c.behaviour).toBe('charge');
      expect(c.standoffM).toBeGreaterThan(0);
    }
  });
});

describe('blast physics', () => {
  it('falls off with distance and rises with yield', () => {
    expect(blastOverpressureKPa(1, 2)).toBeGreaterThan(blastOverpressureKPa(1, 4));
    expect(blastOverpressureKPa(5, 3)).toBeGreaterThan(blastOverpressureKPa(1, 3));
  });

  it('reports a charge as a detonation with yield and overpressure, not an impact', () => {
    const t = shoot('charge-block', 'plywood', 0.018);
    const boom = t.events.find((e) => e.type === 'detonate');
    expect(boom?.yieldKg).toBeCloseTo(1.3);
    expect(boom?.pressureKPa).toBeGreaterThan(100);
    expect(t.summary.blastKPa).toBe(boom?.pressureKPa);
    expect(t.summary.finalState).toBe('detonated');
  });

  it('throws fragments from a cased charge but none from a bare one', () => {
    expect(shoot('charge-cased', 'concrete', 0.19).summary.fragments).toBeGreaterThan(20);
    expect(shoot('charge-block', 'concrete', 0.19).summary.fragments).toBe(0);
  });
});

describe('artillery and missile impacts', () => {
  it('lets a shaped-charge jet through armour that blast-fragmentation cannot cross', () => {
    const jet = shoot(missileId('guided-at', 'shaped'), 'rha', 0.2);
    const frag = shoot(missileId('guided-at', 'blast-frag'), 'rha', 0.2);
    expect(jet.summary.passedThrough).toBe(true);
    expect(frag.summary.passedThrough).toBe(false);
    expect(jet.summary.penetrationM).toBeGreaterThan(frag.summary.penetrationM * 3);
  });

  it('keeps high-explosive shell fragments from defeating thick armour', () => {
    for (const shell of ARTILLERY.filter((b) => b.id.endsWith('-he'))) expect(shoot(shell.id, 'rha', 0.3).summary.passedThrough).toBe(false);
  });

  it('lets a heavy armour-piercing shot through a concrete wall that stops a light one', () => {
    expect(shoot('88mm-ap', 'reinforced-concrete', 0.4).summary.passedThrough).toBe(true);
    expect(shoot('30mm-ap', 'reinforced-concrete', 0.4).summary.passedThrough).toBe(false);
  });

  it('detonates a high-explosive shell on contact, with its yield on the event', () => {
    const t = shoot('155mm-he', 'reinforced-concrete', 0.4);
    expect(t.summary.finalState).toBe('detonated');
    expect(t.events.find((e) => e.type === 'detonate')?.yieldKg).toBe(8);
  });
});

describe('missile warheads', () => {
  const bore = (airframe: string, head: string) => {
    const b = getBullet(missileId(airframe, head));
    return simulate({ bullet: b, layers: layersFor(getMedium('rha'), 4), angleDeg: 0, impactPoint: { x: -0.2, y: 0.16, z: 0 }, standOffM: b.standoffM ?? 0.5 }).summary.penetrationM;
  };

  it('bores deeper with a wider warhead, a few calibres into armour', () => {
    const depths = AIRFRAMES.map((a) => bore(a.id, 'shaped'));
    for (let i = 1; i < depths.length; i++) expect(depths[i]).toBeGreaterThan(depths[i - 1]);
    AIRFRAMES.forEach((a, i) => {
      const calibres = depths[i] / (a.caliberMm / 1000);
      expect(calibres).toBeGreaterThan(2.5);
      expect(calibres).toBeLessThan(7);
    });
  });

  it('sends a tandem warhead second jets down the first hole, so it bores deeper than a single charge', () => {
    for (const a of AIRFRAMES) expect(bore(a.id, 'tandem')).toBeGreaterThan(bore(a.id, 'shaped') * 1.1);
  });
});

describe('shaped-charge depth (#195, #193)', () => {
  const calibres = (id: string) => {
    const t = shoot(id, 'rha', 1.0);
    return t.summary.penetrationM / (getBullet(id).caliberMm / 1000);
  };

  it('bores about four to five calibres of armour from every airframe that fits the plate', () => {
    for (const a of ['light-rocket', 'shoulder-rocket', 'guided-at', 'air-surface']) {
      const d = calibres(missileId(a, 'shaped'));
      expect(d).toBeGreaterThan(3.5);
      expect(d).toBeLessThan(6.5);
    }
  });

  it('bores deeper with a tandem warhead, whose second jets follow the first hole', () => {
    for (const a of ['light-rocket', 'guided-at']) expect(calibres(missileId(a, 'tandem'))).toBeGreaterThan(calibres(missileId(a, 'shaped')) * 1.1);
  });
});
