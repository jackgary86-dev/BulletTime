import { SLOWEST_RATE, beatFactor, beatSpans } from './impactBeat';
import { PlayClock } from './playClock';
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
 * and scrubbing are just changes to the playhead. It is the shared clock
 * (`PlayClock`, #242) playing simulated seconds, with the impact beat (#238)
 * and dead air between rounds (#153) as its beat and gaps.
 */
export class Playback extends PlayClock {
  /** Simulated seconds per real second. */
  override rate = 1 / 1000;
  /** Slow down on its own round each impact (#238). */
  impactBeat = true;
  timeline: Timeline | null = null;
  /** When the shots on the timeline first touch something (impacts and detonations), s. */
  private impacts: number[] = [];

  /**
   * The beat's multiplier on the chosen rate right now: 1 away from an impact,
   * down to a tenth through one. It never takes the rate below the slowest
   * preset, so a shot already at 1/100,000 plays as chosen.
   */
  override get beat(): number {
    if (!this.impactBeat || !this.timeline) return 1;
    return Math.max(beatFactor(this.position, this.impacts), Math.min(1, SLOWEST_RATE / this.rate));
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

  /** Plays `timeline` from `from` seconds (a later shot on a multi-shot timeline starts part-way in). */
  start(timeline: Timeline, from = 0): void {
    this.timeline = timeline;
    this.impacts = timeline.events.filter((e) => e.type === 'impact' || e.type === 'detonate').map((e) => e.t);
    this.load({ duration: timeline.duration, gaps: deadAir(timeline) }, from);
  }

  /** Clears the current shot. */
  stop(): void {
    this.timeline = null;
    this.impacts = [];
    this.unload();
  }

  get time(): number {
    return this.position;
  }

  /** Steps by `frames` display frames at the current slow-motion rate (negative steps back). */
  step(frames: number): void {
    this.stepBy(frames, Math.max(MIN_STEP_S, DISPLAY_FRAME_S * this.rate));
  }

  /** The stretches of dead air playback skips, for the scrubber to show. */
  get skipped(): readonly [number, number][] {
    return this.gaps;
  }
}
