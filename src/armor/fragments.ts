/**
 * Armor lab (#165): where everything thrown clear of the plate goes. Plugs,
 * scabs, jet and spall debris, the pieces of a shattered shot and a ricochet
 * all fly ballistically, tumble, and bounce off the floor and walls of a small
 * test room with restitution and friction, then slide to rest.
 *
 * The whole flight of each piece is worked out once, in closed form, as a list
 * of constant-acceleration legs (`FragmentSegment`): between two bounces a
 * piece follows a parabola, a slide along the floor is uniform deceleration.
 * Where it is at time t is then a pure lookup (`fragmentStateAt`), so playback
 * can scrub, and nothing advances per frame.
 *
 * Coordinates: x along the shot line from the plate's front face, y up from
 * the shot line, metres. The room is a box either side of the plate (the
 * plate's two faces are walls too); a piece stays in the box it leaves into.
 *
 * Restitution, friction and the spreads are illustrative lab values, chosen to
 * look right: a teaching model, not measured data.
 */

import {
  viewMargin,
  type ArmorFrame,
  type ArmorTimeline,
  type FragmentField,
  type FragmentKind,
  type FragmentRoom,
  type FragmentSegment,
  type FragmentTrack,
} from './model';
import { ricochetOutcome } from './ricochet';

export const GRAVITY = 9.81;
/** Share of the speed into a surface a piece keeps when it bounces. */
export const FLOOR_RESTITUTION = 0.35;
export const WALL_RESTITUTION = 0.4;
/** Coulomb friction against floor and walls. */
export const FRICTION = 0.5;
/** Spin kept at each bounce. */
export const BOUNCE_SPIN_KEEP = 0.65;
/** A bounce leaving less than this speed away from the surface (m/s) turns into sliding. */
export const REST_SPEED = 0.6;
/** Most legs in a flight; past it the piece is put down where it is. */
export const MAX_SEGMENTS = 64;
/** Most pieces drawn for one shot. */
export const MAX_FRAGMENTS = 40;
/** Height of the room's floor and ceiling from the shot line, as a multiple of the air either side of the plate. */
export const ROOM_HALF_HEIGHT_FACTOR = 1.4;
/** Pieces start spinning at up to this many radians per second per m/s of speed per metre of length... kept simple: spin = this × speed / length. */
export const SPIN_FACTOR = 0.35;
export const MAX_SPIN = 60;

/** The test room around a plate whose line-of-sight thickness is `tLos` (m). */
export function fragmentRoom(tLos: number): FragmentRoom {
  const gap = viewMargin(tLos);
  return { leftX: -gap, frontX: 0, rearX: tLos, rightX: tLos + gap, floorY: -ROOM_HALF_HEIGHT_FACTOR * gap, ceilingY: ROOM_HALF_HEIGHT_FACTOR * gap };
}

/** A small deterministic random sequence (mulberry32), so a shot always throws the same pieces. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What a piece starts with. */
export interface FragmentSeed {
  kind: FragmentKind;
  t0: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  lengthM: number;
  widthM: number;
  massKg: number;
  hot: boolean;
  angle?: number;
  omega?: number;
}

/** Where a piece is at a time: position, tilt (rad), and whether it has come to rest. */
export interface FragmentState {
  x: number;
  y: number;
  angle: number;
  resting: boolean;
}

/** The first time (> 0) a trajectory y0 + vy·t − g·t²/2 reaches `target`, or Infinity. */
function timeToHeight(y0: number, vy: number, ay: number, target: number): number {
  // y(t) − target = ½ay·t² + vy·t + (y0 − target), ay = −g (or 0 when sliding).
  const c = y0 - target;
  if (Math.abs(ay) < 1e-12) return Math.abs(vy) < 1e-12 ? Infinity : c / -vy > 1e-12 ? c / -vy : Infinity;
  const disc = vy * vy - 2 * ay * c;
  if (disc < 0) return Infinity;
  const root = Math.sqrt(disc);
  const candidates = [(-vy + root) / ay, (-vy - root) / ay].filter((t) => t > 1e-12);
  return candidates.length ? Math.min(...candidates) : Infinity;
}

