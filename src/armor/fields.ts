/**
 * Armor lab (#166): the fields painted on the cross-section: temperature,
 * stress against yield, pressure wave, and the energy account. They are
 * analytic teaching approximations driven by a penetration timeline, not a
 * finite-element solve, and the UI says so. Each one is a pure function of a
 * point in the plate and a time, so the renderer can colour the metal at any
 * instant and playback can scrub.
 *
 * Coordinates are those of the cross-section: x along the shot line from the
 * plate's front face (0 to the line-of-sight thickness), y across it, from the
 * shot line, metres. Values come back in real units (°C, a ratio, GPa, J).
 *
 * The shapes follow the usual open picture of a penetration event:
 * - temperature: plastic work heats the metal round the crater wall, falling
 *   off exponentially with distance and spreading slowly by conduction; a
 *   sheared plug leaves a thin adiabatic shear band round its edge; the metal
 *   at a jet's or rod's interface can melt;
 * - stress: highest at the penetrator's nose, about the target resistance over
 *   yield (Rt / Y), falling with distance; a ratio of 1 or more is the plastic
 *   zone;
 * - pressure: a compression front spreading from the impact at the plate's
 *   sound speed, falling with distance, reflecting off the rear face as
 *   tension (stress-wave rounds use the HESH model's own planar pulse);
 * - energy: remaining kinetic energy, plastic work, heat, thrown metal and the
 *   penetrator that gets through, which add up to the impact energy.
 * The constants are illustrative lab values, not measured data.
 */

import { frameAt, type ArmorFrame, type ArmorTimeline } from './model';
import type { PlateMaterial } from './materials';
import { netStress, patchRadius, pulseLength, rearStress } from './hesh';

export type FieldKind = 'temperature' | 'stress' | 'pressure';

/** Starting temperature of the plate, °C. */
export const AMBIENT_C = 20;
/** Share of the plastic work that turns to heat (Taylor-Quinney); the rest is stored in the metal. */
export const HEAT_FRACTION = 0.9;
/** Width of the hot zone round the crater wall, as a multiple of the crater radius (e-folding distance). */
export const HEAT_ZONE_RADII = 0.6;
/** Thermal diffusivity is conductivity over density times specific heat; this scales conduction so it is visible over the playback window. */
export const CONDUCTION_GAIN = 1;
/** A sheared plug's shear band: the rise in temperature as a share of the way from ambient to melting, and its width as a share of the hole radius. */
export const SHEAR_BAND_RISE = 0.55;
export const SHEAR_BAND_WIDTH_RATIO = 0.12;
/** Metal within this many hot-zone widths of the crater wall at a jet's or rod's interface can melt. */
export const MOLTEN_INTERFACE_ZONES = 0.35;
/** Hydrodynamic flow concentrates the dissipation at a jet's or rod's interface: the rise there is this many times the zone average. */
export const INTERFACE_HEAT_BOOST = 2.5;
/** The most a molten interface can be superheated above melting, °C. */
export const MOLTEN_SUPERHEAT_C = 400;

/** Pressure pulse behind the wave front: its length as a multiple of the penetrator's diameter, and the share of the pulse the leading edge takes to rise. */
export const PULSE_DIAMETER_RATIO = 4;
export const PULSE_RISE_FRACTION = 0.1;
/** The stress at the nose reaches its full value once the penetrator moves faster than this share of its peak penetration rate. */
export const LOAD_RATE_SHARE = 0.05;
/** The pressure pulse is never longer than this share of the plate's line-of-sight thickness. */
export const PULSE_MAX_PLATE_FRACTION = 0.25;
/** The initial pressure is the plate's impedance times half the impact speed (a matched-impedance estimate), at most this many times Rt. */
export const MAX_PRESSURE_RT = 3;
/** The stress-wave pulse spreads sideways at this slope as it crosses the plate (tangent of the spread angle). */
export const WAVE_SPREAD_SLOPE = 0.6;
/** The stress-wave pulse's sharp front is smoothed over this share of its length. */
export const WAVE_FRONT_RAMP = 0.05;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const smoothstep = (v: number) => {
  const x = clamp(v, 0, 1);
  return x * x * (3 - 2 * x);
};

/** What a field needs to know about one instant of a timeline. */
export interface FieldContext {
  timeline: ArmorTimeline;
  /** Time since impact, s. */
  t: number;
  frame: ArmorFrame;
  material: PlateMaterial;
  /** Line-of-sight thickness, m. */
  tLos: number;
}

