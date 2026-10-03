/**
 * Armor lab (#162): long-rod (APFSDS) penetration by the Alekseevskii–Tate
 * erosion model. A long, dense rod hits the plate so fast that the pressure
 * at its head is far above the strength of either metal: the head mushrooms
 * and is eaten away (eroded) while it pushes the crater bottom forward, and
 * the rest of the rod behind it is slowed only by its own strength.
 *
 * The classical open-literature model, simplified for teaching
 * (Alekseevskii 1966; Tate 1967, 1969; typical rod strength Yp and target
 * resistance Rt as used in Anderson & Walker's open long-rod work and in
 * Zukas, "Impact Dynamics"). With v the rod's (tail) speed, u the speed of
 * the crater bottom (the rod–plate interface), L the rod's remaining length
 * and P the crater depth:
 * - Interface pressure balance (a modified Bernoulli equation):
 *   ½ρp(v − u)² + Yp = ½ρt·u² + Rt.
 * - The rod behind the head decelerates under its own strength:
 *   dv/dt = −Yp / (ρp·L).
 * - The head erodes at the closing speed: dL/dt = −(v − u).
 * - The crater deepens at the interface speed: dP/dt = u.
 *
 * Two special cases follow from the balance. If the rod is stronger than the
 * plate can ever push back (Yp − Rt > ½ρt·v²), it does not erode: u = v and it
 * digs as a rigid body, slowed by the plate's resistance plus the inertia of
 * the plate material it pushes aside, ρp·L·dv/dt = −(Rt + ½ρt·v²) (Tate's
 * rigid-penetration form). If the rod's head pressure cannot beat the plate
 * (½ρp·v² < Rt − Yp), the crater does not deepen: u = 0 and the rod erodes
 * against the face (dL/dt = −v) until it is used up or stops. The regime is
 * checked at every step, so a rod can switch as it slows.
 *
 * Without strength (Yp = Rt = 0) the depth is the hydrodynamic limit
 * L·√(ρp/ρt); with the plate stronger than the rod it is always less.
 *
 * The crater width, the breakout allowance at the rear face, how the
 * breakout disc's kinetic energy is paid for (out of the energy already spent
 * at the crater bottom, so the rod keeps its tail speed) and the rear bulge are illustrative lab heuristics
 * chosen for the teaching model, not figures from the cited sources.
 *
 * Impact physics only: the rod is its state at the plate (from `munitions.ts`).
 * All values are a simplified teaching model, not engineering data.
 */

import {
  MAX_TIMELINE_FRAMES,
  TIMELINE_FRAMES,
  losThickness,
  normalizeShot,
  roundBottomCraterProfile,
  roundBottomRadius,
  sampleFrames,
  timelineDuration,
  type ArmorEjecta,
  type ArmorEvent,
  type ArmorFrame,
  type ArmorMechanism,
  type ArmorShot,
  type ArmorTimeline,
} from './model';
import { PENETRATOR_YIELD, type SolidImpact } from './munitions';

/** Steepest plate slope (degrees) the long-rod model handles; steeper shots are clamped to it (ricochet and rod bending are #165). */
export const LONG_ROD_MAX_OBLIQUITY_DEG = 75;

/** Crater radius as a multiple of the rod diameter: the mushroomed head digs a crater about twice the rod's diameter (illustrative lab heuristic). */
export const CRATER_RADIUS_RATIO = 1.0;
/**
 * The last of the plate breaks out of the rear face once this many rod
 * diameters are left ahead of the crater bottom: the rear-face bulge-and-
 * breakout allowance (illustrative lab heuristic).
 */
export const BREAKOUT_RATIO = 1.0;
/** The rear face starts to bulge when the plate left ahead of the crater bottom is under this many rod diameters (illustrative lab heuristic, as #161). */
export const LONG_ROD_REAR_BULGE_ONSET_RATIO = 1.5 * BREAKOUT_RATIO;
/** Bulge height per metre the remaining plate is under the onset thickness (illustrative lab heuristic, as #161). */
export const LONG_ROD_REAR_BULGE_GAIN = 0.25;

/**
 * A rod that ends with less than this many diameters of length left counts as
 * used up: near the end of erosion the last sliver's deceleration grows
 * without bound (dv/dt = −Yp / (ρp·L)), so the model stops it with a smear of
 * rod material a few micrometres long rather than at exactly L = 0.
 */
export const ROD_CONSUMED_RATIO = 0.05;

