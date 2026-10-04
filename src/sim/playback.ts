import { SLOWEST_RATE, beatFactor, beatSpans } from './impactBeat';
import { deadAir } from './session';
import type { Timeline } from './types';

/** One display frame at 60 fps, the unit for frame-by-frame stepping. */
const DISPLAY_FRAME_S = 1 / 60;
/** Never step by less than the engine's own timestep. */
const MIN_STEP_S = 1e-6;

/**
 * Plays a precomputed timeline back at a slow-motion rate. `rate` is simulated
 * seconds per real second, so 1/1000 means one millisecond of the shot takes a
 * full second on screen. Because the timeline is precomputed, pausing, stepping
 * and scrubbing are just changes to the playhead.
 */
export class Playback {
  rate = 1 / 1000;
  /** Slow down on its own round each impact (#238). */
  impactBeat = true;
  /** When the shots on the timeline first touch something (impacts and detonations), s. */
  private impacts: number[] = [];

  /**
   * The beat's multiplier on the chosen rate right now: 1 away from an impact,
   * down to a tenth through one. It never takes the rate below the slowest
   * preset, so a shot already at 1/100,000 plays as chosen.
   */
  get beat(): number {
    if (!this.impactBeat || !this.timeline) return 1;
    return Math.max(beatFactor(this.simTime, this.impacts), Math.min(1, SLOWEST_RATE / this.rate));
  }

  /** The rate playback advances at now, sim seconds per real second: the chosen rate, slowed by the beat. */
  get effectiveRate(): number {
    return this.rate * this.beat;
  }

  /** The stretches of sim time the beat slows, for the scrubber to show (none when it is off). */
  get beatSpans(): [number, number][] {
    return this.impactBeat && this.timeline && SLOWEST_RATE / this.rate < 1 ? beatSpans(this.impacts) : [];
  }

  /**
   * Sim time one displayed frame's exposure covers (#74), as if filmed with a
   * 180° shutter at the playback rate: fast playback smears moving things,
   * deep slow motion freezes them.
   */
  get shutterS(): number {
    return DISPLAY_FRAME_S * this.effectiveRate * 0.5;
  }

  /** The frame rate the slow motion implies right now: one displayed frame per this much sim time (#75). It climbs through a beat, like a camera ramping. */
  get fps(): number {
    return 1 / (DISPLAY_FRAME_S * this.effectiveRate);
  }

  timeline: Timeline | null = null;
  private simTime = 0;
  private playing = false;
  /** Dead air between rounds that playing (not scrubbing) jumps over (#153). */
  private gaps: [number, number][] = [];

  /** Plays `timeline` from `from` seconds (a later shot on a multi-shot timeline starts part-way in). */
  start(timeline: Timeline, from = 0): void {
    this.timeline = timeline;
    this.gaps = deadAir(timeline);
    this.impacts = timeline.events.filter((e) => e.type === 'impact' || e.type === 'detonate').map((e) => e.t);
    this.simTime = from;
    this.playing = true;
  }

  /** Clears the current shot. */
  stop(): void {
    this.timeline = null;
    this.gaps = [];
    this.impacts = [];
    this.playing = false;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get time(): number {
    return this.simTime;
  }

  get duration(): number {
    return this.timeline?.duration ?? 0;
  }

  pause(): void {
    this.playing = false;
  }

  /** Resumes playback, restarting from the beginning if the shot has finished. */
  play(): void {
    if (!this.timeline) return;
    if (this.simTime >= this.timeline.duration) this.simTime = 0;
    this.playing = true;
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Moves the playhead to `t` (clamped) and pauses. */
  seek(t: number): void {
    if (!this.timeline) return;
    this.simTime = Math.min(this.timeline.duration, Math.max(0, t));
    this.playing = false;
  }

  /** Steps by `frames` display frames at the current slow-motion rate (negative steps back). */
  step(frames: number): void {
    this.seek(this.simTime + frames * Math.max(MIN_STEP_S, DISPLAY_FRAME_S * this.rate));
  }

  /** The stretches of dead air playback skips, for the scrubber to show. */
  get skipped(): readonly [number, number][] {
    return this.gaps;
  }

  /** Advances by `realDeltaS` seconds of wall-clock time and returns the current simulated time. */
  update(realDeltaS: number): number | null {
    if (!this.timeline) return null;
    if (this.playing) {
      this.simTime += realDeltaS * this.effectiveRate;
      // Jump over dead air between rounds; scrubbing and stepping can still go anywhere.
      for (const [from, to] of this.gaps) if (this.simTime > from && this.simTime < to) this.simTime = to;
      if (this.simTime >= this.timeline.duration) {
        this.simTime = this.timeline.duration;
        this.playing = false;
      }
    }
    return this.simTime;
  }
}
