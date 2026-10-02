import { sampleTimeline, type Keyframe, type Timeline } from './timeline';

/**
 * Plays a precomputed timeline back at a slow-motion rate. `rate` is simulated
 * seconds per real second, so 1/1000 means one millisecond of the shot takes a
 * full second on screen.
 */
export class Playback {
  rate = 1 / 1000;
  private timeline: Timeline | null = null;
  private simTime = 0;
  private playing = false;

  start(timeline: Timeline): void {
    this.timeline = timeline;
    this.simTime = 0;
    this.playing = true;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Advances by `realDeltaS` seconds of wall-clock time and returns the current frame. */
  update(realDeltaS: number): Keyframe | null {
    if (!this.timeline) return null;
    if (this.playing) {
      this.simTime += realDeltaS * this.rate;
      if (this.simTime >= this.timeline.duration) {
        this.simTime = this.timeline.duration;
        this.playing = false;
      }
    }
    return sampleTimeline(this.timeline, this.simTime);
  }
}
