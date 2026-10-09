/**
 * Redraw the shadow maps only when a shadow caster may have moved (#331). The key light's map is up to 4096² on Ultra
 * and was redrawn on every render, though the lab, the stand and the target sit still and a paused frame moves
 * nothing. Shadows are drawn from the light, so the camera moving changes nothing; what does is the shot playing
 * (the sim time changing: projectiles, debris, a stand toppling) and the scene being changed (a new target, round,
 * quality or lighting, or an asset finishing loading), which the caller reports with `invalidate()`. An idle map is
 * still refreshed once a second, as a safety net.
 */
export class ShadowGate {
  private lastT: number | null | undefined = undefined;
  private dirty = true;
  private sinceUpdateS = 0;

  constructor(
    /** The map is refreshed at least this often, in seconds. */
    readonly keepAliveS = 1,
  ) {}

  /** The scene changed in a way the sim time does not show. */
  invalidate(): void {
    this.dirty = true;
  }

  /** Whether the shadow maps need redrawing for a frame at sim time `t` (null when nothing is loaded or playing). */
  shouldUpdate(t: number | null, deltaS: number): boolean {
    this.sinceUpdateS += Math.max(0, deltaS);
    const update = this.dirty || t !== this.lastT || this.sinceUpdateS >= this.keepAliveS;
    this.dirty = false;
    this.lastT = t;
    if (update) this.sinceUpdateS = 0;
    return update;
  }
}
