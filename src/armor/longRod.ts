/**
 * Armor lab (#162): a long-rod (APFSDS) penetrator against plate. At 1,400 to
 * 1,800 m/s the pressure at the rod's tip is far above the strength of either
 * metal, so rod and plate both flow like fluids at the interface: the rod head
 * mushrooms and is consumed as it digs a crater about twice its diameter.
 *
 * The model is Alekseevskii–Tate (Alekseevskii 1966, Tate 1967; see Anderson
 * & Walker, "An examination of long-rod penetration", Int. J. Impact Eng.
 * 1991, and Zukas, "Impact Dynamics"). With v the rod's tail speed, u the
 * speed of the crater bottom, L the remaining rod length and P the depth:
 *
 *   interface:  ½ρp(v − u)² + Yp = ½ρt·u² + Rt
 *   rod:        dv/dt = −Yp / (ρp·L)        dL/dt = −(v − u)
 *   penetration: dP/dt = u
 *
 * Yp is the rod's yield strength and Rt the plate's target resistance, both
 * from the catalogues. Two special cases follow from the interface equation:
 * - **Rigid rod.** When Yp − Rt > ½ρt·v² the plate cannot erode the rod. It
 *   digs as a rigid body (u = v, no erosion) against a resistance of
 *   ½ρt·v² + Rt, and slows until it stops.
 * - **No penetration.** In the eroding regime u falls to zero when
 *   ½ρp·v² = Rt − Yp, and the rod is stopped there with some of its length left.
 *
 * The rod is integrated with a fine time step until it is consumed, stops or
 * breaks out of the rear face. Breakout is a lab heuristic: the rod perforates
 * when the crater is within about one rod diameter of the line-of-sight
 * thickness (`BREAKOUT_RATIO`), then flies on at the speed it has.
 *
 * Obliquity is only used as a longer path (the line-of-sight thickness); the
 * ricochet and shatter of steeply sloped plate is a later ticket (#165). The
 * crater width, its taper and the rear bulge are illustrative lab heuristics.
 *
 * Impact physics only. All values are a simplified teaching model, not
 * engineering data.
 */

import {
  CRATER_PROFILE_SAMPLES,
  MAX_TIMELINE_FRAMES,
  TIMELINE_FRAMES,
  losThickness,
  normalizeShot,
  sampleFrames,
  timelineDuration,
  type ArmorEvent,
  type ArmorFrame,
  type ArmorShot,
  type ArmorTimeline,
} from './model';
import { REAR_BULGE_GAIN, REAR_BULGE_ONSET_RATIO } from './fullBore';
import { PENETRATOR_YIELD, type SolidImpact } from './munitions';
import type { PlateMaterial } from './materials';

/** Steepest plate slope (degrees) the long-rod model handles; steeper shots are clamped to it. */
export const LONG_ROD_MAX_OBLIQUITY_DEG = 70;

/** The rod breaks out of the rear face when the crater is within this many rod diameters of the plate's far side (illustrative lab heuristic). */
export const BREAKOUT_RATIO = 1;
/** The crater ends up about this many rod diameters wide (the mushroomed head). */
export const CRATER_DIAMETER_RATIO = 2;
/** The head reaches its full width after this many rod diameters of rod have been eroded (illustrative lab heuristic). */
export const MUSHROOM_ERODED_DIAMETERS = 4;
/** Time steps per rod transit time (L0 / v0). */
const STEPS_PER_TRANSIT = 4000;

/** Which regime the rod is in. */
export type LongRodRegime = 'eroding' | 'rigid' | 'stalled';

/**
 * Speed of the crater bottom, u (m/s), for a rod tail speed v, from the Tate
 * interface equation. 0 when the rod cannot push the interface forward
 * (½ρp·v² ≤ Rt − Yp). Valid for the eroding regime.
 */
export function tateInterfaceSpeed(v: number, rodDensity: number, rodYieldPa: number, plateDensity: number, targetResistancePa: number): number {
  const a = targetResistancePa - rodYieldPa; // the strength the rod's dynamic pressure must beat
  if (0.5 * rodDensity * v * v <= a) return 0;
  if (rodDensity === plateDensity) return v / 2 - a / (rodDensity * v);
  const root = Math.sqrt(rodDensity * plateDensity * v * v + 2 * (rodDensity - plateDensity) * a);
  return (rodDensity * v - root) / (rodDensity - plateDensity);
}

/** Whether a rod at tail speed v digs as a rigid body: Yp − Rt > ½ρt·v². */
export function rodIsRigid(v: number, rodYieldPa: number, plateDensity: number, targetResistancePa: number): boolean {
  return rodYieldPa - targetResistancePa > 0.5 * plateDensity * v * v;
}