/** Integration step, s. The equations are integrated with fourth-order Runge–Kutta; halving the step changes the depth by far under 0.5%. */
export const TATE_STEP_S = 0.1e-6;
/** Near the end of a run the step is halved at most this many times to land on the rod being used up or stopping. */
const MAX_STEP_HALVINGS = 30;

/** The Alekseevskii–Tate regime at one instant. */
export type TateRegime = 'hydrodynamic' | 'rigid' | 'no-penetration';

/** The rod as it reaches the plate. SI units. */
export interface TateRod {
  /** kg/m³ */
  density: number;
  /** Rod strength Yp, Pa. */
  yieldPa: number;
  /** m */
  length: number;
  /** m */
  diameter: number;
  /** m/s */
  velocity: number;
}

/** What the plate brings to the balance. SI units. */
export interface TateTarget {
  /** kg/m³ */
  density: number;
  /** Target resistance Rt, Pa. */
  targetResistancePa: number;
}

/** The state after one integration step. */
export interface TateSample {
  /** Time since impact, s. */
  t: number;
  /** Crater depth P, m. */
  penetration: number;
  /** Remaining rod length L, m. */
  length: number;
  /** Rod (tail) speed v, m/s. */
  velocity: number;
  /** Interface (crater-bottom) speed u, m/s. */
  interfaceSpeed: number;
  regime: TateRegime;
  /** Work done on the plate so far, J (cumulative). */
  plateWorkJ: number;
  /** Kinetic energy carried off by eroded rod material so far, J (cumulative). */
  erodedRodJ: number;
}

export type TateOutcome = 'breakout' | 'rod-consumed' | 'stopped';

export interface TatePenetration {
  /** Every integration step from impact (index 0) to the end of the run. */
  samples: TateSample[];
  /** How the run ended: the rear face broke out, the rod was used up (under `ROD_CONSUMED_RATIO` diameters left), or it stopped with more left. */
  outcome: TateOutcome;
  /** Crater depth at the end, m (at breakout, the depth it broke out at). */
  penetrationM: number;
  /** Rod length left at the end, m. */
  residualLengthM: number;
  /** Rod (tail) speed at the end, m/s (0 when stopped). */
  residualVelocity: number;
  /** Time the run ended, s. */
  endTime: number;
  /** The regime at impact. */
  impactRegime: TateRegime;
  /** Crater depth dug in each regime, m. */
  regimePenetrationM: Record<TateRegime, number>;
  /** Work done on the plate, J: the rod's kinetic-energy loss less what the eroded material carried off. */
  plateWorkJ: number;
  /** Kinetic energy of the eroded rod material, J. */
  erodedRodJ: number;
  /** L·√(ρp/ρt), m: the depth with no strength on either side. */
  hydrodynamicLimitM: number;
}

/** The hydrodynamic (density-law) limit, m: how deep a rod of length L goes with no strength on either side, L·√(ρp/ρt). */
export function hydrodynamicLimit(length: number, rodDensity: number, targetDensity: number): number {
  return length * Math.sqrt(rodDensity / targetDensity);
}

/** Which regime the interface is in at rod speed v. */
export function tateRegime(rod: Pick<TateRod, 'density' | 'yieldPa'>, target: TateTarget, v: number): TateRegime {
  const { density: rp, yieldPa: Yp } = rod;
  const { density: rt, targetResistancePa: Rt } = target;
  if (Yp - Rt > 0.5 * rt * v * v) return 'rigid';
  if (0.5 * rp * v * v < Rt - Yp) return 'no-penetration';
  return 'hydrodynamic';
}

/**
 * Interface speed u, m/s, at rod speed v: the root of
 * ½ρp(v − u)² + Yp = ½ρt·u² + Rt with 0 ≤ u ≤ v (v for a rigid rod, 0 when
 * the rod cannot dig). Written as ½(ρp − ρt)u² − ρp·v·u + ½ρp·v² + Yp − Rt = 0,
 * the physical root is u = 2c / (ρp·v + √(ρp²v² − 4ac)) with
 * a = ½(ρp − ρt) and c = ½ρp·v² + Yp − Rt: the "minus" root of the quadratic
 * in a form that stays finite as ρp → ρt, where it becomes the linear
 * solution u = c / (ρp·v).
 */
