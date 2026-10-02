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

  /**
   * Sim time one displayed frame's exposure covers (#74), as if filmed with a
   * 180° shutter at the playback rate: fast playback smears moving things,
   * deep slow motion freezes them.
   */
  get shutterS(): number {
    return DISPLAY_FRAME_S * this.rate * 0.5;
  }

  /** The frame rate this slow-motion rate implies: one displayed frame per this much sim time (#75). */
  get fps(): number {
    return 1 / (DISPLAY_FRAME_S * this.rate);
  }

  timeline: Timeline | null = null;
  private simTime = 0;
  private playing = false;

  /** Plays `timeline` from `from` seconds (a later shot on a multi-shot timeline starts part-way in). */
  start(timeline: Timeline, from = 0): void {
    this.timeline = timeline;
    this.simTime = from;
    this.playing = true;
  }

  /** Clears the current shot. */
  stop(): void {
    this.timeline = null;
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

  /** Advances by `realDeltaS` seconds of wall-clock time and returns the current simulated time. */
  update(realDeltaS: number): number | null {
    if (!this.timeline) return null;
    if (this.playing) {
      this.simTime += realDeltaS * this.rate;
      if (this.simTime >= this.timeline.duration) {
        this.simTime = this.timeline.duration;
        this.playing = false;
      }
    }
    return this.simTime;
  }
}