/** The hydrodynamic limit, m: the deepest an ideal fluid rod of length L could go, L·√(ρp/ρt). Strength only lowers it while the plate resists more than the rod yields (Rt > Yp); a rod stronger than that (tungsten in aluminium) can pass it. */
export function hydrodynamicLimit(rodLengthM: number, rodDensity: number, plateDensity: number): number {
  return rodLengthM * Math.sqrt(rodDensity / plateDensity);
}

interface Sample {
  t: number;
  /** Tail speed, m/s. */
  v: number;
  /** Remaining rod length, m. */
  L: number;
  /** Crater depth, m. */
  P: number;
  /** Speed of the crater bottom, m/s. */
  u: number;
}

interface Integration {
  samples: Sample[];
  regime: LongRodRegime;
  /** Why it ended: the rod was used up, stalled or stopped, or broke out of the rear face. */
  end: 'consumed' | 'stalled' | 'stopped' | 'breakout';
}

/** Integrates the rod until it is consumed, stops or reaches `breakoutDepthM`. */
function integrate(impact: SolidImpact, material: PlateMaterial, breakoutDepthM: number): Integration {
  const rhoP = impact.density;
  const yp = PENETRATOR_YIELD[impact.material];
  const rhoT = material.density;
  const rt = material.targetResistancePa;
  let v = impact.velocity;
  let L = impact.length;
  let P = 0;
  let t = 0;
  const dt = impact.length / impact.velocity / STEPS_PER_TRANSIT;
  const samples: Sample[] = [];
  let rigid = rodIsRigid(v, yp, rhoT, rt);
  let end: Integration['end'] = 'stopped';
  const uOf = () => (rigid ? v : tateInterfaceSpeed(v, rhoP, yp, rhoT, rt));
  samples.push({ t, v, L, P, u: uOf() });
  // Safety cap: a rod that somehow keeps going is cut off after a few transit times.
  for (let step = 0; step < 20 * STEPS_PER_TRANSIT; step++) {
    if (!rigid && rodIsRigid(v, yp, rhoT, rt)) rigid = true; // once the rod has slowed enough it stops eroding
    const u = uOf();
    if (!rigid && u <= 0) {
      end = 'stalled';
      break;
    }
    if (rigid) {
      v -= ((0.5 * rhoT * v * v + rt) / (rhoP * L)) * dt;
      if (v <= 0) {
        v = 0;
        end = 'stopped';
        P += 0;
        t += dt;
        samples.push({ t, v, L, P, u: 0 });
        break;
      }
    } else {
      v -= (yp / (rhoP * L)) * dt;
      L -= (v - u) * dt;
      if (L <= 0 || v <= 0) {
        L = Math.max(0, L);
        v = Math.max(0, v);
        end = 'consumed';
        P += u * dt;
        t += dt;
        samples.push({ t, v, L, P, u: 0 });
        break;
      }
    }
    P += u * dt;
    t += dt;
    samples.push({ t, v, L, P, u: uOf() });
    if (P >= breakoutDepthM) {
      end = 'breakout';
      break;
    }
  }
  return { samples, regime: rigid ? 'rigid' : end === 'stalled' ? 'stalled' : 'eroding', end };
}

