import type { BulletSpec } from '../data/bullets';
import type { SimResolution } from '../data/physics';
import { simulate, type TargetLayer } from './engine';
import { appendShot, priorDamage } from './session';
import type { Timeline, Vec3 } from './types';

/** Gap between the rounds of a group, in sim seconds. */
export const GROUP_GAP_S = 1e-3;

/** One round of a Fire: the layers it meets (shaped round its aim point) and where it strikes. */
export interface FireRound {
  layers: TargetLayer[];
  impactPoint: Vec3;
  /** Its aim relative to the target's centre line, stored on the shot so the muzzle can follow it. */
  aim: { y: number; z: number };
}

/**
 * Everything a Fire needs to simulate, as plain data, so it can run in the simulation worker (#333) or in place.
 * The rounds run in order: each meets the damage the ones before it left.
 */
export interface FireSessionInput {
  bullet: BulletSpec;
  rounds: FireRound[];
  angleDeg: number;
  standOffM: number;
  resolution: SimResolution;
  /** The session so far (null for a fresh one). */
  session: Timeline | null;
  /** When this Fire's first round goes, in session time. */
  fireStart: number;
  mode: 'single' | 'group' | 'burst';
  /** Rounds per minute, for a burst. */
  rpm: number;
}

/** Simulates the rounds of a Fire and returns the session with them appended. Pure. */
export function fireSession(input: FireSessionInput): Timeline {
  let session = input.session;
  let offset = input.fireStart;
  input.rounds.forEach((round, i) => {
    const part = simulate({
      bullet: input.bullet,
      layers: round.layers,
      angleDeg: input.angleDeg,
      impactPoint: round.impactPoint,
      standOffM: input.standOffM,
      damage: priorDamage(session),
      resolution: input.resolution,
    });
    part.shots[0].aim = round.aim;
    session = appendShot(session, part, offset);
    // A burst fires on the beat of its rate; a group one round after another.
    offset = input.mode === 'burst' ? input.fireStart + ((i + 1) * 60) / input.rpm : offset + part.duration + GROUP_GAP_S;
  });
  return session!;
}