/** The context for time `t` (s, clamped to the timeline's frames). */
export function fieldContext(timeline: ArmorTimeline, t: number): FieldContext {
  return { timeline, t, frame: frameAt(timeline, t), material: timeline.shot.material, tLos: timeline.result.losThicknessM };
}

/** The crater's radius at depth x along the shot line (m), 0 below the crater bottom. */
export function craterRadiusAt(frame: ArmorFrame, x: number): number {
  if (x < 0 || x > frame.depth) return 0;
  const profile = frame.craterProfile;
  if (!profile || profile.length < 2 || frame.depth <= 0) return frame.craterRadius;
  const f = (x / frame.depth) * (profile.length - 1);
  const i = Math.min(profile.length - 2, Math.floor(f));
  return profile[i] + (profile[i + 1] - profile[i]) * (f - i);
}

/** How far a point is from the crater (m): 0 inside it, the straight distance to its wall or round its bottom outside. */
export function distanceToCrater(frame: ArmorFrame, x: number, y: number): number {
  const ay = Math.abs(y);
  if (x <= frame.depth) return Math.max(0, ay - craterRadiusAt(frame, x));
  const bottom = frame.craterProfile && frame.craterProfile.length ? frame.craterProfile[frame.craterProfile.length - 1] : frame.craterRadius;
  return Math.max(0, Math.hypot(x - frame.depth, ay) - bottom);
}

/** The radius that sets the size of the hot zone and the stress falloff: the crater's mouth, or the contact patch of a stress-wave round. */
function zoneRadius(frame: ArmorFrame): number {
  return Math.max(frame.craterRadius, 5e-4);
}

/** Whether the penetrator at the crater bottom flows like a fluid (a jet or a long rod), so the interface can melt. */
function hasFluidInterface(timeline: ArmorTimeline): boolean {
  const family = timeline.shot.impact.family;
  return family === 'heat' || family === 'apfsds';
}

/** Whether a stress-wave model (HESH) made this timeline: its frames carry the wave front. */
function isStressWave(timeline: ArmorTimeline): boolean {
  return timeline.frames[0]?.waveFrontM !== undefined;
}

export interface TemperatureSample {
  /** °C. */
  valueC: number;
  /** In the molten interface of a jet or rod: the metal there can be above melting. */
  molten: boolean;
}

/** Temperature at a point, °C. */
export function temperatureAt(ctx: FieldContext, x: number, y: number): TemperatureSample {
  const { frame, material, timeline, t } = ctx;
  const meltC = material.meltingPointC;
  const rc = zoneRadius(frame);
  const lambda0 = HEAT_ZONE_RADII * rc;
  const kappa = (CONDUCTION_GAIN * material.thermalConductivity) / (material.density * material.specificHeat);
  const lambda = Math.sqrt(lambda0 ** 2 + 4 * kappa * t);
  const spread = (lambda0 / lambda) ** 2;
  const d = distanceToCrater(frame, x, y);

  // Plastic work deposited so far, spread over the metal round the crater wall.
  const volume = Math.PI * ((rc + lambda0) ** 2 - rc ** 2) * Math.max(frame.depth, rc + lambda0);
  const peakRise = (HEAT_FRACTION * frame.energyDepositedJ) / (material.density * material.specificHeat * volume);
  // At a fluid interface the dissipation is concentrated at the wall, fading over the same short distance as the molten zone.
  const wInterface = hasFluidInterface(timeline) ? 1 - smoothstep(d / (MOLTEN_INTERFACE_ZONES * lambda0 + 1e-12)) : 0;
  let rise = peakRise * (1 + (INTERFACE_HEAT_BOOST - 1) * wInterface) * spread * Math.exp(-d / lambda);

  // The adiabatic shear band round a sheared plug, from where it shears to the rear face.
  const plug = timeline.result.plug;
  const plugEvent = timeline.events.find((e) => e.type === 'plug');
  if (plug && plugEvent && t >= plugEvent.t) {
    const r = plug.diameterM / 2;
    const w = Math.max(SHEAR_BAND_WIDTH_RATIO * r, 1e-4);
    const along = x >= plugEvent.depth ? 1 : smoothstep(1 - (plugEvent.depth - x) / w);
    rise += SHEAR_BAND_RISE * (meltC - AMBIENT_C) * along * Math.exp(-(((Math.abs(y) - r) / w) ** 2));
  }

  const range = meltC - AMBIENT_C;
  // Below melting everywhere: a smooth cap that follows the rise until it nears melting.
  const capped = AMBIENT_C + range * Math.tanh(Math.max(0, rise) / range);
  // At a jet's or rod's interface the metal can pass melting, fading to nothing a little way from the wall.
  let molten = false;
  let extra = 0;
  if (wInterface > 0 && rise > range) {
    molten = true;
    extra = wInterface * MOLTEN_SUPERHEAT_C * (1 - Math.exp(-(rise - range) / range));
  }
  return { valueC: capped + extra, molten };
}