/** Index of the last sample at or before time `t`. */
function lastAtOrBefore(samples: Sample[], t: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  if (t >= samples[hi].t) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The sample at time `t`, linearly interpolated between the two nearest. */
function sampleAt(samples: Sample[], t: number): Sample {
  const i = lastAtOrBefore(samples, t);
  const a = samples[i];
  const b = samples[Math.min(i + 1, samples.length - 1)];
  if (b.t <= a.t || t <= a.t) return a;
  const f = (t - a.t) / (b.t - a.t);
  return { t, v: a.v + (b.v - a.v) * f, L: a.L + (b.L - a.L) * f, P: a.P + (b.P - a.P) * f, u: a.u + (b.u - a.u) * f };
}

/** Simulates a long-rod penetrator against the plate. */
export function longRodShot(input: ArmorShot): ArmorTimeline {
  const shot = normalizeShot(input, LONG_ROD_MAX_OBLIQUITY_DEG);
  const { impact, material } = shot;
  if (impact.family !== 'apfsds') throw new Error(`longRodShot models long rods, not '${impact.family}'`);

  const { diameter: D, length: L0, mass, velocity: v0, density: rhoP } = impact;
  const tLos = losThickness(shot.thicknessM, shot.obliquityDeg);
  const breakoutAllowance = Math.min(BREAKOUT_RATIO * D, 0.5 * tLos, Math.max(0, shot.rearRoomM ?? Infinity));
  const breakoutDepth = tLos - breakoutAllowance;
  const { samples, end } = integrate(impact, material, breakoutDepth);
  const last = samples[samples.length - 1];
  const impactEnergyJ = 0.5 * mass * v0 ** 2;
  const rodRadius = D / 2;
  const area = Math.PI * rodRadius ** 2;

  const perforated = end === 'breakout';
  // After breakout the rod flies through the last bit of plate without eroding, at the speed it has.
  const vOut = perforated ? last.v : 0;
  const tBreak = last.t;
  const tExit = perforated ? tBreak + breakoutAllowance / vOut : Infinity;
  const endTime = perforated ? tExit : last.t;
  const residualLengthM = perforated ? last.L : 0;
  const residualMassKg = rhoP * area * residualLengthM;
  const residualEnergyJ = 0.5 * residualMassKg * vOut ** 2;

  // The mushroomed head's radius as the rod is eroded: D/2 growing to CRATER_DIAMETER_RATIO·D/2.
  const headRadius = (eroded: number) => rodRadius * (1 + (CRATER_DIAMETER_RATIO - 1) * Math.min(1, eroded / (MUSHROOM_ERODED_DIAMETERS * D)));
  // Radius of the crater wall at depth x: the head radius when the nose passed that depth.
  const wallRadius = (x: number) => {
    let lo = 0;
    let hi = samples.length - 1;
    if (x >= samples[hi].P) return headRadius(L0 - samples[hi].L);
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].P <= x) lo = mid;
      else hi = mid;
    }
    return headRadius(L0 - samples[lo].L);
  };
  // The mouth is flared wider than the wall by the material that flows back out of the crater.
  const profileAt = (depth: number, current: number): number[] =>
    Array.from({ length: CRATER_PROFILE_SAMPLES }, (_, i) => {
      const s = i / (CRATER_PROFILE_SAMPLES - 1);
      const wall = wallRadius(depth * s);
      return wall + (current - wall) * (1 - s) ** 3;
    });

  const rearBulge = (depth: number) => REAR_BULGE_GAIN * Math.max(0, REAR_BULGE_ONSET_RATIO * D - (tLos - depth));

  const frameAtTime = (t: number): ArmorFrame => {
    let travel: number;
    let speed: number;
    let penetrationRate: number;
    let length: number;
    let eroded: number;
    if (perforated && t >= tBreak) {
      travel = breakoutDepth + vOut * (t - tBreak);
      speed = vOut;
      penetrationRate = t < tExit ? vOut : 0;
      length = last.L;
      eroded = L0 - last.L;
    } else {
      const s = sampleAt(samples, Math.min(t, last.t));
      travel = s.P;
      speed = s.v;
      penetrationRate = t >= last.t ? 0 : s.u;
      length = s.L;
      eroded = L0 - s.L;
    }
    const depth = Math.min(tLos, travel);
    const radius = headRadius(eroded);
    return {
      t,
      depth,
      travel,
      speed,
      penetrationRate,
      craterRadius: radius,
      craterProfile: profileAt(depth, radius),
      penetratorLength: length,
      rearBulge: rearBulge(depth),
      // The impact energy not carried on by the rod has gone into the plate (and the eroded rod) as work and heat.
      energyDepositedJ: impactEnergyJ - 0.5 * rhoP * area * length * speed ** 2,
    };
  };

  const events: ArmorEvent[] = [{ t: 0, type: 'impact', depth: 0, speed: v0, label: 'Impact' }];
  if (perforated) {
    events.push({ t: tExit, type: 'perforate', depth: tLos, speed: vOut, label: 'Rod breaks through the rear face' });
  } else if (end === 'consumed') {
    events.push({ t: last.t, type: 'stop', depth: last.P, speed: 0, label: 'Rod fully eroded' });
  } else if (end === 'stalled') {
    events.push({ t: last.t, type: 'stop', depth: last.P, speed: last.v, label: 'Rod too slow to erode the plate: penetration ends' });
  } else {
    events.push({ t: last.t, type: 'stop', depth: last.P, speed: 0, label: 'Rigid rod stops in the plate' });
  }

  const duration = timelineDuration(endTime);
  const result = {
    mechanism: 'Hydrodynamic erosion' as const,
    losThicknessM: tLos,
    penetrationM: perforated ? tLos : last.P,
    perforated,
    residualVelocity: vOut,
    residualMassKg,
    shattered: false,
    fragments: 0,
    impactEnergyJ,
    residualEnergyJ,
    energy: { plateWorkJ: impactEnergyJ - residualEnergyJ, ejectaJ: 0 },
  };
  return {
    shot,
    frames: sampleFrames(duration, frameAtTime, Math.min(MAX_TIMELINE_FRAMES, TIMELINE_FRAMES)),
    events,
    result,
    duration,
  };
}
