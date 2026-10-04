import { describe, expect, it } from 'vitest';
import { getPlateMaterial, type PlateMaterialId } from './materials';
import { impactState, type MunitionFamilyId } from './munitions';
import { simulateArmor } from './simulate';
import {
  MAX_GAP_TIME_S,
  MAX_LAYERS,
  MAX_ROD_YAW_DEG,
  PARTICULATION_CONE_DIAMETERS,
  STACK_PRESETS,
  carryOver,
  jetGapEfficiency,
  rodYawDeg,
  shiftFragments,
  simulateStack,
  type PlateLayer,
  type StackShot,
} from './stack';

const layer = (material: PlateMaterialId, thicknessMm: number, gapMm = 0): PlateLayer => ({ material: getPlateMaterial(material), thicknessM: thicknessMm / 1000, gapBeforeM: gapMm / 1000 });
const stack = (family: MunitionFamilyId, layers: PlateLayer[], obliquityDeg = 0, calibreMm = 120, velocity?: number): StackShot => ({ impact: impactState(family, calibreMm, velocity), layers, obliquityDeg });

describe('a stack of one plate (#171)', () => {
  it('is the single-plate run, exactly', () => {
    for (const [family, thickness] of [['ap-shot', 60], ['apfsds', 60], ['heat', 100], ['hesh', 30]] as const) {
      const s = simulateStack(stack(family, [layer('rha', thickness)]));
      const single = simulateArmor({ impact: impactState(family, 120), material: getPlateMaterial('rha'), thicknessM: thickness / 1000, obliquityDeg: 0 });
      expect(s.stages).toHaveLength(1);
      expect(s.stages[0].timeline).toEqual(single);
      expect(s.events.map((e) => e.label)).toEqual(single.events.map((e) => e.label));
      expect(s.duration).toBe(single.duration);
    }
  });

  it('has one results entry, engaged', () => {
    const s = simulateStack(stack('apfsds', [layer('rha', 60)]));
    expect(s.plates).toHaveLength(1);
    expect(s.plates[0].engaged).toBe(true);
    expect(s.plates[0].perforated).toBe(true);
  });
});

describe('stack limits (#171)', () => {
  it('takes 1 to 4 plates', () => {
    expect(() => simulateStack(stack('apfsds', []))).toThrow();
    expect(() => simulateStack(stack('apfsds', Array.from({ length: MAX_LAYERS + 1 }, () => layer('rha', 10))))).toThrow();
    expect(() => simulateStack(stack('apfsds', Array.from({ length: MAX_LAYERS }, () => layer('rha', 10, 50))))).not.toThrow();
  });
});

describe('results per plate (#171)', () => {
  it('has an entry for every plate, engaged or not, with its own depth and residual', () => {
    const s = simulateStack(stack('apfsds', [layer('rha', 20), layer('rha', 30, 100), layer('rha', 250, 100), layer('rha', 20, 100)], 0, 50));
    expect(s.plates).toHaveLength(4);
    expect(s.plates[0].perforated).toBe(true);
    expect(s.plates[0].residualVelocity).toBeGreaterThan(0);
    expect(s.plates[0].penetrationM).toBeCloseTo(s.plates[0].losThicknessM, 9);
    expect(s.plates[0].residualLengthM).toBeGreaterThan(0);
    // The rod is spent somewhere in the thick plate; whatever is behind it is untouched.
    const stopped = s.plates.findIndex((p) => p.engaged && !p.perforated);
    expect(stopped).toBeGreaterThan(0);
    expect(s.result.stoppedAt).toBe(stopped);
    for (const p of s.plates.slice(stopped + 1)) {
      expect(p.engaged).toBe(false);
      expect(p.mechanism).toBeNull();
      expect(p.penetrationM).toBe(0);
    }
    expect(s.result.perforated).toBe(false);
    expect(s.result.platesDefeated).toBe(stopped);
    expect(s.result.residualVelocity).toBe(0);
  });

  it('adds up what gets through the whole stack', () => {
    const s = simulateStack(stack('apfsds', [layer('rha', 20), layer('rha', 20, 100)]));
    expect(s.result.perforated).toBe(true);
    expect(s.result.stoppedAt).toBeNull();
    expect(s.result.platesDefeated).toBe(2);
    expect(s.result.residualVelocity).toBe(s.plates[1].residualVelocity);
    // The second plate sees the rod yawed a little, so its line of sight is a touch longer.
    expect(s.result.totalLosThicknessM).toBeGreaterThanOrEqual(0.04 - 1e-9);
    expect(s.result.totalLosThicknessM).toBeLessThan(0.042);
    expect(s.result.impactEnergyJ).toBe(s.stages[0].timeline.result.impactEnergyJ);
    expect(s.result.residualEnergyJ).toBeLessThan(s.result.impactEnergyJ);
  });

  it('reports line-of-sight thickness per plate at the stack slope', () => {
    const s = simulateStack(stack('ap-shot', [layer('rha', 20), layer('rha', 30, 100)], 45, 88));
    for (const p of s.plates.filter((x) => x.engaged)) expect(p.losThicknessM).toBeCloseTo(p.thicknessM / Math.cos(Math.PI / 4), 6);
  });
});

