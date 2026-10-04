import type { BlastSpec, BulletSpec } from './bullets';

/**
 * The Missile simulator (#181): five basic airframes, each fittable with any of
 * five warhead types. A round is built from one of each, so the catalogue is the
 * product of the two lists. Numbers are rounded and generic, tuned for the
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
  { id: 'shaped', name: 'Shaped charge', description: 'A hollow-charge jet: very narrow and very fast.' },
  { id: 'tandem', name: 'Tandem shaped charge', description: 'Two shaped charges in a row: the first clears the way for the second.' },
  { id: 'blast-frag', name: 'Blast-fragmentation', description: 'A cased high-explosive warhead: a burst and a cone of fragments.' },
  { id: 'penetrator', name: 'Kinetic penetrator', description: 'A solid dense core with no explosive: all its energy in a narrow bar.' },
  { id: 'thermobaric', name: 'Thermobaric', description: 'A fuel-rich warhead: a huge fireball and a long, strong blast, little fragmentation.' },
];

export const DEFAULT_AIRFRAME_ID = 'guided-at';
export const DEFAULT_WARHEAD_ID = 'shaped';

/**
 * The jet's mass as a fraction of the airframe, so the jet (and with it the depth it
 * bores) follows the warhead, not the weight of the whole airframe. The scale is tuned so
 * a shaped charge bores about 4 to 5 calibres of armour plate and a tandem 5 to 6.
 */
const JET_MASS_SCALE = 1.8;
const jetFraction = (a: Airframe): number => (a.warheadKg * JET_MASS_SCALE) / a.massKg;

const blastFor = (head: string, a: Airframe): BlastSpec => {
  switch (head) {
    case 'shaped':
      return { yieldKg: a.warheadKg * 0.5, fragmentCount: 10, fragmentSpeedMs: 1000, jet: { count: 6, speedMs: 7800, massFraction: jetFraction(a) }, fireball: 'standard' };
    case 'tandem':
      return { yieldKg: a.warheadKg * 0.6, fragmentCount: 10, fragmentSpeedMs: 1000, jet: { count: 6, speedMs: 7800, massFraction: jetFraction(a), tandem: true }, fireball: 'standard' };
    case 'blast-frag':
      return { yieldKg: a.warheadKg * 0.5, fragmentCount: 56, fragmentSpeedMs: 1500, fireball: 'standard' };
    case 'thermobaric':
      return { yieldKg: a.warheadKg * 1.4, fragmentCount: 6, fragmentSpeedMs: 900, fireball: 'thermobaric' };
    default:
      return { yieldKg: 0 };
  }
};

export function missileId(airframe: string, head: string): string {
  return `missile:${airframe}:${head}`;
}

/** Builds the round for an airframe fitted with a warhead head. */
export function missileSpec(airframeId: string, headId: string): BulletSpec {
  const a = AIRFRAMES.find((f) => f.id === airframeId);
  const h = WARHEADS.find((w) => w.id === headId);
  if (!a || !h) throw new Error(`Unknown missile ${airframeId}/${headId}`);
  const kinetic = h.id === 'penetrator';
  return {
    id: missileId(a.id, h.id),
    mode: 'missile',
    name: a.name,
    type: h.name,
    description: `${a.description} ${h.description}`,
    // A kinetic round is its own dense core: much narrower and much faster than the body.
    caliberMm: kinetic ? Math.max(25, a.caliberMm * 0.35) : a.caliberMm,
    lengthMm: kinetic ? a.lengthMm * 0.6 : a.lengthMm,
    massGrains: gr(kinetic ? a.warheadKg * 1.5 : a.massKg),
    muzzleVelocityMs: kinetic ? 1500 : a.speedMs,
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
