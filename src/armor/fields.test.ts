import { describe, expect, it } from 'vitest';
import {
  AMBIENT_C,
  HEAT_FRACTION,
  MOLTEN_SUPERHEAT_C,
  craterRadiusAt,
  distanceToCrater,
  energyBalance,
  fieldContext,
  fieldGrid,
  fieldScale,
  noseStressRatio,
  peakFields,
  pressureGPaAt,
  stressRatioAt,
  temperatureAt,
  wavePulse,
} from './fields';
import { getPlateMaterial, type PlateMaterialId } from './materials';
import type { ArmorTimeline } from './model';
import { impactState, type MunitionFamilyId } from './munitions';
import { simulateArmor } from './simulate';

const run = (family: MunitionFamilyId, thicknessMm: number, obliquityDeg = 0, material: PlateMaterialId = 'rha', calibreMm = 120): ArmorTimeline =>
  simulateArmor({ impact: impactState(family, calibreMm), material: getPlateMaterial(material), thicknessM: thicknessMm / 1000, obliquityDeg });

/** A spread of shots: every family and outcome the fields have to handle. */
const SHOTS: [string, ArmorTimeline][] = [
  ['full-bore plugs', run('ap-shot', 60)],
  ['full-bore stops', run('ap-shot', 300, 0, 'rha', 60)],
  ['full-bore shatters and ricochets', run('ap-shot', 100, 80)],
  ['rod perforates', run('apfsds', 60)],
  ['rod stops', run('apfsds', 300, 0, 'rha', 40)],
  ['rod ricochets', run('apfsds', 100, 85)],
  ['jet perforates', run('heat', 100)],
  ['jet stops', run('heat', 300, 0, 'rha', 60)],
  ['HESH spalls', run('hesh', 30, 0, 'cast-iron')],
  ['HESH holds', run('hesh', 300)],
  ['jet in aluminium', run('heat', 150, 0, 'al-5083')],
];

const times = (tl: ArmorTimeline) => [0, 0.05, 0.2, 0.5, 0.8, 1].map((f) => f * tl.duration);

describe('fields are finite and in range (#166)', () => {
  for (const [name, tl] of SHOTS) {
    it(`${name}: every field is finite everywhere, always`, () => {
      for (const t of times(tl)) {
        const ctx = fieldContext(tl, t);
        for (const kind of ['temperature', 'stress', 'pressure'] as const) {
          const g = fieldGrid(ctx, kind, 24, 16, ctx.tLos);
          for (const v of g.values) expect(Number.isFinite(v)).toBe(true);
        }
      }
    });
  }

  for (const [name, tl] of SHOTS) {
    it(`${name}: temperature stays between ambient and melting, apart from a flagged molten interface`, () => {
      const melt = tl.shot.material.meltingPointC;
      const fluid = tl.shot.impact.family === 'heat' || tl.shot.impact.family === 'apfsds';
      for (const t of times(tl)) {
        const g = fieldGrid(fieldContext(tl, t), 'temperature', 40, 24, tl.result.losThicknessM / 2);
        for (let k = 0; k < g.values.length; k++) {
          expect(g.values[k]).toBeGreaterThanOrEqual(AMBIENT_C - 1e-6);
          if (g.molten[k]) {
            expect(fluid).toBe(true);
            expect(g.values[k]).toBeLessThanOrEqual(melt + MOLTEN_SUPERHEAT_C + 1e-6);
          } else expect(g.values[k]).toBeLessThanOrEqual(melt + 1e-6);
        }
      }
    });
  }

  it('melts the interface of a jet or rod digging deep, and nothing in a plugged plate', () => {
    const jet = run('heat', 100);
    const moltenAt = (tl: ArmorTimeline, f: number) => fieldGrid(fieldContext(tl, tl.duration * f), 'temperature', 60, 30, tl.result.losThicknessM / 4).molten.some((m) => m === 1);
    expect(moltenAt(jet, 0.6)).toBe(true);
    const plugged = run('ap-shot', 60);
    for (const f of [0.2, 0.6, 1]) expect(moltenAt(plugged, f)).toBe(false);
  });
});

