/**
 * The bullet catalogue. Every round the app can fire is one entry here; the
 * selector, the 3D model and the simulation all read from this list, so adding
 * a round only needs a new entry.
 *
 * Numbers are typical published factory-load values (rounded) from common
 * barrel lengths. They are realistic, not authoritative for any specific load.
 */

import { ARTILLERY } from './artillery';
import { EXPLOSIVES } from './explosives';
import { findMissile } from './missiles';

/** The four simulators (#186). Each is an impact or blast test on the same material catalogue. */
export type SimulatorId = 'bullet' | 'artillery' | 'missile' | 'explosion';

/** How the bullet behaves on impact; drives the physics engine. */
export type BulletBehaviour =
  | 'intact' // stays in one piece, may yaw (FMJ, round nose)
  | 'expand' // mushrooms above a velocity threshold (JHP, soft point)
  | 'fragment' // breaks up above a velocity threshold (5.56 M193)
  | 'shot' // multiple pellets (buckshot)
  | 'explosive' // detonates on first contact (shells, warheads)
  | 'charge'; // a placed charge that detonates in the air at its stand-off (explosion test bed)

/** Which procedural profile builds the 3D model. */
export type BulletShape =
  | 'roundNose'
  | 'truncatedCone'
  | 'hollowPoint'
  | 'softPoint'
  | 'spitzer'
  | 'boatTail'
  | 'fosterSlug'
  | 'buckshot'
  | 'cannonShell'
  | 'dart' // long-rod penetrator
  | 'missile'
  | 'charge';

/** What a detonation does (#186). Yields are TNT-equivalent kilograms; the numbers are plausible for a game, not engineering data. */
export interface BlastSpec {
  /** TNT-equivalent explosive, in kilograms. Sets the fireball, the overpressure and the shockwave. */
  yieldKg: number;
  /** Fragments thrown (a representative sample, not the real count) and their speed. */
  fragmentCount?: number;
  fragmentSpeedMs?: number;
  /** Fraction of the round's mass that becomes fragments (default 0.7). */
  fragmentMassFraction?: number;
  /** Shaped-charge jets: how many separate jets, each pair's speed and the fraction of the round's mass in each jet group. */
  jet?: { count: number; speedMs: number; massFraction: number; /** A second, delayed jet group (tandem warhead). */ tandem?: boolean;
    /** Stand-off from the cone to the target, in calibres: the jet needs about 4 to stretch out, and breaks up past that (see `jetStandoffFactor`). Omit for the tuned default. */
    standoffCal?: number;
    /** Top-attack (#260): the jet fires straight into the struck face, not along the missile's heading, so a dive onto a roof does not lengthen its path through the plate. */
    fireNormal?: boolean };
  /** Fireball look. */
  fireball?: 'standard' | 'thermobaric' | 'incendiary' | 'none';
  /** Delay fuze: the round goes on through the target and detonates after this much path, in metres, instead of on contact (APHE, bunker-busting HE). */
  delayM?: number;
  /** HESH: a charge that spreads on the face and spalls the far side of steel and concrete thinner than a limit set by the yield. */
  spall?: { count: number; speedMs: number }; 
}

export interface BulletSpec {
  id: string;
  name: string;
  /** Short type label shown in the UI, e.g. "FMJ". */
  type: string;
  description: string;
  /** Bullet diameter in millimetres. */
  caliberMm: number;
  /** Projectile length in millimetres (one pellet for shot). */
  lengthMm: number;
  massGrains: number;
  muzzleVelocityMs: number;
  behaviour: BulletBehaviour;
  shape: BulletShape;
  /** Marks the clearly-not-a-sidearm entertainment option. */
  fun?: boolean;
  /** A hardened steel or tungsten core: it does not flatten, splash or tumble against armour, so it keeps its frontage (AP shot, long rods). */
  hardCore?: boolean;
  /** Powered flight (missiles): the round starts `runM` metres back, at `startFraction` of its speed, and its motor accelerates it to full speed over 70% of the run. */
  launch?: { runM: number; startFraction: number };
  /** Heading the selector groups this round under (artillery, for now). */
  group?: string;
  /** Which simulator lists this round (bullet when left out). */
  mode?: SimulatorId;
  /** Detonation details for shells, warheads and charges. */
  blast?: BlastSpec;
  /** Distance from the round's start (or the charge) to the target face, in metres. */
  standoffM?: number;

