import { getMedium, type MediumSpec } from '../data/media';
import type { BulletSpec } from '../data/bullets';
import { overpressureKPa } from './blastResponse';
import { layersFor, simulate } from './engine';
import { seededRandom } from './random';
import { appendShot } from './session';
import type { Timeline, Vec3 } from './types';

/**
 * Gel witness blocks inside a mock building (#249): what gets through the
 * struck wall, read off blocks of 10% gelatin placed in the room behind it.
 *
 * Works in the building's frame: x runs from the struck wall's back face into
 * the room, y is up from the shot line and z is across the face. A block
 * counts the pieces whose paths cross its volume (the wall's own fragments,
 * jets and the round, plus scab torn off the back of a concrete or brick wall
 * where something perforated it), and each piece is then shot into the gel
 * with the same `simulate()` a Bullet lab shot uses, so the per-block depths
 * are the gel model's own numbers. Pure: no three.js.
 */

export interface WitnessBlock {
  /** From the struck wall's back face to the block's front face, m. */
  distM: number;
  /** Centre of the block across the face, m (0 = on the shot line). */
  lateralM: number;
}

export const MAX_WITNESS_BLOCKS = 6;
/** A 40 x 20 x 20 cm block: 40 cm along the shot, 20 cm high and wide. */
export const WITNESS_BLOCK = { depthM: 0.4, faceM: 0.2 } as const;
/** Peak overpressure above which the blast front alone would be felt at the block (breaks windows), kPa. */
export const BLAST_FELT_KPA = 7;
/** Share of the outside overpressure that reaches a point inside the room past the struck wall (a rough figure for a closed room). */
export const WALL_TRANSMISSION = 0.02;

/** The witness gel: the standard 10% block, at the witness block's face size. */
export const WITNESS_GEL: MediumSpec = { ...getMedium('gel10'), id: 'witness-gel', heightM: WITNESS_BLOCK.faceM, widthM: WITNESS_BLOCK.faceM, dummyOnly: true };

/** Where the room is, in the world: the shot-line origin, the stack's turn and the wall's back face. */
export interface WitnessFrame {
  /** The struck face at the shot line, world coordinates. */
  origin: Vec3;
  /** Impact angle of the stack, degrees (the building turns with it). */
  angleDeg: number;
  /** Thickness of the struck wall, m. */
  wallM: number;
  /** Depth of the room from the wall's back face to the far wall, m. */
  roomM: number;
  /** The struck wall, for its scab. */
  wall: MediumSpec;
}

export interface WitnessPiece {
  kind: 'round' | 'fragment' | 'scab';
  massKg: number;
  diameterM: number;
  speed: number;
  /** When it reaches the block's face, s. */
  t: number;
  /** Where it enters the block, in the building frame. */
  at: Vec3;
}

export interface WitnessResult {
  block: WitnessBlock;
  pieces: WitnessPiece[];
  /** Deepest track in the gel, m. */
  deepestM: number;
  /** Widest temporary cavity, m (diameter). */
  widestCavityM: number;
  /** Peak blast overpressure at the block, kPa (0 with no detonation). */
  blastKPa: number;
  blastFelt: boolean;
  /** Every piece's gel shot, on the session's clock, for the block's effects; null when nothing reached it. */
  timeline: Timeline | null;
}

export interface Box {
  min: Vec3;
  max: Vec3;
}

/** The block's volume in the building frame. */
export function witnessBox(block: WitnessBlock): Box {
  const h = WITNESS_BLOCK.faceM / 2;
  return {
    min: { x: block.distM, y: -h, z: block.lateralM - h },
    max: { x: block.distM + WITNESS_BLOCK.depthM, y: h, z: block.lateralM + h },
  };
}

/** Keeps blocks inside the room and the building's width, at most six, front faces at least 10 cm off the wall. */
export function clampBlocks(blocks: readonly WitnessBlock[], roomM: number, widthM: number): WitnessBlock[] {
  const maxDist = Math.max(0.1, roomM - WITNESS_BLOCK.depthM - 0.05);
  const maxLat = Math.max(0, widthM / 2 - WITNESS_BLOCK.faceM);
  return blocks.slice(0, MAX_WITNESS_BLOCKS).map((b) => ({
    distM: Math.min(maxDist, Math.max(0.1, b.distM)),
    lateralM: Math.min(maxLat, Math.max(-maxLat, b.lateralM)),
  }));
}

/** World to building frame: undo the stack's turn about the shot-line origin, then step past the wall. */
export function toBuildingFrame(p: Vec3, frame: WitnessFrame): Vec3 {
  const a = (frame.angleDeg * Math.PI) / 180;
  const dx = p.x - frame.origin.x;
  const dz = p.z - frame.origin.z;
  // The group is turned by +a about y; its inverse turns by -a.
  const x = dx * Math.cos(a) - dz * Math.sin(a);
  const z = dx * Math.sin(a) + dz * Math.cos(a);
  return { x: x - frame.wallM, y: p.y - frame.origin.y, z };
}