describe('fields are continuous (#166)', () => {
  const STEP = 2e-6;
  const scaleOf = (tl: ArmorTimeline, kind: 'temperature' | 'stress' | 'pressure') => {
    const s = fieldScale(kind, tl);
    return s.max - s.min;
  };
  const sample = (tl: ArmorTimeline, kind: 'temperature' | 'stress' | 'pressure', t: number, x: number, y: number) => {
    const ctx = fieldContext(tl, t);
    return kind === 'temperature' ? temperatureAt(ctx, x, y).valueC : kind === 'stress' ? stressRatioAt(ctx, x, y) : pressureGPaAt(ctx, x, y);
  };
  for (const [name, tl] of SHOTS) {
    it(`${name}: no jumps between neighbouring points`, () => {
      for (const kind of ['temperature', 'stress', 'pressure'] as const) {
        const scale = scaleOf(tl, kind);
        for (const f of [0.3, 0.7, 1]) {
          const t = tl.duration * f;
          for (let i = 0; i <= 60; i++) {
            const x = (tl.result.losThicknessM * i) / 60;
            for (const y of [0, tl.result.losThicknessM / 8, -tl.result.losThicknessM / 3]) {
              const a = sample(tl, kind, t, x, y);
              expect(Math.abs(sample(tl, kind, t, x + STEP, y) - a)).toBeLessThan(0.02 * scale);
              expect(Math.abs(sample(tl, kind, t, x, y + STEP) - a)).toBeLessThan(0.02 * scale);
            }
          }
        }
      }
    });
  }

  it('is continuous in time too', () => {
    const tl = run('apfsds', 120);
    const scale = scaleOf(tl, 'temperature');
    for (const [x, y] of [[0.02, 0.01], [0.06, 0], [0.1, 0.03]]) {
      let prev = temperatureAt(fieldContext(tl, 0), x, y).valueC;
      for (let i = 1; i <= 200; i++) {
        const v = temperatureAt(fieldContext(tl, (tl.duration * i) / 200), x, y).valueC;
        expect(Math.abs(v - prev)).toBeLessThan(0.2 * scale);
        prev = v;
      }
    }
  });
});

describe('crater geometry helpers (#166)', () => {
  it('is zero inside the crater and grows with distance outside it', () => {
    const tl = run('apfsds', 200);
    const ctx = fieldContext(tl, tl.duration * 0.3);
    const f = ctx.frame;
    expect(f.depth).toBeGreaterThan(0);
    expect(distanceToCrater(f, f.depth / 2, 0)).toBe(0);
    const rc = craterRadiusAt(f, f.depth / 2);
    expect(rc).toBeGreaterThan(0);
    expect(distanceToCrater(f, f.depth / 2, rc + 0.01)).toBeCloseTo(0.01, 9);
    expect(distanceToCrater(f, f.depth / 2, rc + 0.02)).toBeGreaterThan(distanceToCrater(f, f.depth / 2, rc + 0.01));
    expect(craterRadiusAt(f, f.depth + 0.01)).toBe(0);
  });
});

