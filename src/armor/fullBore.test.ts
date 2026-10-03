import { describe, expect, it } from 'vitest';
import { deMarreBallisticLimit, deMarreRhaPenetration, fullBorePenetration, fullBoreShot } from './fullBore';
import { getPlateMaterial, type PlateMaterialId } from './materials';
import { simulateArmor, type ArmorTimeline } from './model';
import { impactState, type SolidImpact } from './munitions';

const shotOf = (calibreMm: number, velocity: number) => impactState('ap-shot', calibreMm, velocity) as SolidImpact;
const run = (calibreMm: number, velocity: number, thicknessMm: number, obliquityDeg = 0, plate: PlateMaterialId = 'rha') =>
  fullBoreShot({ impact: shotOf(calibreMm, velocity), material: getPlateMaterial(plate), thicknessM: thicknessMm / 1000, obliquityDeg });
const event = (tl: ArmorTimeline, type: string) => tl.events.find((e) => e.type === type);

/** The historical reference: 88 mm, about 10 kg, 1,000 m/s, about 165 mm RHA at 0°. */
const REF_SHOT = shotOf(88, 1000);
/** De Marre with K = 70,000 and exponents 0.75 / 0.7 / 0.5 for the 10.2 kg reference shot. */
const REF_RHA_M = 0.16424;

describe('De Marre ballistic limit', () => {
  it('reproduces the 88 mm / ~10 kg / 1,000 m/s ≈ 165 mm RHA reference within ±10%', () => {
    expect(REF_SHOT.mass).toBeCloseTo(10.2, 6);
    const p = deMarreRhaPenetration(REF_SHOT.diameter, REF_SHOT.mass, REF_SHOT.velocity);
    expect(p).toBeGreaterThan(0.165 * 0.9);
    expect(p).toBeLessThan(0.165 * 1.1);
    // And it is the formula's value, so a wrong constant or exponent fails here.
    expect(p).toBeCloseTo(REF_RHA_M, 5);
    const closedForm = ((1000 * Math.sqrt(REF_SHOT.mass)) / (70_000 * 0.088 ** 0.75)) ** (1 / 0.7);
    expect(p).toBeCloseTo(closedForm, 9);
  });

  it('the full simulation stops the reference shot at that depth in a thick RHA plate', () => {
    const tl = run(88, 1000, 300);
    expect(tl.result.perforated).toBe(false);
    expect(tl.result.penetrationM).toBeCloseTo(REF_RHA_M, 5);
    expect(tl.result.penetrationM).toBeGreaterThan(0.165 * 0.9);
    expect(tl.result.penetrationM).toBeLessThan(0.165 * 1.1);
  });

  it('thickness and ballistic limit are inverses', () => {
    const p = deMarreRhaPenetration(0.088, 10.2, 950);
    expect(deMarreBallisticLimit(0.088, p, 10.2)).toBeCloseTo(950, 6);
    expect(deMarreBallisticLimit(0.088, 0.165, 10.2)).toBeGreaterThan(900);
    expect(deMarreBallisticLimit(0.088, 0.165, 10.2)).toBeLessThan(1100);
  });

  it('penetration scales as v^(1/0.7)', () => {
    const at = (v: number) => deMarreRhaPenetration(0.088, 10.2, v);
    expect(at(1000) / at(800)).toBeCloseTo((1000 / 800) ** (1 / 0.7), 9);
    expect(at(1000) / at(500)).toBeCloseTo(2 ** (1 / 0.7), 9);
  });

  it('rises monotonically with velocity across the family range, and with calibre', () => {
    let previous = 0;
    for (let v = 700; v <= 1050; v += 25) {
      const p = run(88, v, 1000).result.penetrationM;
      expect(p).toBeGreaterThan(previous);
      previous = p;
    }
    previous = 0;
    for (const cal of [40, 57, 76, 88, 105, 120, 150]) {
      const p = fullBorePenetration(shotOf(cal, 900), getPlateMaterial('rha'), 0).rhaM;
      expect(p).toBeGreaterThan(previous);
      previous = p;
    }
  });
});

