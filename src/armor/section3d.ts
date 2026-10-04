/**
 * Armor lab (#172): the geometry of the 3D sectioned view. Each plate of a
 * stack is a round test plate cut in half along the shot line, the way a
 * sample is sawn open, so the channel shows. Because the crater is
 * axisymmetric about the shot line, the plate, its crater and its rear bulge
 * are a profile revolved half a turn about that line. The cut face is that
 * profile mirrored about the axis, and the view paints it with the 2D section
 * drawing (fields included).
 *
 * Obliquity is unfolded as it is on the 2D section: each plate is shown at
 * its line-of-sight thickness, square to the shot line, so the 3D view and the
 * section show the same path.
 *
 * Pure (no three.js, no DOM): it turns a `StackTimeline` and a time into
 * profiles and positions in metres, so the shapes can be unit-tested.
 * Coordinates: x along the shot line from the first plate's front face, y up
 * from the shot line, z toward the viewer out of the cut face.
 */

import { ROOM_HALF_HEIGHT_FACTOR, fragmentStateAt, seededRandom } from './fragments';
import { viewMargin, type ArmorFrame, type FragmentKind } from './model';
import { penetratorDiameter } from './section';
import { activeStage, extendedFrame } from './stackView';
import type { StackStage, StackTimeline } from './stack';

/** A point on a profile: radius from the shot line and position along it, m. */
export interface ProfilePoint {
  r: number;
  x: number;
}

export type SurfaceKind = 'front' | 'rim' | 'rear' | 'bulge' | 'crater';

/** One open stretch of the profile, revolved on its own so its edges stay sharp. */
export interface ProfileSurface {
  kind: SurfaceKind;
  points: ProfilePoint[];
}

export interface PlateSolid {
  index: number;
  /** The plate's front and rear faces along the shot line, m. */
  frontX: number;
  rearX: number;
  radiusM: number;
  /** The profile as separate surfaces: front face, rim, rear face (and bulge), crater wall. */
  surfaces: ProfileSurface[];
  /** The closed outline of the cut face on one side of the axis (r ≥ 0); the view mirrors it for the other side. */
  outline: ProfilePoint[];
  /** Whether the crater goes right through. */
  throughHole: boolean;
  /** Share of the impact energy deposited so far (0 to 1), for the glow on the crater wall. */
  heat: number;
}

export interface Penetrator3d {
  noseX: number;
  tailX: number;
  radiusM: number;
  hidden: boolean;
  jet: boolean;
}

export interface Fragment3d {
  kind: FragmentKind;
  x: number;
  y: number;
  z: number;
  /** Tilt in the x-y plane, rad. */
  angle: number;
  lengthM: number;
  widthM: number;
  hot: boolean;
  resting: boolean;
}

/** The floor and the walls the pieces bounce off (the fragment room of `fragments.ts`), m. */
export interface Room3d {
  floorY: number;
  leftX: number;
  rightX: number;
}

export interface Section3d {
  plates: PlateSolid[];
  penetrator: Penetrator3d;
  fragments: Fragment3d[];
  room: Room3d | null;
  /** The plates' radius, m, and the floor under them (the stand fills the space between), m. */
  radiusM: number;
  floorY: number;
  /** Total length of the stack along the shot line, m. */
  pathM: number;
}

/** The plates' radius as a share of the room's half-height, so a stand shows under them. */
export const PLATE_RADIUS_SHARE = 0.78;
/** How far a piece drifts sideways out of the section plane, per metre it has flown along it. */
export const FRAGMENT_SPREAD = 0.45;
/** Samples round the rounded nose of a crater that is still digging. */
const NOSE_SAMPLES = 6;
/** Samples across the rear bulge. */
const BULGE_SAMPLES = 8;

/** The room's half-height for a stack, m: the 2D view's, so the floor is where the pieces land. */
export function roomHalfHeight(stack: StackTimeline): number {
  const lastLos = stack.stages[stack.stages.length - 1].timeline.result.losThicknessM;
  return ROOM_HALF_HEIGHT_FACTOR * viewMargin(lastLos);
}

/** The crater wall from the mouth to the bottom (on the axis while digging, at the rear face once through), in plate-local x. */
export function craterWall(frame: ArmorFrame, losM: number, through: boolean): ProfilePoint[] {
  const depth = Math.min(frame.depth, losM);
  if (depth <= 0) return [];
  const profile = frame.craterProfile && frame.craterProfile.length > 1 ? frame.craterProfile : null;
  const n = profile ? profile.length : 12;
  const wall: ProfilePoint[] = [];
  for (let i = 0; i < n; i++) wall.push({ r: Math.max(0, profile ? profile[i] : frame.craterRadius), x: (depth * i) / (n - 1) });
  if (through) return wall;
  // A rounded nose while it is still digging, as on the section, kept inside the plate.
  const last = wall[wall.length - 1];
  const reach = Math.min(last.r * 0.6, Math.max(0, losM - last.x) * 0.98);
  for (let k = 1; k <= NOSE_SAMPLES; k++) {
    const a = (k / NOSE_SAMPLES) * (Math.PI / 2);
    wall.push({ r: k === NOSE_SAMPLES ? 0 : Math.cos(a) * last.r, x: last.x + Math.sin(a) * reach });
  }
  return wall;
}

