import type { PriorDamage } from './engine';
import type { ShotInfo, Timeline } from './types';

/**
 * Multiple shots into the same target (#22). Every shot is simulated on its
 * own, then placed on one shared timeline at its firing time. Effects and
 * marks are pure functions of time, so earlier shots' holes, channels and
 * cracks are simply there (in their settled state) when a later shot arrives.
 */

/** Earlier shots' effects have settled this long before a new, separately fired shot starts, in seconds. */
export const SHOT_GAP_S = 0.05;

/** Appends `part` to `session` (or starts a new session) with its clock shifted by `offset` seconds. */
export function appendShot(session: Timeline | null, part: Timeline, offset: number): Timeline {
  const idOffset = session?.tracks.length ?? 0;
  const tracks = part.tracks.map((tr) => ({
    ...tr,
    id: tr.id + idOffset,
    spawnT: tr.spawnT + offset,
    endT: tr.endT + offset,
    keyframes: tr.keyframes.map((k) => ({ ...k, t: k.t + offset })),
  }));
  const events = part.events.map((e) => ({ ...e, t: e.t + offset, trackId: e.trackId + idOffset }));
  const cavity = part.cavity.map((c) => ({ ...c, t: c.t + offset }));
  const shots: ShotInfo[] = part.shots.map((s) => ({
    ...s,
    start: s.start + offset,
    impactTime: s.impactTime + offset,
    primaryId: s.primaryId + idOffset,
    firstTrack: s.firstTrack + idOffset,
  }));
  if (!session) return { ...part, tracks, events, cavity, shots, duration: part.duration + offset, impactTime: part.impactTime + offset };
  return {
    tracks: [...session.tracks, ...tracks],
    events: [...session.events, ...events].sort((a, b) => a.t - b.t),
    cavity: [...session.cavity, ...cavity],
    summary: part.summary,
    duration: Math.max(session.duration, part.duration + offset),
    impactTime: session.impactTime,
    shots: [...session.shots, ...shots],
  };
}

/** Holes, channels, craters and dents left by the shots so far, for the next shot's physics. */
export function priorDamage(session: Timeline | null): PriorDamage[] {
  if (!session) return [];
  const damage: PriorDamage[] = [];
  // Gel and water: the permanent channel, sampled every few millimetres along each path.
  for (const c of session.cavity) {
    if (c.channelRadius > 0) damage.push({ layer: c.layer, pos: c.pos, radius: c.channelRadius });
  }
  // Solid media: entry and exit holes (and the dents and craters around them).
  for (const e of session.events) {
    if (e.layer === undefined) continue;
    if (e.type !== 'impact' && e.type !== 'enter' && e.type !== 'exit' && e.type !== 'splash') continue;
    const track = session.tracks[e.trackId];
    if (!track || track.kind === 'fragment') continue;
    damage.push({ layer: e.layer, pos: e.pos, radius: track.baseDiameter });
  }
  return damage;
}

/** The shot playing at time t: the latest one fired at or before t (or the first). */
export function activeShot(timeline: Timeline, t: number): ShotInfo {
  let shot = timeline.shots[0];
  for (const s of timeline.shots) if (s.start <= t) shot = s;
  return shot;
}

/** Whether a track is one of the shots' main projectiles. */
export function isPrimary(timeline: Timeline, trackId: number): boolean {
  return timeline.shots.some((s) => s.primaryId === trackId);
}

/** Dead air shorter than this plays through as normal, in seconds. */
export const MIN_DEAD_AIR_S = 3e-3;
/** Playback lands this long before the next round leaves the muzzle, so its flash is seen, in seconds. */
const DEAD_AIR_LEAD_S = 2e-4;
/** After a round's last projectile stops, its impact still settles for this long, in seconds. */
const DEAD_AIR_TAIL_S = 1e-3;

/**
 * Stretches of a multi-shot timeline where nothing is happening (#153): between
 * one round settling and the next leaving the muzzle, as [from, to] sim times.
 * Playback jumps over them, so a burst at 750 rpm (80 ms apart, a few ms of
 * action each) plays in about the time of its impacts.
 */
export function deadAir(timeline: Timeline, minGap = MIN_DEAD_AIR_S): [number, number][] {
  const gaps: [number, number][] = [];
  let busyUntil = -Infinity;
  const shots = [...timeline.shots].sort((a, b) => a.start - b.start);
  for (const shot of shots) {
    const from = busyUntil;
    const to = shot.start - DEAD_AIR_LEAD_S;
    if (to - from > minGap) gaps.push([from, to]);
    let end = shot.start;
    for (let id = shot.firstTrack; id < shot.firstTrack + shot.trackCount; id++) {
      const track = timeline.tracks[id];
      if (track) end = Math.max(end, track.endT);
    }
    busyUntil = Math.max(busyUntil, end + DEAD_AIR_TAIL_S);
  }
  // The first round's run-up from t = 0 is part of the shot, not dead air.
  return gaps.filter(([from]) => Number.isFinite(from));
}
