/**
 * Armor lab (#163): a shaped-charge jet against plate. A HEAT warhead fires a
 * thin copper jet at several km/s. At those pressures the plate behaves like
 * a fluid whatever its strength, so the jet penetrates hydrodynamically.
 *
 * The model is the classical density law (Birkhoff, MacDougall, Pugh &
 * Taylor 1948; see Walters & Zukas, "Fundamentals of Shaped Charges", and
 * Zukas, "Impact Dynamics"). Where the jet meets the plate the pressures on
 * both sides are equal, so with the jet at speed v and the crater bottom at u:
 *
 *   ½ρj(v − u)² = ½ρt·u²   →   u = v / (1 + γ),   γ = √(ρt/ρj)
 *
 * and each length dℓ of jet consumed digs dP = dℓ·√(ρj/ρt) = dℓ/γ, so a jet
 * of effective length L reaches P = L·√(ρj/ρt). The catalogue sets L so that
 * copper into RHA gives about six cone diameters; other plates scale by
 * √(ρj/ρt).
 *
 * The jet has a velocity gradient from its tip to its tail, v(ℓ) falling
 * linearly with the length ℓ consumed. Slower elements arrive later, so the
 * crater-bottom speed u falls as it digs. In closed form (no integration):
 *
 *   dt = dℓ (1 + γ) / (γ·v(ℓ))   →   t(ℓ) = ((1 + γ)/γ)·(L/Δv)·ln(v_tip / v(ℓ))
 *
 * so v(t) = v_tip · e^(−t/K) with K = ((1 + γ)/γ)·L/Δv, ℓ(t) = L (v_tip − v)/Δv
 * and P = ℓ/γ. The jet is a lab simplification: no standoff, stretching or
 * particulation is simulated (they are only drawn), and the plate's strength
 * is ignored. The last `SLUG_FRACTION` of the jet length is the slow tail
 * "slug", which is too slow to dig and lodges in the hole.
 *
 * The hole profile, the debris cone and the unfuzed skid are illustrative
 * lab heuristics.
 *
 * Impact physics only. All values are a simplified teaching model, not
 * engineering data.
 */

import {
  CRATER_PROFILE_SAMPLES,
  TIMELINE_FRAMES,
  losThickness,
  normalizeShot,
  sampleFrames,
  timelineDuration,
  type ArmorDebris,
  type ArmorEvent,
  type ArmorFrame,
  type ArmorShot,
  type ArmorTimeline,
} from './model';
import type { PlateMaterial } from './materials';
import type { JetImpact } from './munitions';

/** Above this slope (degrees) a shaped-charge round fails to fuze and skids off the plate. */
export const FUZE_FAIL_OBLIQUITY_DEG = 80;

/** The slow tail of the jet that does not dig but lodges in the hole, as a fraction of the effective length. */
export const SLUG_FRACTION = 0.05;

/** Hole diameter at the plate face and deep in the hole, as multiples of the cone diameter. */
export const HOLE_ENTRY_DIAMETER_RATIO = 0.25;
export const HOLE_DEEP_DIAMETER_RATIO = 0.1;

/** Half-angle of the cone of debris behind a perforated plate, degrees. */
export const DEBRIS_HALF_ANGLE_DEG = 30;
/** Spall knocked off the rear face is a disc this many hole radii wide... */
export const SPALL_RADIUS_RATIO = 3;
/** ...and this many hole radii thick (or the plate's thickness, if less). */
export const SPALL_THICKNESS_RATIO = 4;
/** The spall leaves at this fraction of the jet's speed. */
export const SPALL_SPEED_FRACTION = 0.1;

/** γ = √(ρt/ρj): how much denser the plate is than the jet, as the density law uses it. */
export function densityRatio(jetDensity: number, plateDensity: number): number {
  return Math.sqrt(plateDensity / jetDensity);
}

/** Speed of the crater bottom, u = v / (1 + γ), for a jet element at speed v (m/s). */
export function jetPenetrationSpeed(v: number, jetDensity: number, plateDensity: number): number {
  return v / (1 + densityRatio(jetDensity, plateDensity));
}