export function interfaceSpeed(rod: Pick<TateRod, 'density' | 'yieldPa'>, target: TateTarget, v: number): number {
  const regime = tateRegime(rod, target, v);
  if (regime === 'rigid') return v;
  if (regime === 'no-penetration' || v <= 0) return 0;
  const { density: rp, yieldPa: Yp } = rod;
  const { density: rt, targetResistancePa: Rt } = target;
  const c = 0.5 * rp * v * v + Yp - Rt;
  if (rp === rt) return Math.min(v, Math.max(0, c / (rp * v)));
  const a = 0.5 * (rp - rt);
  const disc = rp * rp * v * v - 4 * a * c;
  return Math.min(v, Math.max(0, (2 * c) / (rp * v + Math.sqrt(Math.max(0, disc)))));
}

interface State {
  P: number;
  L: number;
  v: number;
}

/**
 * Integrates the Alekseevskii–Tate equations for a rod into a plate whose
 * line-of-sight thickness is `losThicknessM` (Infinity for a semi-infinite
 * block). The run ends when the rod is used up (L reaches 0), stops (v
 * reaches 0), or the crater gets within `BREAKOUT_RATIO` rod diameters of the
 * rear face while the rod is still digging (the plate breaks out; a plate
 * thinner than that breaks out at impact).
 *
 * Energy is tracked exactly at every step: the eroded slice dm carries
 * ½·dm·v̄² (v̄ the step's mean rod speed), and the rest of the rod's
 * kinetic-energy loss is work done on the plate.
 */
