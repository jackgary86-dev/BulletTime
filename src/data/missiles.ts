import type { BlastSpec, BulletSpec } from './bullets';

/**
 * The Missile simulator (#181): five basic airframes, each fittable with a
 * penetrating head: a kinetic penetrator or an explosively formed penetrator. A
 * round is built from one of each, so the catalogue is the product of the two
 * lists. Blast and shaped-charge heads are not in the catalogue. Numbers are rounded and generic, tuned for the
 * look and the physics.
 */
const GRAINS_PER_KG = 15432.36;
const gr = (kg: number): number => Math.round(kg * GRAINS_PER_KG);

export interface Airframe {
  id: string;
  name: string;
  description: string;
  /** Body diameter and length, in millimetres. */
  caliberMm: number;
  lengthMm: number;
  /** Mass of the whole missile and of its warhead section, in kilograms. */
  massKg: number;
  warheadKg: number;
  /** Speed at impact, in metres per second. */
  speedMs: number;
}

export interface WarheadHead {
  id: string;
  name: string;
  description: string;
}

export const AIRFRAMES: Airframe[] = [
  { id: 'light-rocket', name: 'Light rocket (70 mm)', description: 'A small unguided rocket.', caliberMm: 70, lengthMm: 1000, massKg: 6.2, warheadKg: 1, speedMs: 350 },
  { id: 'shoulder-rocket', name: 'Shoulder rocket (90 mm)', description: 'A single-use launcher rocket.', caliberMm: 90, lengthMm: 900, massKg: 3.8, warheadKg: 1.4, speedMs: 300 },
  { id: 'guided-at', name: 'Guided anti-tank missile (127 mm)', description: 'A wire or laser guided missile for armour.', caliberMm: 127, lengthMm: 1600, massKg: 12, warheadKg: 4, speedMs: 280 },
  { id: 'air-surface', name: 'Air-to-surface missile (178 mm)', description: 'A rail-launched aircraft missile.', caliberMm: 178, lengthMm: 1750, massKg: 45, warheadKg: 9, speedMs: 450 },
  { id: 'cruise', name: 'Cruise-class missile (520 mm)', description: 'A large long-range missile with a heavy warhead.', caliberMm: 520, lengthMm: 6000, massKg: 1200, warheadKg: 450, speedMs: 250 },
];

export const WARHEADS: WarheadHead[] = [
  { id: 'penetrator', name: 'Kinetic penetrator', description: 'A solid dense core with no explosive: all its energy in a narrow bar.' },
  { id: 'long-rod', name: 'Long-rod penetrator', description: 'A slimmer, longer tungsten rod driven faster: it bores deepest into armour plate.' },
  { id: 'heavy-core', name: 'Heavy penetrator', description: 'A thick, heavy steel-jacketed core at a lower speed: less depth in armour, but it carries more momentum into concrete and earth.' },
  { id: 'efp', name: 'Explosively formed penetrator', description: 'A plate that folds into a single slug at about 2 km/s: it keeps its punch at long stand-off but bores far less than a jet.' },
];

export const DEFAULT_AIRFRAME_ID = 'guided-at';
export const DEFAULT_WARHEAD_ID = 'penetrator';

/** Stand-off, in calibres, at which a jet has stretched to its full length. */
export const OPTIMUM_STANDOFF_CAL = 4;

/**
 * How much of a jet's length survives at a given stand-off (#260): a short stand-off leaves it unstretched,
 * a long one lets it break into particles. 1 at the optimum, never below 0.4.
 */
export function jetStandoffFactor(standoffCal: number | undefined): number {
  if (standoffCal === undefined) return 1;
  if (standoffCal <= OPTIMUM_STANDOFF_CAL) return 0.4 + (0.6 * Math.max(0, standoffCal)) / OPTIMUM_STANDOFF_CAL;
  return Math.max(0.4, OPTIMUM_STANDOFF_CAL / standoffCal);
}

/**
 * The jet's mass as a fraction of the airframe, so the jet (and with it the depth it
 * bores) follows the warhead, not the weight of the whole airframe. The scale is tuned so
 * a shaped charge bores about 4 to 5 calibres of armour plate and a tandem 5 to 6.
 */
const JET_MASS_SCALE = 1.8;
const jetFraction = (a: Airframe): number => (a.warheadKg * JET_MASS_SCALE) / a.massKg;

const blastFor = (head: string, a: Airframe): BlastSpec => {
  switch (head) {
    case 'efp':
      return { yieldKg: a.warheadKg * 0.5, fragmentCount: 4, fragmentSpeedMs: 1000, jet: { count: 1, speedMs: 2200, massFraction: jetFraction(a) * 0.7 }, fireball: 'standard' };
    default:
      return { yieldKg: 0 };
  }
};

export function missileId(airframe: string, head: string): string {
  return `missile:${airframe}:${head}`;
}

/**
 * The kinetic heads: the core's diameter and length as fractions of the airframe's, its mass as a multiple of the
 * warhead section's, and its speed at the target.
 */
const KINETIC: Record<string, { calibre: number; length: number; mass: number; speedMs: number; minMm: number }> = {
  penetrator: { calibre: 0.35, length: 0.6, mass: 1.5, speedMs: 1500, minMm: 25 },
  'long-rod': { calibre: 0.22, length: 0.8, mass: 1.2, speedMs: 1800, minMm: 18 },
  'heavy-core': { calibre: 0.5, length: 0.5, mass: 2.4, speedMs: 1100, minMm: 35 },
};

/** Builds the round for an airframe fitted with a warhead head. */
export function missileSpec(airframeId: string, headId: string): BulletSpec {
  const a = AIRFRAMES.find((f) => f.id === airframeId);
  const h = WARHEADS.find((w) => w.id === headId);
  if (!a || !h) throw new Error(`Unknown missile ${airframeId}/${headId}`);
  const core = KINETIC[h.id];
  const kinetic = !!core;
  return {
    id: missileId(a.id, h.id),
    mode: 'missile',
    name: a.name,
    type: h.name,
    description: `${a.description} ${h.description}`,
    // A kinetic round is its own dense core: much narrower and much faster than the body.
    caliberMm: core ? Math.max(core.minMm, a.caliberMm * core.calibre) : a.caliberMm,
    lengthMm: core ? a.lengthMm * core.length : a.lengthMm,
    massGrains: gr(core ? a.warheadKg * core.mass : a.massKg),
    muzzleVelocityMs: core ? core.speedMs : a.speedMs,
    behaviour: kinetic ? 'intact' : 'explosive',
    shape: kinetic ? 'dart' : 'missile',
    noseDragFactor: kinetic ? 0.25 : 0.5,
    hardCore: kinetic || undefined,
    blast: kinetic ? undefined : blastFor(h.id, a),
    // A powered missile is seen leaving its launch point and accelerating; a kinetic core is already at speed.
    launch: kinetic ? undefined : { runM: Math.min(3, Math.max(1, (a.lengthMm / 1000) * 1.5)), startFraction: 0.25 },
  };
}

export const MISSILES: BulletSpec[] = AIRFRAMES.flatMap((a) => WARHEADS.map((h) => missileSpec(a.id, h.id)));

/** Resolves a `missile:<airframe>:<head>` id, or undefined. */
export function findMissile(id: string): BulletSpec | undefined {
  const [kind, a, h] = id.split(':');
  if (kind !== 'missile') return undefined;
  try {
    return missileSpec(a, h);
  } catch {
    return undefined;
  }
}
