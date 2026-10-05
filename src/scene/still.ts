/**
 * Still mode (#243): `?still` in the address freezes everything that moves with
 * the wall clock rather than the shot's own clock, so a paused frame renders
 * the same pixels every time. The visual regression screenshots use it.
 * Effects are already functions of sim time; what is left is the film grain,
 * the rocket trail's flicker and the camera's opening glide.
 */
let still: boolean | null = null;

export function isStill(): boolean {
  if (still === null) {
    try {
      still = new URLSearchParams(globalThis.location?.search ?? '').has('still');
    } catch {
      still = false;
    }
  }
  return still;
}

/** Seconds for wall-clock driven looks (grain, flicker): the real clock, or 0 when still. */
export function wallClockS(): number {
  return isStill() ? 0 : performance.now() / 1000;
}
