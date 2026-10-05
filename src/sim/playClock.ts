/**
 * The one playback clock (#242): a playhead that plays, pauses, seeks, steps
 * and advances with the wall clock, slowed by a beat and skipping stretches it
 * is told to jump. Both the simulators (`Playback`, playing simulated seconds)
 * and the Armor lab (playing its 0 to 1 scrubber, see `armor/playback.ts`) run
 * on it, so speed, the impact beat (#238), stepping and scrubbing behave the
 * same everywhere.
 *
 * Positions are in whatever unit the source plays: the clock never interprets
 * them. `rate` is positions per real second.
 */

/** What a clock plays. */
export interface ClockSource {
  /** Where the playhead ends, in the source's unit. */
  duration: number;
  /** The playback rate multiplier at a position (1 = as chosen); the impact beat slows it round impacts. */
  beat?: (position: number) => number;
  /** Stretches playing (not seeking or stepping) jumps over, [from, to). */
  gaps?: readonly [number, number][];
}

export class PlayClock {
  /** Positions per real second at full speed. */
  rate = 1;
  protected source: ClockSource | null = null;
  private pos = 0;
  private playing = false;

  /** Starts playing `source` from `from` (or parks there when `play` is false). */
  load(source: ClockSource, from = 0, play = true): void {
    this.source = source;
    this.pos = Math.min(source.duration, Math.max(0, from));
    this.playing = play;
  }

  /** Clears the source. */
  unload(): void {
    this.source = null;
    this.playing = false;
    this.pos = 0;
  }

  get loaded(): boolean {
    return this.source !== null;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get position(): number {
    return this.pos;
  }

  get duration(): number {
    return this.source?.duration ?? 0;
  }

  /** Whether the playhead has reached the end. */
  get atEnd(): boolean {
    return !!this.source && this.pos >= this.source.duration;
  }

  /** The beat's multiplier on the rate at the playhead. */
  get beat(): number {
    return this.source?.beat ? this.source.beat(this.pos) : 1;
  }

  /** Positions per real second right now: the rate, slowed by the beat. */
  get effectiveRate(): number {
    return this.rate * this.beat;
  }

  /** The stretches playing jumps over. */
  get gaps(): readonly [number, number][] {
    return this.source?.gaps ?? [];
  }

  pause(): void {
    this.playing = false;
  }

  /** Resumes, from the start if the playhead is at the end. */
  play(): void {
    if (!this.source) return;
    if (this.atEnd) this.pos = 0;
    this.playing = true;
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Moves the playhead to `position` (clamped) and pauses. */
  seek(position: number): void {
    if (!this.source) return;
    this.pos = Math.min(this.source.duration, Math.max(0, position));
    this.playing = false;
  }

  /** Steps `frames` frames of `frameSize` positions each (negative steps back), and pauses. */
  stepBy(frames: number, frameSize: number): void {
    this.seek(this.pos + frames * frameSize);
  }

  /** Advances by `realDeltaS` seconds of wall-clock time and returns the playhead, or null with nothing loaded. */
  update(realDeltaS: number): number | null {
    const source = this.source;
    if (!source) return null;
    if (this.playing) {
      this.pos += realDeltaS * this.effectiveRate;
      for (const [from, to] of this.gaps) if (this.pos > from && this.pos < to) this.pos = to;
      if (this.pos >= source.duration) {
        this.pos = source.duration;
        this.playing = false;
      }
    }
    return this.pos;
  }
}
