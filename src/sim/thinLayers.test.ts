import { describe, expect, it } from 'vitest';
import { BULLETS } from '../data/bullets';
import { getMedium } from '../data/media';
import { ULTRA_RESOLUTION } from '../data/physics';
import { stepIntoSkippedLayer, updateYawAndBreakup } from './engine';
import { fire } from './testUtil';

describe('stepIntoSkippedLayer (#265)', () => {
  const thin = [{ offset: 0.1, thickness: 0.0007 }];

  it('is null when the step does not jump a whole layer', () => {
    expect(stepIntoSkippedLayer(thin, 0, 1, 0.0005)).toBeNull();
    // Starts before the layer and ends inside it: not skipped.
    expect(stepIntoSkippedLayer(thin, 0.0996, 1, 0.0006)).toBeNull();
    // Already past it.
    expect(stepIntoSkippedLayer(thin, 0.2, 1, 0.01)).toBeNull();
    expect(stepIntoSkippedLayer(thin, 0, 1, 0)).toBeNull();
  });

  it('lands just inside a layer the step would clear, going in either direction', () => {
    // A 1 mm step from 0.0998 m would end at 0.1008 m, past the 0.7 mm layer at 0.1 m: land just inside its front face.
    const f = stepIntoSkippedLayer(thin, 0.0998, 1, 0.001)!;
    expect(0.0998 + f * 0.001).toBeGreaterThan(0.1);
    expect(0.0998 + f * 0.001).toBeLessThan(0.1 + 1e-6);
    // Heading back out through it (negative cosine) lands just inside its rear face.
    const back = stepIntoSkippedLayer(thin, 0.1009, -1, 0.001)!;
    expect(0.1009 - back * 0.001).toBeLessThan(0.1007);
    expect(0.1009 - back * 0.001).toBeGreaterThan(0.1007 - 1e-6);
  });

  it('goes for the nearest skipped layer, and scales by the angle', () => {
    const two = [{ offset: 0.1, thickness: 0.0005 }, { offset: 0.1006, thickness: 0.0005 }];
    expect(stepIntoSkippedLayer(two, 0.0997, 1, 0.002)!).toBeLessThan(0.0004 / 0.002 + 1e-3);
    // At 60 degrees only half the travel is along the normal.
    expect(stepIntoSkippedLayer(thin, 0.0995, 0.5, 0.001)).toBeNull();
  });
});

/** Every round, however fast, must meet every layer it crosses, down to very thin ones (#265). */
describe('thin layers are never skipped (#265)', () => {
  const rounds = BULLETS.map((b) => b.id);
  const cases: [string, number][] = [
    ['glass', 0.0002],
    ['glass', 0.0007],
    ['steel-mild', 0.0005],
    ['steel-mild', 0.0009],
    ['aluminum', 0.0004],
    ['sheet-metal', 0.001],
  ];

  it.each(cases)('every round records a hit on 1 layer of %s at %f m', (medium, thickness) => {
    for (const bullet of rounds) {
      const tl = fire({ bullet, medium, thickness });
      const hit = tl.events.some((e) => e.layer === 0 && (e.type === 'impact' || e.type === 'enter'));
      expect(hit, `${bullet} into ${thickness} m of ${medium}`).toBe(true);
    }
  });

  it('records the phone glass for a 5.56 whatever the layer behind it', () => {
    const pane = { medium: 'glass', thickness: 0.0007 };
    const tl = fire({ bullet: '556-m193', ...pane });
    expect(tl.summary.passedThrough).toBe(true);
    expect(tl.events.some((e) => e.type === 'exit' && e.layer === 0)).toBe(true);
  });

  it('also holds at Ultra resolution', () => {
    for (const bullet of ['556-m193', '308-sp', '50bmg-fmj']) {
      const tl = fire({ bullet, medium: 'glass', thickness: 0.0007, resolution: ULTRA_RESOLUTION });
      expect(tl.events.some((e) => e.layer === 0 && (e.type === 'impact' || e.type === 'enter'))).toBe(true);
    }
  });
});

/** A shortened step must advance everything by the time it really took, not a full step (#265). */
describe('thin layer behind a thick one (#265)', () => {
  const thick = { medium: getMedium('gel10'), thickness: 0.2, gapM: 0 };
  const thin = (gapM: number) => ({ medium: getMedium('glass'), thickness: 0.0007, gapM });

  it('advances a tumbling round by the time the step really took, not a full step', () => {
    const medium = getMedium('gel10');
    const make = () =>
      ({
        bullet: { yawNeckM: 0.001, behaviour: 'intact' },
        state: 'intact',
        speed: 900,
        layerDist: 0.05,
        layer: 0,
        yaw: 0,
        yawing: false,
        fragmented: false,
        impactSpeed: 900,
        id: 0,
        t: 0,
        pos: { x: 0, y: 0, z: 0 },
      }) as never as Parameters<typeof updateYawAndBreakup>[1];
    const ctx = { res: { stepS: 1e-6 }, events: [] } as never as Parameters<typeof updateYawAndBreakup>[0];
    const full = make();
    updateYawAndBreakup(ctx, full, medium, 1e-6);
    const short = make();
    updateYawAndBreakup(ctx, short, medium, 1e-10);
    const yaw = (b: unknown) => (b as { yaw: number }).yaw;
    expect(yaw(full)).toBeGreaterThan(0);
    // A step 10,000 times shorter turns it 10,000 times less.
    expect(yaw(short)).toBeCloseTo(yaw(full) / 1e4, 9);
  });

  it('meets the thin layer behind the thick one exactly once, in and out, however big the gap', () => {
    for (const gapM of [0, 0.0003, 0.05]) {
      const tl = fire({ bullet: '556-m193', stack: [{ ...thick, thickness: 0.002, medium: getMedium('plywood') }, thin(gapM)] });
      const mine = tl.events.filter((e) => e.trackId === tl.shots[0].primaryId && e.layer === 1);
      expect(mine.filter((e) => e.type === 'enter' || e.type === 'impact').length, `gap ${gapM}`).toBe(1);
      expect(mine.filter((e) => e.type === 'exit').length, `gap ${gapM}`).toBe(1);
    }
  });

  it('records a thin layer at an angle too', () => {
    for (const angleDeg of [30, 60]) {
      const tl = fire({ bullet: '556-m193', medium: 'glass', thickness: 0.0007, angleDeg });
      expect(tl.events.some((e) => e.layer === 0 && (e.type === 'impact' || e.type === 'enter')), `${angleDeg} deg`).toBe(true);
    }
  });
});