/** The density-law penetration of a jet of length L (m): L·√(ρj/ρt). */
export function jetPenetration(jetLengthM: number, jetDensity: number, plateDensity: number): number {
  return jetLengthM * Math.sqrt(jetDensity / plateDensity);
}

/** How deep the jet digs in a plate too thick to perforate: the density law on all of it but the slug. */
export function jetReach(impact: JetImpact, material: PlateMaterial): number {
  return jetPenetration((1 - SLUG_FRACTION) * impact.jetLength, impact.density, material.density);
}

/** Simulates a shaped-charge jet against the plate. */
export function jetShot(input: ArmorShot): ArmorTimeline {
  const shot = normalizeShot(input);
  const { impact, material } = shot;
  if (impact.family !== 'heat') throw new Error(`jetShot models shaped-charge jets, not '${impact.family}'`);

  const { coneDiameter: Dc, jetTipVelocity: vTip, jetTailVelocity: vTail, jetLength: L, jetDiameter, density: rhoJ } = impact;
  const dv = vTip - vTail;
  const area = Math.PI * (jetDiameter / 2) ** 2;
  const tLos = losThickness(shot.thicknessM, shot.obliquityDeg);
  const gamma = densityRatio(rhoJ, material.density);
  // Jet kinetic energy of the length from ℓ1 to ℓ2 (jet speeds v1 > v2): ½ρA ∫ v² dℓ = ½ρA · (L/Δv) · (v1³ − v2³) / 3.
  const jetEnergy = (v1: number, v2: number) => 0.5 * rhoJ * area * ((L / dv) * (v1 ** 3 - v2 ** 3)) / 3;
  const impactEnergyJ = jetEnergy(vTip, vTail);
  const speedAt = (ell: number) => vTip - (dv * ell) / L;

  const holeEntryRadius = (HOLE_ENTRY_DIAMETER_RATIO * Dc) / 2;
  const holeDeepRadius = (HOLE_DEEP_DIAMETER_RATIO * Dc) / 2;

  // Too steep to fuze: the round skids off the plate and the jet never forms.
  if (shot.obliquityDeg > FUZE_FAIL_OBLIQUITY_DEG) {
    const duration = timelineDuration(0);
    const frame = (t: number): ArmorFrame => ({
      t,
      depth: 0,
      travel: 0,
      speed: 0,
      penetrationRate: 0,
      craterRadius: 0,
      penetratorLength: L,
      rearBulge: 0,
      energyDepositedJ: 0,
    });
    return {
      shot,
      frames: sampleFrames(duration, frame),
      events: [
        { t: 0, type: 'impact', depth: 0, speed: impact.velocity, label: 'Impact' },
        { t: 0, type: 'skid', depth: 0, speed: impact.velocity, label: 'Too steep to fuze: the round skids off' },
      ],
      result: {
        mechanism: 'Jet penetration',
        losThicknessM: tLos,
        penetrationM: 0,
        perforated: false,
        residualVelocity: 0,
        residualMassKg: 0,
        shattered: false,
        fragments: 0,
        impactEnergyJ: 0,
        residualEnergyJ: 0,
        energy: { plateWorkJ: 0, ejectaJ: 0 },
        failedToFuze: true,
      },
      duration,
    };
  }

  const reach = jetReach(impact, material);
  const perforated = tLos <= reach;
  // Length of jet consumed when the digging ends: at the rear face, or when only the slug is left.
  const ellEnd = perforated ? gamma * tLos : (1 - SLUG_FRACTION) * L;
  const vEnd = speedAt(ellEnd);
  const K = ((1 + gamma) / gamma) * (L / dv);
  const timeAt = (v: number) => K * Math.log(vTip / v);
  const tEnd = timeAt(vEnd);

  // Behind the plate: what is left of the jet flies on at its own speeds, with plate spall thrown ahead of it.
  const residualLengthM = perforated ? L - ellEnd : 0;
  const residualMassKg = rhoJ * area * residualLengthM;
  const residualEnergyJ = perforated ? jetEnergy(vEnd, vTail) : 0;
  let debris: ArmorDebris | undefined;
  let ejectaJ = 0;
  if (perforated) {
    const spallVelocity = SPALL_SPEED_FRACTION * vEnd;
    const spallRadius = SPALL_RADIUS_RATIO * holeDeepRadius;
    const spallThickness = Math.min(SPALL_THICKNESS_RATIO * holeDeepRadius, tLos);
    const spallMassKg = material.density * Math.PI * spallRadius ** 2 * spallThickness;
    ejectaJ = 0.5 * spallMassKg * spallVelocity ** 2;
    debris = {
      halfAngleDeg: DEBRIS_HALF_ANGLE_DEG,
      jetParticles: { massKg: residualMassKg, velocity: vEnd },
      spall: { massKg: spallMassKg, velocity: spallVelocity },
    };
  }
  const plateWorkJ = impactEnergyJ - residualEnergyJ - ejectaJ;

  // Hole radius at depth x: narrow and deep, tapering from the entry to the deep size over the jet's full reach in this plate.
  const taperDepth = jetPenetration(L, rhoJ, material.density);
  const holeRadius = (x: number) => holeEntryRadius + (holeDeepRadius - holeEntryRadius) * Math.min(1, x / taperDepth);
  const profile = (depth: number): number[] =>
    Array.from({ length: CRATER_PROFILE_SAMPLES }, (_, i) => holeRadius((depth * i) / (CRATER_PROFILE_SAMPLES - 1)));
  // The rear face bulges as the jet gets near it, like the other models, but only by a hole's width.
  const rearBulge = (depth: number) => Math.max(0, 1 - (tLos - depth) / (4 * holeEntryRadius)) * holeEntryRadius;

  const frameAtTime = (t: number): ArmorFrame => {
    if (t >= tEnd) {
      const travel = perforated ? tLos + vEnd * (t - tEnd) : ellEnd / gamma;
      const depth = Math.min(tLos, travel);
      return {
        t,
        depth,
        travel,
        speed: perforated ? vEnd : 0,
        penetrationRate: 0,
        craterRadius: holeEntryRadius,
        craterProfile: profile(depth),
        // The slug lodges in the hole; a perforating jet flies on with what is left.
        penetratorLength: perforated ? residualLengthM : SLUG_FRACTION * L,
        rearBulge: perforated ? 0 : rearBulge(depth),
        energyDepositedJ: plateWorkJ,
      };
    }
    const v = vTip * Math.exp(-t / K);
    const ell = (L * (vTip - v)) / dv;
    const depth = ell / gamma;
    return {
      t,
      depth,
      travel: depth,
      speed: v,
      penetrationRate: jetPenetrationSpeed(v, rhoJ, material.density),
      craterRadius: holeEntryRadius,
      craterProfile: profile(depth),
      penetratorLength: L - ell,
      rearBulge: rearBulge(depth),
      energyDepositedJ: jetEnergy(vTip, v),
    };
  };

  const events: ArmorEvent[] = [{ t: 0, type: 'impact', depth: 0, speed: vTip, label: 'Jet tip hits the plate' }];
  if (perforated) events.push({ t: tEnd, type: 'perforate', depth: tLos, speed: vEnd, label: 'Jet breaks through, debris sprays behind the plate' });
  else events.push({ t: tEnd, type: 'stop', depth: ellEnd / gamma, speed: 0, label: 'Jet used up: the slow tail slug lodges in the hole' });

  // Show the jet's dig at full detail, and give a perforating jet a little of its flight behind the plate.
  const duration = timelineDuration(tEnd);
  return {
    shot,
    frames: sampleFrames(duration, frameAtTime, TIMELINE_FRAMES),
    events,
    result: {
      mechanism: 'Jet penetration',
      losThicknessM: tLos,
      penetrationM: perforated ? tLos : ellEnd / gamma,
      perforated,
      residualVelocity: perforated ? vEnd : 0,
      residualMassKg,
      shattered: false,
      fragments: 0,
      impactEnergyJ,
      residualEnergyJ,
      energy: { plateWorkJ, ejectaJ },
      debris,
    },
    duration,
  };
}
