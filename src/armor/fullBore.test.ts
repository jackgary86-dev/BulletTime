import { describe, expect, it } from 'vitest';
import {
  FULL_BORE_MAX_OBLIQUITY_DEG,
  STOP_DEPTH_MIN_FRACTION,
  deMarreBallisticLimit,
  deMarreRhaPenetration,
  fullBorePenetration,
  fullBoreShot,
  shotShatters,
} from './fullBore';
import { PLATE_MATERIALS, getPlateMaterial, type PlateMaterialId } from './materials';
import { CRATER_PROFILE_SAMPLES, MAX_TIMELINE_FRAMES, TIMELINE_FRAMES, losThickness, type ArmorTimeline } from './model';
import { impactState, type SolidImpact } from './munitions';

const shotOf = (calibreMm: number, velocity: number) => impactState('ap-shot', calibreMm, velocity) as SolidImpact;
const run = (calibreMm: number, velocity: number, thicknessMm: number, obliquityDeg = 0, plate: PlateMaterialId = 'rha') =>
  fullBoreShot({ impact: shotOf(calibreMm, velocity), material: getPlateMaterial(plate), thicknessM: thicknessMm / 1000, obliquityDeg });
const event = (tl: ArmorTimeline, type: string) => tl.events.find((e) => e.type === type);