/** The largest stress-to-yield ratio the model sets at the nose: the plate's target resistance over its yield strength. */
export function noseStressRatio(material: PlateMaterial): number {
  return material.targetResistancePa / material.yieldPa;
}

/** Peak penetration rate over a timeline, for scaling how hard the penetrator is pushing (cached per timeline). */
const peakRateCache = new WeakMap<ArmorTimeline, number>();
function peakPenetrationRate(timeline: ArmorTimeline): number {
  let peak = peakRateCache.get(timeline);
  if (peak === undefined) {
    peak = timeline.frames.reduce((m, f) => Math.max(m, f.penetrationRate), 0);
    peakRateCache.set(timeline, peak);
  }
  return peak;
}

/** Von Mises stress over yield at a point. At least 1 is plastic flow. */
export function stressRatioAt(ctx: FieldContext, x: number, y: number): number {
  const { frame, material, timeline } = ctx;
  if (isStressWave(timeline)) return Math.abs(pressureGPaAt(ctx, x, y)) * 1e9 / material.yieldPa;
  const peak = peakPenetrationRate(timeline);
  // The target resists with about Rt while the penetrator is moving, however fast, and lets go once it stops.
  const load = peak > 0 ? smoothstep(frame.penetrationRate / (LOAD_RATE_SHARE * peak)) : 0;
  const rn = zoneRadius(frame);
  const dist = Math.hypot(x - frame.depth, y);
  return load * noseStressRatio(material) * (rn / (rn + dist)) ** 2;
}

/** The pulse shape behind a wave front: a short rise then a linear fall to nothing, for s = (R - r) / W from 0 at the front to 1 at the tail. */
function pulseShape(s: number): number {
  if (s <= 0 || s >= 1) return 0;
  return s < PULSE_RISE_FRACTION ? s / PULSE_RISE_FRACTION : 1 - (s - PULSE_RISE_FRACTION) / (1 - PULSE_RISE_FRACTION);
}

/** Diameter of the penetrator at impact, m (the jet's width for a jet). */
function penetratorWidth(timeline: ArmorTimeline): number {
  const impact = timeline.shot.impact;
  return impact.family === 'heat' ? Math.max(impact.jetDiameter, impact.coneDiameter * 0.1) : impact.diameter;
}

/** The pulse's initial pressure, Pa, and its length, m, for a penetrating round. */
export function wavePulse(timeline: ArmorTimeline): { p0Pa: number; lengthM: number } {
  const { material, impact } = timeline.shot;
  const speed = impact.family === 'heat' ? impact.jetTipVelocity : impact.velocity;
  const p0Pa = Math.min(MAX_PRESSURE_RT * material.targetResistancePa, 0.5 * material.density * material.soundSpeed * speed);
  return { p0Pa, lengthM: Math.min(PULSE_DIAMETER_RATIO * penetratorWidth(timeline), PULSE_MAX_PLATE_FRACTION * timeline.result.losThicknessM) };
}

/** Pressure of the outgoing pulse from a source at the impact point, as seen at distance r after the front has gone R = c·t. Pa. */
function sphericalPressure(r: number, frontM: number, pulse: { p0Pa: number; lengthM: number }): number {
  const rRef = pulse.lengthM / PULSE_DIAMETER_RATIO;
  const falloff = rRef / Math.max(r, rRef);
  return pulse.p0Pa * falloff * pulseShape((frontM - r) / pulse.lengthM);
}

/**
 * Pressure at a point, GPa: compression positive, tension negative. The front
 * is at c·t from the impact. In the plate's rear half the pulse has reflected
 * off the rear face as tension.
 */
