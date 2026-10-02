import type { Timeline } from './types';

/**
 * Plays a precomputed timeline back at a slow-motion rate. `rate` is simulated
 * seconds per real second, so 1/1000 means one millisecond of the shot takes a
 * full second on screen.
 */
export class Playback {
  rate = 1 / 1000;
  timeline: Timeline | null = null;
  private simTime = 0;
  private playing = false;

  start(timeline: Timeline): void {
    this.timeline = timeline;
    this.simTime = 0;
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
