import { describe, expect, it } from 'vitest';
import { ALL_MUNITIONS, BULLETS, getBullet } from '../data/bullets';
import { ARTILLERY } from '../data/artillery';
import { EXPLOSIVES } from '../data/explosives';
import { AIRFRAMES, MISSILES, OPTIMUM_STANDOFF_CAL, WARHEADS, findMissile, jetStandoffFactor, missileId } from '../data/missiles';
import { MODES, roundsForMode } from '../data/modes';
import { getMedium } from '../data/media';
import { blastOverpressureKPa, layersFor, simulate } from './engine';
import { blastResponse, debrisScale, outcomeFor } from './blastResponse';

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

  it('builds five airframes with nine warheads each', () => {
    expect(AIRFRAMES).toHaveLength(5);
    expect(WARHEADS).toHaveLength(9);
    expect(MISSILES).toHaveLength(45);
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

describe('more shaped-charge heads (#260)', () => {
  const depth = (id: string) => shoot(id, 'rha', 1.0).summary.penetrationM;

  it('a large-calibre head bores deeper than the standard shaped charge', () => {
    for (const a of ['light-rocket', 'guided-at']) expect(depth(missileId(a, 'shaped-large'))).toBeGreaterThan(depth(missileId(a, 'shaped')) * 1.1);
    // Light rocket: 70 mm calibre, over 5.5 calibres into the plate.
    expect(depth(missileId('light-rocket', 'shaped-large')) / 0.07).toBeGreaterThan(5.5);
  });

  it('an explosively formed penetrator is a single slug that bores less than a jet', () => {
    expect(getBullet(missileId('guided-at', 'efp')).blast?.jet?.count).toBe(1);
    for (const a of ['light-rocket', 'guided-at']) expect(depth(missileId(a, 'efp'))).toBeLessThan(depth(missileId(a, 'shaped')));
  });
});

describe('jet stand-off (#260)', () => {
  const depth = (id: string) => shoot(id, 'rha', 1.0).summary.penetrationM;

  it('the factor is 1 at the optimum, lower either side, and never below 0.4', () => {
    expect(jetStandoffFactor(undefined)).toBe(1);
    expect(jetStandoffFactor(OPTIMUM_STANDOFF_CAL)).toBe(1);
    expect(jetStandoffFactor(1)).toBeLessThan(1);
    expect(jetStandoffFactor(10)).toBeLessThan(1);
    expect(jetStandoffFactor(0)).toBeGreaterThanOrEqual(0.4);
    expect(jetStandoffFactor(100)).toBeGreaterThanOrEqual(0.4);
  });

  it('a probe bores deeper than a charge fuzed at the nose', () => {
    for (const a of ['light-rocket', 'guided-at']) expect(depth(missileId(a, 'shaped-probe'))).toBeGreaterThan(depth(missileId(a, 'shaped-short')) * 1.15);
  });
});

describe('blast response of the material (#196)', () => {
  const layer = (id: string, offset = 0, stack = 0) => {
    const medium = getMedium(id);
    return { medium, thickness: medium.thickness.default, offset, stack };
  };

  it('fails glass, drywall and wood well before concrete, and steel last', () => {
    const at = (id: string) => blastResponse(1.3, 1.2, [layer(id)])[0].k;
    expect(at('glass')).toBeGreaterThan(at('drywall'));
    expect(at('drywall')).toBeGreaterThan(at('pine'));
    expect(at('pine')).toBeGreaterThan(at('concrete'));
    expect(at('concrete')).toBeGreaterThan(at('steel-mild'));
  });

  it('destroys brittle panels, topples a wood panel in the middle range and cracks heavy ones', () => {
    expect(outcomeFor('glass', 1.1).outcome).toBe('destroyed');
    expect(outcomeFor('wood', 1.5).outcome).toBe('toppled');
    expect(outcomeFor('wood', 3).outcome).toBe('destroyed');
    expect(outcomeFor('concrete', 3).outcome).toBe('cracked');
    expect(outcomeFor('concrete', 8).outcome).toBe('toppled');
    expect(outcomeFor('steel', 0.5).outcome).toBe('intact');
  });

  it('shields later panels behind one that holds, but not behind one that is blown away', () => {
    const behindHeld = blastResponse(6.5, 2, [layer('steel-mild'), layer('glass', 0.3, 1)])[1];
    const behindGone = blastResponse(6.5, 2, [layer('glass'), layer('glass', 0.3, 1)])[1];
    expect(behindHeld.pressureKPa).toBeLessThan(behindGone.pressureKPa * 0.4);
  });

  it('reports each layer of the stack on the charge summary, and more stand-off means less pressure', () => {
    const near = shoot('charge-block', 'pine', 0.038).summary.blastLayers![0];
    const far = simulate({
      bullet: { ...getBullet('charge-block'), standoffM: 4 },
      layers: layersFor(getMedium('pine'), 0.038),
      angleDeg: 0,
      impactPoint: { x: -0.2, y: 0.16, z: 0 },
      standOffM: 4,
    }).summary.blastLayers![0];
    expect(near.name).toBe('Pine plank');
    expect(far.pressureKPa).toBeLessThan(near.pressureKPa / 5);
  });
});

describe('results for warheads and charges (#200)', () => {
  it('follows the deepest jet through the plate, fastest at the face and slowing as it bores', () => {
    const s = shoot(missileId('guided-at', 'shaped'), 'rha', 0.3).summary;
    expect(s.penetrator).toBeDefined();
    expect(s.penetrator!.startSpeed).toBeGreaterThan(3000);
    const curve = s.penetrator!.curve;
    expect(curve.length).toBeGreaterThan(5);
    expect(curve.at(-1)!.depth).toBeGreaterThan(curve[0].depth);
    expect(curve.at(-1)!.speed).toBeLessThan(curve[0].speed);
  });

  it('has no penetrator curve for plain bullets and for a charge that throws nothing', () => {
    expect(shoot('9mm-fmj', 'pine', 0.038).summary.penetrator).toBeUndefined();
    expect(shoot('charge-block', 'pine', 0.038).summary.penetrator).toBeUndefined();
  });

  it('follows the fragments of a cased charge into the target', () => {
    const s = shoot('charge-cased', 'drywall', 0.0127).summary;
    expect(s.penetrator?.curve.length ?? 0).toBeGreaterThan(1);
  });
});

describe('debris scaling (#192)', () => {
  it('sizes the debris from a burst by its yield, small for a 20 mm shell and capped for the biggest', () => {
    expect(debrisScale(0.01)).toBeCloseTo(0.215, 2);
    expect(debrisScale(1)).toBe(1);
    expect(debrisScale(8)).toBe(2);
    expect(debrisScale(30)).toBe(2.5);
    expect(debrisScale(5000)).toBe(2.5);
    expect(debrisScale(0)).toBe(0.15);
  });
});

describe('missile launch run (#194)', () => {
  it('starts a powered missile slowly, well back from the target, and has it at full speed by impact', () => {
    const spec = getBullet(missileId('guided-at', 'shaped'));
    const t = shoot(spec.id, 'rha', 0.1);
    const frames = t.tracks[0].keyframes;
    expect(frames[0].speed).toBeCloseTo(spec.muzzleVelocityMs * 0.25, 0);
    expect(frames[0].pos.x).toBeLessThan(-0.2 - 0.5 - 1);
    expect(t.summary.impactSpeed).toBeCloseTo(spec.muzzleVelocityMs, 0);
    // Speed never goes down on the way in.
    const before = frames.filter((f) => f.pos.x < -0.2);
    for (let i = 1; i < before.length; i++) expect(before[i].speed).toBeGreaterThanOrEqual(before[i - 1].speed - 0.01);
  });

  it('gives a kinetic penetrator no launch run, and keeps the run bounded for the biggest airframe', () => {
    expect(getBullet(missileId('guided-at', 'penetrator')).launch).toBeUndefined();
    const cruise = getBullet(missileId('cruise', 'shaped'));
    expect(cruise.launch!.runM).toBe(3);
    expect(shoot(cruise.id, 'rha', 0.1).duration).toBeLessThan(0.05);
  });
});