export function pressureGPaAt(ctx: FieldContext, x: number, y: number): number {
  const { timeline, material, t, tLos } = ctx;
  const c = material.soundSpeed;
  if (isStressWave(timeline)) {
    // The HESH model's planar pulse, spread sideways as it crosses the plate.
    const impact = timeline.shot.impact;
    if (impact.family === 'heat' || impact.family === 'he-frag') return 0;
    const sigma = rearStress(impact, tLos, timeline.shot.obliquityDeg);
    const arrive = tLos / c;
    const patch = patchRadius(impact) / Math.cos((timeline.shot.obliquityDeg * Math.PI) / 180);
    const lateral = 1 / (1 + (y / (patch + WAVE_SPREAD_SLOPE * x)) ** 2);
    const lambda = pulseLength(impact);
    // The model's pulse has a sharp front; average it over a short ramp so the field is continuous.
    const ramp = WAVE_FRONT_RAMP * lambda;
    let sum = 0;
    for (let k = -2; k <= 2; k++) sum += netStress(tLos - x + (k * ramp) / 2, t - arrive, sigma, lambda, c);
    return (sum / 5 * lateral) / 1e9;
  }
  const pulse = wavePulse(timeline);
  const front = c * t;
  const direct = sphericalPressure(Math.hypot(x, y), front, pulse);
  // A free rear face reflects the pulse inverted: an image source the same distance behind it.
  const reflected = sphericalPressure(Math.hypot(2 * tLos - x, y), front, pulse);
  return (direct - reflected) / 1e9;
}

export interface FieldPeaks {
  /** Hottest metal anywhere in the section over the whole impact, °C. */
  temperatureC: number;
  /** Whether that hottest metal is molten (the interface of a jet or a rod). */
  molten: boolean;
  /** Largest von Mises stress over yield, over the whole impact. */
  stressRatio: number;
  /** The same stress in GPa: the ratio times the plate's yield strength. */
  stressGPa: number;
}

/** How many instants of the impact, how many points along the shot line and how many across it, `peakFields` samples. */
const PEAK_TIMES = 48;
const PEAK_DEPTHS = 28;
const PEAK_RADII = [0, 0.5, 1, 2];

const peakCache = new WeakMap<ArmorTimeline, FieldPeaks>();

/**
 * The largest temperature and stress the model puts in the plate over the whole impact (#157): the numbers the
 * results panel quotes, taken from the same functions that draw the overlays, so a reader can match a reading on
 * the legend with the figure in the panel. Sampled, not exact: it looks at the shot line and the crater wall.
 */
export function peakFields(timeline: ArmorTimeline): FieldPeaks {
  const cached = peakCache.get(timeline);
  if (cached) return cached;
  let temperatureC = AMBIENT_C;
  let molten = false;
  let stressRatio = 0;
  const reach = Math.max(timeline.result.losThicknessM, 1e-3);
  for (let i = 0; i <= PEAK_TIMES; i++) {
    const ctx = fieldContext(timeline, (timeline.duration * i) / PEAK_TIMES);
    const rc = zoneRadius(ctx.frame);
    // Along the shot line to a little past the crater bottom; for a stress wave, the whole thickness.
    const xMax = isStressWave(timeline) ? reach : Math.min(reach, ctx.frame.depth + 3 * rc);
    for (let j = 0; j <= PEAK_DEPTHS; j++) {
      const x = (xMax * j) / PEAK_DEPTHS;
      for (const k of PEAK_RADII) {
        const y = k * rc + (isStressWave(timeline) ? reach * 0.02 * k : 0);
        const sample = temperatureAt(ctx, x, y);
        if (sample.valueC > temperatureC) {
          temperatureC = sample.valueC;
          molten = sample.molten;
        }
        stressRatio = Math.max(stressRatio, stressRatioAt(ctx, x, y));
      }
    }
  }
  const peaks = { temperatureC, molten, stressRatio, stressGPa: (stressRatio * timeline.shot.material.yieldPa) / 1e9 };
  peakCache.set(timeline, peaks);
  return peaks;
}

export interface EnergyBalance {
  /** Time since impact, s. */
  t: number;
  /** Kinetic energy of the penetrator still working in the plate, J. */
  kineticJ: number;
  /** Plastic work stored in the metal (the share of the work that does not turn to heat), J. */
  plasticJ: number;
  /** Heat in the plate, J. */
  heatJ: number;
  /** Kinetic energy of plate material thrown out (plug, scab, spall), J. */
  ejectaJ: number;
  /** Kinetic energy of the penetrator once it has left the plate (through the back, or ricocheted away), J. */
  residualJ: number;
  /** The sum of the terms: the impact energy, J. */
  totalJ: number;
  /** Impact energy, J. */
  impactJ: number;
}

