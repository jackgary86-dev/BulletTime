import { describe, expect, it } from 'vitest';
import { getBullet } from '../data/bullets';
import { getMedium } from '../data/media';
import type { TargetLayer } from '../sim/engine';
import type { ShotEvent, ShotInfo, Timeline } from '../sim/types';
import { buildCues, CueTrack, MAX_CUES_PER_FRAME, shotSound } from './cues';
import { getSound } from './sounds';

function shot(start: number, impactTime: number, bulletId: string, firstTrack = 0, trackCount = 1): ShotInfo {
  return { start, impactTime, primaryId: firstTrack, firstTrack, trackCount, bulletId, aim: { y: 0, z: 0 } } as ShotInfo;
}

function event(t: number, type: ShotEvent['type'], trackId: number, layer?: number): ShotEvent {
  return { t, type, trackId, layer, pos: { x: 0, y: 0, z: 0 }, speed: 300 };
}

function timeline(shots: ShotInfo[], events: ShotEvent[]): Timeline {
  return { shots, events } as Timeline;
}

const layer = (id: string): TargetLayer => ({ medium: getMedium(id), thickness: 0.1, offset: 0 });

describe('sound cues', () => {
  it('picks a shot sound for every round', () => {
    expect(shotSound(getBullet('9mm-fmj'))).toBe('shot-pistol');
    expect(shotSound(getBullet('308-sp'))).toBe('shot-rifle');
    expect(shotSound(getBullet('12ga-00buck'))).toBe('shot-shotgun');
    expect(shotSound(getBullet('12ga-slug'))).toBe('shot-shotgun');
  });

  it('cues the shot, a supersonic crack and each material hit, in time order', () => {
    const cues = buildCues(
      timeline([shot(0, 0.001, '308-sp')], [event(0.001, 'impact', 0, 0), event(0.0012, 'enter', 0, 1), event(0.0015, 'stop', 0, 1)]),
      [layer('pine'), layer('gel10')],
      getBullet,
    );
    expect(cues).toEqual([
      { t: 0, sound: 'shot-rifle' },
      { t: 0.0005, sound: 'supersonic-crack' },
      { t: 0.001, sound: 'impact-wood' },
      { t: 0.0012, sound: 'impact-gel' },
    ]);
    for (const c of cues) expect(() => getSound(c.sound)).not.toThrow();
  });

  it('plays one sound per material per shot, however many fragments hit it', () => {
    const events = [0, 1, 2, 3].map((id) => event(0.002 + id * 1e-5, 'impact', id, 0));
    const cues = buildCues(timeline([shot(0, 0.002, '12ga-00buck', 0, 4)], events), [layer('steel-mild')], getBullet);
    expect(cues.filter((c) => c.sound === 'impact-steel')).toHaveLength(1);
    expect(cues.some((c) => c.sound === 'supersonic-crack')).toBe(true);
  });

  it('skips the crack for subsonic rounds and cues ricochets', () => {
    const cues = buildCues(timeline([shot(0, 0.002, '45acp-fmj')], [event(0.002, 'ricochet', 0, 0)]), [layer('steel-ar500')], getBullet);
    expect(cues.map((c) => c.sound)).toEqual(['shot-pistol', 'ricochet']);
  });
});

describe('cue track', () => {
  const cues = [
    { t: 0, sound: 'a' },
    { t: 0.001, sound: 'b' },
    { t: 0.002, sound: 'c' },
  ];

  it('sounds each cue once as playback passes it', () => {
    const track = new CueTrack();
    track.load(cues);
    expect(track.update(0, true)).toEqual(['a']);
    expect(track.update(0.0005, true)).toEqual([]);
    expect(track.update(0.0015, true)).toEqual(['b']);
    expect(track.update(0.003, true)).toEqual(['c']);
    expect(track.update(0.003, true)).toEqual([]);
  });

  it('starts part-way in for a later shot of a group', () => {
    const track = new CueTrack();
    track.load(cues, 0.001);
    expect(track.update(0.001, true)).toEqual(['b']);
  });

  it('stays silent while scrubbing and resumes from the playhead', () => {
    const track = new CueTrack();
    track.load(cues);
    track.update(0, true);
    expect(track.update(0.0025, false)).toEqual([]);
    expect(track.update(0.0025, true)).toEqual([]);
    // Play from the end restarts at 0.
    track.update(0.003, false);
    expect(track.update(0, true)).toEqual(['a']);
  });

  it('caps how many cues start in one frame', () => {
    const track = new CueTrack();
    track.load(Array.from({ length: 10 }, (_, i) => ({ t: i * 1e-4, sound: `s${i}` })));
    expect(track.update(1, true)).toHaveLength(MAX_CUES_PER_FRAME);
  });

  it('replays from the start', () => {
    const track = new CueTrack();
    track.load(cues);
    track.update(0.003, true);
    track.rewind(0);
    expect(track.update(0.003, true)).toEqual(['a', 'b', 'c']);
  });
});

describe('heavy sounds (#199)', () => {
  it('picks cannon and howitzer reports by shell mass, a launch for missiles and nothing for a charge', () => {
    expect(shotSound(getBullet('30mm-ap'))).toBe('shot-cannon');
    expect(shotSound(getBullet('105mm-heat'))).toBe('shot-cannon');
    expect(shotSound(getBullet('155mm-he'))).toBe('shot-howitzer');
    expect(shotSound(getBullet('240mm-he'))).toBe('shot-howitzer');
    expect(shotSound(getBullet('missile:guided-at:shaped'))).toBe('missile-launch');
    expect(shotSound(getBullet('charge-block'))).toBe('');
  });

  it('cues a blast sized by yield and fireball, and every cue names a real sound', () => {
    const boom = (yieldKg: number, fireball: string): ShotEvent => ({ ...event(0.0015, 'detonate', 0, 0), yieldKg, fireball });
    const cuesFor = (id: string, e: ShotEvent) => buildCues(timeline([shot(0, 0.0015, id)], [e]), [layer('pine')], getBullet);
    expect(cuesFor('charge-flash', boom(0.1, 'standard'))).toEqual([{ t: 0.0015, sound: 'blast-small' }]);
    expect(cuesFor('charge-satchel', boom(6.5, 'standard'))).toEqual([{ t: 0.0015, sound: 'blast-large' }]);
    expect(cuesFor('charge-thermobaric', boom(3.5, 'thermobaric'))).toEqual([{ t: 0.0015, sound: 'blast-thermobaric' }]);
    for (const c of [...cuesFor('155mm-he', boom(8, 'standard')), ...cuesFor('missile:cruise:thermobaric', boom(630, 'thermobaric'))]) expect(() => getSound(c.sound)).not.toThrow();
  });
});
