import type { MediumSpec } from '../data/media';
import { concreteFootprint } from '../fx/concreteDamage';
import type { ShotSummary } from './types';

/**
 * Where a shot's energy and momentum went (#227): speed and kinetic energy before and after, the share the
 * target absorbed, and for measured concrete panels the mass and speed of the spall and scab it threw.
 */
export interface EnergyAccounting {
  impactSpeedMs: number;
  /** Zero when the bullet stopped in the target. */
  residualSpeedMs: number;
  impactJ: number;
  residualJ: number;
  /** (vr / vi)², the share of the kinetic energy the bullet kept, 0-1. */
  retained: number;
  /** 1 − retained: what the target took. */
  absorbed: number;
  /** Bullet mass implied by the shot's energy, in kg. */
  massKg: number;
}

export function energyAccounting(s: Pick<ShotSummary, 'impactSpeed' | 'impactEnergyJ' | 'passedThrough' | 'exitSpeed'>): EnergyAccounting {
  const vi = s.impactSpeed;
  const vr = s.passedThrough ? Math.min(s.exitSpeed, vi) : 0;
  const retained = vi > 0 ? (vr / vi) ** 2 : 0;
  return {
    impactSpeedMs: vi,
    residualSpeedMs: vr,
    impactJ: s.impactEnergyJ,
    residualJ: s.impactEnergyJ * retained,
    retained,
    absorbed: 1 - retained,
    massKg: vi > 0 ? (2 * s.impactEnergyJ) / (vi * vi) : 0,
  };
}

/** Depth of the front spall and the back scab cones as a share of the panel thickness (the hourglass is deeper behind). */
export const SPALL_DEPTH_FRACTION = 0.3;
export const SCAB_DEPTH_FRACTION = 0.5;
/** How fast the front spall leaves, in m/s. The scab speed comes from the grade debris table. */
export const SPALL_SPEED_MS = 10;
/** A debris tally within this factor of the momentum the bullet lost passes the check. */
export const MOMENTUM_BAND = 3;

export interface DebrisAccounting {
  spallKg: number;
  scabKg: number;
  spallSpeedMs: number;
  scabSpeedMs: number;
  /** Momentum the bullet lost to the panel, kg·m/s. */
  bulletLostKgMs: number;
  /** Momentum of the spall and scab together, kg·m/s. */
  debrisKgMs: number;
  /** debris ÷ lost; about 1 when the tally is consistent. */
  ratio: number;
  /** False for an outlier. */
  consistent: boolean;
}

/** Mass of a cone-shaped break-out: an elliptical footprint, a depth, a third of the cylinder it sits in. */
function coneMassKg(widthM: number, heightM: number, depthM: number, density: number): number {
  return ((Math.PI / 4) * widthM * heightM * depthM * density) / 3;
}

/** Spall and scab of a measured concrete panel, or undefined for any other medium. */
export function concreteDebrisAccounting(medium: MediumSpec, thicknessM: number, acc: EnergyAccounting): DebrisAccounting | undefined {
  const d = medium.concreteDamage;
  const spall = concreteFootprint(medium, thicknessM, 'spall');
  const scab = concreteFootprint(medium, thicknessM, 'scab');
  if (!d || !spall || !scab) return undefined;
  const spallKg = coneMassKg(spall.w, spall.h, thicknessM * SPALL_DEPTH_FRACTION, medium.density);
  // The back scab only lets go once the panel is perforated; short of that there is just the front crater.
  const scabKg = acc.residualSpeedMs > 0 ? coneMassKg(scab.w, scab.h, thicknessM * SCAB_DEPTH_FRACTION, medium.density) : 0;
  const [lo, hi] = d.debris.chips.speed;
  // Pieces are spread over the table speed range, so the mass-weighted speed sits nearer the slow end: a geometric mean.
  const scabSpeedMs = Math.sqrt(lo * hi);
  const bulletLostKgMs = acc.massKg * (acc.impactSpeedMs - acc.residualSpeedMs);
  const debrisKgMs = spallKg * SPALL_SPEED_MS + scabKg * scabSpeedMs;
  const ratio = bulletLostKgMs > 0 ? debrisKgMs / bulletLostKgMs : 0;
  return {
    spallKg,
    scabKg,
    spallSpeedMs: SPALL_SPEED_MS,
    scabSpeedMs,
    bulletLostKgMs,
    debrisKgMs,
    ratio,
    consistent: ratio >= 1 / MOMENTUM_BAND && ratio <= MOMENTUM_BAND,
  };
}