describe('plate material and obliquity', () => {
  it('is lowest in RHA and highest in aluminium: RHA < cast iron < mild steel < copper < Al 5083', () => {
    const order: PlateMaterialId[] = ['rha', 'cast-iron', 'mild-steel', 'copper', 'al-5083'];
    const depths = order.map((id) => run(88, 1000, 2000, 0, id).result.penetrationM);
    for (let i = 1; i < depths.length; i++) expect(depths[i]).toBeGreaterThan(depths[i - 1]);
  });

  it('divides the RHA figure by the material’s RHA thickness factor', () => {
    const al = fullBorePenetration(REF_SHOT, getPlateMaterial('al-5083'), 0);
    expect(al.pathM).toBeCloseTo(REF_RHA_M / 0.35, 4);
    const mild = fullBorePenetration(REF_SHOT, getPlateMaterial('mild-steel'), 0);
    expect(mild.pathM).toBeCloseTo(REF_RHA_M / 0.75, 4);
  });

  it('capability through the plate’s normal thickness falls with obliquity', () => {
    let previous = Infinity;
    for (let deg = 0; deg <= 75; deg += 5) {
      const p = fullBorePenetration(REF_SHOT, getPlateMaterial('rha'), deg).pathM;
      const normal = p * Math.cos((deg * Math.PI) / 180);
      expect(normal).toBeLessThan(previous);
      previous = normal;
    }
  });

  it('a plate it perforates square-on stops it when sloped, and residual speed falls with slope', () => {
    expect(run(88, 1000, 120, 0).result.perforated).toBe(true);
    expect(run(88, 1000, 120, 60).result.perforated).toBe(false);
    let previous = Infinity;
    for (const deg of [0, 15, 30, 40]) {
      const r = run(88, 1000, 100, deg).result;
      expect(r.perforated).toBe(true);
      expect(r.residualVelocity).toBeLessThan(previous);
      previous = r.residualVelocity;
    }
  });

  it('measures the line-of-sight thickness through the slope', () => {
    expect(run(88, 1000, 100, 60).result.losThicknessM).toBeCloseTo(0.2, 9);
  });
});

describe('shatter', () => {
  it('steel shot partly shatters on RHA only above 55°, losing a quarter of its penetration', () => {
    const rha = getPlateMaterial('rha');
    const at55 = fullBorePenetration(REF_SHOT, rha, 55);
    const at56 = fullBorePenetration(REF_SHOT, rha, 56);
    expect(at55.shattered).toBe(false);
    expect(at55.fragments).toBe(0);
    expect(at55.pathM).toBeCloseTo(REF_RHA_M, 5);
    expect(at56.shattered).toBe(true);
    expect(at56.pathM).toBeCloseTo(REF_RHA_M * 0.75, 5);
    expect(at56.fragments).toBe(8 + Math.round(88 / 15));
  });

  it('does not shatter on softer plates, however sloped', () => {
    for (const id of ['al-5083', 'mild-steel', 'copper', 'cast-iron'] as const) {
      const r = fullBorePenetration(REF_SHOT, getPlateMaterial(id), 75);
      expect(r.shattered).toBe(false);
      expect(r.fragments).toBe(0);
    }
  });

  it('reports the shatter in the result and the events', () => {
    const tl = run(88, 1000, 60, 65);
    expect(tl.result.shattered).toBe(true);
    expect(tl.result.fragments).toBe(14);
    expect(event(tl, 'shatter')).toBeDefined();
    expect(run(88, 1000, 60, 50).events.some((e) => e.type === 'shatter')).toBe(false);
  });
});

