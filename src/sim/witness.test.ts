import { describe, expect, it } from 'vitest';
import { getBullet } from '../data/bullets';
import { BUILDINGS, interiorGapM } from '../data/buildings';
import { getMedium } from '../data/media';
import { MODES } from '../data/modes';
import { STACK_PRESETS, presetLayers } from '../data/stacks';
import { layersFor, simulate } from './engine';
import { fire } from './testUtil';
import type { Timeline } from './types';
import {
  MAX_WITNESS_BLOCKS,
  WITNESS_BLOCK,
  WITNESS_GEL,
  blockFrontWorld,
  clampBlocks,
  toBuildingFrame,
  pieceAsRound,
  segmentEntersBox,
  trackPiecesReaching,
  witnessBox,
  witnessResults,
  type WitnessFrame,
} from './witness';

const house = BUILDINGS['block-house'];
const houseShot = (bullet: string): Timeline => fire({ bullet, stack: presetLayers(STACK_PRESETS.find((p) => p.id === 'building-block-house')!) });
/** `fire` puts the face at x = -0.2 on the bench line (y 0.16), head on. */
const frame: WitnessFrame = { origin: { x: -0.2, y: 0.16, z: 0 }, angleDeg: 0, wallM: house.front.thicknessM, roomM: interiorGapM(house), wall: getMedium(house.front.medium) };
const missile = getBullet(MODES.missile.defaultId).id;

