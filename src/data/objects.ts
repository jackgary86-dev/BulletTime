import type { TargetLayer } from '../sim/engine';
import type { Timeline } from '../sim/types';
import type { MediumSpec, ObjectShape } from './media';
import type { StackLayer } from './stacks';

/**
 * Showpiece objects (#156): round and hollow things, not slabs. The physics
 * still runs each layer as a slab, so this file turns an aim point into the
 * path the bullet really takes through the object's outline: a shot near the
 * edge of a ball crosses a short chord instead of its full diameter, and
 * enters further back.
 */

/** How far out from the centre a shot may land, as a fraction of the outline's radius, so it never just grazes the edge. */
export const OUTLINE_AIM_LIMIT = 0.9;

export function isObject(medium: MediumSpec): boolean {
  return medium.shape !== undefined;
}

/** The aim's distance from the centre, in units of the outline's radius (1 = on the edge), for a round outline. */
function outlineRadius(shape: ObjectShape, y: number, z: number, halfH: number, halfW: number): number {
  return shape === 'cylinder' ? Math.abs(z / halfW) : Math.hypot(y / halfH, z / halfW);
}

/**
 * Fraction of the object's depth the shot line crosses at aim (y, z) from its
 * centre: the chord of a circle for a ball, melon or bottle, and the full
 * thickness for a flat disc.
 */
export function chordFraction(shape: ObjectShape, y: number, z: number, halfH: number, halfW: number): number {
  if (shape === 'disc') return 1;
  const r = outlineRadius(shape, y, z, halfH, halfW);
  return Math.sqrt(Math.max(0, 1 - r * r));
}

/** Pulls an aim point (y, z) from the centre back inside the outline, `OUTLINE_AIM_LIMIT` of the way to its edge. */
export function clampToOutline(shape: ObjectShape, y: number, z: number, halfH: number, halfW: number): { y: number; z: number } {
  const limit = OUTLINE_AIM_LIMIT;
  if (shape === 'cylinder') {
    return { y: Math.max(-halfH * limit, Math.min(halfH * limit, y)), z: Math.max(-halfW * limit, Math.min(halfW * limit, z)) };
  }
  const r = outlineRadius(shape, y, z, halfH, halfW);
  return r <= limit ? { y, z } : { y: (y * limit) / r, z: (z * limit) / r };
}

/** Pulls an aim point inside the outline of every object in the stack. */
export function clampAimToObjects(stack: StackLayer[], y: number, z: number): { y: number; z: number } {
  let aim = { y, z };
  for (const { medium } of stack) {
    if (medium.shape) aim = clampToOutline(medium.shape, aim.y, aim.z, medium.heightM / 2, medium.widthM / 2);
  }
  return aim;
}

/**
 * The physics layers for a shot at (y, z): each round object's layer shrinks
 * to the chord the shot line crosses, centred in the object's depth.
 */
export function shapeLayers(layers: TargetLayer[], y: number, z: number): TargetLayer[] {
  return layers.map((l) => {
    const { shape, heightM, widthM } = l.medium;
    if (!shape) return l;
    const chord = l.thickness * chordFraction(shape, y, z, heightM / 2, widthM / 2);
    return { ...l, offset: l.offset + (l.thickness - chord) / 2, thickness: chord };
  });
}

/** One line on what happened to the object, for the results panel; null for ordinary targets. */
export function objectOutcome(medium: MediumSpec, energyJ: number, passedThrough: boolean): string | null {
  switch (medium.look) {
    case 'bowlingBall':
      return energyJ > BOWLING_BALL_CRACK_J ? 'The bowling ball cracked apart.' : passedThrough ? 'Holed the bowling ball.' : 'The bullet buried itself in the ball.';
    case 'steelBall':
      return 'The steel ball shrugged it off with a bright mark.';
    case 'gong':
      return passedThrough ? 'Punched straight through the gong.' : 'Dented the gong and set it ringing.';
    case 'watermelon':
      return energyJ > MELON_BURST_J ? 'The watermelon burst apart.' : 'Holed the watermelon; the flesh sprayed out of the exit.';
    case 'bottle':
      return 'The bottle shattered.';
    default:
      return null;
  }
}

/**
 * Energy left in the object (joules) above which it gives way completely.
 * Simple thresholds for the look, not a fracture model: most pistol rounds
 * stay below them, rifle rounds go well past.
 */
export const BOWLING_BALL_CRACK_J = 900;
export const MELON_BURST_J = 450;

/**
 * Kinetic energy the bullets (not their fragments) left in physics layer
 * `layer` during the last shot of the timeline, in joules: what they had going
 * in less what they still had coming out.
 */
export function energyIntoLayer(timeline: Timeline, layer: number, shotIndex = timeline.shots.length - 1): number {
  const shot = timeline.shots[shotIndex];
  if (!shot) return 0;
  const end = timeline.shots[shotIndex + 1]?.start ?? Infinity;
  let joules = 0;
  for (const track of timeline.tracks) {
    if (track.kind === 'fragment') continue;
    const events = timeline.events.filter((e) => e.trackId === track.id && e.layer === layer && e.t >= shot.start && e.t < end);
    const into = events.find((e) => e.type === 'impact' || e.type === 'enter');
    if (!into) continue;
    const out = events.find((e) => e.type === 'exit' || e.type === 'ricochet');
    joules += 0.5 * track.massKg * (into.speed ** 2 - (out ? out.speed ** 2 : 0));
  }
  return Math.max(0, joules);
}
