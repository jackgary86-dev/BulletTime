/**
 * Adaptive render resolution (#332). Ultra and Extreme render at up to four times the device's pixel ratio, through
 * ambient occlusion, bloom, depth of field and the grade, and a big blast can push a frame well past budget. The
 * governor watches the time between frames and steps the render scale down when they run slow, and back up when they
 * have kept up for a while.
 *
 * Frames are capped at the display's refresh, so headroom cannot be seen directly: after a stretch of on-time frames
 * it tries one step up, and if that step runs slow it comes back down and waits twice as long before trying again,
 * so it settles instead of flickering between two sizes.
 */
export class ResolutionGovernor {
  /** Current step into `steps`: 0 is full resolution. */
  private step = 0;
  /** Smoothed frame time, ms. */
  private averageMs: number;
  private framesSinceChange = 0;
  private framesOnTime = 0;
  /** Frames on time before trying a step up; doubled after each step up that did not hold. */
  private upWait: number;
  /** True for a while after a step up, so a slow spell there counts against it. */
  private trialFrames = 0;

  constructor(
    /** The frame time to hold, ms. */
    readonly targetMs = 1000 / 60,
    /** Render scales, full first. */
    readonly steps: readonly number[] = [1, 0.85, 0.7, 0.6, 0.5],
    /** Frames on time before the first try at a step up. */
    readonly baseUpWait = 120,
    /** Longest wait between tries at a step up, in frames. */
    readonly maxUpWait = 3600,
  ) {
    this.averageMs = targetMs;
    this.upWait = baseUpWait;
  }

  /** The render scale to use, 0.5 to 1. */
  get scale(): number {
    return this.steps[this.step];
  }

  /** Back to full resolution and a fresh start (a new quality level, a new mode). */
  reset(): void {
    this.step = 0;
    this.averageMs = this.targetMs;
    this.framesSinceChange = 0;
    this.framesOnTime = 0;
    this.upWait = this.baseUpWait;
    this.trialFrames = 0;
  }

  /** Feeds the time since the last drawn frame, in ms. Returns true when the scale changed. */
  frame(ms: number): boolean {
    // A stall (shaders compiling, the tab hidden) says nothing about the load of a frame.
    if (!(ms > 0) || ms > 250) return false;
    const target = this.targetMs;
    this.averageMs += 0.1 * (ms - this.averageMs);
    this.framesSinceChange++;
    if (this.trialFrames > 0) this.trialFrames--;

    const slow = this.averageMs > target * 1.25;
    this.framesOnTime = this.averageMs <= target * 1.1 ? this.framesOnTime + 1 : 0;

    // Step down once a change has had time to show in the average.
    if (slow && this.framesSinceChange >= 30 && this.step < this.steps.length - 1) {
      // A step up that ran slow straight away: wait longer before the next try.
      if (this.trialFrames > 0) this.upWait = Math.min(this.maxUpWait, this.upWait * 2);
      this.change(this.step + 1);
      return true;
    }
    if (this.framesOnTime >= this.upWait && this.step > 0) {
      this.change(this.step - 1);
      this.trialFrames = 120;
      return true;
    }
    return false;
  }

  private change(step: number): void {
    this.step = step;
    this.framesSinceChange = 0;
    this.framesOnTime = 0;
    // Start the average fresh at the target, so the new size is judged on its own frames.
    this.averageMs = this.targetMs;
  }
}

/**
 * The display's frame interval, ms, measured over a few animation frames while nothing 3D is drawing yet (at start-up),
 * so the governor aims at what the display can show: 60 fps, or a slower display's own refresh.
 */
export async function displayFrameMs(frames = 12): Promise<number> {
  const times: number[] = [];
  let last = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
  for (let i = 0; i < frames; i++) {
    const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
    times.push(now - last);
    last = now;
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}