describe('temperature (#166)', () => {
  it('is hottest at the crater wall and falls away from it', () => {
    const tl = run('apfsds', 200);
    const ctx = fieldContext(tl, tl.duration * 0.6);
    const x = ctx.frame.depth / 2;
    const rc = craterRadiusAt(ctx.frame, x);
    const wall = temperatureAt(ctx, x, rc).valueC;
    const near = temperatureAt(ctx, x, rc + 0.01).valueC;
    const far = temperatureAt(ctx, x, rc + 0.08).valueC;
    expect(wall).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThanOrEqual(AMBIENT_C);
  });

  it('is cold before anything has happened, and warms as the energy goes in', () => {
    const tl = run('ap-shot', 300, 0, 'rha', 60);
    const at = (f: number) => temperatureAt(fieldContext(tl, tl.duration * f), tl.result.losThicknessM * 0.05, 0).valueC;
    expect(at(0)).toBeCloseTo(AMBIENT_C, 6);
    expect(at(0.5)).toBeGreaterThan(at(0.05));
  });

  it('puts a hot adiabatic shear band round a sheared plug, from the shear point to the rear face', () => {
    const tl = run('ap-shot', 60);
    const plug = tl.events.find((e) => e.type === 'plug')!;
    const r = tl.result.plug!.diameterM / 2;
    const ctx = fieldContext(tl, plug.t + 1e-6);
    const xMid = (plug.depth + tl.result.losThicknessM) / 2;
    const onBand = temperatureAt(ctx, xMid, r).valueC;
    const beside = temperatureAt(ctx, xMid, r * 2.5).valueC;
    const before = temperatureAt(fieldContext(tl, plug.t * 0.5), xMid, r).valueC;
    expect(onBand).toBeGreaterThan(beside + 100);
    expect(onBand).toBeGreaterThan(before);
  });

  it('spreads and cools slowly by conduction: the peak falls and the zone widens over a long time', () => {
    const tl = run('ap-shot', 300, 0, 'rha', 60);
    const end = tl.duration;
    const a = fieldContext(tl, end);
    // Same frame at a much later time: only the conduction term changes.
    const later = { ...a, t: end + 1 };
    const x = a.frame.depth / 2;
    const rc = craterRadiusAt(a.frame, x);
    expect(temperatureAt(later, x, rc).valueC).toBeLessThan(temperatureAt(a, x, rc).valueC);
    expect(temperatureAt(later, x, rc + 0.05).valueC).toBeGreaterThanOrEqual(AMBIENT_C);
  });
});

/** A frame part-way through the dig, while the shot is still moving. */
const midDig = (tl: ArmorTimeline) => tl.frames.find((f) => f.depth > 0.1 * tl.result.penetrationM && f.penetrationRate > 0)!;

describe('stress over yield (#166)', () => {
  it('is about Rt/Y at the nose while digging, and falls off with distance', () => {
    for (const material of ['rha', 'mild-steel', 'cast-iron'] as const) {
      const tl = run('ap-shot', 300, 0, material, 60);
      const ctx = fieldContext(tl, midDig(tl).t);
      const mat = getPlateMaterial(material);
      const nose = stressRatioAt(ctx, ctx.frame.depth, 0);
      expect(nose).toBeCloseTo(noseStressRatio(mat), 6);
      expect(nose).toBeGreaterThan(1);
      const dx = (tl.shot.impact.calibreMm / 1000) * 0.5;
      const farther = stressRatioAt(ctx, ctx.frame.depth + dx, 0);
      const farthest = stressRatioAt(ctx, ctx.frame.depth + 4 * dx, 0);
      expect(farther).toBeLessThan(nose);
      expect(farthest).toBeLessThan(farther);
      // Out in the plate it is elastic.
      expect(stressRatioAt(ctx, ctx.frame.depth + 0.3, 0.2)).toBeLessThan(1);
    }
  });

  it('marks a plastic zone (ratio of 1 or more) round the nose and not beyond', () => {
    const tl = run('ap-shot', 300, 0, 'rha', 60);
    const ctx = fieldContext(tl, midDig(tl).t);
    const d = tl.shot.impact.calibreMm / 1000;
    expect(stressRatioAt(ctx, ctx.frame.depth + 0.1 * d, 0)).toBeGreaterThanOrEqual(1);
    expect(stressRatioAt(ctx, ctx.frame.depth + 20 * d, 0)).toBeLessThan(1);
  });

  it('eases off once the penetrator has stopped', () => {
    const tl = run('ap-shot', 300, 0, 'rha', 60);
    const end = fieldContext(tl, tl.duration);
    expect(stressRatioAt(end, end.frame.depth, 0)).toBeLessThan(0.01);
  });

  it('follows the pressure wave for a stress-wave round', () => {
    const tl = run('hesh', 30, 0, 'cast-iron');
    const arrive = tl.result.losThicknessM / tl.shot.material.soundSpeed;
    const ctx = fieldContext(tl, arrive * 1.05);
    const x = tl.result.losThicknessM * 0.97;
    expect(stressRatioAt(ctx, x, 0)).toBeCloseTo((Math.abs(pressureGPaAt(ctx, x, 0)) * 1e9) / tl.shot.material.yieldPa, 9);
  });
});