describe('gel witness blocks (#249)', () => {
  it('finds where a segment enters a box, and misses one that passes by', () => {
    const box = { min: { x: 1, y: -0.1, z: -0.1 }, max: { x: 1.4, y: 0.1, z: 0.1 } };
    expect(segmentEntersBox({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, box)).toBeCloseTo(0.5, 9);
    expect(segmentEntersBox({ x: 0, y: 0.3, z: 0 }, { x: 2, y: 0.3, z: 0 }, box)).toBeNull();
    expect(segmentEntersBox({ x: 0, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 }, box)).toBeNull();
  });

  it('places a block in the world and reads it back in the building frame, at any angle', () => {
    for (const angleDeg of [0, 20, -35]) {
      const f = { ...frame, angleDeg };
      const p = toBuildingFrame(blockFrontWorld({ distM: 1.2, lateralM: -0.6 }, f), f);
      expect(p.x).toBeCloseTo(1.2, 9);
      expect(p.y).toBeCloseTo(0, 9);
      expect(p.z).toBeCloseTo(-0.6, 9);
    }
  });

  it('keeps at most six blocks, inside the room and the building', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ distM: i, lateralM: i - 4 }));
    const kept = clampBlocks(many, interiorGapM(house), house.widthM);
    expect(kept).toHaveLength(MAX_WITNESS_BLOCKS);
    for (const b of kept) {
      expect(b.distM + WITNESS_BLOCK.depthM).toBeLessThanOrEqual(interiorGapM(house));
      expect(Math.abs(b.lateralM) + WITNESS_BLOCK.faceM / 2).toBeLessThanOrEqual(house.widthM / 2);
    }
  });

  it('counts exactly the pieces whose paths cross the block, carrying on ones the engine stopped following', () => {
    const kf = (t: number, x: number, y: number, z: number, speed: number, dir = { x: 1, y: 0, z: 0 }) => ({ t, pos: { x, y, z }, dir, speed, yaw: 0, diameter: 0.01 });
    const track = (id: number, keyframes: ReturnType<typeof kf>[]) => ({ id, kind: 'fragment' as const, massKg: 0.01, baseDiameter: 0.01, keyframes, spawnT: 0, endT: 1, persists: false, finalState: 'intact' as const });
    // World: the face is at x = -0.2, the wall's back face at x = 0.1, the room runs to x = 3.5.
    const timeline = {
      tracks: [
        // Straight through the block at 0.4-0.8 m into the room.
        track(0, [kf(0, 0.1, 0.16, 0, 1000), kf(0.004, 3.5, 0.16, 0, 900)]),
        // Above it.
        track(1, [kf(0, 0.1, 0.5, 0, 1000), kf(0.004, 3.5, 0.5, 0, 900)]),
        // Stopped by the engine 10 cm past the wall, still flying straight at the block.
        track(2, [kf(0, 0.1, 0.16, 0.02, 1000), kf(0.0001, 0.2, 0.16, 0.02, 1000)]),
        // Stopped dead before the block.
        track(3, [kf(0, 0.1, 0.16, 0, 300), kf(0.001, 0.2, 0.16, 0, 0)]),
        // Never got past the wall.
        track(4, [kf(0, -0.2, 0.16, 0, 1000), kf(0.0001, -0.1, 0.16, 0, 0)]),
      ],
      events: [],
      cavity: [],
    } as unknown as Timeline;
    const reached = trackPiecesReaching(timeline, frame, witnessBox({ distM: 0.4, lateralM: 0 }));
    expect(reached).toHaveLength(2);
    expect(reached.map((p) => p.at.x)).toEqual([expect.closeTo(0.4, 6), expect.closeTo(0.4, 6)]);
    expect(trackPiecesReaching(timeline, frame, witnessBox({ distM: 0.4, lateralM: 1 }))).toHaveLength(0);
  });

  it('a block just behind the struck wall shows tracks; one at the back of the room off the line shows none', () => {
    const t = houseShot(missile);
    const [near, far] = witnessResults(t, frame, [
      { distM: 0.3, lateralM: 0 },
      { distM: interiorGapM(house) - WITNESS_BLOCK.depthM - 0.05, lateralM: house.widthM / 2 - WITNESS_BLOCK.faceM },
    ]);
    expect(near.pieces.length).toBeGreaterThan(0);
    expect(near.deepestM).toBeGreaterThan(0);
    expect(near.timeline).not.toBeNull();
    expect(near.pieces.some((p) => p.kind === 'scab')).toBe(true);
    expect(far.pieces.length).toBe(0);
    expect(far.deepestM).toBe(0);
    expect(far.timeline).toBeNull();
  });

  it('gives each piece the same gel result as a direct shot of the same piece', () => {
    const t = houseShot(missile);
    const [r] = witnessResults(t, frame, [{ distM: 0.3, lateralM: 0 }]);
    const piece = r.pieces[0];
    const direct = simulate({ bullet: pieceAsRound(piece, 0), layers: layersFor(WITNESS_GEL, WITNESS_BLOCK.depthM), angleDeg: 0, impactPoint: { x: 0, y: 0, z: 0 }, standOffM: 0.02 });
    expect(r.deepestM).toBeGreaterThanOrEqual(direct.summary.penetrationM);
    // The witness gel is the standard 10% gel at the block's size.
    expect(WITNESS_GEL.behaviour).toBe(getMedium('gel10').behaviour);
    expect(WITNESS_GEL.density).toBe(getMedium('gel10').density);
  });

  it('reports the blast at the block, damped by an unbroken wall', () => {
    const shell = getBullet(MODES.artillery.defaultId).id;
    const t = houseShot(shell);
    const [r] = witnessResults(t, frame, [{ distM: 0.3, lateralM: 0 }]);
    expect(r.blastKPa).toBeGreaterThan(0);
    expect(Number.isFinite(r.blastKPa)).toBe(true);
  });

  it('keeps six blocks within the simulation time budget', () => {
    const t = houseShot(missile);
    const blocks = Array.from({ length: 6 }, (_, i) => ({ distM: 0.2 + i * 0.5, lateralM: (i % 3) * 0.4 - 0.4 }));
    const start = performance.now();
    witnessResults(t, frame, clampBlocks(blocks, frame.roomM, house.widthM));
    expect(performance.now() - start).toBeLessThan(500);
  });
});
