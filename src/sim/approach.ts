import { BUILDINGS, buildingForFront } from '../data/buildings';
import { getMedium } from '../data/media';
import { stackDepth, type StackLayer } from '../data/stacks';
import { segmentEntersBox, type Box } from './witness';
import type { Vec3 } from './types';

/**
 * Missile approach from any angle (#250): a dive angle and a bearing pick the
 * direction the round arrives from; tracing that path back from the middle of
 * the target finds the face it meets first (the front wall or hull side at a
 * shallow angle, the roof or turret top in a steep dive, a side wall from far
 * round), the obliquity to that face, and the layers behind it.
 *
 * The engine always shoots along +x into a face turned `obliquity` degrees
 * about y. `engineToWorld` gives the turn and shift that carries that frame
 * onto the real path and face, so the round, its plume and every effect can
 * be drawn where the hit really is. Pure: no three.js.
 *
 * The target frame has its origin on the struck front face at the shot line,
 * x into the target, y up and z across, like the world when the stack is not
 * turned.
 */

export interface Approach {
  /** 0 = level, 90 = straight down. */
  diveDeg: number;
  /** Which side it comes from: 0 = head on along the shot line, positive from the -z side (heading toward +z). */
  bearingDeg: number;
}

export const LEVEL: Approach = { diveDeg: 0, bearingDeg: 0 };
export const MAX_DIVE_DEG = 90;
export const MAX_BEARING_DEG = 75;
export const BEARING_STEP_DEG = 15;
/** How far out the run starts, m: well past the edge of the proving ground. */
export const RUN_IN_M = 600;
/** Half the side of the proving ground's ground plane, m. */
export const SITE_HALF_EXTENT_M = 200;

export type Face = 'front' | 'top' | 'side';

/** The target as a box, and the layers a hit from above meets (none for a plain plate or wall). */
export interface TargetShape {
  box: Box;
  top: StackLayer[] | null;
}

export interface ApproachHit {
  face: Face;
  /** Outward normal of the struck face. */
  normal: Vec3;
  /** Unit direction of travel. */
  dir: Vec3;
  /** Where the path meets the target, in the target frame. */
  entry: Vec3;
  /** Angle between the path and the face normal, degrees. */
  obliquityDeg: number;
  /** The layers the round goes through from that face. */
  layers: StackLayer[];
}

export const isLevel = (a: Approach): boolean => Math.abs(a.diveDeg) < 1e-9 && Math.abs(a.bearingDeg) < 1e-9;

/** Keeps the dive in 0-90° and the bearing within ±75° in 15° steps. */
export function clampApproach(a: Approach): Approach {
  return {
    diveDeg: Math.min(MAX_DIVE_DEG, Math.max(0, a.diveDeg)),
    bearingDeg: Math.min(MAX_BEARING_DEG, Math.max(-MAX_BEARING_DEG, Math.round(a.bearingDeg / BEARING_STEP_DEG) * BEARING_STEP_DEG)),
  };
}

/** Unit direction of travel for the angles. */
export function approachDir(a: Approach): Vec3 {
  const d = (a.diveDeg * Math.PI) / 180;
  const b = (a.bearingDeg * Math.PI) / 180;
  return { x: Math.cos(d) * Math.cos(b), y: -Math.sin(d), z: Math.cos(d) * Math.sin(b) };
}

const layer = (id: string, thickness: number, gapM = 0): StackLayer => ({ medium: getMedium(id), thickness, gapM });

/** Tank (#231): the hull is 3.4 m across, its side plate rides 0.95-1.85 m up and the turret top is 0.75 m above the hull roof. */
const TANK = { depthM: 3.4, turretAboveRoofM: 0.75, roof: 0.04, roomM: 1.6, floor: 0.02 } as const;