describe('pressure wave (#166)', () => {
  /** The farthest x along the shot line where the pressure is above a small share of its peak. */
  const frontX = (tl: ArmorTimeline, t: number) => {
    const ctx = fieldContext(tl, t);
    const pulse = wavePulse(tl);
    let farthest = 0;
    const n = 4000;
    for (let i = 0; i <= n; i++) {
      const x = (tl.result.losThicknessM * i) / n;
      if (Math.abs(pressureGPaAt(ctx, x, 0)) * 1e9 > 1e-3 * pulse.p0Pa) farthest = x;
    }
    return farthest;
  };

  it('has its front at c·t from the impact', () => {
    const tl = run('ap-shot', 200, 0, 'rha', 150);
    const c = tl.shot.material.soundSpeed;
    const w = wavePulse(tl).lengthM;
    for (const f of [0.15, 0.3, 0.5]) {
      // Only while the front is still inside the plate.
      const t = (f * tl.result.losThicknessM) / c;
      const x = frontX(tl, t);
      expect(x).toBeLessThanOrEqual(c * t + 1e-9);
      expect(x).toBeGreaterThan(c * t - w * 0.2);
    }
  });

  it('moves out at the longitudinal sound speed of the plate material', () => {
    const rha = run('ap-shot', 200, 0, 'rha', 150);
    const al = run('ap-shot', 200, 0, 'al-5083', 150);
    const t = 3e-5;
    const front = (tl: ArmorTimeline) => frontX(tl, t);
    expect(front(al) / front(rha)).toBeCloseTo(al.shot.material.soundSpeed / rha.shot.material.soundSpeed, 1);
  });

  it('falls with distance from the impact', () => {
    const tl = run('ap-shot', 300, 0, 'rha', 150);
    const c = tl.shot.material.soundSpeed;
    const pulse = wavePulse(tl);
    const peakAt = (t: number) => {
      const ctx = fieldContext(tl, t);
      let max = 0;
      for (let i = 0; i <= 2000; i++) max = Math.max(max, pressureGPaAt(ctx, (tl.result.losThicknessM * i) / 2000, 0));
      return max;
    };
    const early = peakAt((0.15 * tl.result.losThicknessM) / c);
    const late = peakAt((0.6 * tl.result.losThicknessM) / c);
    expect(early).toBeGreaterThan(late);
    expect(early * 1e9).toBeLessThanOrEqual(pulse.p0Pa + 1);
  });

  it('is not yet anywhere before the front gets there, and spreads out sideways', () => {
    const tl = run('ap-shot', 300, 0, 'rha', 150);
    const c = tl.shot.material.soundSpeed;
    const ctx = fieldContext(tl, (0.2 * tl.result.losThicknessM) / c);
    expect(pressureGPaAt(ctx, 0.6 * tl.result.losThicknessM, 0)).toBe(0);
    const front = 0.2 * tl.result.losThicknessM;
    // On the arc at the front the pressure is the same up the plate as along the shot line (a hemispherical wave).
    const along = pressureGPaAt(ctx, front - 1e-3, 0);
    const up = pressureGPaAt(ctx, 0, front - 1e-3);
    expect(up).toBeGreaterThan(0);
    expect(up / along).toBeGreaterThan(0.8);
    expect(up / along).toBeLessThan(1.25);
  });

  it('reflects off the rear face as tension', () => {
    const tl = run('ap-shot', 100, 0, 'rha', 150);
    const c = tl.shot.material.soundSpeed;
    const tLos = tl.result.losThicknessM;
    const ctx = fieldContext(tl, (tLos + 0.6 * tLos) / c);
    let min = 0;
    for (let i = 0; i <= 400; i++) min = Math.min(min, pressureGPaAt(ctx, (tLos * i) / 400, 0));
    expect(min).toBeLessThan(0);
    // Before the front reaches the rear face there is no tension.
    const early = fieldContext(tl, (0.8 * tLos) / c);
    for (let i = 0; i <= 400; i++) expect(pressureGPaAt(early, (tLos * i) / 400, 0)).toBeGreaterThanOrEqual(-1e-9);
  });

  it('shows the stress-wave round its own planar pulse, reflecting as tension that tears the scab', () => {
    const tl = run('hesh', 30, 0, 'cast-iron');
    const c = tl.shot.material.soundSpeed;
    const tLos = tl.result.losThicknessM;
    const arrive = tLos / c;
    const before = fieldContext(tl, 0.5 * arrive);
    const after = fieldContext(tl, arrive + 0.5 * (tl.frames.find((f) => f.peakTensionPa)?.t ?? arrive) / 1e9);
    let max = 0;
    for (let i = 0; i <= 200; i++) max = Math.max(max, pressureGPaAt(before, (tLos * i) / 200, 0));
    expect(max).toBeGreaterThan(0);
    // Tension appears after the pulse reflects, and where the model puts the peak.
    const frame = tl.frames.find((f) => (f.peakTensionPa ?? 0) > 0)!;
    const ctx = fieldContext(tl, frame.t);
    let min = 0;
    let at = 0;
    for (let i = 0; i <= 600; i++) {
      const p = pressureGPaAt(ctx, (tLos * i) / 600, 0);
      if (p < min) {
        min = p;
        at = (tLos * i) / 600;
      }
    }
    expect(min).toBeLessThan(0);
    expect(tLos - at).toBeCloseTo(frame.tensionDepthM!, 1);
    void after;
  });
});

