/**
 * Armor lab (#165): the playback clock. The impact itself takes microseconds
 * and what it throws takes a second to come to rest, so one linear clock cannot
 * show both. A timeline with fragments plays in two phases on one scrubber:
 * the impact in linear time (the section frames), then the aftermath on a log
 * time scale, from the end of the impact to the moment the last piece rests,
 * with the section frozen at its last frame. A timeline without fragments is
 * just linear.
 *
 * Pure functions of the playhead `u` (0 to 1), so scrubbing and replay are the
 * same thing.
 */

import type { ArmorTimeline } from './model';
import { armorBeat, beatFactor } from '../sim/impactBeat';
import type { ClockSource } from '../sim/playClock';

/** Share of the scrubber given to the impact phase when there is an aftermath. */
export const IMPACT_SHARE = 0.55;
/** Smallest aftermath span worth a phase of its own, as a multiple of the impact duration. */
export const MIN_AFTERMATH_RATIO = 2;

/** What the clock needs from a timeline: a single plate's or a stack's. */
export type PlaybackSource = Pick<ArmorTimeline, 'duration' | 'fragments'>;

export interface PlaybackTime {
  /** Time for the section frames, s (held at the timeline's duration during the aftermath). */
  t: number;
  /** Time since impact for the fragments, s. */
  fragmentT: number;
  /** Whether the aftermath phase is playing. */
  aftermath: boolean;
}

/** The time at the end of the aftermath: when the last piece has come to rest. */
export function aftermathEnd(timeline: PlaybackSource): number {
  const f = timeline.fragments;
  return f ? Math.max(f.restS, MIN_AFTERMATH_RATIO * timeline.duration) : timeline.duration;
}

/** The times at playhead `u` (clamped to 0 to 1). */
export function playbackAt(timeline: PlaybackSource, u: number): PlaybackTime {
  const x = Math.min(1, Math.max(0, u));
  const { duration } = timeline;
  if (!timeline.fragments) return { t: x * duration, fragmentT: x * duration, aftermath: false };
  if (x <= IMPACT_SHARE) {
    const t = (x / IMPACT_SHARE) * duration;
    return { t, fragmentT: t, aftermath: false };
  }
  const k = (x - IMPACT_SHARE) / (1 - IMPACT_SHARE);
  const end = aftermathEnd(timeline);
  return { t: duration, fragmentT: duration * (end / duration) ** k, aftermath: true };
}

/** The playhead (0 to 1) at which the section frames are at time `t` during the impact phase: the inverse of `playbackAt` there. */
export function playheadForImpactTime(timeline: PlaybackSource, t: number): number {
  const x = Math.min(1, Math.max(0, t / timeline.duration));
  return timeline.fragments ? x * IMPACT_SHARE : x;
}

/** How long a whole timeline takes to play at 1x, in real seconds. */
export const PLAY_SECONDS = 8;
/** A timeline with an aftermath (thrown pieces coming to rest) plays this much longer. */
export const AFTERMATH_PLAY_FACTOR = 1.6;
/** A stack of plates plays this much longer than one plate. */
export const STACK_PLAY_FACTOR = 1.3;

/** The real seconds a whole playback takes at 1x: longer with an aftermath and with several plates. */
export function playSeconds(source: PlaybackSource & { stages?: readonly unknown[] }): number {
  return PLAY_SECONDS * (source.fragments ? AFTERMATH_PLAY_FACTOR : 1) * ((source.stages?.length ?? 1) > 1 ? STACK_PLAY_FACTOR : 1);
}

/**
 * The Armor lab on the shared clock (#242): the scrubber's playhead `u` (0 to
 * 1) is the position, played at `speed / playSeconds` per real second, and the
 * impact beat (#238) slows it as the round meets each plate (`impacts`, s on
 * the timeline's own clock), during the impact phase only.
 */
export function armorClockSource(source: PlaybackSource, impacts: readonly number[], beatOn: boolean): ClockSource {
  const shape = armorBeat(source.duration);
  return {
    duration: 1,
    beat: beatOn
      ? (u) => {
          const pb = playbackAt(source, u);
          return pb.aftermath ? 1 : beatFactor(pb.t, impacts, shape);
        }
      : undefined,
  };
}