/** The target's box in the target frame, with `lineY` the shot line's height above the ground, and its top layers. */
export function targetShape(layers: readonly StackLayer[], lineY: number): TargetShape {
  const front = layers[0];
  const building = front ? buildingForFront(front.medium.id) : undefined;
  if (building) {
    const r = building.roof;
    return {
      box: { min: { x: 0, y: -lineY, z: -building.widthM / 2 }, max: { x: building.depthM, y: building.heightM - lineY, z: building.widthM / 2 } },
      top: [layer(r.medium, r.thicknessM), layer(r.floor.medium, r.floor.thicknessM, r.roomM)],
    };
  }
  if (front?.medium.id === 'tank-hull') {
    const top = front.medium.heightM / 2 + TANK.turretAboveRoofM;
    return {
      box: { min: { x: 0, y: -lineY, z: -front.medium.widthM / 2 }, max: { x: TANK.depthM, y: top, z: front.medium.widthM / 2 } },
      top: [layer('turret-roof', TANK.roof), layer('hull-floor', TANK.floor, TANK.roomM)],
    };
  }
  const halfH = Math.max(0.05, ...layers.map((l) => l.medium.heightM / 2));
  const halfW = Math.max(0.05, ...layers.map((l) => l.medium.widthM / 2));
  return { box: { min: { x: 0, y: -halfH, z: -halfW }, max: { x: Math.max(0.01, stackDepth([...layers])), y: halfH, z: halfW } }, top: null };
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Where the path at `approach` meets the target, aimed at the middle of the
 * target at the shot line, and what it goes through there.
 */
export function approachHit(approach: Approach, layers: readonly StackLayer[], lineY: number): ApproachHit {
  const a = clampApproach(approach);
  const dir = approachDir(a);
  const shape = targetShape(layers, lineY);
  const { box } = shape;
  const aim = { x: (box.min.x + box.max.x) / 2, y: 0, z: 0 };
  const far = 1000;
  const start = { x: aim.x - dir.x * far, y: aim.y - dir.y * far, z: aim.z - dir.z * far };
  const f = segmentEntersBox(start, aim, box) ?? 1;
  const entry = { x: start.x + (aim.x - start.x) * f, y: start.y + (aim.y - start.y) * f, z: start.z + (aim.z - start.z) * f };
  // The face is the one the entry point lies on (the nearest, to allow for rounding).
  const eps = 1e-6;
  let face: Face = 'front';
  let normal: Vec3 = { x: -1, y: 0, z: 0 };
  if (Math.abs(entry.y - box.max.y) < eps && shape.top) {
    face = 'top';
    normal = { x: 0, y: 1, z: 0 };
  } else if (Math.abs(entry.z - box.min.z) < eps || Math.abs(entry.z - box.max.z) < eps) {
    face = 'side';
    normal = { x: 0, y: 0, z: Math.abs(entry.z - box.min.z) < eps ? -1 : 1 };
  } else if (Math.abs(entry.y - box.max.y) < eps) {
    // A plate or wall seen from above has no roof: the path meets its front face, very obliquely.
    face = 'front';
  }
  const cos = Math.min(1, Math.max(0, -dot(dir, normal)));
  return {
    face,
    normal,
    dir,
    entry,
    obliquityDeg: (Math.acos(cos) * 180) / Math.PI,
    layers: face === 'top' && shape.top ? shape.top : [...layers],
  };
}

/** Where the run starts, `distanceM` back along the path from the entry point (in the same frame). */
export function pathStart(hit: ApproachHit, distanceM = RUN_IN_M): Vec3 {
  return { x: hit.entry.x - hit.dir.x * distanceM, y: hit.entry.y - hit.dir.y * distanceM, z: hit.entry.z - hit.dir.z * distanceM };
}

/** Whether a point (target frame, near enough the world) is outside the proving ground: past its edge or high above it. */
export function outsideSite(p: Vec3): boolean {
  return Math.max(Math.abs(p.x), Math.abs(p.z)) > SITE_HALF_EXTENT_M || p.y > SITE_HALF_EXTENT_M;
}

type Basis = [Vec3, Vec3, Vec3];

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const sub = (a: Vec3, b: Vec3, k = 1): Vec3 => ({ x: a.x - b.x * k, y: a.y - b.y * k, z: a.z - b.z * k });

/** An orthonormal basis from the direction of travel and the face normal (the normal's part across the path is the second axis). */
function basis(dir: Vec3, normal: Vec3, fallback: Vec3): Basis {
  const u1 = norm(dir);
  let u2 = sub(normal, u1, dot(normal, u1));
  if (Math.hypot(u2.x, u2.y, u2.z) < 1e-6) u2 = sub(fallback, u1, dot(fallback, u1));
  u2 = norm(u2);
  return [u1, u2, cross(u1, u2)];
}

/**
 * The 4 x 4 transform (row-major, for `Matrix4.set`) carrying the engine's
 * frame onto the world: the engine shoots along +x into a face whose outward
 * normal is (-cos θ, 0, sin θ) with its centre at `engineFace`; the world
 * round travels along `hit.dir` into `hit.normal` with the face's entry at
 * `worldEntry`.
 */
export function engineToWorld(hit: ApproachHit, engineFace: Vec3, worldEntry: Vec3): number[] {
  const t = (hit.obliquityDeg * Math.PI) / 180;
  const e = basis({ x: 1, y: 0, z: 0 }, { x: -Math.cos(t), y: 0, z: Math.sin(t) }, { x: 0, y: 1, z: 0 });
  // Head on, the second axis is free: keep the engine's up as close to the world's as the path allows.
  const up = Math.abs(hit.dir.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const w = basis(hit.dir, hit.normal, up);
  // R = W · Eᵀ: engine basis vector i goes to world basis vector i.
  const r = (i: number, j: number) => w[0][key(i)] * e[0][key(j)] + w[1][key(i)] * e[1][key(j)] + w[2][key(i)] * e[2][key(j)];
  const R = [0, 1, 2].map((i) => [0, 1, 2].map((j) => r(i, j)));
  const c = [engineFace.x, engineFace.y, engineFace.z];
  const tr = [0, 1, 2].map((i) => [worldEntry.x, worldEntry.y, worldEntry.z][i] - (R[i][0] * c[0] + R[i][1] * c[1] + R[i][2] * c[2]));
  return [R[0][0], R[0][1], R[0][2], tr[0], R[1][0], R[1][1], R[1][2], tr[1], R[2][0], R[2][1], R[2][2], tr[2], 0, 0, 0, 1];
}

const key = (i: number): 'x' | 'y' | 'z' => (i === 0 ? 'x' : i === 1 ? 'y' : 'z');

/** Applies a row-major 4 x 4 transform to a point. */
export function applyRowMajor(m: readonly number[], p: Vec3): Vec3 {
  return {
    x: m[0] * p.x + m[1] * p.y + m[2] * p.z + m[3],
    y: m[4] * p.x + m[5] * p.y + m[6] * p.z + m[7],
    z: m[8] * p.x + m[9] * p.y + m[10] * p.z + m[11],
  };
}

/** The buildings with a roof, for tests and the UI. */
export const ROOFED = Object.values(BUILDINGS).map((b) => b.front.medium);
