import { bulletMassKg, type BulletSpec } from '../data/bullets';
import type { MediumBehaviour } from '../data/media';
import type { TargetLayer } from '../sim/engine';
import type { Timeline } from '../sim/types';

/** Speed of sound in air, m/s: faster rounds trail a supersonic crack. */
const SPEED_OF_SOUND_MS = 343;
/** Most cues one frame may start, so a burst crossing many events at 1× doesn't pile into noise. */
export const MAX_CUES_PER_FRAME = 4;

/** One sound on a shot timeline (#120): `sound` plays when the playhead reaches sim time `t`. */
export interface SoundCue {
  t: number;
  sound: string;
}

const IMPACT_SOUNDS: Record<MediumBehaviour, string> = {
  gel: 'impact-gel',
  bone: 'impact-gel',
  water: 'impact-water',
  wood: 'impact-wood',
  drywall: 'impact-drywall',
  concrete: 'impact-concrete',
  steel: 'impact-steel',
  sand: 'impact-sandbag',
  glass: 'impact-glass',
  ice: 'impact-glass',
};

/** Mass (kg) from which a shell is a cannon, and from which a howitzer. */
const CANNON_KG = 0.3;
const HOWITZER_KG = 20;

/**
 * The muzzle report for a round: shotgun shells, then rifles by muzzle speed, else a pistol;
 * cannon and howitzer reports by shell mass (#199), a launch roar for missiles, and nothing
 * for a charge that just sits there.
 */
export function shotSound(spec: BulletSpec): string {
  if (spec.shape === 'charge') return '';
  if (spec.shape === 'missile') return 'missile-launch';
  if (spec.shape === 'buckshot' || spec.shape === 'fosterSlug') return 'shot-shotgun';
  const kg = bulletMassKg(spec);
  if (kg >= HOWITZER_KG) return 'shot-howitzer';
  if (kg >= CANNON_KG) return 'shot-cannon';
  return spec.muzzleVelocityMs > 600 ? 'shot-rifle' : 'shot-pistol';
}

/** The bang of a detonation, by yield and fireball look. */
export function blastSound(yieldKg: number, fireball?: string): string {
  if (fireball === 'thermobaric') return 'blast-thermobaric';
  return yieldKg < 0.5 ? 'blast-small' : 'blast-large';
}

export function impactSound(behaviour: MediumBehaviour): string {
  return IMPACT_SOUNDS[behaviour];
}

/**
 * Every sound a timeline makes, in time order: per shot, the muzzle report, a
 * crack as a supersonic round flies to the target, and one sound per material
 * it hits (a cinder block's two shells, or forty fragments in one gel block,
 * still make one thud), plus ricochets.
 */
export function buildCues(timeline: Timeline, layers: TargetLayer[], bullet: (id: string) => BulletSpec): SoundCue[] {
  const cues: SoundCue[] = [];
  for (const shot of timeline.shots) {
    const spec = bullet(shot.bulletId);
    const report = shotSound(spec);
    if (report) cues.push({ t: shot.start, sound: report });
    if (spec.muzzleVelocityMs > SPEED_OF_SOUND_MS)
      cues.push({ t: (shot.start + shot.impactTime) / 2, sound: 'supersonic-crack' });

    const heard = new Set<string>();
    const last = shot.firstTrack + shot.trackCount;
    for (const e of timeline.events) {
      if (e.trackId < shot.firstTrack || e.trackId >= last) continue;
      let sound: string | null = null;
      if (e.type === 'detonate' && e.yieldKg !== undefined) sound = blastSound(e.yieldKg, e.fireball);
      else if (e.type === 'ricochet') sound = 'ricochet';
      else if ((e.type === 'impact' || e.type === 'enter') && e.layer !== undefined && layers[e.layer])
        sound = impactSound(layers[e.layer].medium.behaviour);
      if (!sound || heard.has(sound)) continue;
      heard.add(sound);
      cues.push({ t: e.t, sound });
    }
  }
  return cues.sort((a, b) => a.t - b.t);
}

/**
 * Plays a timeline's cues in step with the slow-motion playhead: a cue sounds
 * the frame playback carries the playhead past it, so at 1/1,000 an impact is
 * heard as it is seen. Scrubbing, stepping and paused frames are silent.
 */
export class CueTrack {
  private cues: SoundCue[] = [];
  private lastT = 0;
  private wasPlaying = false;

  /** Loads cues for playback starting at `from`; a cue exactly at `from` still sounds. */
  load(cues: SoundCue[], from = 0): void {
    this.cues = cues;
    this.rewind(from);
  }

  /** Playback restarted at `from` (Replay). */
  rewind(from: number): void {
    this.lastT = from - 1e-12;
    this.wasPlaying = true;
  }

  clear(): void {
    this.cues = [];
  }

  /** Sounds due this frame, given the playhead and whether playback was running into this frame. */
  update(t: number, playing: boolean): string[] {
    // Resuming after a pause or a seek: start from here. Play from the end restarts at 0, so include it.
    const from = playing && !this.wasPlaying ? (t === 0 ? -1 : t) : this.lastT;
    this.wasPlaying = playing;
    this.lastT = t;
    if (!playing || t <= from) return [];
    const due: string[] = [];
    for (const c of this.cues) {
      if (c.t > t) break;
      if (c.t > from && due.length < MAX_CUES_PER_FRAME) due.push(c.sound);
    }
    return due;
  }
}
