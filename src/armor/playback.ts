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

import { warpShape } from '../sim/timeWarp';
import type { ArmorTimeline } from './model';

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

/** Share of a plate's own penetration time the slow-motion beat eases down over before contact (#238). */
export const BEAT_LEAD_SHARE = 0.02;
/** Share of a plate's penetration time the beat holds at its slowest after contact. */
export const BEAT_HOLD_SHARE = 0.03;
/** Share of a plate's penetration time the beat takes to ease back to full speed. */
export const BEAT_RAMP_SHARE = 0.12;

/** One plate's contact on the stack's clock, with the plate's penetration time that sizes its beat. */
export interface ImpactBeat {
  t0: number;
  scaleS: number;
}

/** The beats of a stack: one per engaged plate, at the moment the round reaches it. */
export function impactBeats(stages: readonly { offsetT: number; timeline: { duration: number } }[]): ImpactBeat[] {
  return stages.map((stage) => ({ t0: stage.offsetT, scaleS: stage.timeline.duration }));
}

/**
 * How fast the playhead runs at `u` relative to its chosen speed (#238): the
 * same beat as the simulators, at each plate's impact, sized to that plate's own
 * penetration time because this clock plays a whole impact in seconds whatever
 * its real length. Only the impact phase is warped; the aftermath is on its own
 * log scale. Scrubbing is unaffected: this scales how fast `u` advances, not
 * what time a given `u` shows.
 */
export function playheadSpeed(timeline: PlaybackSource, beats: readonly ImpactBeat[], u: number): number {
  const pb = playbackAt(timeline, u);
  if (pb.aftermath) return 1;
  let factor = 1;
  for (const { t0, scaleS } of beats) {
    if (!(scaleS > 0)) continue;
    factor = Math.min(factor, warpShape((pb.t - t0) / scaleS, BEAT_LEAD_SHARE, BEAT_HOLD_SHARE, BEAT_RAMP_SHARE));
  }
  return factor;
}
