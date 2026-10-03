import { describe, expect, it } from 'vitest';
import {
  MAX_CALIBRE_MM,
  MIN_CALIBRE_MM,
  MUNITION_FAMILIES,
  REFERENCE,
  impactState,
  type FragmentImpact,
  type JetImpact,
  type SolidImpact,
} from './munitions';

const CALIBRES = [40, 57, 76, 88, 105, 120, 125, 150];

describe('munition catalogue', () => {
  it('has the five families from the epic, each with UI text and a velocity range', () => {
    expect(MUNITION_FAMILIES.map((f) => f.id)).toEqual(['ap-shot', 'apfsds', 'heat', 'hesh', 'he-frag']);
    for (const f of MUNITION_FAMILIES) {
      expect(f.name.length).toBeGreaterThan(3);
      expect(f.description.length).toBeGreaterThan(20);
      expect(f.explainer.length).toBeGreaterThan(120);
      expect(f.velocity.min).toBeLessThan(f.velocity.max);
      expect(f.velocity.default).toBeGreaterThanOrEqual(f.velocity.min);
      expect(f.velocity.default).toBeLessThanOrEqual(f.velocity.max);
    }
  });

  it('gives a finite impact state for every family and calibre', () => {
    for (const f of MUNITION_FAMILIES) {
      for (const cal of CALIBRES) {
        const s = impactState(f.id, cal);
        expect(s.calibreMm).toBe(cal);
        for (const value of Object.values(s)) if (typeof value === 'number') expect(Number.isFinite(value) && value > 0).toBe(true);
      }
    }
  });

  it('scales sensibly with calibre: bigger guns, bigger and heavier projectiles', () => {
    for (const id of ['ap-shot', 'apfsds', 'hesh', 'he-frag'] as const) {
      let previous = impactState(id, CALIBRES[0]) as SolidImpact | FragmentImpact;
      for (const cal of CALIBRES.slice(1)) {
        const s = impactState(id, cal) as SolidImpact | FragmentImpact;
        expect(s.mass).toBeGreaterThan(previous.mass);
        expect(s.diameter).toBeGreaterThan(previous.diameter);
        previous = s;
      }
    }
    expect((impactState('heat', 150) as JetImpact).jetLength).toBeGreaterThan((impactState('heat', 40) as JetImpact).jetLength);
  });

  it('a 120 mm-class long rod is about 27 mm × 700 mm of tungsten alloy at about 1,650 m/s', () => {
    const rod = impactState('apfsds', 120) as SolidImpact;
    expect(rod.material).toBe('tungsten-alloy');
    expect(rod.diameter * 1000).toBeCloseTo(27, 0);
    expect(rod.length).toBeGreaterThan(0.65);
    expect(rod.length).toBeLessThan(0.75);
    expect(rod.velocity).toBe(1650);
    // Long rods are long: L/D well above 10 at every calibre.
    for (const cal of CALIBRES) {
      const r = impactState('apfsds', cal) as SolidImpact;
      expect(r.length / r.diameter).toBeGreaterThanOrEqual(15);
    }
  });

  it('full-bore shot is steel at bore diameter: about 10 kg at 88 mm, 800–1,000 m/s', () => {
    const shot = impactState('ap-shot', 88) as SolidImpact;
    expect(shot.material).toBe('steel');
    expect(shot.diameter).toBeCloseTo(0.088, 6);
    expect(shot.mass).toBeGreaterThan(9);
    expect(shot.mass).toBeLessThan(11);
    expect(shot.velocity).toBeGreaterThanOrEqual(800);
    expect(shot.velocity).toBeLessThanOrEqual(1000);
  });

  it('a shaped-charge jet has a 0.8-calibre cone and reaches about 6 cone diameters into RHA by the density law', () => {
    for (const cal of CALIBRES) {
      const jet = impactState('heat', cal) as JetImpact;
      expect(jet.coneDiameter).toBeCloseTo(cal * 0.0008, 9);
      expect(jet.jetTipVelocity).toBeGreaterThan(jet.jetTailVelocity);
      const depth = jet.jetLength * Math.sqrt(jet.density / REFERENCE.rhaDensity);
      expect(depth / jet.coneDiameter).toBeGreaterThan(5);
      expect(depth / jet.coneDiameter).toBeLessThan(7);
    }
  });

  it('HE fragments fly at 1,200–1,800 m/s', () => {
    const he = impactState('he-frag', 155) as FragmentImpact;
    expect(he.fragments.velocity).toEqual([1200, 1800]);
    expect(he.fragments.count).toBeGreaterThan(20);
    expect(he.fragments.mass[0]).toBeLessThan(he.fragments.mass[1]);
  });

  it('clamps the calibre to 40–150 mm and the velocity to the family range', () => {
    expect(impactState('apfsds', 10).calibreMm).toBe(MIN_CALIBRE_MM);
    expect(impactState('apfsds', 400).calibreMm).toBe(MAX_CALIBRE_MM);
    expect(impactState('apfsds', 120, 5000).velocity).toBe(1800);
    expect(impactState('apfsds', 120, 100).velocity).toBe(1400);
    expect(impactState('ap-shot', 88, 950).velocity).toBe(950);
  });
});