  /** Pellets per shell (shot only). Mass and size above are per pellet. */
  pellets?: number;
  /** Pellet spread in metres per metre of travel (shot only). */
  spreadPerMetre?: number;

  // --- Tuning constants for the physics engine (#5) ---
  /** Drag coefficient multiplier for the nose shape in a dense medium. 1 = blunt cylinder. */
  noseDragFactor: number;
  /** Expanded diameter / original diameter when fully expanded ('expand' only). */
  expansionRatio?: number;
  /** Minimum impact speed (m/s) for expansion to start ('expand' only). */
  expansionThresholdMs?: number;
  /** Minimum impact speed (m/s) for fragmentation ('fragment' only). */
  fragmentThresholdMs?: number;
  /** Share of the mass that breaks off when it fragments (default 0.4) ('fragment' only). */
  fragmentShedFraction?: number;
  /** Distance travelled in gel before the bullet starts to yaw, in metres (pointed FMJ only). */
  yawNeckM?: number;
}

const GRAINS_TO_GRAMS = 0.06479891;
const MS_TO_FPS = 3.28084;

export const gramsFromGrains = (grains: number): number => grains * GRAINS_TO_GRAMS;
export const fpsFromMs = (ms: number): number => ms * MS_TO_FPS;

export const BULLETS: BulletSpec[] = [
  {
    id: '22lr-lrn',
    name: '.22 LR',
    type: 'Lead round nose',
    description: 'Tiny rimfire plinking round. Soft lead, low energy, but still penetrates deeply for its size.',
    caliberMm: 5.7,
    lengthMm: 11.4,
    massGrains: 40,
    muzzleVelocityMs: 330,
    behaviour: 'intact',
    shape: 'roundNose',
    noseDragFactor: 2.2,
  },
  {
    id: '9mm-fmj',
    name: '9mm Luger',
    type: 'FMJ',
    description: 'The most common handgun round. Full metal jacket stays intact and penetrates deeply.',
    caliberMm: 9.01,
    lengthMm: 15.5,
    massGrains: 124,
    muzzleVelocityMs: 360,
    behaviour: 'intact',
    shape: 'roundNose',
    noseDragFactor: 0.75,
  },
  {
    id: '9mm-jhp',
    name: '9mm Luger',
    type: 'JHP',
    description: 'Jacketed hollow point. The nose cavity peels open in tissue-like media and the bullet mushrooms.',
    caliberMm: 9.01,
    lengthMm: 15.5,
    massGrains: 124,
    muzzleVelocityMs: 360,
    behaviour: 'expand',
    shape: 'hollowPoint',
    noseDragFactor: 0.35,
    expansionRatio: 1.72, // recovered diameter about 15.5 mm
    expansionThresholdMs: 250,
  },
  {
    id: '45acp-fmj',
    name: '.45 ACP',
    type: 'FMJ',
    description: 'Big, slow, heavy pistol bullet. Wide but subsonic, with a truncated round nose.',
    caliberMm: 11.48,
    lengthMm: 17.0,
    massGrains: 230,
    muzzleVelocityMs: 255,
    behaviour: 'intact',
    shape: 'roundNose',
    noseDragFactor: 0.32,
  },
  {
    id: '357mag-jsp',
    name: '.357 Magnum',
    type: 'JSP',
    description: 'Jacketed soft point revolver round. Exposed lead nose expands at magnum velocity.',
    caliberMm: 9.07,
    lengthMm: 17.3,
    massGrains: 158,
    muzzleVelocityMs: 376,
    behaviour: 'expand',
    shape: 'truncatedCone',
    noseDragFactor: 0.8,
    expansionRatio: 1.5,
    expansionThresholdMs: 290,
  },
  {
    id: '556-m193',
    name: '5.56×45mm NATO',
    type: 'FMJ (M193)',
    description: 'Fast, light rifle bullet. Yaws after a short neck in gel and often snaps at the cannelure, fragmenting above about 820 m/s.',
    caliberMm: 5.7,
    lengthMm: 19.0,
    massGrains: 55,
    muzzleVelocityMs: 990,
    behaviour: 'fragment',
    shape: 'boatTail',
    noseDragFactor: 0.45,
    fragmentThresholdMs: 820,
    yawNeckM: 0.12,
  },
  {
    id: '762x39-fmj',
    name: '7.62×39mm',
    type: 'FMJ',
    description: 'Intermediate rifle round. Long steel-core FMJ that travels a long neck before yawing.',
    caliberMm: 7.92,
    lengthMm: 26.5,
    massGrains: 123,
    muzzleVelocityMs: 715,
    behaviour: 'intact',
    shape: 'boatTail',
    noseDragFactor: 0.45,
    yawNeckM: 0.26,
  },
  {
    id: '308-sp',
    name: '.308 Winchester',
    type: 'Soft point',
    description: 'Full-power hunting rifle round. The exposed lead tip expands violently and sheds fragments.',
    caliberMm: 7.82,
    lengthMm: 28.0,
    massGrains: 150,
    muzzleVelocityMs: 860,
    behaviour: 'expand',
    shape: 'softPoint',
    noseDragFactor: 0.6,
    expansionRatio: 2.1,
    expansionThresholdMs: 550,
  },
  {
    id: '12ga-slug',
    name: '12 gauge',
    type: 'Foster slug',
    description: 'A single one-ounce lead slug with a hollow base and rifled ribs. Enormous, blunt and heavy.',
    caliberMm: 18.5,
    lengthMm: 17.0,
    massGrains: 437.5,
    muzzleVelocityMs: 490,
    behaviour: 'expand',
    shape: 'fosterSlug',
    noseDragFactor: 1.0,
    expansionRatio: 1.3,
    expansionThresholdMs: 300,
  },
  {
    id: '12ga-00buck',
    name: '12 gauge',
    type: '00 buckshot',
    description: 'Nine 8.4 mm lead balls that spread apart in flight. Each pellet is roughly a .380 bullet.',
    caliberMm: 8.38,
    lengthMm: 8.38,
    massGrains: 53.8,
    muzzleVelocityMs: 400,
    behaviour: 'shot',
    shape: 'buckshot',
    pellets: 9,
    spreadPerMetre: 0.03,
    noseDragFactor: 0.8,
  },
  {
    id: '50bmg-fmj',
    name: '.50 BMG',
    type: 'FMJ (M33 ball)',
    description: 'Heavy machine-gun and anti-materiel rifle round. Huge mass and energy; defeats most targets here.',
    caliberMm: 12.95,
    lengthMm: 58.0,
    massGrains: 661,
    muzzleVelocityMs: 887,
    behaviour: 'intact',
    shape: 'boatTail',
    noseDragFactor: 0.45,
    yawNeckM: 0.45,
  },
  {
    id: '20mm-hei',
    name: '20×102mm cannon',
    type: 'HEI (fun option)',
    description: 'Just for fun: an aircraft cannon shell, far beyond any firearm. High-explosive incendiary filler.',
    caliberMm: 20.0,
    lengthMm: 75.0,
    massGrains: 1574,
    muzzleVelocityMs: 1030,
    behaviour: 'explosive',
    shape: 'cannonShell',
    fun: true,
    noseDragFactor: 0.5,
  },
];

export const DEFAULT_BULLET_ID = '9mm-jhp';

/** Every round in every simulator, except the missile combinations (those resolve by id). */
export const ALL_MUNITIONS: BulletSpec[] = [...BULLETS, ...ARTILLERY, ...EXPLOSIVES];

export function getBullet(id: string): BulletSpec {
  const bullet = ALL_MUNITIONS.find((b) => b.id === id) ?? findMissile(id);
  if (!bullet) throw new Error(`Unknown bullet id: ${id}`);
  return bullet;
}

/** Mass in kilograms (per pellet for shot). */
export const bulletMassKg = (b: BulletSpec): number => gramsFromGrains(b.massGrains) / 1000;

/** Muzzle kinetic energy in joules (all pellets for shot). */
export const muzzleEnergyJ = (b: BulletSpec): number =>
  0.5 * bulletMassKg(b) * (b.pellets ?? 1) * b.muzzleVelocityMs ** 2;
