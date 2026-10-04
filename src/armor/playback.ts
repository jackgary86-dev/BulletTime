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

/** Share of the scrubber given to the impact phase when there is an aftermath. */
export const IMPACT_SHARE = 0.55;
/** Smallest aftermath span worth a phase of its own, as a multiple of the impact duration. */
export const MIN_AFTERMATH_RATIO = 2;

export interface PlaybackTime {
  /** Time for the section frames, s (held at the timeline's duration during the aftermath). */
  t: number;
  /** Time since impact for the fragments, s. */
  fragmentT: number;
  /** Whether the aftermath phase is playing. */
  aftermath: boolean;
}

/** The time at the end of the aftermath: when the last piece has come to rest. */
export function aftermathEnd(timeline: ArmorTimeline): number {
  const f = timeline.fragments;
  return f ? Math.max(f.restS, MIN_AFTERMATH_RATIO * timeline.duration) : timeline.duration;
}

/** The times at playhead `u` (clamped to 0 to 1). */
export function playbackAt(timeline: ArmorTimeline, u: number): PlaybackTime {
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
export function playheadForImpactTime(timeline: ArmorTimeline, t: number): number {
  const x = Math.min(1, Math.max(0, t / timeline.duration));
  return timeline.fragments ? x * IMPACT_SHARE : x;
}