/** One plate's solid at a frame. */
export function plateSolid(stage: StackStage, frame: ArmorFrame, radiusM: number): PlateSolid {
  const losM = stage.timeline.result.losThicknessM;
  const x0 = stage.startM;
  const through = stage.timeline.result.perforated && frame.depth >= losM - 1e-9;
  const wall = craterWall(frame, losM, through);
  const mouth = wall.length ? Math.min(wall[0].r, radiusM * 0.95) : 0;
  const shift = (points: ProfilePoint[]) => points.map((p) => ({ r: Math.min(p.r, radiusM * 0.95), x: x0 + p.x }));

  const front: ProfilePoint[] = [
    { r: mouth, x: x0 },
    { r: radiusM, x: x0 },
  ];
  const rim: ProfilePoint[] = [
    { r: radiusM, x: x0 },
    { r: radiusM, x: x0 + losM },
  ];
  // The rear face from the rim inward: to the hole once through, else over the bulge to the axis.
  const exitR = through && wall.length ? Math.min(wall[wall.length - 1].r, radiusM * 0.95) : 0;
  const bulgeH = !through ? Math.max(0, frame.rearBulge) : 0;
  const bulgeHalf = bulgeH > 1e-6 ? Math.min(radiusM * 0.9, Math.max(frame.craterRadius * 4, bulgeH * 3)) : 0;
  const rear: ProfilePoint[] = [
    { r: radiusM, x: x0 + losM },
    { r: bulgeHalf > 0 ? bulgeHalf : exitR, x: x0 + losM },
  ];
  const bulge: ProfilePoint[] = [];
  if (bulgeHalf > 0) {
    for (let i = 0; i <= BULGE_SAMPLES; i++) {
      const s = 1 - i / BULGE_SAMPLES;
      bulge.push({ r: s * bulgeHalf, x: x0 + losM + bulgeH * (1 - s * s) });
    }
  }
  const crater = shift(wall);

  const surfaces: ProfileSurface[] = [
    { kind: 'front', points: front },
    { kind: 'rim', points: rim },
    { kind: 'rear', points: rear },
  ];
  if (bulge.length) surfaces.push({ kind: 'bulge', points: bulge });
  if (crater.length > 1) surfaces.push({ kind: 'crater', points: crater });

  // The cut face: front face out, rim, rear face in (over any bulge), then back along the axis or up the crater to the mouth.
  const outline: ProfilePoint[] = [...front, rim[1], ...rear.slice(1), ...bulge.slice(1)];
  if (crater.length) {
    outline.push(...[...crater].reverse());
  } else {
    outline.push({ r: 0, x: x0 });
  }
  const total = stage.timeline.result.impactEnergyJ;
  return {
    index: stage.index,
    frontX: x0,
    rearX: x0 + losM,
    radiusM,
    surfaces,
    outline: dedupe(outline),
    throughHole: through,
    heat: total > 0 ? Math.min(1, Math.max(0, frame.energyDepositedJ / total)) : 0,
  };
}

/** Drops points that repeat the one before (and a last point equal to the first). */
function dedupe(points: ProfilePoint[]): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || Math.abs(prev.r - p.r) > 1e-9 || Math.abs(prev.x - p.x) > 1e-9) out.push(p);
  }
  if (out.length > 1 && Math.abs(out[0].r - out[out.length - 1].r) < 1e-9 && Math.abs(out[0].x - out[out.length - 1].x) < 1e-9) out.pop();
  return out;
}

/** Everything in the 3D view at stack time `t`, with the pieces timed at `fragmentT` (s). */
export function section3d(stack: StackTimeline, t: number, fragmentT: number): Section3d {
  const half = roomHalfHeight(stack);
  const radiusM = PLATE_RADIUS_SHARE * half;
  const active = activeStage(stack, t);
  const plates = stack.stages.map((stage) => plateSolid(stage, extendedFrame(stage, t - stage.offsetT), radiusM));

  // The round: in the plate it is at, never past the front of the next plate.
  const stage = stack.stages[active];
  const frame = extendedFrame(stage, t - stage.offsetT);
  let noseX = stage.startM + frame.travel;
  const length = Math.max(0, frame.penetratorLength);
  const next = stack.stages[active + 1];
  if (next) noseX = Math.min(noseX, next.startM);
  const fragStage = stack.stages[stack.fragmentStage];
  // The stack's fragments are already on its clock, in that plate's own coordinates.
  const field = stack.fragments;
  const handoff = field && active === stack.fragmentStage ? field.handoffS : null;
  const penetrator: Penetrator3d = {
    noseX,
    tailX: noseX - length,
    radiusM: Math.max(1e-4, penetratorDiameter(stage.timeline) / 2),
    hidden: handoff !== null && fragmentT >= handoff,
    jet: stage.shot.impact.family === 'heat',
  };

  const fragments: Fragment3d[] = [];
  let room: Room3d | null = null;
  if (field) {
    const x0 = fragStage.startM;
    room = { floorY: field.room.floorY, leftX: x0 + field.room.leftX, rightX: x0 + field.room.rightX };
    const rand = seededRandom(field.tracks.length * 7919 + 17);
    for (const track of field.tracks) {
      const side = rand() * 2 - 1;
      if (fragmentT < track.t0) continue;
      const s = fragmentStateAt(track, fragmentT);
      const start = fragmentStateAt(track, track.t0);
      const flown = Math.abs(s.x - start.x) + Math.abs(s.y - start.y);
      fragments.push({
        kind: track.kind,
        x: x0 + s.x,
        y: s.y,
        z: side * FRAGMENT_SPREAD * flown,
        angle: s.angle,
        lengthM: track.lengthM,
        widthM: track.widthM,
        hot: track.hot && fragmentT - track.t0 < 0.02,
        resting: s.resting,
      });
    }
  }
  const last = stack.stages[stack.stages.length - 1];
  return { plates, penetrator, fragments, room, radiusM, floorY: -half, pathM: last.startM + last.timeline.result.losThicknessM };
}