/** The middle of the block's front face in the world: the building frame turned back by the stack's angle. */
export function blockFrontWorld(block: WitnessBlock, frame: WitnessFrame): Vec3 {
  const a = (frame.angleDeg * Math.PI) / 180;
  const x = block.distM + frame.wallM;
  const z = block.lateralM;
  return { x: frame.origin.x + x * Math.cos(a) + z * Math.sin(a), y: frame.origin.y, z: frame.origin.z - x * Math.sin(a) + z * Math.cos(a) };
}

/** Where the segment p0 → p1 first enters the box, as a fraction along it, or null (slab method). */
export function segmentEntersBox(p0: Vec3, p1: Vec3, box: Box): number | null {
  let t0 = 0;
  let t1 = 1;
  for (const axis of ['x', 'y', 'z'] as const) {
    const d = p1[axis] - p0[axis];
    if (Math.abs(d) < 1e-12) {
      if (p0[axis] < box.min[axis] || p0[axis] > box.max[axis]) return null;
      continue;
    }
    let a = (box.min[axis] - p0[axis]) / d;
    let b = (box.max[axis] - p0[axis]) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

const lerp = (a: Vec3, b: Vec3, f: number): Vec3 => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f });

/** The timeline's pieces (round, pellets, fragments) whose paths cross the block inside the room. */
export function trackPiecesReaching(timeline: Timeline, frame: WitnessFrame, box: Box): WitnessPiece[] {
  const pieces: WitnessPiece[] = [];
  for (const track of timeline.tracks) {
    const kfs = track.keyframes;
    let hit = false;
    for (let i = 0; i + 1 < kfs.length; i++) {
      const p0 = toBuildingFrame(kfs[i].pos, frame);
      const p1 = toBuildingFrame(kfs[i + 1].pos, frame);
      // Only the stretch inside the room: past the wall, short of the far wall.
      if (Math.max(p0.x, p1.x) <= 0 || Math.min(p0.x, p1.x) >= frame.roomM) continue;
      const f = segmentEntersBox(p0, p1, box);
      if (f === null) continue;
      const speed = kfs[i].speed + (kfs[i + 1].speed - kfs[i].speed) * f;
      if (speed < 1) break;
      pieces.push({
        kind: track.kind === 'fragment' ? 'fragment' : 'round',
        massKg: track.massKg,
        diameterM: Math.max(1e-4, kfs[i].diameter),
        speed,
        t: kfs[i].t + (kfs[i + 1].t - kfs[i].t) * f,
        at: lerp(p0, p1, f),
      });
      hit = true;
      break;
    }
    // The engine stops following a piece a little way past the wall; one still flying carries on straight across the room.
    const last = kfs[kfs.length - 1];
    if (hit || !last || last.speed < 1) continue;
    const p0 = toBuildingFrame(last.pos, frame);
    if (p0.x <= 0 || p0.x >= frame.roomM) continue;
    const a = (frame.angleDeg * Math.PI) / 180;
    const dir = { x: last.dir.x * Math.cos(a) - last.dir.z * Math.sin(a), y: last.dir.y, z: last.dir.x * Math.sin(a) + last.dir.z * Math.cos(a) };
    if (dir.x <= 0) continue;
    const run = (frame.roomM - p0.x) / dir.x;
    const p1 = { x: p0.x + dir.x * run, y: p0.y + dir.y * run, z: p0.z + dir.z * run };
    const f = segmentEntersBox(p0, p1, box);
    if (f === null) continue;
    pieces.push({
      kind: track.kind === 'fragment' ? 'fragment' : 'round',
      massKg: track.massKg,
      diameterM: Math.max(1e-4, last.diameter),
      speed: last.speed,
      t: last.t + (f * run) / last.speed,
      at: lerp(p0, p1, f),
    });
  }
  return pieces;
}

/** Scab chunks per perforation of a concrete or brick wall, their mass range (kg) and speed range (m/s). */
const SCAB = { count: 14, massKg: [0.02, 0.15], speed: [40, 160], coneRad: 0.45 } as const;

/**
 * Scab torn off the back of a concrete or brick wall where something
 * perforated it: a cone of chunks leaving the exit point, seeded by the shot
 * so the same shot gives the same chunks. Each chunk flies straight across the
 * room; the ones whose paths cross the block reach it.
 */