describe('plugging and perforation', () => {
  it('88 mm at 1,000 m/s perforates 100 mm RHA by shearing out a plug', () => {
    const tl = run(88, 1000, 100);
    const r = tl.result;
    expect(r.perforated).toBe(true);
    expect(r.mechanism).toBe('Plugging');
    expect(r.penetrationM).toBeCloseTo(0.1, 9);
    expect(r.plug).toBeDefined();
    const plug = r.plug!;
    // The plug starts when 0.7 calibres of plate are left: 61.6 mm thick, 1.05 × 88 mm wide.
    expect(plug.thicknessM).toBeCloseTo(0.0616, 9);
    expect(plug.diameterM).toBeCloseTo(0.0924, 9);
    expect(plug.massKg).toBeCloseTo(7850 * Math.PI * 0.0462 ** 2 * 0.0616, 6);
    expect(plug.massKg).toBeCloseTo(3.2425, 3);

    const plugEvent = event(tl, 'plug')!;
    expect(plugEvent.depth).toBeCloseTo(0.1 - 0.0616, 9);
    // Speed at the plug from v² = v0²(1 − x/P).
    expect(plugEvent.speed).toBeCloseTo(1000 * Math.sqrt(1 - 0.0384 / REF_RHA_M), 1);
    expect(plugEvent.speed).toBeCloseTo(875.3, 0);
    // Momentum sharing: m·v_p = (m + m_plug)·v_r, and the plug flies at v_r.
    const m = REF_SHOT.mass;
    expect(m * plugEvent.speed).toBeCloseTo((m + plug.massKg) * r.residualVelocity, 6);
    expect(r.residualVelocity).toBeCloseTo(664.2, 0);
    expect(plug.velocity).toBe(r.residualVelocity);
    expect(r.residualMassKg).toBe(m);
    expect(r.residualEnergyJ).toBeCloseTo(0.5 * m * r.residualVelocity ** 2, 6);
    expect(r.residualEnergyJ).toBeLessThan(r.impactEnergyJ);

    const exit = event(tl, 'perforate')!;
    expect(exit.depth).toBeCloseTo(0.1, 9);
    expect(exit.speed).toBe(r.residualVelocity);
    expect(exit.t).toBeCloseTo(plugEvent.t + 0.0616 / r.residualVelocity, 12);
    expect(event(tl, 'stop')).toBeUndefined();
  });

  it('the same shot stops in 250 mm RHA without a plug', () => {
    const tl = run(88, 1000, 250);
    const r = tl.result;
    expect(r.perforated).toBe(false);
    expect(r.mechanism).toBe('Plastic penetration');
    expect(r.plug).toBeUndefined();
    expect(r.residualVelocity).toBe(0);
    expect(r.residualMassKg).toBe(0);
    expect(r.residualEnergyJ).toBe(0);
    expect(r.penetrationM).toBeCloseTo(REF_RHA_M, 5);
    const stop = event(tl, 'stop')!;
    expect(stop.depth).toBeCloseTo(REF_RHA_M, 5);
    expect(stop.speed).toBe(0);
    expect(stop.t).toBeCloseTo((2 * r.penetrationM) / 1000, 12);
    expect(event(tl, 'plug')).toBeUndefined();
  });

  it('plugs exactly when the plate is thin enough: line-of-sight thickness under P + 0.7 D', () => {
    const limitMm = (REF_RHA_M + 0.7 * 0.088) * 1000;
    expect(run(88, 1000, limitMm - 1).result.perforated).toBe(true);
    expect(run(88, 1000, limitMm + 1).result.perforated).toBe(false);
  });

  it('a plate thinner than 0.7 calibres is plugged at once, at full speed', () => {
    const tl = run(88, 1000, 20);
    const plugEvent = event(tl, 'plug')!;
    expect(plugEvent.t).toBe(0);
    expect(plugEvent.speed).toBe(1000);
    expect(tl.result.plug!.thicknessM).toBeCloseTo(0.02, 9);
  });

  it('aluminium of the same thickness is perforated faster than RHA', () => {
    const rha = run(88, 900, 100).result;
    const al = run(88, 900, 100, 0, 'al-5083').result;
    expect(rha.perforated && al.perforated).toBe(true);
    expect(al.residualVelocity).toBeGreaterThan(rha.residualVelocity);
  });
});