describe('energy account (#166)', () => {
  for (const [name, tl] of SHOTS) {
    it(`${name}: the terms add up to the impact energy within 2%, at every instant`, () => {
      for (let i = 0; i <= 80; i++) {
        const b = energyBalance(tl, (tl.duration * i) / 80);
        expect(Math.abs(b.totalJ - b.impactJ)).toBeLessThanOrEqual(0.02 * b.impactJ + 1e-9);
        for (const v of [b.kineticJ, b.plasticJ, b.heatJ, b.ejectaJ, b.residualJ]) expect(v).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it('starts as all kinetic and ends where the result says the energy went', () => {
    for (const [, tl] of SHOTS) {
      const start = energyBalance(tl, 0);
      // A plug that shears at the instant of impact (a plate thinner than the shot) already did its shear work.
      if (!tl.events.some((e) => e.type === 'plug' && e.t === 0)) expect(start.kineticJ).toBeGreaterThan(0.98 * start.impactJ);
      expect(start.kineticJ).toBeLessThanOrEqual(start.impactJ);
      const end = energyBalance(tl, tl.duration);
      const r = tl.result;
      expect(Math.abs(end.heatJ + end.plasticJ - r.energy.plateWorkJ)).toBeLessThanOrEqual(1e-4 * r.impactEnergyJ + 1e-9);
      expect(Math.abs(end.ejectaJ - r.energy.ejectaJ)).toBeLessThanOrEqual(1e-9 + 1e-6 * r.impactEnergyJ);
      expect(Math.abs(end.kineticJ + end.residualJ - r.residualEnergyJ)).toBeLessThanOrEqual(0.02 * r.impactEnergyJ + 1e-9);
    }
  });

  it('puts most of the work into heat', () => {
    const tl = run('ap-shot', 300, 0, 'rha', 60);
    const end = energyBalance(tl, tl.duration);
    expect(end.heatJ / (end.heatJ + end.plasticJ)).toBeCloseTo(HEAT_FRACTION, 9);
  });

  it('sends what gets through into residual, and leaves nothing kinetic after the penetrator has gone', () => {
    const tl = run('apfsds', 60);
    expect(tl.result.perforated).toBe(true);
    const end = energyBalance(tl, tl.duration);
    expect(end.kineticJ).toBe(0);
    expect(end.residualJ).toBeGreaterThan(0);
    const during = energyBalance(tl, tl.duration * 0.05);
    expect(during.residualJ).toBe(0);
  });

  it('adds the thrown plug to the ejecta term once it is sheared out', () => {
    const tl = run('ap-shot', 60);
    const perforate = tl.events.find((e) => e.type === 'perforate')!;
    expect(energyBalance(tl, perforate.t * 0.5).ejectaJ).toBe(0);
    expect(energyBalance(tl, perforate.t).ejectaJ).toBeCloseTo(tl.result.energy.ejectaJ, 6);
  });
});

describe('colour scales (#166)', () => {
  it('gives each field a range in real units', () => {
    const tl = run('heat', 100);
    const temp = fieldScale('temperature', tl);
    expect(temp.unit).toBe('°C');
    expect(temp.min).toBe(AMBIENT_C);
    expect(temp.max).toBeGreaterThanOrEqual(tl.shot.material.meltingPointC);
    const stress = fieldScale('stress', tl);
    expect(stress.min).toBe(0);
    expect(stress.max).toBeGreaterThanOrEqual(noseStressRatio(tl.shot.material));
    const p = fieldScale('pressure', tl);
    expect(p.diverging).toBe(true);
    expect(p.min).toBe(-p.max);
    expect(p.unit).toBe('GPa');
  });

  it('puts the whole pressure field inside its scale', () => {
    for (const [, tl] of SHOTS) {
      const s = fieldScale('pressure', tl);
      for (const f of [0.1, 0.4, 1]) {
        const g = fieldGrid(fieldContext(tl, tl.duration * f), 'pressure', 40, 24, tl.result.losThicknessM / 2);
        for (const v of g.values) expect(Math.abs(v)).toBeLessThanOrEqual(s.max * 1.001);
      }
    }
  });

  it('keeps temperature and stress inside theirs', () => {
    for (const [, tl] of SHOTS) {
      const t = fieldScale('temperature', tl);
      const s = fieldScale('stress', tl);
      const ctx = fieldContext(tl, tl.duration * 0.5);
      for (const v of fieldGrid(ctx, 'temperature', 30, 20, tl.result.losThicknessM / 2).values) expect(v).toBeLessThanOrEqual(t.max + 1e-6);
      for (const v of fieldGrid(ctx, 'stress', 30, 20, tl.result.losThicknessM / 2).values) expect(v).toBeLessThanOrEqual(s.max + 1e-6);
    }
  });
});

describe('field grid (#166)', () => {
  it('has a cell per column and row, row 0 at the top', () => {
    const tl = run('ap-shot', 100, 0, 'rha', 60);
    const ctx = fieldContext(tl, tl.duration * 0.5);
    const g = fieldGrid(ctx, 'temperature', 20, 10, 0.05);
    expect(g.values).toHaveLength(200);
    expect(g.molten).toHaveLength(200);
    // The shot line is the middle: a row either side of it matches by symmetry.
    for (let i = 0; i < 20; i++) expect(g.values[4 * 20 + i]).toBeCloseTo(g.values[5 * 20 + i], 4);
  });
});

describe('peak temperature and stress for the results panel (#157)', () => {
  it.each(SHOTS)('%s: the peaks are in range and agree with the field scales', (_name, timeline) => {
    const peaks = peakFields(timeline);
    const temp = fieldScale('temperature', timeline);
    expect(peaks.temperatureC).toBeGreaterThanOrEqual(AMBIENT_C);
    expect(peaks.temperatureC).toBeLessThanOrEqual(temp.max + 1e-6);
    expect(peaks.stressRatio).toBeGreaterThanOrEqual(0);
    expect(peaks.stressRatio).toBeLessThanOrEqual(Math.max(noseStressRatio(timeline.shot.material), 1e9));
    expect(peaks.stressGPa).toBeCloseTo((peaks.stressRatio * timeline.shot.material.yieldPa) / 1e9, 9);
    // Cached: asking again returns the same answer.
    expect(peakFields(timeline)).toBe(peaks);
  });

  it('a rod through armour reaches plastic flow and a molten interface, and nothing is as hot as it', () => {
    const rod = peakFields(run('apfsds', 60));
    expect(rod.stressRatio).toBeGreaterThan(1);
    expect(rod.molten).toBe(true);
    expect(rod.temperatureC).toBeGreaterThan(getPlateMaterial('rha').meltingPointC);
    const fragments = peakFields(run('he-frag', 300));
    expect(fragments.temperatureC).toBeLessThan(rod.temperatureC);
  });

  it('a squash head loads the plate through a pulse: stress reaches the spall level in a thin plate, not a thick one', () => {
    const thin = peakFields(run('hesh', 30, 0, 'cast-iron'));
    const thick = peakFields(run('hesh', 300));
    expect(thin.stressRatio).toBeGreaterThan(thick.stressRatio);
    expect(thin.molten).toBe(false);
  });
});