describe('shaped-charge jets across gaps (#171)', () => {
  it('has a gap efficiency that is 1 with no gap and half at the particulation distance', () => {
    expect(jetGapEfficiency(0, 0.1)).toBe(1);
    expect(jetGapEfficiency(PARTICULATION_CONE_DIAMETERS * 0.1, 0.1)).toBeCloseTo(0.5, 9);
    expect(jetGapEfficiency(1, 0.1)).toBeLessThan(jetGapEfficiency(0.2, 0.1));
  });

  it('loses measurable penetration across a large gap compared with no gap', () => {
    const through = (gapMm: number) => {
      const s = simulateStack(stack('heat', [layer('rha', 30), layer('rha', 400, gapMm)], 0, 60));
      return s.plates[1].penetrationM;
    };
    const none = through(0);
    const small = through(100);
    const large = through(800);
    expect(none).toBeGreaterThan(small);
    expect(small).toBeGreaterThan(large);
    expect(large).toBeLessThan(0.7 * none);
  });

  it('carries the remaining jet, with less length than the jet started with', () => {
    const s = simulateStack(stack('heat', [layer('rha', 30), layer('rha', 400, 100)], 0, 60));
    const first = s.stages[0].shot.impact;
    const second = s.stages[1].shot.impact;
    if (first.family !== 'heat' || second.family !== 'heat') throw new Error('expected jets');
    expect(second.jetLength).toBeLessThan(first.jetLength);
    expect(second.jetTipVelocity).toBeLessThan(first.jetTipVelocity);
    expect(second.jetTailVelocity).toBe(first.jetTailVelocity);
  });

  it('is spent in a plate it cannot get through, and the plates behind are not engaged', () => {
    const s = simulateStack(stack('heat', [layer('rha', 300), layer('rha', 30, 100)], 0, 60));
    expect(s.plates[0].perforated).toBe(false);
    expect(s.plates[1].engaged).toBe(false);
    expect(s.result.stoppedAt).toBe(0);
  });
});

describe('long rods in a stack (#171)', () => {
  it('arrive at the next plate shorter, slower and yawed', () => {
    const s = simulateStack(stack('apfsds', [layer('rha', 20), layer('rha', 250, 200)], 0, 50));
    const a = s.stages[0].shot;
    const b = s.stages[1].shot;
    if (a.impact.family !== 'apfsds' || b.impact.family !== 'apfsds') throw new Error('expected rods');
    expect(b.impact.length).toBeLessThan(a.impact.length);
    expect(b.impact.velocity).toBeLessThan(a.impact.velocity);
    expect(b.impact.mass).toBeLessThan(a.impact.mass);
    expect(b.obliquityDeg).toBeGreaterThan(a.obliquityDeg);
    expect(b.obliquityDeg).toBeLessThanOrEqual(MAX_ROD_YAW_DEG + 1e-9);
  });

  it('yaws more for a thin plate than a thick one, and never more than the maximum', () => {
    expect(rodYawDeg(0.005, 0.027)).toBeGreaterThan(rodYawDeg(0.1, 0.027));
    expect(rodYawDeg(0, 0.027)).toBeCloseTo(MAX_ROD_YAW_DEG, 9);
    expect(rodYawDeg(1, 0.027)).toBeGreaterThan(0);
  });

  it('digs less in the main plate after a spaced plate than alone', () => {
    const alone = simulateStack(stack('apfsds', [layer('rha', 250)], 0, 50)).plates[0].penetrationM;
    const behind = simulateStack(stack('apfsds', [layer('rha', 40), layer('rha', 250, 300)], 0, 50)).plates[1].penetrationM;
    expect(behind).toBeLessThan(alone);
  });
});