export function scabPiecesReaching(timeline: Timeline, frame: WitnessFrame, box: Box): WitnessPiece[] {
  if (frame.wall.behaviour !== 'concrete') return [];
  const exits = timeline.events.filter((e) => e.type === 'exit' && e.layer === 0);
  if (exits.length === 0) return [];
  // One cone at the first exit is the scab; later exits through the same hole add nothing new.
  const exit = exits[0];
  const from = toBuildingFrame(exit.pos, frame);
  const rand = seededRandom(Math.round(exit.t * 1e9) + timeline.tracks.length);
  const pieces: WitnessPiece[] = [];
  for (let i = 0; i < SCAB.count; i++) {
    const theta = Math.sqrt(rand()) * SCAB.coneRad;
    const phi = rand() * Math.PI * 2;
    const dir = { x: Math.cos(theta), y: Math.sin(theta) * Math.sin(phi), z: Math.sin(theta) * Math.cos(phi) };
    const speed = SCAB.speed[0] + rand() * (SCAB.speed[1] - SCAB.speed[0]);
    const massKg = SCAB.massKg[0] + rand() * (SCAB.massKg[1] - SCAB.massKg[0]);
    const start = { x: Math.max(0, from.x), y: from.y, z: from.z };
    const end = { x: start.x + dir.x * frame.roomM, y: start.y + dir.y * frame.roomM, z: start.z + dir.z * frame.roomM };
    const f = segmentEntersBox(start, end, box);
    if (f === null) continue;
    const dist = f * frame.roomM;
    pieces.push({
      kind: 'scab',
      massKg,
      // A chunk of the wall's density, as a sphere.
      diameterM: Math.cbrt((6 * massKg) / (Math.PI * frame.wall.density)),
      speed,
      t: exit.t + dist / speed,
      at: lerp(start, end, f),
    });
  }
  return pieces;
}

/** A piece as a round to shoot into the gel: blunt, intact, at its own speed. */
export function pieceAsRound(p: WitnessPiece, index: number): BulletSpec {
  const mm = p.diameterM * 1000;
  return {
    id: `witness-${p.kind}-${index}`,
    name: `Witness ${p.kind}`,
    type: p.kind,
    description: 'A piece that came through the wall.',
    caliberMm: mm,
    lengthMm: mm,
    massGrains: (p.massKg * 1000) / 0.06479891,
    muzzleVelocityMs: p.speed,
    behaviour: 'intact',
    shape: 'roundNose',
    // Irregular chunks and fragments drag like blunt bodies.
    noseDragFactor: p.kind === 'round' ? 1.2 : 2.4,
  };
}

/** Results for each block: what reached it, the gel's deepest track and widest cavity, and the blast there. */
export function witnessResults(timeline: Timeline, frame: WitnessFrame, blocks: readonly WitnessBlock[]): WitnessResult[] {
  const detonation = timeline.events.find((e) => e.type === 'detonate' && e.yieldKg !== undefined);
  const layers = layersFor(WITNESS_GEL, WITNESS_BLOCK.depthM);
  return blocks.map((block) => {
    const box = witnessBox(block);
    const pieces = [...trackPiecesReaching(timeline, frame, box), ...scabPiecesReaching(timeline, frame, box)].sort((a, b) => a.t - b.t);
    let deepestM = 0;
    let widestCavityM = 0;
    let session: Timeline | null = null;
    pieces.forEach((piece, i) => {
      const part = simulate({
        bullet: pieceAsRound(piece, i),
        layers,
        angleDeg: frame.angleDeg,
        // Shot at the block where it stands, so the gel effects draw on the block in the room.
        impactPoint: (() => {
          const front = blockFrontWorld(block, frame);
          return { x: front.x, y: front.y + piece.at.y, z: front.z + (piece.at.z - block.lateralM) };
        })(),
        standOffM: 0.02,
      });
      deepestM = Math.max(deepestM, part.summary.penetrationM);
      for (const c of part.cavity) widestCavityM = Math.max(widestCavityM, 2 * c.radius);
      const impact = part.events.find((e) => e.type === 'impact')?.t ?? 0;
      session = appendShot(session, part, piece.t - impact);
    });
    let blastKPa = 0;
    if (detonation?.yieldKg) {
      const c = { x: block.distM + WITNESS_BLOCK.depthM / 2, y: 0, z: block.lateralM };
      const d = toBuildingFrame(detonation.pos, frame);
      blastKPa = overpressureKPa(detonation.yieldKg, Math.max(0.1, Math.hypot(c.x - d.x, c.y - d.y, c.z - d.z)));
      // A detonation outside the wall: the wall reflects most of the front, and what leaks in (round the edges,
      // through openings, through a jet's narrow hole) is a small share of it.
      if (d.x < 0) blastKPa *= WALL_TRANSMISSION;
    }
    return { block, pieces, deepestM, widestCavityM, blastKPa, blastFelt: blastKPa >= BLAST_FELT_KPA, timeline: session };
  });
}