export function tatePenetration(rod: TateRod, target: TateTarget, losThicknessM: number, stepS = TATE_STEP_S): TatePenetration {
  const { density: rp, yieldPa: Yp, length: L0, diameter: D, velocity: v0 } = rod;
  const { density: rt, targetResistancePa: Rt } = target;
  for (const [name, value] of Object.entries({ density: rp, yieldPa: Yp, length: L0, diameter: D, velocity: v0, targetDensity: rt, targetResistance: Rt })) {
    if (!(Number.isFinite(value) && value >= 0)) throw new Error(`Long rod: ${name} must be a non-negative number, got ${value}`);
  }
  if (!(L0 > 0 && D > 0 && v0 > 0 && rp > 0 && rt > 0)) throw new Error('Long rod: length, diameter, speed and densities must be positive');
  if (!(losThicknessM > 0)) throw new Error(`Long rod: plate thickness must be positive, got ${losThicknessM}`);
  if (!(stepS > 0)) throw new Error(`Long rod: step must be positive, got ${stepS}`);

  const area = Math.PI * (D / 2) ** 2;
  const breakoutDepth = Math.max(0, losThicknessM - BREAKOUT_RATIO * D);
  const regimeAt = (v: number) => tateRegime(rod, target, v);

  // dP/dt, dL/dt, dv/dt in the regime that holds at speed v.
  const deriv = (s: State): State => {
    const regime = regimeAt(s.v);
    const L = Math.max(s.L, 1e-12);
    if (regime === 'rigid') return { P: s.v, L: 0, v: -(Rt + 0.5 * rt * s.v * s.v) / (rp * L) };
    const u = interfaceSpeed(rod, target, s.v);
    return { P: u, L: -(s.v - u), v: -Yp / (rp * L) };
  };
  const rk4 = (s: State, h: number): State => {
    const add = (a: State, k: State, f: number): State => ({ P: a.P + f * k.P, L: a.L + f * k.L, v: a.v + f * k.v });
    const k1 = deriv(s);
    const k2 = deriv(add(s, k1, h / 2));
    const k3 = deriv(add(s, k2, h / 2));
    const k4 = deriv(add(s, k3, h));
    return {
      P: s.P + (h / 6) * (k1.P + 2 * k2.P + 2 * k3.P + k4.P),
      L: s.L + (h / 6) * (k1.L + 2 * k2.L + 2 * k3.L + k4.L),
      v: s.v + (h / 6) * (k1.v + 2 * k2.v + 2 * k3.v + k4.v),
    };
  };

  const impactRegime = regimeAt(v0);
  const regimePenetrationM: Record<TateRegime, number> = { hydrodynamic: 0, rigid: 0, 'no-penetration': 0 };
  let plateWorkJ = 0;
  let erodedRodJ = 0;
  let t = 0;
  let s: State = { P: 0, L: L0, v: v0 };
  const sampleOf = (): TateSample => {
    const u = interfaceSpeed(rod, target, s.v);
    return { t, penetration: s.P, length: s.L, velocity: s.v, interfaceSpeed: u, regime: regimeAt(s.v), plateWorkJ, erodedRodJ };
  };
  const samples: TateSample[] = [sampleOf()];

  // Moves the run on to state `next`, `h` later, booking the energy and the depth dug.
  const advance = (next: State, h: number) => {
    const dm = rp * area * (s.L - next.L);
    const meanV = 0.5 * (s.v + next.v);
    const eroded = 0.5 * dm * meanV * meanV;
    const keLoss = 0.5 * rp * area * (s.L * s.v * s.v - next.L * next.v * next.v);
    erodedRodJ += eroded;
    plateWorkJ += keLoss - eroded;
    regimePenetrationM[regimeAt(s.v)] += next.P - s.P;
    t += h;
    s = next;
    samples.push(sampleOf());
  };

  let outcome: TateOutcome;
  if (breakoutDepth <= 0) {
    // A plate thinner than the breakout allowance breaks out at impact.
    outcome = 'breakout';
  } else {
    // A generous cap on the number of steps: far more than the slowest rod in the lab needs.
    const maxSteps = Math.ceil((40 * L0) / (v0 * stepS)) + 100_000;
    outcome = 'stopped';
    for (let n = 0; ; n++) {
      if (n > maxSteps) throw new Error('Long rod: integration did not finish');
      let h = stepS;
      let next = rk4(s, h);
      let halvings = 0;
      const ok = (x: State) => Number.isFinite(x.P) && Number.isFinite(x.v) && Number.isFinite(x.L) && x.L > 0 && x.v > 0;
      while (!ok(next) && halvings < MAX_STEP_HALVINGS) {
        h /= 2;
        halvings++;
        next = rk4(s, h);
      }
      if (!ok(next)) {
        // Within a hair of the end: finish the step to the rod being used up, or to it stopping.
        const u = interfaceSpeed(rod, target, s.v);
        if (!(next.L > 0) || s.L < s.v * h) {
          advance({ P: s.P + u * h, L: 0, v: s.v }, h);
          outcome = 'rod-consumed';
        } else {
          // The last of its speed goes as plate work, so the budget closes exactly.
          advance({ P: s.P + u * h, L: s.L, v: 0 }, h);
          outcome = 'stopped';
        }
        break;
      }
      if (next.P >= breakoutDepth) {
        // The crater reaches the breakout depth inside this step: land on it exactly.
        const f = next.P > s.P ? (breakoutDepth - s.P) / (next.P - s.P) : 1;
        advance({ P: breakoutDepth, L: s.L + f * (next.L - s.L), v: s.v + f * (next.v - s.v) }, f * h);
        outcome = 'breakout';
        break;
      }
      advance(next, h);
    }
    if (outcome === 'stopped' && s.L <= ROD_CONSUMED_RATIO * D) outcome = 'rod-consumed';
  }
  return {
    samples,
    outcome,
    penetrationM: s.P,
    residualLengthM: s.L,
    residualVelocity: outcome === 'stopped' ? 0 : s.v,
    endTime: t,
    impactRegime,
    regimePenetrationM,
    plateWorkJ,
    erodedRodJ,
    hydrodynamicLimitM: hydrodynamicLimit(L0, rp, rt),
  };
}

const MECHANISM: Record<TateRegime, ArmorMechanism> = {
  hydrodynamic: 'Hydrodynamic erosion',
  rigid: 'Rigid-rod penetration',
  'no-penetration': 'No penetration (rod erodes at the face)',
};

/** The regime that dug the most crater (the regime at impact when none dug any). */
function dominantRegime(run: TatePenetration): TateRegime {
  let best: TateRegime = run.impactRegime;
  let bestDepth = 0;
  for (const regime of ['hydrodynamic', 'rigid', 'no-penetration'] as const) {
    if (run.regimePenetrationM[regime] > bestDepth) {
      best = regime;
      bestDepth = run.regimePenetrationM[regime];
    }
  }
  return best;
}

const REGIME_EVENT_LABEL: Record<'rigid' | 'no-penetration', { atImpact: string; later: string }> = {
  rigid: { atImpact: 'Rod digs as a rigid body, without eroding', later: 'Rod stops eroding and digs on as a rigid body' },
  'no-penetration': { atImpact: 'Rod erodes at the face without digging', later: 'Crater stops deepening; the rod erodes against its floor' },
};