/** The leg of a flight in force at `t`, and its state there. */
export function fragmentStateAt(track: FragmentTrack, t: number): FragmentState {
  const segs = track.segments;
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  const s = segs[lo];
  const dt = Math.max(0, t - s.t0);
  const last = lo === segs.length - 1;
  return {
    x: s.x + s.vx * dt + 0.5 * s.ax * dt * dt,
    y: s.y + s.vy * dt + 0.5 * s.ay * dt * dt,
    angle: s.angle + s.omega * dt + 0.5 * s.alpha * dt * dt,
    resting: last && s.vx === 0 && s.vy === 0 && s.ax === 0 && s.ay === 0,
  };
}

/** Works out the whole flight of one piece, in the room it was thrown into. */
export function buildTrack(seed: FragmentSeed, room: FragmentRoom): FragmentTrack {
  // The box it is in: either side of the plate.
  const right = seed.x >= (room.frontX + room.rearX) / 2;
  const xmin = right ? room.rearX : room.leftX;
  const xmax = right ? room.rightX : room.frontX;
  const r = Math.min(seed.widthM, seed.lengthM) / 2;
  const half = Math.max(r, 0);
  const minX = xmin + half;
  const maxX = xmax - half;
  const minY = room.floorY + half;
  const maxY = room.ceilingY - half;

  const segments: FragmentSegment[] = [];
  let t = seed.t0;
  let x = Math.min(maxX, Math.max(minX, seed.x));
  let y = Math.min(maxY, Math.max(minY, seed.y));
  let vx = seed.vx;
  let vy = seed.vy;
  let angle = seed.angle ?? Math.atan2(seed.vy, seed.vx);
  let omega = seed.omega ?? (SPIN_FACTOR * Math.hypot(seed.vx, seed.vy)) / Math.max(seed.lengthM, 1e-3);
  omega = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, omega));

  const push = (ax: number, ay: number, alpha: number) => segments.push({ t0: t, x, y, vx, vy, ax, ay, angle, omega, alpha });

  while (segments.length < MAX_SEGMENTS - 2) {
    push(0, -GRAVITY, 0);
    // Time to each surface.
    const tWall = vx > 0 ? (maxX - x) / vx : vx < 0 ? (minX - x) / vx : Infinity;
    const tFloor = timeToHeight(y, vy, -GRAVITY, minY);
    const tCeil = vy > 0 || y > maxY - 1e-9 ? timeToHeight(y, vy, -GRAVITY, maxY) : Infinity;
    const dt = Math.min(tWall, tFloor, tCeil);
    if (!Number.isFinite(dt)) break;
    const wallHit = dt === tWall;
    const floorHit = !wallHit && dt === tFloor;
    // Move to the surface.
    x += vx * dt;
    y += vy * dt - 0.5 * GRAVITY * dt * dt;
    angle += omega * dt;
    vy -= GRAVITY * dt;
    t += dt;
    if (wallHit) {
      x = vx > 0 ? maxX : minX;
      const vn = Math.abs(vx);
      vx = -Math.sign(vx) * WALL_RESTITUTION * vn;
      vy = frictionSlide(vy, vn);
    } else if (floorHit) {
      y = minY;
      const vn = Math.abs(vy);
      vy = FLOOR_RESTITUTION * vn;
      vx = frictionSlide(vx, vn);
      if (vy < REST_SPEED) {
        vy = 0;
        break;
      }
    } else {
      y = maxY;
      const vn = Math.abs(vy);
      vy = -WALL_RESTITUTION * vn;
      vx = frictionSlide(vx, vn);
    }
    omega *= BOUNCE_SPIN_KEEP;
  }

  // Sliding to rest on the floor (or put down where it is, if it never got there).
  if (segments.length >= MAX_SEGMENTS - 2) {
    vx = 0;
    vy = 0;
    y = Math.max(minY, Math.min(y, maxY));
  } else if (Math.abs(vx) > 1e-9) {
    const decel = FRICTION * GRAVITY;
    const slideT = Math.abs(vx) / decel;
    y = minY;
    push(-Math.sign(vx) * decel, 0, -omega / slideT);
    x += vx * slideT - 0.5 * Math.sign(vx) * decel * slideT * slideT;
    angle += omega * slideT - 0.5 * (omega / slideT) * slideT * slideT;
    t += slideT;
    vx = 0;
    omega = 0;
  }
  vy = 0;
  omega = 0;
  push(0, 0, 0);

  return { kind: seed.kind, t0: seed.t0, lengthM: seed.lengthM, widthM: seed.widthM, massKg: seed.massKg, hot: seed.hot, segments };
}

