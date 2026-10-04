import { getBullet, type BulletSpec } from './bullets';

/**
 * Measured gelatin results for rifle and black-powder rounds (#228), read from the published tracks: how far
 * each goes in 10% gel, how wide its temporary cavity gets, and how much of its weight it keeps. The projectiles
 * below stand in for them and are tuned to these numbers; they are not in the round selector. Each result is a
 * single shot, so the tests allow 20%.
 */
export interface GelReference {
  id: string;
  /** Penetration in 10% gel, metres. */
  penetrationM: number;
  /** Largest temporary cavity, metres across; absent for the black-powder tracks. */
  cavityM?: number;
  /** Fraction of the weight kept; absent for the black-powder tracks. */
  retained?: number;
  /** Kinetic energy at the muzzle end of the track, joules, where the source gives it. */
  energyJ?: number;
  bullet: BulletSpec;
}

const IN = 0.0254;
const FPS = 0.3048;
const GRAMS_TO_GRAINS = 1 / 0.06479891;

/** A polymer-tipped hunting rifle bullet that fragments; only the weight, speed and break-up distance differ. */
function tap(id: string, grains: number, fps: number, neckM: number, noseDrag: number, kept: number): BulletSpec {
  return {
    ...getBullet('556-m193'),
    id,
    name: `.308 TAP ${grains} gr`,
    type: 'Fragmenting hunting bullet',
    description: 'Stand-in for the gelatin reference track. Not in the round selector.',
    caliberMm: 7.82,
    lengthMm: 30,
    massGrains: grains,
    muzzleVelocityMs: fps * FPS,
    shape: 'softPoint',
    behaviour: 'fragment',
    noseDragFactor: noseDrag,
    fragmentThresholdMs: 500,
    fragmentShedFraction: 1 - kept,
    yawNeckM: neckM,
  };
}

/** A soft lead black-powder bullet that upsets in the gel. */
function blackPowder(id: string, grams: number, caliberMm: number, ms: number, noseDrag: number): BulletSpec {
  return {
    ...getBullet('45acp-fmj'),
    id,
    name: id,
    type: 'Soft lead',
    description: 'Stand-in for the gelatin reference track. Not in the round selector.',
    caliberMm,
    lengthMm: 32,
    massGrains: grams * GRAMS_TO_GRAINS,
    muzzleVelocityMs: ms,
    shape: 'roundNose',
    behaviour: 'expand',
    expansionRatio: 1.4,
    expansionThresholdMs: 100,
    noseDragFactor: noseDrag,
  };
}

export const GEL_REFERENCE: readonly GelReference[] = [
  { id: 'tap-110', penetrationM: 10 * IN, cavityM: 6.5 * IN, retained: 19 / 110, bullet: tap('tap-110', 110, 3075, 0.16, 0.45, 19 / 110) },
  { id: 'tap-155', penetrationM: 15 * IN, cavityM: 7 * IN, retained: 79 / 155, bullet: tap('tap-155', 155, 2676, 0.01, 0.6, 79 / 155) },
  { id: 'tap-168', penetrationM: 16.5 * IN, cavityM: 6 * IN, retained: 103 / 168, bullet: tap('tap-168', 168, 2546, 0.005, 1.2, 103 / 168) },
  // 510 gr Minie at 290 m/s and 28 g Lorenz at 375 m/s; both about 35-40 cm deep.
  { id: 'minie', penetrationM: 0.375, energyJ: 1385, bullet: blackPowder('minie', 510 / GRAMS_TO_GRAINS, 14.7, 290, 1.0) },
  { id: 'lorenz', penetrationM: 0.375, energyJ: 1973, bullet: blackPowder('lorenz', 28, 13.9, 375, 1.5) },
];
