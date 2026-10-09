import { describe, expect, it } from 'vitest';
import { FrameGate, cameraSignature } from './frameGate';

const FRAME = 1 / 60;
/** Runs `n` frames with the same signature and counts the ones drawn. */
const run = (gate: FrameGate, n: number, signature = 'still', live = false) => {
  let drawn = 0;
  for (let i = 0; i < n; i++) if (gate.shouldDraw(signature, live, FRAME)) drawn++;
  return drawn;
};

describe('drawing only the frames that change (#329)', () => {
  it('draws the first frames, settles, then stops drawing an unchanged frame', () => {
    const gate = new FrameGate(20, 1);
    expect(run(gate, 20)).toBe(20);
    // Half a second idle: nothing more.
    expect(run(gate, 30)).toBe(0);
  });

  it('draws again as soon as what the frame shows changes, and settles again after', () => {
    const gate = new FrameGate(20, 1);
    run(gate, 60);
    expect(gate.shouldDraw('moved', false, FRAME)).toBe(true);
    expect(run(gate, 19, 'moved')).toBe(19);
    expect(run(gate, 10, 'moved')).toBe(0);
  });

  it('keeps drawing while something animates on its own, and while playback runs', () => {
    const gate = new FrameGate(20, 1);
    run(gate, 60);
    expect(run(gate, 120, 'still', true)).toBe(120);
    let drawn = 0;
    for (let i = 0; i < 120; i++) if (gate.shouldDraw(`t=${i}`, false, FRAME)) drawn++;
    expect(drawn).toBe(120);
  });

  it('draws after an invalidation (input, a setting, a loaded texture) with nothing in the signature', () => {
    const gate = new FrameGate(20, 1);
    run(gate, 60);
    gate.invalidate();
    expect(gate.shouldDraw('still', false, FRAME)).toBe(true);
  });

  it('redraws an idle frame about once a second, as a safety net', () => {
    const gate = new FrameGate(20, 1);
    run(gate, 20);
    // Ten seconds idle at 60 fps: about ten frames, not six hundred.
    const drawn = run(gate, 600);
    expect(drawn).toBeGreaterThanOrEqual(9);
    expect(drawn).toBeLessThanOrEqual(11);
  });

  it('tells camera poses apart well below a pixel, and treats an identical pose as unchanged', () => {
    const cam = (x: number) => ({ position: { x, y: 1, z: 2 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, fov: 40, zoom: 1 });
    expect(cameraSignature(cam(0.5))).toBe(cameraSignature(cam(0.5)));
    expect(cameraSignature(cam(0.5))).not.toBe(cameraSignature(cam(0.50001)));
  });
});
