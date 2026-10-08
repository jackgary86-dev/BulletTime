/**
 * Draw only the frames that change (#329). The whole chain (shadows, ambient occlusion, bloom, depth of field, the
 * grade and the transmission pass behind gel and glass) used to run every display frame, paused or not. A frame is
 * now drawn when what it shows has changed (the camera, the sim time, the canvas size, playback), when something on
 * screen animates by itself (a missile's flickering plume), or when input or a setting asks for it; then for a short
 * settle window, so springs and fades finish; and once a second while idle, as a safety net for any change that
 * nothing reported. Film grain and plume flicker hold still on an idle frame, as a still image would.
 */
export class FrameGate {
  private last = '';
  private dirty = true;
  private idleFrames = 0;
  private sinceDrawS = 0;

  constructor(
    /** Frames still drawn after the last change. */
    readonly settleFrames = 20,
    /** An idle frame is redrawn at least this often, in seconds. */
    readonly keepAliveS = 1,
  ) {}

  /** Something changed that the signature does not see: input, a setting, an asset that finished loading. */
  invalidate(): void {
    this.dirty = true;
  }

  /**
   * Whether to draw this frame. `signature` sums up what the frame shows; `live` is true while something animates on
   * its own; `deltaS` is the time since the last call.
   */
  shouldDraw(signature: string, live: boolean, deltaS: number): boolean {
    const changed = this.dirty || live || signature !== this.last;
    this.dirty = false;
    this.last = signature;
    this.idleFrames = changed ? 0 : this.idleFrames + 1;
    this.sinceDrawS += Math.max(0, deltaS);
    const draw = this.idleFrames < this.settleFrames || this.sinceDrawS >= this.keepAliveS;
    if (draw) this.sinceDrawS = 0;
    return draw;
  }
}

/** What a camera shows, to a precision well below a pixel, as part of a frame signature. */
export function cameraSignature(camera: { position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number }; fov: number; zoom: number }): string {
  const { position: p, quaternion: q } = camera;
  return [p.x, p.y, p.z, q.x, q.y, q.z, q.w, camera.fov, camera.zoom].map((v) => v.toFixed(6)).join(',');
}