describe('full-bore shot in a stack (#171)', () => {
  it('shatters at the first plate and arrives as a small piece', () => {
    const s = simulateStack(stack('ap-shot', [layer('rha', 20), layer('rha', 60, 200)], 60, 88));
    expect(s.plates[0].shattered).toBe(true);
    const a = s.stages[0].shot.impact;
    const b = s.stages[1]?.shot.impact;
    if (b) {
      if (a.family !== 'ap-shot' || b.family !== 'ap-shot') throw new Error('expected shot');
      expect(b.mass).toBeLessThan(0.5 * a.mass);
      expect(b.diameter).toBeLessThan(a.diameter);
    }
  });

  it('carries the speed it got through with', () => {
    const s = simulateStack(stack('ap-shot', [layer('rha', 20), layer('rha', 40, 100)], 0, 88));
    const b = s.stages[1].shot.impact;
    expect(b.velocity).toBeCloseTo(s.plates[0].residualVelocity, 9);
    expect(s.plates[1].entrySpeed).toBeCloseTo(s.plates[0].residualVelocity, 9);
  });

  it('meets both plates of two equal plates, each shearing its own plug, and ends slower than it arrived', () => {
    const two = simulateStack(stack('ap-shot', [layer('rha', 40), layer('rha', 40, 50)], 0, 88));
    expect(two.plates[0].engaged).toBe(true);
    expect(two.plates[1].engaged).toBe(true);
    expect(two.plates[0].plug).toBeDefined();
    expect(two.plates[1].entrySpeed).toBeLessThan(two.plates[0].entrySpeed);
    if (two.result.perforated) expect(two.result.residualVelocity).toBeLessThan(two.plates[1].entrySpeed);
  });
});

describe('squash-head rounds in a stack (#171)', () => {
  it('spall only the first plate, and nothing behind it is engaged', () => {
    const s = simulateStack(stack('hesh', [layer('cast-iron', 30), layer('rha', 30, 0), layer('rha', 30, 50)]));
    expect(s.plates[0].engaged).toBe(true);
    expect(s.plates[0].mechanism).toBe('Spalling');
    expect(s.plates[0].scab).toBeDefined();
    expect(s.plates[1].engaged).toBe(false);
    expect(s.plates[2].engaged).toBe(false);
    expect(s.stages).toHaveLength(1);
    expect(s.result.stoppedAt).toBe(0);
    expect(s.result.platesDefeated).toBe(0);
  });

  it('hold on a thick first plate too', () => {
    const s = simulateStack(stack('hesh', [layer('rha', 300), layer('rha', 20)]));
    expect(s.plates[0].scab).toBeUndefined();
    expect(s.plates[1].engaged).toBe(false);
  });
});

describe('carry-over (#171)', () => {
  it('carries nothing from a plate that stopped the round, a ricochet or a squash head', () => {
    expect(carryOver(simulateArmor({ impact: impactState('apfsds', 40), material: getPlateMaterial('rha'), thicknessM: 0.3, obliquityDeg: 0 }), 0.1)).toBeNull();
    expect(carryOver(simulateArmor({ impact: impactState('apfsds', 120), material: getPlateMaterial('rha'), thicknessM: 0.1, obliquityDeg: 85 }), 0.1)).toBeNull();
    expect(carryOver(simulateArmor({ impact: impactState('hesh', 120), material: getPlateMaterial('cast-iron'), thicknessM: 0.03, obliquityDeg: 0 }), 0.1)).toBeNull();
  });

  it('ends a stack at a ricochet', () => {
    const s = simulateStack(stack('apfsds', [layer('rha', 100), layer('rha', 100, 100)], 85));
    expect(s.plates[0].mechanism).toBe('Ricochet');
    expect(s.plates[1].engaged).toBe(false);
  });
});