/** The energy account at time `t`: where the impact energy is at that instant. The terms add up to the impact energy. */
export function energyBalance(timeline: ArmorTimeline, t: number): EnergyBalance {
  const { result, events } = timeline;
  const frame = frameAt(timeline, t);
  const impactJ = result.impactEnergyJ;
  const leave = events.find((e) => e.type === 'perforate' || e.type === 'ricochet');
  const emit = events.find((e) => e.type === 'spall') ?? events.find((e) => e.type === 'perforate');
  const work = clamp(frame.energyDepositedJ, 0, impactJ);
  const ejectaJ = emit && t >= emit.t ? result.energy.ejectaJ : 0;
  const carried = Math.max(0, impactJ - work - ejectaJ);
  const left = leave !== undefined && t >= leave.t;
  const heatJ = HEAT_FRACTION * work;
  const plasticJ = work - heatJ;
  const kineticJ = left ? 0 : carried;
  const residualJ = left ? carried : 0;
  return { t, kineticJ, plasticJ, heatJ, ejectaJ, residualJ, totalJ: kineticJ + plasticJ + heatJ + ejectaJ + residualJ, impactJ };
}

export interface FieldScale {
  kind: FieldKind;
  /** Colour scale range, in the field's unit. */
  min: number;
  max: number;
  unit: string;
  label: string;
  /** Diverging scales (pressure) are centred on zero. */
  diverging: boolean;
}

/** A suggested colour-scale range for the legend, in real units, for this timeline. */
export function fieldScale(kind: FieldKind, timeline: ArmorTimeline): FieldScale {
  const { material } = timeline.shot;
  switch (kind) {
    case 'temperature':
      return { kind, min: AMBIENT_C, max: material.meltingPointC + (hasFluidInterface(timeline) ? MOLTEN_SUPERHEAT_C : 0), unit: '°C', label: 'Temperature', diverging: false };
    case 'stress':
      return { kind, min: 0, max: Math.max(2, Math.ceil(noseStressRatio(material))), unit: '× yield', label: 'Stress / yield', diverging: false };
    case 'pressure': {
      const peakGPa = isStressWave(timeline)
        ? Math.abs(rearStressGPa(timeline))
        : wavePulse(timeline).p0Pa / 1e9;
      const max = Math.max(0.5, Math.ceil(peakGPa * 2) / 2);
      return { kind, min: -max, max, unit: 'GPa', label: 'Pressure (tension < 0)', diverging: true };
    }
  }
}

function rearStressGPa(timeline: ArmorTimeline): number {
  const impact = timeline.shot.impact;
  if (impact.family === 'heat' || impact.family === 'he-frag') return 0;
  return rearStress(impact, timeline.result.losThicknessM, timeline.shot.obliquityDeg) / 1e9;
}

export interface FieldGrid {
  kind: FieldKind;
  cols: number;
  rows: number;
  /** Values in the field's unit, row by row from the top (y = +halfHeightM) down, left to right across the plate (x from 0 to the line-of-sight thickness). */
  values: Float32Array;
  /** 1 where the metal is molten (temperature only). */
  molten: Uint8Array;
  halfHeightM: number;
}

/**
 * Samples a field on a coarse grid covering the plate (x from 0 to the
 * line-of-sight thickness) and `halfHeightM` either side of the shot line, for
 * the renderer to upscale. Cell centres are sampled.
 */
export function fieldGrid(ctx: FieldContext, kind: FieldKind, cols: number, rows: number, halfHeightM: number): FieldGrid {
  const values = new Float32Array(cols * rows);
  const molten = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const y = halfHeightM * (1 - (2 * (j + 0.5)) / rows);
    for (let i = 0; i < cols; i++) {
      const x = (ctx.tLos * (i + 0.5)) / cols;
      const k = j * cols + i;
      if (kind === 'temperature') {
        const s = temperatureAt(ctx, x, y);
        values[k] = s.valueC;
        molten[k] = s.molten ? 1 : 0;
      } else if (kind === 'stress') values[k] = stressRatioAt(ctx, x, y);
      else values[k] = pressureGPaAt(ctx, x, y);
    }
  }
  return { kind, cols, rows, values, molten, halfHeightM };
}