/** Speed along a surface after a bounce at normal speed `vn`: Coulomb friction takes μ(1+e)·vn off it, no further than zero. */
function frictionSlide(vt: number, vn: number): number {
  const loss = FRICTION * (1 + FLOOR_RESTITUTION) * vn;
  return Math.abs(vt) <= loss ? 0 : vt - Math.sign(vt) * loss;
}

const first = <T extends { type: string }>(events: T[], type: string): T | undefined => events.find((e) => e.type === type);

/** Spread a random fraction of `spread` either side of zero, radians. */
const spreadAngle = (rand: () => number, spread: number) => (rand() * 2 - 1) * spread;

/**
 * Everything the shot throws clear of the plate, as seeds in the room, or an
 * empty list when nothing comes loose. The kinds of piece follow the result:
 * a plug, a scab, the pieces of a shot that shattered and a jet's debris cone
 * all leave the rear face; a ricochet leaves the front.
 */
export function fragmentSeeds(timeline: ArmorTimeline, rand: () => number): { seeds: FragmentSeed[]; handoffS: number | null } {
  const { result, events, shot } = timeline;
  const impact = shot.impact;
  const tLos = result.losThicknessM;
  const seeds: FragmentSeed[] = [];
  let handoffS: number | null = null;
  const lastFrame: ArmorFrame = timeline.frames[timeline.frames.length - 1];

  if (result.ricochet) {
    if (impact.family === 'heat' || impact.family === 'he-frag') return { seeds, handoffS };
    const out = ricochetOutcome(impact, shot.material, shot.obliquityDeg);
    const t0 = first(events, 'ricochet')?.t ?? 0;
    handoffS = t0;
    // Away from the face (-x) and up along it (+y); the shattered pieces fan out about that.
    const baseAngle = Math.atan2(out.exitTangentSpeed, -out.exitNormalSpeed);
    const diameter = impact.diameter;
    if (out.shattered) {
      for (let i = 0; i < Math.min(out.fragments, MAX_FRAGMENTS); i++) {
        // Pieces fan out about the ricochet, but all leave the face: none heads back into the plate.
        let a = baseAngle + spreadAngle(rand, 0.35);
        if (Math.cos(a) > 0) a = Math.PI - a;
        const speed = out.exitSpeed * (0.45 + 0.55 * rand());
        const size = diameter * (0.25 + 0.4 * rand());
        seeds.push({ kind: 'shard', t0, x: 0, y: 0, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, lengthM: size * 1.6, widthM: size, massKg: (impact.mass / out.fragments) * 1, hot: false });
      }
    } else {
      const length = Math.min(impact.length, 6 * diameter);
      seeds.push({
        kind: 'penetrator',
        t0,
        x: 0,
        y: 0,
        vx: Math.cos(baseAngle) * out.exitSpeed,
        vy: Math.sin(baseAngle) * out.exitSpeed,
        lengthM: length,
        widthM: diameter,
        massKg: impact.mass,
        hot: false,
      });
    }
    return { seeds, handoffS };
  }

  const perforate = first(events, 'perforate');
  if (result.plug && perforate) {
    seeds.push({ kind: 'plug', t0: perforate.t, x: tLos, y: 0, vx: result.plug.velocity, vy: 0, lengthM: result.plug.thicknessM, widthM: result.plug.diameterM, massKg: result.plug.massKg, hot: true });
  }
  const spallEvent = first(events, 'spall');
  if (result.scab && spallEvent) {
    seeds.push({ kind: 'scab', t0: spallEvent.t, x: tLos, y: 0, vx: result.scab.velocity, vy: 0, lengthM: result.scab.thicknessM, widthM: result.scab.diameterM, massKg: result.scab.massKg, hot: false });
  }

  if (result.perforated && perforate) {
    handoffS = perforate.t;
    const d = result.debris;
    if (d) {
      // A jet's debris cone: many small jet particles and chips of plate, fanned about the shot line.
      const half = (d.halfAngleDeg * Math.PI) / 180;
      const nJet = 14;
      for (let i = 0; i < nJet; i++) {
        const a = spreadAngle(rand, half);
        const speed = d.jetParticles.velocity * (0.25 + 0.75 * rand());
        const size = 0.002 + 0.005 * rand();
        seeds.push({ kind: 'jet', t0: perforate.t, x: tLos, y: 0, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, lengthM: size * 1.5, widthM: size, massKg: d.jetParticles.massKg / nJet, hot: true });
      }
      const nSpall = 8;
      for (let i = 0; i < nSpall; i++) {
        const a = spreadAngle(rand, half * 1.4);
        const speed = d.spall.velocity * (0.4 + 0.6 * rand());
        const size = 0.003 + 0.008 * rand();
        seeds.push({ kind: 'spall', t0: perforate.t, x: tLos, y: 0, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, lengthM: size * 1.3, widthM: size, massKg: d.spall.massKg / nSpall, hot: true });
      }
    } else if (result.shattered && result.fragments > 0 && 'diameter' in impact) {
      for (let i = 0; i < Math.min(result.fragments, MAX_FRAGMENTS); i++) {
        const a = spreadAngle(rand, 0.3);
        const speed = result.residualVelocity * (0.6 + 0.4 * rand());
        const size = impact.diameter * (0.25 + 0.4 * rand());
        seeds.push({ kind: 'shard', t0: perforate.t, x: tLos, y: 0, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, lengthM: size * 1.6, widthM: size, massKg: result.residualMassKg / result.fragments, hot: false });
      }
    } else if ('diameter' in impact && result.residualMassKg > 0) {
      // The penetrator itself, what is left of it, carried on past the plate.
      seeds.push({
        kind: 'penetrator',
        t0: perforate.t,
        x: tLos,
        y: 0,
        vx: result.residualVelocity,
        vy: 0,
        lengthM: Math.max(lastFrame.penetratorLength, impact.diameter),
        widthM: impact.diameter,
        massKg: result.residualMassKg,
        hot: false,
      });
    }
  }
  return { seeds, handoffS };
}

/**
 * Adds the fragment field to a timeline: every piece thrown clear of the plate,
 * with its bouncing flight worked out. Returns the timeline unchanged when
 * nothing is thrown.
 */
export function withFragments(timeline: ArmorTimeline): ArmorTimeline {
  const room = fragmentRoom(timeline.result.losThicknessM);
  const impact = timeline.shot.impact;
  const rand = seededRandom(Math.round(impact.velocity * 7 + impact.calibreMm * 131 + timeline.shot.thicknessM * 1e5 + timeline.shot.obliquityDeg * 977));
  const { seeds, handoffS } = fragmentSeeds(timeline, rand);
  if (!seeds.length) return timeline;
  const tracks = seeds.slice(0, MAX_FRAGMENTS).map((s) => buildTrack(s, room));
  const restS = tracks.reduce((end, tr) => Math.max(end, tr.segments[tr.segments.length - 1].t0), 0);
  const field: FragmentField = { room, tracks, handoffS, restS };
  return { ...timeline, fragments: field };
}