describe('time history', () => {
  it('v² falls linearly with depth to the stopping point', () => {
    const tl = run(88, 1000, 300);
    const P = tl.result.penetrationM;
    const moving = tl.frames.filter((f) => f.speed > 0);
    expect(moving.length).toBeGreaterThan(50);
    for (const f of moving) expect(f.speed ** 2 / 1000 ** 2).toBeCloseTo(1 - f.depth / P, 9);
    // Slope of v² against depth is −v0²/P between any two frames.
    const a = moving[10];
    const b = moving[moving.length - 10];
    expect((b.speed ** 2 - a.speed ** 2) / (b.depth - a.depth)).toBeCloseTo(-(1000 ** 2) / P, 0);
  });

  it('frames are finite, evenly spaced, at least 120, and grow in depth', () => {
    for (const tl of [run(88, 1000, 100), run(88, 1000, 250), run(40, 700, 30, 70), run(150, 1050, 200, 30, 'copper')]) {
      expect(tl.frames.length).toBeGreaterThanOrEqual(120);
      expect(tl.frames[0].t).toBe(0);
      expect(tl.frames[tl.frames.length - 1].t).toBeCloseTo(tl.duration, 15);
      const dt = tl.frames[1].t - tl.frames[0].t;
      for (let i = 0; i < tl.frames.length; i++) {
        const f = tl.frames[i];
        for (const value of Object.values(f)) expect(Number.isFinite(value)).toBe(true);
        expect(f.depth).toBeLessThanOrEqual(tl.result.losThicknessM + 1e-12);
        expect(f.penetratorLength).toBe((tl.shot.impact as SolidImpact).length);
        if (i > 0) {
          expect(f.t - tl.frames[i - 1].t).toBeCloseTo(dt, 15);
          expect(f.depth).toBeGreaterThanOrEqual(tl.frames[i - 1].depth);
          expect(f.speed).toBeLessThanOrEqual(tl.frames[i - 1].speed);
          expect(f.rearBulge).toBeGreaterThanOrEqual(tl.frames[i - 1].rearBulge);
          expect(f.craterRadius).toBeGreaterThanOrEqual(tl.frames[i - 1].craterRadius);
        }
      }
      expect(tl.frames[tl.frames.length - 1].depth).toBeCloseTo(tl.result.penetrationM, 12);
    }
  });

  it('runs on 20% (at least 30 µs) past the last event', () => {
    const stopped = run(88, 1000, 250);
    const tStop = event(stopped, 'stop')!.t;
    expect(stopped.duration).toBeCloseTo(tStop + Math.max(0.2 * tStop, 30e-6), 15);
    const thin = run(88, 1000, 10);
    const tExit = event(thin, 'perforate')!.t;
    expect(thin.duration).toBeCloseTo(tExit + 30e-6, 15);
  });

  it('after the plug the shot moves on at the residual velocity, and the hole is 1.05 calibres wide', () => {
    const tl = run(88, 1000, 100);
    const tPlug = event(tl, 'plug')!.t;
    const last = tl.frames[tl.frames.length - 1];
    expect(last.speed).toBe(tl.result.residualVelocity);
    expect(last.depth).toBeCloseTo(0.1, 12);
    for (const f of tl.frames.filter((x) => x.t > tPlug)) expect(f.speed).toBe(tl.result.residualVelocity);
    expect(last.craterRadius).toBeCloseTo((1.05 * 0.088) / 2, 12);
  });

  it('bulges the rear face once less than 1.5 calibres are left, and keeps it after the plug', () => {
    const D = 0.088;
    // Thick plate: no bulge until the end, which stays at 0.25 × (1.5 D − remaining).
    const stopped = run(88, 1000, 250);
    expect(stopped.frames[0].rearBulge).toBe(0);
    const remaining = 0.25 - stopped.result.penetrationM;
    expect(stopped.frames[stopped.frames.length - 1].rearBulge).toBeCloseTo(0.25 * (1.5 * D - remaining), 6);
    // Too thick to reach the bulge zone at all.
    expect(run(88, 1000, 400).frames.every((f) => f.rearBulge === 0)).toBe(true);
    // Plugged: the bulge reaches 0.25 × (1.5 − 0.7) D when the plug shears, then holds.
    const plugged = run(88, 1000, 100);
    const tPlug = event(plugged, 'plug')!.t;
    for (const f of plugged.frames.filter((x) => x.t >= tPlug)) expect(f.rearBulge).toBeCloseTo(0.25 * 0.8 * D, 12);
  });

  it('reports impact energy and starts the events with the impact', () => {
    const tl = run(88, 1000, 100);
    expect(tl.result.impactEnergyJ).toBeCloseTo(0.5 * 10.2 * 1000 ** 2, 3);
    expect(tl.events[0]).toMatchObject({ t: 0, type: 'impact', depth: 0, speed: 1000 });
    for (let i = 1; i < tl.events.length; i++) expect(tl.events[i].t).toBeGreaterThanOrEqual(tl.events[i - 1].t);
    expect(tl.events.every((e) => e.label.length > 3)).toBe(true);
  });

  it('is what the dispatcher runs for full-bore shot, and refuses other projectiles', () => {
    const shot = { impact: REF_SHOT, material: getPlateMaterial('rha'), thicknessM: 0.1, obliquityDeg: 0 };
    expect(simulateArmor(shot)).toEqual(fullBoreShot(shot));
    expect(() => fullBoreShot({ ...shot, impact: impactState('apfsds', 120) })).toThrow(/full-bore/);
  });
});