/** Simulates an APFSDS long rod against the plate. */
export function longRodShot(input: ArmorShot): ArmorTimeline {
  const shot = normalizeShot(input, LONG_ROD_MAX_OBLIQUITY_DEG);
  const { impact, material } = shot;
  if (impact.family !== 'apfsds') throw new Error(`longRodShot models APFSDS long rods, not '${impact.family}'`);
  const rodImpact = impact as SolidImpact;
  const { diameter: D, length: L0, velocity: v0, density: rp } = rodImpact;
  const rod: TateRod = { density: rp, yieldPa: PENETRATOR_YIELD[rodImpact.material], length: L0, diameter: D, velocity: v0 };
  const tLos = losThickness(shot.thicknessM, shot.obliquityDeg);
  const run = tatePenetration(rod, material, tLos);
  const { samples } = run;
  const area = Math.PI * (D / 2) ** 2;
  const massOf = (length: number) => rp * area * length;
  const impactEnergyJ = 0.5 * massOf(L0) * v0 ** 2;
  const craterRadius = CRATER_RADIUS_RATIO * D;

  const perforated = run.outcome === 'breakout';
  const tTate = run.endTime;
  const xBreak = run.penetrationM;
  let plateWorkJ = run.plateWorkJ;
  let erodedRodJ = run.erodedRodJ;
  let ejectaJ = 0;
  let vResidual = 0;
  let residualLength = 0;
  let plug: ArmorEjecta | undefined;
  let tExit = Infinity;
  if (perforated) {
    // The last of the plate breaks out as a disc as wide as the crater and flies off with the rod at the rod's tail
    // speed, which is the residual velocity. The disc's kinetic energy is paid for by the impact energy already spent
    // at the crater bottom: first out of the eroded rod material's (the eroding head is what pushes the plate ahead of
    // it), then out of plate work. Only when the plate is so thin that both together cannot cover it (a plate about
    // two rod diameters thick or less) does the rod pay the rest: rod and disc then leave at the common speed that
    // closes the budget, ½(m_rod + m_disc)·v_r² = ½·m_rod·v² + E_eroded + W_plate (lab heuristic).
    residualLength = run.residualLengthM;
    const mRod = massOf(residualLength);
    const vTail = run.residualVelocity;
    const thicknessM = tLos - xBreak;
    const massKg = material.density * Math.PI * craterRadius ** 2 * thicknessM;
    const discJ = 0.5 * massKg * vTail ** 2;
    if (run.erodedRodJ + run.plateWorkJ >= discJ) {
      vResidual = vTail;
      const fromEroded = Math.min(run.erodedRodJ, discJ);
      erodedRodJ = run.erodedRodJ - fromEroded;
      plateWorkJ = run.plateWorkJ - (discJ - fromEroded);
    } else {
      vResidual = Math.sqrt((mRod * vTail ** 2 + 2 * (run.erodedRodJ + run.plateWorkJ)) / (mRod + massKg));
      erodedRodJ = 0;
      plateWorkJ = 0;
    }
    plug = { massKg, velocity: vResidual, thicknessM, diameterM: 2 * craterRadius };
    ejectaJ = 0.5 * massKg * vResidual ** 2;
    tExit = tTate + thicknessM / vResidual;
  }
  // Share of the work done during the dig that stays in the plate (the rest leaves with the breakout disc).
  const keptShare = run.plateWorkJ > 0 ? plateWorkJ / run.plateWorkJ : 1;
  const residualMassKg = perforated ? massOf(residualLength) : 0;
  const residualEnergyJ = 0.5 * residualMassKg * vResidual ** 2;
  const endTime = perforated ? tExit : tTate;

  // Rear-face bulge: grows once the plate ahead of the crater bottom is under LONG_ROD_REAR_BULGE_ONSET_RATIO rod
  // diameters, and freezes at breakout (after that the disc moves out rather than the face bulging).
  const rearBulge = (depth: number) => {
    const remaining = tLos - (perforated ? Math.min(depth, xBreak) : depth);
    return LONG_ROD_REAR_BULGE_GAIN * Math.max(0, LONG_ROD_REAR_BULGE_ONSET_RATIO * D - remaining);
  };

  // The integration history, linearly interpolated in time.
  const sampleAt = (t: number) => {
    if (t >= tTate) return { a: samples[samples.length - 1], b: samples[samples.length - 1], f: 0 };
    let lo = 0;
    let hi = samples.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = samples[lo];
    const b = samples[hi];
    return { a, b, f: b.t > a.t ? (t - a.t) / (b.t - a.t) : 0 };
  };
  const lerp = (x: number, y: number, f: number) => x + (y - x) * f;

  const frameAtTime = (t: number): ArmorFrame => {
    let travel: number;
    let speed: number;
    let penetrationRate: number;
    let penetratorLength: number;
    let energyDepositedJ: number;
    if (perforated && t >= tTate) {
      // Rod and disc move on together at v_r; the rod leaves the plate at tExit.
      travel = xBreak + vResidual * (t - tTate);
      speed = vResidual;
      penetrationRate = t < tExit ? vResidual : 0;
      penetratorLength = residualLength;
      energyDepositedJ = plateWorkJ;
    } else if (!perforated && t >= tTate) {
      const last = samples[samples.length - 1];
      travel = last.penetration;
      speed = 0;
      penetrationRate = 0;
      penetratorLength = last.length;
      energyDepositedJ = plateWorkJ;
    } else {
      const { a, b, f } = sampleAt(t);
      travel = lerp(a.penetration, b.penetration, f);
      speed = lerp(a.velocity, b.velocity, f);
      penetrationRate = Math.min(speed, lerp(a.interfaceSpeed, b.interfaceSpeed, f));
      penetratorLength = lerp(a.length, b.length, f);
      energyDepositedJ = keptShare * lerp(a.plateWorkJ, b.plateWorkJ, f);
    }
    const depth = Math.min(tLos, travel);
    const through = perforated && t >= tExit;
    return {
      t,
      depth,
      travel,
      speed,
      penetrationRate,
      craterRadius: through ? craterRadius : roundBottomRadius(depth, craterRadius),
      craterProfile: roundBottomCraterProfile(depth, craterRadius, through),
      penetratorLength,
      rearBulge: rearBulge(depth),
      energyDepositedJ,
    };
  };

  const events: ArmorEvent[] = [{ t: 0, type: 'impact', depth: 0, speed: v0, label: 'Impact' }];
  // Regime changes: at impact when the rod does not start out eroding, and whenever it switches as it slows.
  // A switch to no penetration part-way through is its own event type ('crater-stalls'), so it is not mistaken for
  // the 'No penetration' outcome of a rod that never dug.
  let previous: TateRegime = 'hydrodynamic';
  for (const sample of samples) {
    if (sample.regime !== previous && sample.regime !== 'hydrodynamic' && sample.velocity > 0) {
      const labels = REGIME_EVENT_LABEL[sample.regime];
      const atImpact = sample.t === 0;
      const type = sample.regime === 'no-penetration' && !atImpact ? 'crater-stalls' : sample.regime;
      events.push({ t: sample.t, type, depth: sample.penetration, speed: sample.velocity, label: atImpact ? labels.atImpact : labels.later });
    }
    previous = sample.regime;
  }
  if (perforated) {
    events.push({ t: tTate, type: 'breakout', depth: xBreak, speed: run.residualVelocity, label: 'Rear face breaks out' });
    events.push({ t: tExit, type: 'perforate', depth: tLos, speed: vResidual, label: 'Rod exits behind the plate' });
  } else if (run.outcome === 'rod-consumed') {
    events.push({ t: tTate, type: 'rod-consumed', depth: run.penetrationM, speed: 0, label: 'Rod consumed' });
  } else {
    const label = run.penetrationM > 0 ? 'Rod stops in the plate' : 'Rod stops at the face';
    events.push({ t: tTate, type: 'stop', depth: run.penetrationM, speed: 0, label });
  }

  const duration = timelineDuration(endTime);
  // A rod that only just breaks out crawls out slowly; sample more frames then so the dig stays visible.
  const frameCount = Math.min(MAX_TIMELINE_FRAMES, Math.max(TIMELINE_FRAMES, Math.ceil((TIMELINE_FRAMES * duration) / timelineDuration(tTate))));
  return {
    shot,
    frames: sampleFrames(duration, frameAtTime, frameCount),
    events,
    result: {
      mechanism: MECHANISM[dominantRegime(run)],
      losThicknessM: tLos,
      penetrationM: perforated ? tLos : run.penetrationM,
      perforated,
      residualVelocity: vResidual,
      residualMassKg,
      plug,
      shattered: false,
      fragments: 0,
      impactEnergyJ,
      residualEnergyJ,
      energy: { plateWorkJ, ejectaJ, erodedRodJ },
    },
    duration,
  };
}
