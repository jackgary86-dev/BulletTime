import { activeShot } from './session';
import type { Keyframe, Timeline, Track } from './types';

/**
 * Interpolates a track at time `t`. Returns null before it spawns, and after it
 * ends unless it persists (a bullet at rest stays where it stopped).
 */
export function sampleTrack(track: Track, t: number): Keyframe | null {
  if (t < track.spawnT) return null;
  const frames = track.keyframes;
  const last = frames[frames.length - 1];
  if (t >= last.t) return track.persists ? last : null;
  if (t <= frames[0].t) return frames[0];

  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[hi];
  const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  const mix = (x: number, y: number) => x + (y - x) * k;
  const dx = mix(a.dir.x, b.dir.x);
  const dy = mix(a.dir.y, b.dir.y);
  const dz = mix(a.dir.z, b.dir.z);
  const dl = Math.hypot(dx, dy, dz) || 1;
  return {
    t,
    pos: { x: mix(a.pos.x, b.pos.x), y: mix(a.pos.y, b.pos.y), z: mix(a.pos.z, b.pos.z) },
    dir: { x: dx / dl, y: dy / dl, z: dz / dl },
    speed: mix(a.speed, b.speed),
    yaw: mix(a.yaw, b.yaw),
    diameter: mix(a.diameter, b.diameter),
  };
}

/** The main projectile's state at time `t` (the bullet, or the first pellet) for the shot playing then. */
export function samplePrimary(timeline: Timeline, t: number): Keyframe | null {
  const track = timeline.tracks[activeShot(timeline, t).primaryId];
  return sampleTrack(track, Math.min(t, track.keyframes.at(-1)!.t));
}