/** The historical reference: 88 mm, about 10 kg, 1,000 m/s, about 165 mm RHA at 0°. */
const REF_SHOT = shotOf(88, 1000);
/** De Marre with K = 70,000 and exponents 0.75 / 0.7 / 0.5 for the 10.2 kg reference shot: the RHA it just perforates. */
const REF_RHA_M = 0.16424;
/** Where the reference shot stops in a thick RHA plate: 0.7 calibres short of the perforation thickness. */
const REF_STOP_M = REF_RHA_M - 0.7 * 0.088;

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

  it('the full simulation perforates the reference thickness (±10%) and no more', () => {
    expect(run(88, 1000, 165 * 0.9).result.perforated).toBe(true);
    expect(run(88, 1000, 165 * 1.1).result.perforated).toBe(false);
    // The simulated limit is the De Marre thickness itself.
    expect(run(88, 1000, REF_RHA_M * 1000 - 0.5).result.perforated).toBe(true);
    expect(run(88, 1000, REF_RHA_M * 1000 + 0.5).result.perforated).toBe(false);
  });

  it('the simulation’s ballistic limit for a plate is De Marre’s', () => {
    const vbl = deMarreBallisticLimit(0.088, 0.165, REF_SHOT.mass);
    expect(run(88, vbl * 1.002, 165).result.perforated).toBe(true);
    expect(run(88, vbl * 0.998, 165).result.perforated).toBe(false);
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

describe('thick-plate stopping depth', () => {
  it('in a plate too thick to perforate the shot stops 0.7 calibres short of the perforation thickness', () => {
    const tl = run(88, 1000, 300);
    expect(tl.result.perforated).toBe(false);
    expect(tl.result.penetrationM).toBeCloseTo(REF_STOP_M, 5);
    expect(fullBorePenetration(REF_SHOT, getPlateMaterial('rha'), 0).stopDepthM).toBeCloseTo(REF_STOP_M, 5);
  });

  it('across the family’s calibres, speeds, plates and slopes the floor never binds and the limit is P', () => {
    for (const cal of [40, 57, 76, 88, 105, 120, 150]) {
      for (const v of [700, 800, 900, 1050]) {
        for (const plate of PLATE_MATERIALS) {
          for (const deg of [0, 30, 56, 75]) {
            const pen = fullBorePenetration(shotOf(cal, v), plate, deg);
            expect(pen.stopDepthM).toBeGreaterThan(0);
            expect(pen.stopDepthM).toBeCloseTo(pen.pathM - 0.7 * (cal / 1000), 12);
          }
        }
      }
    }
    // The worst case (40 mm at 700 m/s, shattered on RHA) still perforates just under P and stops just over it.
    for (const deg of [0, 70]) {
      const pen = fullBorePenetration(shotOf(40, 700), getPlateMaterial('rha'), deg);
      const normalMm = pen.pathM * Math.cos((deg * Math.PI) / 180) * 1000;
      expect(run(40, 700, normalMm * 0.999, deg).result.perforated).toBe(true);
      expect(run(40, 700, normalMm * 1.001, deg).result.perforated).toBe(false);
    }
  });

  it('below the family’s speed range the floor keeps the stopping depth positive and the timeline finite', () => {
    const slow = { ...shotOf(40, 700), velocity: 300 };
    const pen = fullBorePenetration(slow, getPlateMaterial('rha'), 0);
    expect(pen.stopDepthM).toBeCloseTo(STOP_DEPTH_MIN_FRACTION * pen.pathM, 12);
    for (const thicknessM of [0.005, 0.2]) {
      const tl = fullBoreShot({ impact: slow, material: getPlateMaterial('rha'), thicknessM, obliquityDeg: 0 });
      expect(Number.isFinite(tl.duration)).toBe(true);
      for (const f of tl.frames) expect(Number.isFinite(f.depth) && Number.isFinite(f.speed)).toBe(true);
    }
  });
});

describe('plate material and obliquity', () => {
  it('is lowest in RHA and highest in aluminium: RHA < cast iron < mild steel < copper < Al 5083', () => {
    const order: PlateMaterialId[] = ['rha', 'cast-iron', 'mild-steel', 'copper', 'al-5083'];
    const depths = order.map((id) => run(88, 1000, 2000, 0, id).result.penetrationM);
    for (let i = 1; i < depths.length; i++) expect(depths[i]).toBeGreaterThan(depths[i - 1]);
    const limits = order.map((id) => fullBorePenetration(REF_SHOT, getPlateMaterial(id), 0).pathM);
    for (let i = 1; i < limits.length; i++) expect(limits[i]).toBeGreaterThan(limits[i - 1]);
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

  it('clamps the slope to the 0–75° it models', () => {
    expect(FULL_BORE_MAX_OBLIQUITY_DEG).toBe(75);
    const steep = run(88, 1000, 30, 85);
    expect(steep.shot.obliquityDeg).toBe(75);
    expect(steep.result.losThicknessM).toBeCloseTo(losThickness(0.03, 75), 12);
    expect(steep.result).toEqual(run(88, 1000, 30, 75).result);
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

  it('shatter hardness threshold is 250 HB', () => {
    const rha = getPlateMaterial('rha');
    expect(shotShatters(REF_SHOT, { ...rha, brinell: 250 }, 60)).toBe(true);
    expect(shotShatters(REF_SHOT, { ...rha, brinell: 249 }, 60)).toBe(false);
  });

  it('only steel shot shatters', () => {
    const rod = impactState('apfsds', 120) as SolidImpact;
    expect(shotShatters(rod, getPlateMaterial('rha'), 70)).toBe(false);
    expect(fullBorePenetration({ ...REF_SHOT, material: 'tungsten-alloy' }, getPlateMaterial('rha'), 70).shattered).toBe(false);
  });

  it('breaks into 8 + calibre/15 pieces', () => {
    expect(fullBorePenetration(shotOf(150, 900), getPlateMaterial('rha'), 70).fragments).toBe(18);
    expect(fullBorePenetration(shotOf(40, 900), getPlateMaterial('rha'), 70).fragments).toBe(11);
  });

  it('reports the shatter in the result and the events, keeping the mechanism name plain', () => {
    const stopped = run(88, 1000, 60, 65);
    expect(stopped.result.shattered).toBe(true);
    expect(stopped.result.fragments).toBe(14);
    expect(stopped.result.mechanism).toBe('Plastic penetration');
    expect(event(stopped, 'shatter')).toBeDefined();
    const plugged = run(88, 1000, 40, 60);
    expect(plugged.result.shattered).toBe(true);
    expect(plugged.result.mechanism).toBe('Plugging');
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
    // Speed at the plug from v² = v0²(1 − x/S), S the thick-plate stopping depth.
    expect(plugEvent.speed).toBeCloseTo(1000 * Math.sqrt(1 - 0.0384 / REF_STOP_M), 1);
    expect(plugEvent.speed).toBeCloseTo(791.1, 0);
    // Momentum sharing: m·v_p = (m + m_plug)·v_r, and the plug flies at v_r.
    const m = REF_SHOT.mass;
    expect(m * plugEvent.speed).toBeCloseTo((m + plug.massKg) * r.residualVelocity, 6);
    expect(r.residualVelocity).toBeCloseTo(600.3, 0);
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
    expect(r.penetrationM).toBeCloseTo(REF_STOP_M, 5);
    const stop = event(tl, 'stop')!;
    expect(stop.depth).toBeCloseTo(REF_STOP_M, 5);
    expect(stop.speed).toBe(0);
    expect(stop.t).toBeCloseTo((2 * r.penetrationM) / 1000, 12);
    expect(event(tl, 'plug')).toBeUndefined();
  });

  it('perforates exactly when the line-of-sight thickness is under P, square-on and sloped', () => {
    expect(run(88, 1000, REF_RHA_M * 1000 - 1).result.perforated).toBe(true);
    expect(run(88, 1000, REF_RHA_M * 1000 + 1).result.perforated).toBe(false);
    const cos45 = Math.SQRT1_2;
    expect(run(88, 1000, (REF_RHA_M * 1000 - 1) * cos45, 45).result.perforated).toBe(true);
    expect(run(88, 1000, (REF_RHA_M * 1000 + 1) * cos45, 45).result.perforated).toBe(false);
  });

  it('a plate exactly at the limit stops the shot, with nothing infinite', () => {
    const P = fullBorePenetration(REF_SHOT, getPlateMaterial('rha'), 0).pathM;
    const tl = fullBoreShot({ impact: REF_SHOT, material: getPlateMaterial('rha'), thicknessM: P, obliquityDeg: 0 });
    expect(tl.result.perforated).toBe(false);
    expect(Number.isFinite(tl.duration)).toBe(true);
    expect(event(tl, 'stop')!.depth).toBeCloseTo(REF_STOP_M, 5);
  });

  it('just inside the limit the shot crawls out, but the dig keeps enough frames', () => {
    const P = REF_RHA_M * 1000;
    for (const [underMm, minDigFrames] of [
      [1, 100],
      [0.01, 60],
      [0.001, 20],
    ]) {
      const tl = run(88, 1000, P - underMm);
      expect(tl.result.perforated).toBe(true);
      expect(Number.isFinite(tl.duration)).toBe(true);
      expect(tl.frames.length).toBeLessThanOrEqual(MAX_TIMELINE_FRAMES);
      const tPlug = event(tl, 'plug')!.t;
      expect(tl.frames.filter((f) => f.t < tPlug).length).toBeGreaterThanOrEqual(minDigFrames);
    }
    // Ordinary plates keep the standard frame count.
    expect(run(88, 1000, 100).frames.length).toBe(TIMELINE_FRAMES);
    expect(run(88, 1000, 250).frames.length).toBe(TIMELINE_FRAMES);
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

  it('plug mass uses the plate density', () => {
    const r = run(88, 1000, 300, 0, 'al-5083').result;
    expect(r.perforated).toBe(true);
    expect(r.plug!.massKg).toBeCloseTo(2660 * Math.PI * ((1.05 * 0.088) / 2) ** 2 * (0.7 * 0.088), 9);
  });

  it('between plug and exit the shot advances at v_r, then flies on behind the plate', () => {
    const tl = run(88, 1000, 100);
    const plug = event(tl, 'plug')!;
    const exit = event(tl, 'perforate')!;
    const vr = tl.result.residualVelocity;
    const mid = tl.frames.filter((f) => f.t > plug.t && f.t < exit.t);
    expect(mid.length).toBeGreaterThan(5);
    for (const f of mid) {
      expect(f.depth).toBeCloseTo(plug.depth + vr * (f.t - plug.t), 12);
      expect(f.travel).toBe(f.depth);
      expect(f.penetrationRate).toBe(vr);
    }
    const after = tl.frames.filter((f) => f.t > exit.t);
    expect(after.length).toBeGreaterThan(5);
    for (const f of after) {
      expect(f.depth).toBeCloseTo(0.1, 12);
      expect(f.travel).toBeCloseTo(0.1 + vr * (f.t - exit.t), 12);
      expect(f.speed).toBe(vr);
      expect(f.penetrationRate).toBe(0);
    }
  });
});

describe('time history', () => {
  it('v² falls linearly with depth to the stopping point', () => {
    const tl = run(88, 1000, 300);
    const S = tl.result.penetrationM;
    const moving = tl.frames.filter((f) => f.speed > 0);
    expect(moving.length).toBeGreaterThan(50);
    for (const f of moving) {
      expect(f.speed ** 2 / 1000 ** 2).toBeCloseTo(1 - f.depth / S, 9);
      expect(f.penetrationRate).toBe(f.speed);
    }
    // Slope of v² against depth is −v0²/S between any two frames.
    const a = moving[10];
    const b = moving[moving.length - 10];
    expect((b.speed ** 2 - a.speed ** 2) / (b.depth - a.depth)).toBeCloseTo(-(1000 ** 2) / S, 0);
  });

  it('frames are finite, evenly spaced, at least 120, and grow in depth', () => {
    for (const tl of [run(88, 1000, 100), run(88, 1000, 250), run(40, 700, 30, 70), run(150, 1050, 200, 30, 'copper'), run(88, 1000, 20)]) {
      expect(tl.frames.length).toBeGreaterThanOrEqual(120);
      expect(tl.frames[0].t).toBe(0);
      expect(tl.frames[tl.frames.length - 1].t).toBeCloseTo(tl.duration, 15);
      const dt = tl.frames[1].t - tl.frames[0].t;
      for (let i = 0; i < tl.frames.length; i++) {
        const f = tl.frames[i];
        for (const value of Object.values(f).flat()) expect(Number.isFinite(value)).toBe(true);
        expect(f.depth).toBeLessThanOrEqual(tl.result.losThicknessM + 1e-12);
        expect(f.travel).toBeGreaterThanOrEqual(f.depth);
        expect(f.penetrationRate).toBeLessThanOrEqual(f.speed);
        expect(f.energyDepositedJ).toBeLessThanOrEqual(tl.result.impactEnergyJ * (1 + 1e-12));
        expect(f.penetratorLength).toBe((tl.shot.impact as SolidImpact).length);
        if (i > 0) {
          const p = tl.frames[i - 1];
          expect(f.t - p.t).toBeCloseTo(dt, 15);
          expect(f.depth).toBeGreaterThanOrEqual(p.depth);
          expect(f.travel).toBeGreaterThanOrEqual(p.travel);
          expect(f.speed).toBeLessThanOrEqual(p.speed);
          expect(f.rearBulge).toBeGreaterThanOrEqual(p.rearBulge);
          expect(f.craterRadius).toBeGreaterThanOrEqual(p.craterRadius);
          expect(f.energyDepositedJ).toBeGreaterThanOrEqual(p.energyDepositedJ);
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
    for (const thicknessMm of [100, 20]) {
      const tl = run(88, 1000, thicknessMm);
      const tPlug = event(tl, 'plug')!.t;
      const last = tl.frames[tl.frames.length - 1];
      expect(last.speed).toBe(tl.result.residualVelocity);
      expect(last.depth).toBeCloseTo(thicknessMm / 1000, 12);
      for (const f of tl.frames.filter((x) => x.t > tPlug)) expect(f.speed).toBe(tl.result.residualVelocity);
      // Once the plug is out the hole goes right through at the plug diameter, even in a plate thinner than the nose radius.
      expect(last.craterRadius).toBeCloseTo((1.05 * 0.088) / 2, 12);
      expect(last.craterProfile!.every((r) => Math.abs(r - (1.05 * 0.088) / 2) < 1e-12)).toBe(true);
    }
  });

  it('crater mouth opens over the first nose radius, and the profile has a round-nosed bottom', () => {
    const tl = run(88, 1000, 250);
    const R = (1.05 * 0.088) / 2;
    const early = tl.frames.filter((f) => f.depth > 0 && f.depth < R);
    expect(early.length).toBeGreaterThan(0);
    for (const f of early) {
      expect(f.craterRadius).toBeLessThan(R);
      expect(f.craterRadius).toBeCloseTo(Math.sqrt(f.depth * (2 * R - f.depth)), 12);
    }
    for (const f of tl.frames) {
      const profile = f.craterProfile!;
      expect(profile).toHaveLength(CRATER_PROFILE_SAMPLES);
      expect(profile[0]).toBeCloseTo(f.craterRadius, 12);
      expect(profile[profile.length - 1]).toBe(0);
      for (let i = 1; i < profile.length; i++) expect(profile[i]).toBeLessThanOrEqual(profile[i - 1]);
    }
    const last = tl.frames[tl.frames.length - 1].craterProfile!;
    // A bore of the plug radius down to one nose radius above the bottom.
    expect(last[1]).toBeCloseTo(R, 12);
    const s = REF_STOP_M / (CRATER_PROFILE_SAMPLES - 1);
    expect(last[CRATER_PROFILE_SAMPLES - 2]).toBeCloseTo(Math.sqrt(s * (2 * R - s)), 5);
  });

  it('bulges the rear face once less than 1.5 calibres are left, and freezes it when the plug shears', () => {
    const D = 0.088;
    // Stopped short of the rear face: the bulge ends at 0.25 × (1.5 D − remaining).
    const stopped = run(88, 1000, 200);
    expect(stopped.frames[0].rearBulge).toBe(0);
    const remaining = 0.2 - stopped.result.penetrationM;
    expect(remaining).toBeLessThan(1.5 * D);
    expect(stopped.frames[stopped.frames.length - 1].rearBulge).toBeCloseTo(0.25 * (1.5 * D - remaining), 6);
    // Too thick to reach the bulge zone at all.
    expect(run(88, 1000, 400).frames.every((f) => f.rearBulge === 0)).toBe(true);
    // Plugged: the bulge reaches 0.25 × (1.5 − 0.7) D when the plug shears, then holds while the plug moves out.
    const plugged = run(88, 1000, 100);
    const tPlug = event(plugged, 'plug')!.t;
    for (const f of plugged.frames.filter((x) => x.t >= tPlug)) expect(f.rearBulge).toBeCloseTo(0.25 * 0.8 * D, 12);
  });

  it('accounts for the impact energy: plate work, plug and residual add up to it', () => {
    const m = REF_SHOT.mass;
    const tl = run(88, 1000, 100);
    const r = tl.result;
    const { plateWorkJ, ejectaJ } = r.energy;
    expect(plateWorkJ + ejectaJ + r.residualEnergyJ).toBeCloseTo(r.impactEnergyJ, 3);
    expect(ejectaJ).toBeCloseTo(0.5 * r.plug!.massKg * r.residualVelocity ** 2, 3);
    // Plate work includes the energy lost when shot and plug share momentum.
    const vp = event(tl, 'plug')!.speed;
    const sharingLoss = 0.5 * m * vp ** 2 - 0.5 * (m + r.plug!.massKg) * r.residualVelocity ** 2;
    expect(sharingLoss).toBeGreaterThan(0);
    expect(plateWorkJ).toBeCloseTo(0.5 * m * (1000 ** 2 - vp ** 2) + sharingLoss, 3);
    // Deposited energy grows as v² falls while digging, and ends at the plate work.
    const tPlug = event(tl, 'plug')!.t;
    for (const f of tl.frames.filter((x) => x.t < tPlug)) expect(f.energyDepositedJ).toBeCloseTo(0.5 * m * (1000 ** 2 - f.speed ** 2), 3);
    expect(tl.frames[tl.frames.length - 1].energyDepositedJ).toBe(plateWorkJ);

    const stopped = run(88, 1000, 300);
    expect(stopped.result.energy).toEqual({ plateWorkJ: stopped.result.impactEnergyJ, ejectaJ: 0 });
    expect(stopped.frames[stopped.frames.length - 1].energyDepositedJ).toBe(stopped.result.impactEnergyJ);
  });

  it('reports impact energy and starts the events with the impact', () => {
    const tl = run(88, 1000, 100);
    expect(tl.result.impactEnergyJ).toBeCloseTo(0.5 * 10.2 * 1000 ** 2, 3);
    expect(tl.events[0]).toMatchObject({ t: 0, type: 'impact', depth: 0, speed: 1000 });
    for (let i = 1; i < tl.events.length; i++) expect(tl.events[i].t).toBeGreaterThanOrEqual(tl.events[i - 1].t);
    expect(tl.events.every((e) => e.label.length > 3)).toBe(true);
  });

  it('refuses projectiles other than full-bore shot', () => {
    const shot = { impact: impactState('apfsds', 120), material: getPlateMaterial('rha'), thicknessM: 0.1, obliquityDeg: 0 };
    expect(() => fullBoreShot(shot)).toThrow(/full-bore/);
  });
});
