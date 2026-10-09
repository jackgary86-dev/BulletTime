import { describe, expect, it } from 'vitest';
import { ALL_MUNITIONS, BULLETS, getBullet } from '../data/bullets';
import { EXPLOSIVES } from '../data/explosives';
import { AIRFRAMES, MISSILES, OPTIMUM_STANDOFF_CAL, WARHEADS, findMissile, jetStandoffFactor, missileId } from '../data/missiles';
import { MODES, roundsForMode } from '../data/modes';
import { getMedium } from '../data/media';
import { blastOverpressureKPa, layersFor, simulate } from './engine';
import { blastResponse, debrisScale, outcomeFor } from './blastResponse';
import { STACK_PRESETS, presetLayers } from '../data/stacks';
import { fire } from './testUtil';

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

  it('covers the ranges: bullets to 20 mm, artillery from autocannon to tank guns', () => {
    expect(Math.min(...BULLETS.map((b) => b.caliberMm))).toBeLessThan(6);
    expect(Math.max(...BULLETS.map((b) => b.caliberMm))).toBe(20);
    const ids = roundsForMode('artillery').map((b) => b.id);
    expect(ids).toContain('20mm-ap');
    expect(ids).toContain('125mm-apfsds');
  });

  it('offers only armour-piercing and penetrator rounds in Artillery and Missile', () => {
    // APHE keeps a small filler that bursts after it gets through; everything else is solid shot or a core.
    for (const b of roundsForMode('artillery')) expect(b.blast === undefined || b.type === 'APHE', b.id).toBe(true);
    for (const b of MISSILES) expect(b.blast === undefined || b.type === 'Explosively formed penetrator', b.id).toBe(true);
    expect(roundsForMode('artillery').map((b) => b.id)).not.toContain('20mm-hei');
  });

  it('builds five airframes with four penetrating heads each', () => {
    expect(AIRFRAMES).toHaveLength(5);
    expect(WARHEADS.map((w) => w.id)).toEqual(['penetrator', 'long-rod', 'heavy-core', 'efp']);
    expect(MISSILES).toHaveLength(20);
    expect(findMissile(missileId('cruise', 'long-rod'))?.mode).toBe('missile');
    expect(findMissile('missile:cruise:shaped')).toBeUndefined();
    expect(findMissile('missile:nope:penetrator')).toBeUndefined();
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
  const depth = (id: string) => shoot(id, 'rha', 1.0).summary.penetrationM;

  it('sends a sub-calibre core deeper into armour than full-calibre shot from the same gun', () => {
    expect(depth('76mm-hvap')).toBeGreaterThan(depth('76mm-ap'));
    expect(depth('88mm-apcr')).toBeGreaterThan(depth('88mm-ap'));
    expect(depth('57mm-apds')).toBeGreaterThan(depth('57mm-ap'));
    expect(depth('30mm-apfsds')).toBeGreaterThan(depth('30mm-ap'));
    expect(depth('105mm-apfsds')).toBeGreaterThan(depth('105mm-apds'));
  });

  it('keeps sub-calibre depths in the range of their class, at the muzzle', () => {
    // Rounded point-blank figures for each class, within a wide margin: the engine is tuned for the look, not a range table.
    const near = (id: string, mm: number) => {
      expect(depth(id) * 1000, id).toBeGreaterThan(mm * 0.7);
      expect(depth(id) * 1000, id).toBeLessThan(mm * 1.3);
    };
    near('25mm-apds', 90);
    near('57mm-apds', 190);
    near('76mm-hvap', 210);
    near('88mm-apcr', 280);
    near('105mm-apds', 330);
    near('105mm-apfsds', 420);
    near('125mm-apfsds', 560);
  });

  it('lets a heavy armour-piercing shot through a concrete wall that stops a light one', () => {
    expect(shoot('88mm-ap', 'reinforced-concrete', 0.4).summary.passedThrough).toBe(true);
    expect(shoot('30mm-ap', 'reinforced-concrete', 0.4).summary.passedThrough).toBe(false);
  });

  it('never detonates solid shot or a kinetic core', () => {
    for (const id of ['120mm-apfsds', '88mm-ap', missileId('guided-at', 'long-rod')]) {
      const t = shoot(id, 'reinforced-concrete', 0.4);
      expect(t.events.some((e) => e.type === 'detonate'), id).toBe(false);
    }
  });
});

describe('missile heads', () => {
  const depth = (id: string) => shoot(id, 'rha', 1.0).summary.penetrationM;

  it('a long rod bores deeper than the standard core, and a heavy core least', () => {
    for (const a of ['light-rocket', 'shoulder-rocket', 'guided-at']) {
      expect(depth(missileId(a, 'long-rod')), a).toBeGreaterThan(depth(missileId(a, 'penetrator')));
      expect(depth(missileId(a, 'penetrator')), a).toBeGreaterThan(depth(missileId(a, 'heavy-core')));
    }
  });

  it('an explosively formed penetrator is a single slug that bores less than a long rod', () => {
    expect(getBullet(missileId('guided-at', 'efp')).blast?.jet?.count).toBe(1);
    for (const a of ['light-rocket', 'guided-at']) expect(depth(missileId(a, 'efp'))).toBeLessThan(depth(missileId(a, 'long-rod')));
  });
});

describe('jet stand-off (#260)', () => {
  it('the factor is 1 at the optimum, lower either side, and never below 0.4', () => {
    expect(jetStandoffFactor(undefined)).toBe(1);
    expect(jetStandoffFactor(OPTIMUM_STANDOFF_CAL)).toBe(1);
    expect(jetStandoffFactor(1)).toBeLessThan(1);
    expect(jetStandoffFactor(10)).toBeLessThan(1);
    expect(jetStandoffFactor(0)).toBeGreaterThanOrEqual(0.4);
    expect(jetStandoffFactor(100)).toBeGreaterThanOrEqual(0.4);
  });
});

describe('reactive armour (#260)', () => {
  const stack = presetLayers(STACK_PRESETS.find((p) => p.id === 'era-plate')!);
  const bare = presetLayers({ id: 'bare', name: 'bare', layers: [{ medium: 'rha', thickness: 0.5 }] });
  const rha = (id: string, layers = stack) => fire({ bullet: id, stack: layers }).summary.penetrationM;
  const tile = stack[0].thickness + stack[1].gapM;

  it("spoils the cutting charge's jet: it bores less of the plate than with no tile", () => {
    expect(rha('charge-shaped') - tile).toBeLessThan(rha('charge-shaped', bare) * 0.85);
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

  it('destroys brittle panels, breaks a wood panel up only under a high pressure and cracks heavy ones', () => {
    // Whether a layer goes over is decided by the impulse against its stand (#320), not by the pressure: see blastTopple.test.ts.
    expect(outcomeFor('glass', 1.1).outcome).toBe('destroyed');
    expect(outcomeFor('wood', 1.5).outcome).toBe('cracked');
    expect(outcomeFor('wood', 3).outcome).toBe('destroyed');
    expect(outcomeFor('concrete', 3).outcome).toBe('cracked');
    expect(outcomeFor('concrete', 8).outcome).toBe('cracked');
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
    const s = shoot('charge-shaped', 'rha', 0.3).summary;
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
    // The formed-penetrator head is the one missile left that flies its own way in.
    const spec = getBullet(missileId('guided-at', 'efp'));
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
    const cruise = getBullet(missileId('cruise', 'efp'));
    expect(cruise.launch!.runM).toBe(3);
    expect(shoot(cruise.id, 'rha', 0.1).duration).toBeLessThan(0.05);
  });
});