describe('stack clock and events (#171)', () => {
  it('starts each plate when the round gets there, later than the one before', () => {
    const s = simulateStack(stack('apfsds', [layer('rha', 20), layer('rha', 20, 200), layer('rha', 20, 200)]));
    expect(s.stages).toHaveLength(3);
    for (let i = 1; i < s.stages.length; i++) {
      expect(s.stages[i].offsetT).toBeGreaterThan(s.stages[i - 1].offsetT);
      const exit = s.stages[i - 1].timeline.events.find((e) => e.type === 'perforate')!;
      expect(s.stages[i].offsetT).toBeCloseTo(s.stages[i - 1].offsetT + exit.t + s.stages[i].gapTimeS, 12);
      expect(s.stages[i].gapTimeS).toBeLessThanOrEqual(MAX_GAP_TIME_S);
      expect(s.stages[i].startM).toBeGreaterThan(s.stages[i - 1].startM + s.stages[i - 1].timeline.result.losThicknessM);
    }
  });

  it('crosses a gap at about the residual speed', () => {
    const s = simulateStack(stack('apfsds', [layer('rha', 20), layer('rha', 20, 200)]));
    expect(s.stages[1].gapTimeS).toBeCloseTo(0.2 / s.plates[0].residualVelocity, 6);
  });

  it('merges the events in time order, labelled by plate', () => {
    const s = simulateStack(stack('apfsds', [layer('rha', 20), layer('rha', 20, 100)]));
    for (let i = 1; i < s.events.length; i++) expect(s.events[i].t).toBeGreaterThanOrEqual(s.events[i - 1].t);
    expect(s.events.some((e) => e.label.startsWith('Plate 1:'))).toBe(true);
    expect(s.events.some((e) => e.label.startsWith('Plate 2:'))).toBe(true);
  });

  it('runs on to the end of the last plate', () => {
    const s = simulateStack(stack('apfsds', [layer('rha', 20), layer('rha', 20, 100)]));
    const last = s.stages[1];
    expect(s.duration).toBeCloseTo(last.offsetT + last.timeline.duration, 12);
  });
});

describe('fragments in a stack (#171)', () => {
  it('belong to the last plate reached, on the stack clock', () => {
    const s = simulateStack(stack('heat', [layer('rha', 30), layer('rha', 80, 100)]));
    expect(s.fragmentStage).toBe(s.stages.length - 1);
    const last = s.stages[s.fragmentStage];
    expect(last.timeline.fragments).toBeDefined();
    expect(s.fragments!.tracks[0].t0).toBeCloseTo(last.timeline.fragments!.tracks[0].t0 + last.offsetT, 12);
    expect(s.stages[0].timeline.fragments).toBeUndefined();
  });

  it('are absent when the last plate throws nothing', () => {
    const s = simulateStack(stack('apfsds', [layer('rha', 40), layer('rha', 400, 100)], 0, 40));
    expect(s.fragments).toBeUndefined();
  });

  it('shifts a field without touching the original', () => {
    const single = simulateArmor({ impact: impactState('heat', 120), material: getPlateMaterial('rha'), thicknessM: 0.1, obliquityDeg: 0 });
    const field = single.fragments!;
    const before = JSON.stringify(field);
    const shifted = shiftFragments(field, 1e-3);
    expect(JSON.stringify(field)).toBe(before);
    expect(shifted.restS).toBeCloseTo(field.restS + 1e-3, 12);
    expect(shifted.tracks[0].segments[0].t0).toBeCloseTo(field.tracks[0].segments[0].t0 + 1e-3, 12);
    expect(shifted.handoffS).toBeCloseTo(field.handoffS! + 1e-3, 12);
  });
});

describe('stack presets (#171)', () => {
  const extras = { spaced: getPlateMaterial('mild-steel'), soft: getPlateMaterial('al-5083'), hard: getPlateMaterial('rha') };

  it('builds layers within the limits, front to back', () => {
    for (const preset of STACK_PRESETS) {
      const layers = preset.build(getPlateMaterial('rha'), 0.1, extras);
      expect(layers.length).toBeGreaterThanOrEqual(1);
      expect(layers.length).toBeLessThanOrEqual(MAX_LAYERS);
      expect(layers[0].gapBeforeM).toBe(0);
      for (const l of layers) expect(l.thicknessM).toBeGreaterThan(0);
    }
  });

  it('keeps the same total thickness for two equal plates against one', () => {
    const two = STACK_PRESETS.find((p) => p.id === 'two-equal')!.build(getPlateMaterial('rha'), 0.08, extras);
    expect(two.reduce((sum, l) => sum + l.thicknessM, 0)).toBeCloseTo(0.08, 9);
    expect(two[0].material.id).toBe(two[1].material.id);
  });

  it('runs every preset against every family that models plate', () => {
    for (const preset of STACK_PRESETS) {
      for (const family of ['ap-shot', 'apfsds', 'heat', 'hesh'] as const) {
        const s = simulateStack({ impact: impactState(family, 120), layers: preset.build(getPlateMaterial('rha'), 0.1, extras), obliquityDeg: 0 });
        expect(s.plates.length).toBe(preset.build(getPlateMaterial('rha'), 0.1, extras).length);
        expect(Number.isFinite(s.duration)).toBe(true);
        expect(s.duration).toBeGreaterThan(0);
      }
    }
  });
});
