import { blastResponse, overpressureKPa } from './blastResponse';
import type { BulletSpec } from '../data/bullets';
import { bulletMassKg } from '../data/bullets';
import type { MediumSpec } from '../data/media';
import { jetStandoffFactor } from '../data/missiles';
import { PHYSICS as P, STANDARD_RESOLUTION, type SimResolution } from '../data/physics';
import { crushFromSpeed } from './crush';
import { seededRandom } from './random';
import type {
  CavitySample,
  FinalState,
  Keyframe,
  ShotEvent,
  ShotSummary,
  Timeline,
  Track,
  TrackKind,
  Vec3,
  VelocityDepthPoint,
} from './types';
import { add, dot, normalize, perturb, reflect, rotateToward, scale, sub, v3 } from './vec';

/**
 * The physics engine: integrates a whole shot up front with a fixed step (1 µs, or 0.25 µs at Ultra)
 * and returns a keyframe timeline for playback. Plausible, data-driven and
 * deterministic; not a validated engineering model.
 *
 * Model: drag inside a medium is ½·ρ·Cd·A·v² + R·A (hydrodynamic drag plus a
 * material strength term). Frontal area grows with expansion, flattening and
 * yaw. Thresholds for expansion, yaw, fragmentation, splash and ricochet come
 * from the bullet and medium catalogues.
 */

/** One slab of material, `offset` metres behind the stack's front face along its normal. */
export interface TargetLayer {
  medium: MediumSpec;
  thickness: number;
  offset: number;
  /** Which layer of the user's target stack this belongs to (a cinder block splits into two shells). */
  stack?: number;
}

export interface ShotSetup {
  bullet: BulletSpec;
  layers: TargetLayer[];
  /** Impact angle in degrees from head-on, rotating the stack about the vertical axis. */
  angleDeg: number;
  /** World position of the impact point on the stack's front face. */
  impactPoint: Vec3;
  /** Distance from the muzzle point to the target face, in metres. */
  standOffM: number;
  /** Damage already in the target from earlier shots (#22): channels, holes, craters and dents. */
  damage?: PriorDamage[];
  /** Integration and sampling resolution; the standard 1 µs step when left out. */
  resolution?: SimResolution;
}

/** A point of earlier damage in a layer: the new shot meets less resistance near it. */
export interface PriorDamage {
  layer: number;
  pos: Vec3;
  /** Radius of the hole or channel there, in metres. */
  radius: number;
}

/** Following an existing hole or channel, the medium offers this fraction of its strength. */
const DAMAGED_CHANNEL_FACTOR = 0.3;
/** Each earlier hit within this distance weakens the material around it (cracks, spall, fatigue). */
const WEAKENED_RADIUS_M = 0.06;
const WEAKEN_PER_HIT = 0.15;
const MIN_WEAKENED_FACTOR = 0.4;

/**
 * Earlier damage near one body (#124). Gel and water channels leave a point
 * every few millimetres, and a group of buckshot leaves thousands, so instead
 * of checking every point on every step, each body keeps the points around
 * where it is and refreshes them once it has moved `DAMAGE_CACHE_MARGIN_M`.
 */
interface DamageNearBody {
  layer: number;
  anchor: Vec3;
  bodyRadius: number;
  /** The lists only hold while the body is at least this big (see `findDenseDamage`). */
  minBodyRadius: number;
  /** Points whose hole or channel the body could be following. */
  channels: PriorDamage[];
  /** Points close enough to weaken the material around the body. */
  weakening: PriorDamage[];
}

const DAMAGE_CACHE_MARGIN_M = 0.01;

const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * One layer's earlier damage in grids (#142), so a body only looks at points near it: cells
 * about a channel wide to find the channels it could be following, fine cells to find the
 * nearest points that weaken it, and cells as wide as the weakening reach to find them all.
 */
interface LayerDamage {
  all: PriorDamage[];
  channelCell: number;
  channel: Map<number, PriorDamage[]>;
  fine: Map<number, PriorDamage[]>;
  coarse: Map<number, PriorDamage[]>;
  maxRadius: number;
}

const FINE_CELL_M = 0.01;
const COARSE_CELL_M = WEAKENED_RADIUS_M + DAMAGE_CACHE_MARGIN_M;
/** Layers (and neighbourhoods) with more earlier damage points than this are searched through grids. */
const DENSE_DAMAGE_POINTS = 256;
/** Hits the weakening count stops at (see `damageFactor`). */
const MAX_WEAKENING_HITS = 4;

const cellKey = (ix: number, iy: number, iz: number) => ((ix + 4096) * 8192 + (iy + 4096)) * 8192 + (iz + 4096);

function addToGrid(grid: Map<number, PriorDamage[]>, cell: number, d: PriorDamage): void {
  const key = cellKey(Math.floor(d.pos.x / cell), Math.floor(d.pos.y / cell), Math.floor(d.pos.z / cell));
  const list = grid.get(key);
  if (list) list.push(d);
  else grid.set(key, [d]);
}

function layerDamage(ctx: Context, layer: number): LayerDamage | undefined {
  if (!ctx.damageByLayer) {
    const byLayer = new Map<number, PriorDamage[]>();
    for (const d of ctx.setup.damage ?? []) {
      const list = byLayer.get(d.layer);
      if (list) list.push(d);
      else byLayer.set(d.layer, [d]);
    }
    ctx.damageByLayer = new Map();
    for (const [index, list] of byLayer) {
      const maxRadius = list.reduce((m, d) => Math.max(m, d.radius), 0);
      const channelCell = Math.max(FINE_CELL_M, maxRadius * 1.5 + DAMAGE_CACHE_MARGIN_M);
      const grids: LayerDamage = { all: list, channelCell, channel: new Map(), fine: new Map(), coarse: new Map(), maxRadius };
      if (list.length > DENSE_DAMAGE_POINTS)
        for (const d of list) {
          addToGrid(grids.channel, channelCell, d);
          addToGrid(grids.fine, FINE_CELL_M, d);
          addToGrid(grids.coarse, COARSE_CELL_M, d);
        }
      ctx.damageByLayer.set(index, grids);
    }
  }
  return ctx.damageByLayer.get(layer);
}

/** Cell offsets within `range` cells, nearest first, with the least distance (in cells) any point could be. */
let fineOffsets: { dx: number; dy: number; dz: number; gap: number }[] | undefined;
function nearestFirstOffsets(): { dx: number; dy: number; dz: number; gap: number }[] {
  if (fineOffsets) return fineOffsets;
  const range = Math.ceil(WEAKENED_RADIUS_M / FINE_CELL_M);
  const offsets: { dx: number; dy: number; dz: number; gap: number }[] = [];
  for (let dx = -range; dx <= range; dx++)
    for (let dy = -range; dy <= range; dy++)
      for (let dz = -range; dz <= range; dz++) {
        const g = (o: number) => Math.max(0, Math.abs(o) - 1);
        offsets.push({ dx, dy, dz, gap: Math.hypot(g(dx), g(dy), g(dz)) });
      }
  return (fineOffsets = offsets.sort((a, b) => a.gap - b.gap));
}

function damageNear(ctx: Context, body: Body, layer: number): DamageNearBody {
  const bodyRadius = body.diameter / 2;
  const cached = ctx.damageNear.get(body.id);
  if (
    cached &&
    cached.layer === layer &&
    bodyRadius <= cached.bodyRadius &&
    bodyRadius >= cached.minBodyRadius &&
    distance(body.pos, cached.anchor) <= DAMAGE_CACHE_MARGIN_M
  )
    return cached;
  const near: DamageNearBody = { layer, anchor: { ...body.pos }, bodyRadius, minBodyRadius: 0, channels: [], weakening: [] };
  const index = layerDamage(ctx, layer);
  if (index && index.all.length <= DENSE_DAMAGE_POINTS) {
    for (const d of index.all) {
      const dist = distance(body.pos, d.pos);
      if (dist < d.radius * 1.5 + bodyRadius + DAMAGE_CACHE_MARGIN_M) near.channels.push(d);
      if (dist < WEAKENED_RADIUS_M + DAMAGE_CACHE_MARGIN_M) near.weakening.push(d);
    }
  } else if (index) {
    findDenseDamage(index, body.pos, bodyRadius, near);
  }
  ctx.damageNear.set(body.id, near);
  return near;
}

/** `damageNear`'s search through the grids, for layers with many points. */
function findDenseDamage(index: LayerDamage, pos: Vec3, bodyRadius: number, near: DamageNearBody): void {
  const { x, y, z } = pos;
  // A cheap squared-distance test skips points that are clearly too far before the exact one.
  const within = (d: PriorDamage, limit: number) => {
    const dx = d.pos.x - x;
    const dy = d.pos.y - y;
    const dz = d.pos.z - z;
    const loose = limit * (1 + 1e-9);
    return dx * dx + dy * dy + dz * dz <= loose * loose && distance(pos, d.pos) < limit;
  };
  // Channels: a point whose channel holds the body from anywhere it gets to before the next
  // refresh settles it alone (while the body stays this big); otherwise every point whose
  // channel it could reach.
  const cell = index.channelCell;
  const hx = Math.floor(x / cell);
  const hy = Math.floor(y / cell);
  const hz = Math.floor(z / cell);
  const reach = Math.ceil((index.maxRadius * 1.5 + bodyRadius + DAMAGE_CACHE_MARGIN_M) / cell);
  channels: for (let dx = -reach; dx <= reach; dx++)
    for (let dy = -reach; dy <= reach; dy++)
      for (let dz = -reach; dz <= reach; dz++)
        for (const d of index.channel.get(cellKey(hx + dx, hy + dy, hz + dz)) ?? []) {
          if (within(d, d.radius * 1.5 + bodyRadius - DAMAGE_CACHE_MARGIN_M - 1e-9)) {
            near.channels = [d];
            near.minBodyRadius = bodyRadius;
            break channels;
          }
          if (within(d, d.radius * 1.5 + bodyRadius + DAMAGE_CACHE_MARGIN_M)) near.channels.push(d);
        }
  // Weakening: every point close enough to count from somewhere the body gets to before the
  // next refresh. Where there are many, the nearest few that count from anywhere give the same
  // answer on their own (the count stops there), so the search stops at those.
  const cx = Math.floor(x / COARSE_CELL_M);
  const cy = Math.floor(y / COARSE_CELL_M);
  const cz = Math.floor(z / COARSE_CELL_M);
  const around: PriorDamage[][] = [];
  let candidates = 0;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        const list = index.coarse.get(cellKey(cx + dx, cy + dy, cz + dz));
        if (!list) continue;
        around.push(list);
        candidates += list.length;
      }
  if (candidates > DENSE_DAMAGE_POINTS) {
    const fx = Math.floor(x / FINE_CELL_M);
    const fy = Math.floor(y / FINE_CELL_M);
    const fz = Math.floor(z / FINE_CELL_M);
    const sure = WEAKENED_RADIUS_M - DAMAGE_CACHE_MARGIN_M - 1e-9;
    for (const o of nearestFirstOffsets()) {
      if (o.gap * FINE_CELL_M >= sure) break;
      for (const d of index.fine.get(cellKey(fx + o.dx, fy + o.dy, fz + o.dz)) ?? []) {
        if (within(d, sure)) near.weakening.push(d);
        if (near.weakening.length >= MAX_WEAKENING_HITS) return;
      }
    }
    near.weakening.length = 0;
  }
  for (const list of around) for (const d of list) if (within(d, WEAKENED_RADIUS_M + DAMAGE_CACHE_MARGIN_M)) near.weakening.push(d);
}

/** How much of the medium's strength is left where the body is, given earlier shots' damage. */
function damageFactor(ctx: Context, body: Body, layer: number): number {
  if (body.followsJet) return DAMAGED_CHANNEL_FACTOR;
  if (!ctx.setup.damage?.length) return 1;
  const pos = body.pos;
  const bodyRadius = body.diameter / 2;
  const near = damageNear(ctx, body, layer);
  for (const d of near.channels) if (distance(pos, d.pos) < d.radius * 1.5 + bodyRadius) return DAMAGED_CHANNEL_FACTOR;
  let hits = 0;
  for (const d of near.weakening) if (distance(pos, d.pos) < WEAKENED_RADIUS_M && ++hits >= MAX_WEAKENING_HITS) break;
  return Math.max(MIN_WEAKENED_FACTOR, 1 - WEAKEN_PER_HIT * hits);
}

/** Splits hollow media (cinder block) into their solid shells; other media are one layer. */
export function layersFor(medium: MediumSpec, thickness: number, offset = 0, stack = 0): TargetLayer[] {
  if (medium.shellM && thickness > medium.shellM * 2.5) {
    const shell = medium.shellM;
    return [
      { medium, thickness: shell, offset, stack },
      { medium, thickness: shell, offset: offset + thickness - shell, stack },
    ];
  }
  return [{ medium, thickness, offset, stack }];
}

interface Body {
  id: number;
  kind: TrackKind;
  pos: Vec3;
  dir: Vec3;
  speed: number;
  mass: number;
  baseDiameter: number;
  diameter: number;
  lengthM: number;
  yaw: number;
  t: number;
  noseDragFactor: number;
  /** Bullet-only behaviour; fragments and pellets get simplified behaviour. */
  bullet?: BulletSpec;
  /** After leaving a panel the bullet keeps losing speed to its broken back scab (#225): deceleration in m/s² until this time. */
  tailDecel?: number;
  tailUntil?: number;
  /** A short, harder first phase of the tail (#225), until `burstUntil`. */
  burstDecel?: number;
  burstUntil?: number;
  state: FinalState;
  expanding: boolean;
  expansionStartDist: number;
  expansionRatio: number;
  clogged: boolean;
  yawing: boolean;
  fragmented: boolean;
  layer: number;
  /** Distance travelled inside the current layer. */
  layerDist: number;
  /** Total distance travelled inside any material. */
  materialDist: number;
  /** Deepest depth along the stack normal reached so far. */
  maxDepth: number;
  pathSinceImpact: number;
  /** Total distance travelled since the track began. */
  travelled: number;
  /** Last time the body was inside any material. */
  lastMaterialT: number;
  /** Speed at first contact with the target. */
  impactSpeed: number;
  /** Crushed by concrete, 0-1; only ever grows (#226). */
  crush: number;
  impacted: boolean;
  ricocheted: boolean;
  /** A tandem warhead's second jets fly down the first group's hole, so the medium resists them less. */
  followsJet?: boolean;
  /** A shaped-charge jet piece (as opposed to a casing fragment). */
  isJet?: boolean;
  /** A motor still burning: the speed it is accelerating to and how fast, in m/s and m/s². */
  thrustTo?: number;
  thrustAccel?: number;
  /** Extra flight allowed before a fragment gives up: a charge's pieces first cross the stand-off to the target. */
  extraRangeM?: number;
}

interface Context {
  setup: ShotSetup;
  normal: Vec3;
  stackDepth: number;
  rand: () => number;
  tracks: Track[];
  events: ShotEvent[];
  cavity: CavitySample[];
  queue: Body[];
  nextId: number;
  vd: VelocityDepthPoint[];
  depositedJ: number;
  res: SimResolution;
  /** Earlier damage by layer, built on first use from `setup.damage`. */
  damageByLayer?: Map<number, LayerDamage>;
  damageNear: Map<number, DamageNearBody>;
}

export function simulate(setup: ShotSetup): Timeline {
  const theta = (setup.angleDeg * Math.PI) / 180;
  // The stack is rotated about +y by theta, so its inward normal is local +x rotated.
  const normal = v3(Math.cos(theta), 0, -Math.sin(theta));
  const stackDepth = Math.max(...setup.layers.map((l) => l.offset + l.thickness));
  const ctx: Context = {
    setup,
    normal,
    stackDepth,
    rand: seededRandom(hash(setup.bullet.id + setup.layers.map((l) => l.medium.id).join())),
    tracks: [],
    events: [],
    cavity: [],
    queue: [],
    nextId: 0,
    vd: [],
    depositedJ: 0,
    res: setup.resolution ?? STANDARD_RESOLUTION,
    damageNear: new Map(),
  };

  const b = setup.bullet;
  // A powered missile begins its launch run further back.
  const run = b.launch?.runM ?? 0;
  const start = sub(setup.impactPoint, v3(setup.standOffM + run, 0, 0));
  const pellets = b.behaviour === 'shot' ? (b.pellets ?? 9) : 1;
  if (b.behaviour === 'charge') placeCharge(ctx, b, start);
  else for (let i = 0; i < pellets; i++) {
    // Pellets leave in a fixed pattern: one centre, the rest on a ring.
    let dir = v3(1, 0, 0);
    if (i > 0 && b.spreadPerMetre) {
      const a = ((i - 1) / (pellets - 1)) * Math.PI * 2;
      dir = normalize(v3(1, Math.sin(a) * b.spreadPerMetre, Math.cos(a) * b.spreadPerMetre));
    }
    const launch = b.launch;
    const body = makeBody(ctx, pellets > 1 ? 'pellet' : 'bullet', start, dir, launch ? b.muzzleVelocityMs * launch.startFraction : b.muzzleVelocityMs, bulletMassKg(b), b.caliberMm / 1000, 0, b);
    if (launch) {
      body.thrustTo = b.muzzleVelocityMs;
      // Full speed after 70% of the run, from v0: v² = v0² + 2 a s.
      body.thrustAccel = (b.muzzleVelocityMs ** 2 - body.speed ** 2) / (2 * 0.7 * launch.runM);
    }
    ctx.queue.push(body);
  }

  while (ctx.queue.length) integrate(ctx, ctx.queue.shift()!);

  const primary = ctx.tracks[0];
  const impact = ctx.events.find((e) => e.type === 'impact');
  const lastEnd = ctx.tracks.reduce((m, tr) => Math.max(m, tr.endT), 0);
  const summary = summarise(ctx, primary);
  const impactTime = impact?.t ?? primary.endT;
  return {
    tracks: ctx.tracks,
    events: ctx.events.sort((a, b2) => a.t - b2.t),
    cavity: ctx.cavity,
    summary,
    duration: lastEnd + P.holdAfterS,
    impactTime,
    shots: [
      {
        start: 0,
        impactTime,
        primaryId: primary.id,
        firstTrack: 0,
        trackCount: ctx.tracks.length,
        bulletId: b.id,
        aim: { y: setup.impactPoint.y, z: setup.impactPoint.z },
        summary,
      },
    ],
  };
}

function makeBody(
  ctx: Context,
  kind: TrackKind,
  pos: Vec3,
  dir: Vec3,
  speed: number,
  mass: number,
  diameter: number,
  t: number,
  bullet?: BulletSpec,
): Body {
  const lengthM = bullet ? bullet.lengthMm / 1000 : diameter * 1.2;
  return {
    id: ctx.nextId++,
    kind,
    pos,
    dir,
    speed,
    mass,
    baseDiameter: diameter,
    diameter,
    lengthM,
    yaw: 0,
    t,
    noseDragFactor: bullet ? bullet.noseDragFactor : P.fragmentDragFactor,
    bullet,
    state: 'intact',
    expanding: false,
    expansionStartDist: 0,
    expansionRatio: 1,
    clogged: false,
    yawing: false,
    fragmented: false,
    layer: -1,
    layerDist: 0,
    materialDist: 0,
    maxDepth: 0,
    pathSinceImpact: 0,
    travelled: 0,
    lastMaterialT: t,
    impactSpeed: speed,
    crush: 0,
    impacted: false,
    ricocheted: false,
  };
}

function depthOf(ctx: Context, p: Vec3): number {
  return dot(sub(p, ctx.setup.impactPoint), ctx.normal);
}

/** How far inside a layer a shortened step lands, in metres (#265). */
const LAND_INSIDE_M = 1e-7;

/**
 * The part of a step (0 to 1) to take so a layer the full step would jump clean
 * over is entered instead (#265), or null when no layer would be skipped. A
 * round at rifle speed covers about a millimetre per 1 microsecond step, so a
 * thinner layer (a phone's glass) can sit between two successive positions and
 * never be seen. `cos` is the direction's component along the stack normal and
 * `travelM` the distance the step would cover; `depth` is where the body is now.
 */
export function stepIntoSkippedLayer(layers: readonly { offset: number; thickness: number }[], depth: number, cos: number, travelM: number): number | null {
  const along = Math.abs(cos) * travelM;
  if (!(along > 0)) return null;
  let best: number | null = null;
  for (const layer of layers) {
    // The face the body meets first, and its distance ahead along the normal.
    const ahead = cos > 0 ? layer.offset - depth : depth - (layer.offset + layer.thickness);
    if (ahead < 0 || ahead + layer.thickness >= along) continue;
    if (best === null || ahead < best) best = ahead;
  }
  return best === null ? null : Math.min(1, (best + LAND_INSIDE_M) / along);
}

/** Furthest a body flies across air to reach a layer ahead before it counts as flown off, m (a steep path across a wide room). */
const MAX_GAP_FLIGHT_M = 12;

/**
 * Distance along the body's path to the next layer face ahead of it, or null
 * when no layer lies ahead (or the nearest is further than MAX_GAP_FLIGHT_M
 * away along a glancing path). Layers are slabs across the shot line.
 */
function distanceToLayerAhead(ctx: Context, body: Body): number | null {
  const cos = dot(body.dir, ctx.normal);
  if (Math.abs(cos) < 1e-6) return null;
  const depth = depthOf(ctx, body.pos);
  let best: number | null = null;
  for (const layer of ctx.setup.layers) {
    const ahead = cos > 0 ? layer.offset - depth : depth - (layer.offset + layer.thickness);
    if (ahead <= 0) continue;
    const along = ahead / Math.abs(cos);
    if (along <= MAX_GAP_FLIGHT_M && (best === null || along < best)) best = along;
  }
  return best;
}

function layerAt(ctx: Context, depth: number): number {
  const layers = ctx.setup.layers;
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (depth >= l.offset && depth <= l.offset + l.thickness) return i;
  }
  return -1;
}

function event(ctx: Context, body: Body, type: ShotEvent['type'], extra: Partial<ShotEvent> = {}): void {
  ctx.events.push({ t: body.t, type, trackId: body.id, pos: { ...body.pos }, speed: body.speed, ...extra });
}

function integrate(ctx: Context, body: Body): void {
  const keyframes: Keyframe[] = [];
  const record = () => {
    // Concrete crushes the bullet as it takes its energy; the stub flies on as a flattened slug (#226).
    if (body.kind === 'bullet' && body.layer >= 0 && ctx.setup.layers[body.layer]?.medium.behaviour === 'concrete') {
      body.crush = Math.max(body.crush, crushFromSpeed(body.speed, body.impactSpeed));
    }
    keyframes.push({
      t: body.t,
      pos: { ...body.pos },
      dir: { ...body.dir },
      speed: body.speed,
      yaw: body.yaw,
      diameter: body.diameter,
      ...(body.crush > 0 ? { crush: body.crush } : {}),
    });
  };
  record();

  const isPrimary = body.id === 0 || body.kind === 'pellet';
  // Fragments fly in near-straight lines, so they need far fewer keyframes.
  const sampleEvery = body.kind === 'fragment' ? ctx.res.sampleEvery * 4 : ctx.res.sampleEvery;
  const dt = ctx.res.stepS;
  let persists = true;
  let step = 0;
  let cavityAccum = 0;
  let cavityEnergy = 0;
  let alive = true;

  while (alive && body.t < P.maxTimeS) {
    const depth = depthOf(ctx, body.pos);
    const layerIndex = layerAt(ctx, depth);

    // --- Layer transitions ---
    if (layerIndex !== body.layer) {
      if (layerIndex >= 0) {
        const outcome = enterLayer(ctx, body, layerIndex);
        if (outcome === 'ricochet') {
          // Put the body back on the struck face, just outside the material, and fly on.
          const layer = ctx.setup.layers[layerIndex];
          const into = depth - layer.offset;
          const outside = dot(body.dir, ctx.normal) < 0 ? -(into + 1e-4) : layer.thickness - into + 1e-4;
          body.pos = add(body.pos, scale(ctx.normal, outside));
          body.t += dt;
          record();
          continue;
        }
        if (outcome === 'ended') {
          persists = false;
          record();
          break;
        }
      } else if (body.layer >= 0) {
        exitLayer(ctx, body, body.layer);
      }
      body.layer = layerIndex;
      body.layerDist = 0;
      record();
    }

    // --- Forces ---
    const medium = layerIndex >= 0 ? ctx.setup.layers[layerIndex].medium : null;
    const frontal = (Math.PI * body.diameter * body.diameter) / 4;
    const side = body.diameter * body.lengthM;
    const sinY = Math.abs(Math.sin(body.yaw));
    const area = frontal * (1 - sinY) + side * sinY;
    // A clogged hollow point behaves like a round-nose FMJ.
    const nose = body.clogged ? Math.max(body.noseDragFactor, P.cloggedNoseDragFactor) : body.noseDragFactor;
    const noseFactor = nose * (1 - sinY) + P.sidewaysDragFactor * sinY;

    // A step that would jump clean over a thin layer lands just inside it instead (#265).
    const jump = stepIntoSkippedLayer(ctx.setup.layers, depthOf(ctx, body.pos), dot(body.dir, ctx.normal), body.speed * dt);
    const stepS = jump === null ? dt : Math.max(dt * jump, 1e-12);

    let force: number;
    if (medium) {
      force =
        0.5 * medium.density * medium.dragCoefficient * noseFactor * area * body.speed ** 2 +
        medium.resistancePa * area * damageFactor(ctx, body, layerIndex);
    } else {
      force = 0.5 * P.airDensity * P.airDragCoefficient * area * body.speed ** 2;
    }

    const tailing = !medium && body.tailUntil !== undefined && body.t < body.tailUntil;
    const bursting = !medium && body.burstUntil !== undefined && body.t < body.burstUntil;
    const dv = (force / body.mass) * stepS + (tailing ? (body.tailDecel ?? 0) * stepS : 0) + (bursting ? (body.burstDecel ?? 0) * stepS : 0);
    let newSpeed = Math.max(0, body.speed - dv);
    // The motor keeps pushing in the air until the missile is up to speed.
    if (!medium && body.thrustTo !== undefined && body.thrustAccel !== undefined && body.speed < body.thrustTo) newSpeed = Math.min(body.thrustTo, body.speed + body.thrustAccel * stepS);
    const dx = ((body.speed + newSpeed) / 2) * stepS;
    if (medium) {
      const deposited = 0.5 * body.mass * (body.speed ** 2 - newSpeed ** 2);
      ctx.depositedJ += deposited;
      if (isPrimary && (medium.behaviour === 'gel' || medium.behaviour === 'water')) {
        cavityAccum += dx;
        cavityEnergy += deposited;
        if (cavityAccum >= ctx.res.cavitySampleM) {
          addCavitySample(ctx, body, medium, layerIndex, cavityEnergy / cavityAccum);
          cavityAccum = 0;
          cavityEnergy = 0;
        }
      }
    }
    body.speed = newSpeed;
    body.pos = add(body.pos, scale(body.dir, dx));
    body.t += stepS;
    body.travelled += dx;
    if (body.impacted) body.pathSinceImpact += dx;

    if (medium) {
      body.lastMaterialT = body.t;
      body.layerDist += dx;
      body.materialDist += dx;
      body.maxDepth = Math.max(body.maxDepth, depthOf(ctx, body.pos));
      if (body.id === 0 && step % ctx.res.sampleEvery === 0) ctx.vd.push({ depth: body.pathSinceImpact, speed: body.speed });
      updateExpansion(body, medium);
      updateYawAndBreakup(ctx, body, medium, stepS);
    }

    step++;
    if (step % sampleEvery === 0) record();

    // --- End conditions ---
    const delay = body.bullet?.blast?.delayM;
    if (delay !== undefined && body.kind !== 'fragment' && body.impacted && body.state !== 'detonated' && body.pathSinceImpact >= delay) {
      // The delay fuze fires after its path through the target, wherever the round has got to by then.
      detonate(ctx, body, Math.max(0, layerIndex >= 0 ? layerIndex : body.layer));
      persists = false;
      alive = false;
    } else if (medium && body.speed < P.restSpeed) {
      body.speed = 0;
      if (delay !== undefined && body.kind !== 'fragment' && body.state !== 'detonated') detonate(ctx, body, layerIndex);
      if (medium.hardness >= P.splashHardness && body.kind !== 'fragment' && body.state !== 'ricocheted') {
        // Lead and copper meeting steel or concrete they can't defeat splash outward.
        const hardSplash = medium.behaviour === 'steel' && !body.bullet?.hardCore;
        if (hardSplash) {
          splash(ctx, body, layerIndex);
          persists = false;
        } else if (body.state === 'intact') {
          body.state = 'deformed';
        }
      }
      event(ctx, body, 'stop', { layer: layerIndex });
      alive = false;
    } else if (!medium) {
      const pastStack = depthOf(ctx, body.pos) > ctx.stackDepth + P.exitRunM;
      // Flown off (#281): only once nothing lies ahead. A jet or fragment crossing an air gap to the next plate, or a
      // room to the far wall, keeps going however far it has already bored.
      const flownOff = body.pathSinceImpact > 1.2 || (body.kind === 'fragment' && body.travelled > P.fragmentRangeM + (body.extraRangeM ?? 0));
      // The step may already have carried it into the next layer, which counts as reaching it.
      const reachedLayer = layerAt(ctx, depthOf(ctx, body.pos)) >= 0;
      const travelledAway = flownOff && !reachedLayer && distanceToLayerAhead(ctx, body) === null;
      const hitFloor = body.pos.y < 0;
      const tooSlow = body.speed < P.restSpeed;
      const lingering = body.impacted && body.t - body.lastMaterialT > P.maxAirAfterExitS;
      if (pastStack || travelledAway || hitFloor || tooSlow || lingering) {
        persists = hitFloor || tooSlow;
        alive = false;
      }
    }
  }
  record();

  ctx.tracks.push({
    id: body.id,
    kind: body.kind,
    massKg: body.mass,
    baseDiameter: body.baseDiameter,
    keyframes,
    spawnT: keyframes[0].t,
    endT: body.t,
    persists,
    finalState: body.state,
  });
  ctx.tracks.sort((a, b) => a.id - b.id);
}

type EntryOutcome = 'entered' | 'ricochet' | 'ended';

function enterLayer(ctx: Context, body: Body, index: number): EntryOutcome {
  const layer = ctx.setup.layers[index];
  const medium = layer.medium;
  const n = ctx.normal;
  const cosInc = dot(body.dir, n);
  const incidence = Math.acos(Math.min(1, Math.abs(cosInc)));
  const first = !body.impacted;
  const faceNormal = scale(n, cosInc > 0 ? -1 : 1);

  // The HEI shell's nose fuze fires on any contact, even a glancing one.
  if (body.bullet?.behaviour === 'explosive' && !body.bullet.blast?.delayM) {
    if (first) body.impactSpeed = body.speed;
    body.impacted = true;
    event(ctx, body, first ? 'impact' : 'enter', { normal: faceNormal, layer: index });
    detonate(ctx, body, index);
    return 'ended';
  }

  // Ricochet off the face at shallow angles.
  if (medium.ricochetAngleDeg !== undefined && incidence >= (medium.ricochetAngleDeg * Math.PI) / 180 && body.kind !== 'fragment') {
    // The impact is logged at the arriving speed, before the bounce takes its share.
    if (first) body.impactSpeed = body.speed;
    event(ctx, body, first ? 'impact' : 'enter', { normal: faceNormal, layer: index });
    const [lo, hi] = P.ricochetRestitution;
    body.dir = normalize(reflect(body.dir, n));
    const kept = lo + (hi - lo) * medium.hardness;
    ctx.depositedJ += 0.5 * body.mass * body.speed ** 2 * (1 - kept * kept);
    body.speed *= kept;
    flatten(body, medium);
    body.state = 'ricocheted';
    body.ricocheted = true;
    body.impacted = true;
    event(ctx, body, 'ricochet', { normal: faceNormal, layer: index });
    return 'ricochet';
  }

  if (first) body.impactSpeed = body.speed;
  body.impacted = true;
  event(ctx, body, first ? 'impact' : 'enter', { normal: faceNormal, layer: index });

  // Reactive armour (#260): the tile fires as the first jet hits it and throws plates across the jet's path, so
  // a jet loses part of its mass crossing it. A tandem warhead's second jets arrive after the tile has fired.
  if (body.isJet && !body.followsJet && medium.jetDisruption) body.mass *= 1 - medium.jetDisruption;

  const b = body.bullet;

  // Oblique entry bends the path a little toward the surface normal.
  if (incidence > 0.01) {
    body.dir = rotateToward(body.dir, scale(n, Math.sign(cosInc)), incidence * P.entryDeflection * medium.hardness);
  }

  flatten(body, medium);

  if (b && b.behaviour === 'expand') {
    if (!medium.allowsExpansion) {
      // A hollow point packed with wood, gypsum or glass won't open later.
      if (b.shape === 'hollowPoint') body.clogged = true;
    } else if (!body.expanding && !body.clogged && body.speed >= (b.expansionThresholdMs ?? 0)) {
      const threshold = b.expansionThresholdMs ?? 0;
      // Faster impacts open more fully, reaching the full ratio at 40% over threshold.
      const k = Math.min(1, (body.speed - threshold) / (threshold * 0.4 + 1));
      body.expansionRatio = 1 + ((b.expansionRatio ?? 1) - 1) * (0.5 + 0.5 * k);
      body.expanding = true;
      body.expansionStartDist = body.materialDist;
      body.state = 'expanded';
      event(ctx, body, 'expand', { layer: index });
    }
  }
  return 'entered';
}

function exitLayer(ctx: Context, body: Body, index: number): void {
  const medium = ctx.setup.layers[index].medium;
  const cosOut = dot(body.dir, ctx.normal);
  event(ctx, body, 'exit', { normal: scale(ctx.normal, Math.sign(cosOut) || 1), layer: index });
  if (medium.exitDeflectionDeg) {
    body.dir = perturb(body.dir, (medium.exitDeflectionDeg * Math.PI) / 180, ctx.rand);
  }
  if (medium.exitTail && body.kind !== 'fragment') {
    body.tailDecel = medium.exitTail.decelMs2;
    body.tailUntil = body.t + medium.exitTail.durationS;
    body.burstDecel = medium.exitTail.burst?.decelMs2;
    body.burstUntil = medium.exitTail.burst ? body.t + medium.exitTail.burst.durationS : undefined;
  }
  if (medium.behaviour === 'steel' && body.kind !== 'fragment' && body.mass > 0) {
    // Punching through a plate tears the bullet (and plate spall) into a wide cone of fragments.
    shed(ctx, body, body.kind === 'pellet' ? 0.3 : 0.45, body.kind === 'pellet' ? 4 : 14, 0.5);
  }
}

/** Soft bullets flatten against hard media. */
function flatten(body: Body, medium: MediumSpec): void {
  if (medium.hardness <= 0.5 || body.kind === 'fragment' || body.bullet?.hardCore) return;
  const grow = 1 + P.flattenGain * (medium.hardness - 0.5);
  // Steel-cored and big FMJ rounds deform less than lead.
  const toughness = body.bullet && body.bullet.caliberMm >= 12 ? 0.4 : 1;
  body.diameter = Math.max(body.diameter, body.baseDiameter * (1 + (grow - 1) * toughness));
  if (body.state === 'intact') body.state = 'deformed';
}

function updateExpansion(body: Body, medium: MediumSpec): void {
  if (!body.expanding) return;
  const distance = (P.expansionDistanceM * 1030) / medium.density;
  const progress = Math.min(1, (body.materialDist - body.expansionStartDist) / distance);
  body.diameter = Math.max(body.diameter, body.baseDiameter * (1 + (body.expansionRatio - 1) * progress));
  if (progress >= 1) body.expanding = false;
}

/** `stepS` is the step just taken, which a thin layer ahead can shorten (#265). */
export function updateYawAndBreakup(ctx: Context, body: Body, medium: MediumSpec, stepS: number): void {
  const b = body.bullet;
  if (!b) return;

  // Pointed rifle bullets travel a neck, then yaw and tumble to base-first.
  if (b.yawNeckM !== undefined && body.state !== 'expanded' && body.speed > P.yawMinSpeed) {
    const neck = b.yawNeckM * medium.yawNeckScale;
    if (body.layerDist > neck) {
      if (!body.yawing) {
        body.yawing = true;
        event(ctx, body, 'yaw', { layer: body.layer });
      }
      const flip = P.yawFlipDistanceM * Math.max(0.15, medium.yawNeckScale);
      body.yaw = Math.min(Math.PI, body.yaw + (Math.PI / flip) * body.speed * stepS);
    }
  }

  // 5.56 M193: snaps at the cannelure as it turns sideways, if it struck above the threshold.
  if (b.behaviour === 'fragment' && !body.fragmented && body.yaw > 1.0 && body.impactSpeed >= (b.fragmentThresholdMs ?? Infinity)) {
    shed(ctx, body, b.fragmentShedFraction ?? 0.4, 8, 0.35);
    body.state = 'fragmented';
  }

  // Fast soft points shed lead from the mushroom.
  if (b.shape === 'softPoint' && body.expanding && !body.fragmented && body.speed > 650) {
    shed(ctx, body, 0.25, 6, 0.3);
  }

  // Very fast rounds break apart in water.
  if (medium.behaviour === 'water' && b.behaviour === 'fragment' && !body.fragmented && body.speed > 700 && body.layerDist > 0.03) {
    shed(ctx, body, 0.5, 6, 0.25);
    body.state = 'fragmented';
  }
}

/** Splits off `fraction` of the body's mass into `count` fragments fanning out by up to `spread` radians. */
function shed(ctx: Context, body: Body, fraction: number, count: number, spread: number): void {
  body.fragmented = true;
  const lost = body.mass * fraction;
  body.mass -= lost;
  // Remaining core shrinks in proportion to its mass.
  body.lengthM *= 1 - fraction * 0.6;
  for (let i = 0; i < count; i++) {
    const m = (lost / count) * (0.5 + ctx.rand());
    const d = fragmentDiameter(m);
    const dir = perturb(body.dir, spread * (0.3 + 0.7 * ctx.rand()), ctx.rand);
    ctx.queue.push(makeBody(ctx, 'fragment', { ...body.pos }, dir, body.speed * (0.75 + 0.2 * ctx.rand()), m, d, body.t));
  }
  event(ctx, body, 'fragment', { layer: body.layer });
}

/** Bullet disintegrates against hard steel: fragments spray out along the face. */
function splash(ctx: Context, body: Body, index: number): void {
  body.state = 'splashed';
  const n = ctx.normal;
  const faceNormal = scale(n, -1);
  const count = body.kind === 'pellet' ? 4 : 10;
  const speed = Math.max(body.speed, 0.35 * ctx.setup.bullet.muzzleVelocityMs);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + ctx.rand() * 0.4;
    // Radial in the face plane, tilted a little back toward the shooter.
    const radial = normalize(v3(-n.z * Math.cos(a), Math.sin(a), n.x * Math.cos(a)));
    const dir = normalize(add(radial, scale(faceNormal, 0.25 + 0.3 * ctx.rand())));
    const m = (body.mass / count) * (0.5 + ctx.rand());
    const entry = add(ctx.setup.impactPoint, scale(n, ctx.setup.layers[index].offset - 0.002));
    const start = v3(entry.x, body.pos.y, body.pos.z);
    ctx.queue.push(makeBody(ctx, 'fragment', start, dir, speed * (0.3 + 0.4 * ctx.rand()), m, fragmentDiameter(m), body.t));
  }
  event(ctx, body, 'splash', { normal: faceNormal, layer: index });
}

/** Delay between a charge appearing at its stand-off and going off, in seconds. */
const CHARGE_FUZE_S = 1.5e-3;
/** Heaviest representative casing fragment, in kilograms. */
const MAX_FRAGMENT_KG = 0.03;
/** Delay before a tandem warhead's second jet group, in seconds. */
const TANDEM_DELAY_S = 40e-6;
/** TNT's specific energy, in joules per kilogram, for the energy line in the results. */
export const TNT_J_PER_KG = 4.184e6;

/** Free-air overpressure from a blast, in kPa (see blastResponse.ts); kept under its old name for the tests. */
export const blastOverpressureKPa = overpressureKPa;

/** Throws a cone of fragments (and shaped-charge jets) from `origin` along `axis`. */
function throwFragments(ctx: Context, body: Body, origin: Vec3, axis: Vec3, spec: NonNullable<BulletSpec['blast']>, cone: number, t: number): void {
  const count = spec.fragmentCount ?? 0;
  const fragMass = body.mass * (spec.fragmentMassFraction ?? 0.7);
  for (let i = 0; i < count; i++) {
    // A sample of the real fragment cloud: each piece stays small, as real casing fragments are.
    const m = Math.min(fragMass / count, MAX_FRAGMENT_KG) * (0.5 + ctx.rand());
    const dir = perturb(axis, cone * Math.sqrt(ctx.rand()), ctx.rand);
    const speed = (spec.fragmentSpeedMs ?? 1300) * (0.8 + 0.4 * ctx.rand());
    const piece = makeBody(ctx, 'fragment', { ...origin }, dir, speed, m, fragmentDiameter(m), t);
    if (ctx.setup.bullet.behaviour === 'charge') piece.extraRangeM = ctx.setup.standOffM;
    ctx.queue.push(piece);
  }
  const jet = spec.jet;
  if (jet) {
    const groups = jet.tandem ? 2 : 1;
    for (let g = 0; g < groups; g++) {
      for (let i = 0; i < jet.count; i++) {
        const m = (body.mass * jet.massFraction * jetStandoffFactor(jet.standoffCal)) / jet.count;
        const dir = perturb(axis, 0.012 * Math.sqrt(ctx.rand()), ctx.rand);
        const speed = jet.speedMs * (0.55 + 0.45 * (1 - i / jet.count)) * (0.97 + 0.06 * ctx.rand());
        const piece = makeBody(ctx, 'fragment', { ...origin }, dir, speed, m, fragmentDiameter(m) * 0.6, t + g * TANDEM_DELAY_S);
        piece.followsJet = g > 0;
        piece.isJet = true;
        if (ctx.setup.bullet.behaviour === 'charge') piece.extraRangeM = ctx.setup.standOffM;
        ctx.queue.push(piece);
      }
    }
  }
}

/** Thickest steel or concrete a HESH charge can spall, per cube root of its yield, in metres. */
const HESH_SPALL_M_PER_KG13 = 0.1;

/** HESH: scabs of the far face fly off the back of a layer thin enough for the shock to cross, forward and slowly. */
function throwSpall(ctx: Context, body: Body, index: number, spec: NonNullable<BulletSpec['blast']>): void {
  const layer = ctx.setup.layers[index];
  const behaviour = layer?.medium.behaviour;
  if (!layer || (behaviour !== 'steel' && behaviour !== 'concrete')) return;
  if (layer.thickness > HESH_SPALL_M_PER_KG13 * Math.cbrt(Math.max(1e-6, spec.yieldKg))) return;
  const { count, speedMs } = spec.spall!;
  const back = add(ctx.setup.impactPoint, scale(ctx.normal, layer.offset + layer.thickness + 0.002));
  // Scabs come off in the face area around the burst, as pieces of the plate itself.
  const mass = Math.min(0.04, 0.4 * layer.thickness * Math.min(layer.medium.heightM, layer.medium.widthM) ** 2 * layer.medium.density / count);
  for (let i = 0; i < count; i++) {
    const m = mass * (0.5 + ctx.rand());
    const r = 0.04 + 0.1 * Math.sqrt(ctx.rand());
    const a = ctx.rand() * Math.PI * 2;
    const start = v3(back.x, body.pos.y + r * Math.sin(a), body.pos.z + r * Math.cos(a));
    const dir = perturb(ctx.normal, 0.7 * Math.sqrt(ctx.rand()), ctx.rand);
    ctx.queue.push(makeBody(ctx, 'fragment', start, dir, speedMs * (0.5 + 0.7 * ctx.rand()), m, fragmentDiameter(m), body.t));
  }
}

/** A round that detonates on contact (shells, warheads): fragments into a forward cone, plus any jets. */
function detonate(ctx: Context, body: Body, index: number): void {
  body.state = 'detonated';
  const spec = body.bullet?.blast;
  if (spec) {
    throwFragments(ctx, body, body.pos, body.dir, spec, spec.jet ? 0.5 : 1.1, body.t);
    if (spec.spall) throwSpall(ctx, body, index, spec);
    event(ctx, body, 'detonate', { layer: index, yieldKg: spec.yieldKg, fireball: spec.fireball ?? 'standard' });
    return;
  }
  const count = 28;
  for (let i = 0; i < count; i++) {
    const m = (body.mass * 0.7) / count;
    const dir = perturb(body.dir, 1.1 * Math.sqrt(ctx.rand()), ctx.rand);
    ctx.queue.push(makeBody(ctx, 'fragment', { ...body.pos }, dir, 1100 + 500 * ctx.rand(), m, fragmentDiameter(m), body.t));
  }
  event(ctx, body, 'detonate', { layer: index, yieldKg: 0.01, fireball: 'standard' });
}

/** The explosion test bed: a charge sits at its stand-off and goes off, throwing fragments and jets at the target. */
function placeCharge(ctx: Context, b: BulletSpec, start: Vec3): void {
  const blast = b.blast ?? { yieldKg: 0 };
  const body = makeBody(ctx, 'bullet', { ...start }, v3(1, 0, 0), 0, bulletMassKg(b), b.caliberMm / 1000, 0, b);
  const standoff = ctx.setup.standOffM;
  // Fragments leave in a cone wide enough to cover the face from the stand-off.
  const cone = Math.min(1.3, Math.atan2(0.7, standoff));
  body.t = CHARGE_FUZE_S;
  body.state = 'detonated';
  const frame = (t: number): Keyframe => ({ t, pos: { ...start }, dir: v3(1, 0, 0), speed: 0, yaw: 0, diameter: body.baseDiameter });
  ctx.tracks.push({
    id: body.id,
    kind: 'bullet',
    massKg: body.mass,
    baseDiameter: body.baseDiameter,
    keyframes: [frame(0), frame(CHARGE_FUZE_S)],
    spawnT: 0,
    endT: CHARGE_FUZE_S,
    persists: false,
    finalState: 'detonated',
  });
  event(ctx, body, 'detonate', {
    layer: 0,
    yieldKg: blast.yieldKg,
    fireball: blast.fireball ?? 'standard',
    pressureKPa: Math.max(0, blastOverpressureKPa(blast.yieldKg, standoff)),
  });
  throwFragments(ctx, body, start, v3(1, 0, 0), blast, cone, CHARGE_FUZE_S);
}

function fragmentDiameter(mass: number): number {
  return Math.cbrt((6 * mass) / (Math.PI * P.leadDensity));
}

function addCavitySample(ctx: Context, body: Body, medium: MediumSpec, layer: number, energyPerMetre: number): void {
  const pressure = medium.cavityPressurePa ?? 1e6;
  const { heightM, widthM } = medium;
  // The block bulges, but the cavity can't grow far past its walls.
  const maxRadius = 0.55 * Math.min(heightM, widthM);
  const open = Math.sqrt(energyPerMetre / (Math.PI * pressure));
  const layerOffset = ctx.setup.layers[layer].offset;
  const depth = depthOf(ctx, body.pos) - layerOffset;
  // Near the entry face the gel vents back out of the hole instead of being pushed sideways (#228), so the
  // cavity is pinched at the entry and swells deeper in: the classic pear shape, widest well into the track.
  const vent = 1 - Math.exp(-Math.max(0, depth) / (P.cavityVentRatio * Math.max(open, 1e-4)));
  const radius = Math.min(maxRadius, open * vent);
  ctx.cavity.push({
    depth,
    pos: { ...body.pos },
    t: body.t,
    radius,
    channelRadius: medium.behaviour === 'gel' ? (body.diameter / 2) * P.channelRadiusFactor : 0,
    energyPerMetre,
    layer,
  });
}

function summarise(ctx: Context, primary: Track): ShotSummary {
  const first = primary.keyframes[0];
  const impact = ctx.events.find((e) => e.type === 'impact' && e.trackId === primary.id);
  const exits = ctx.events.filter((e) => e.type === 'exit' && e.trackId === primary.id);
  const lastLayer = ctx.setup.layers.length - 1;
  const finalExit = exits.find((e) => e.layer === lastLayer);
  const last = primary.keyframes[primary.keyframes.length - 1];
  const bulletTracks = ctx.tracks.filter((t) => t.kind !== 'fragment');
  const impactSpeed = impact?.speed ?? first.speed;
  const pelletCount = bulletTracks.length;
  let maxDepthAll = 0;
  for (const track of bulletTracks) {
    for (const k of track.keyframes) maxDepthAll = Math.max(maxDepthAll, Math.min(ctx.stackDepth, depthOf(ctx, k.pos)));
  }
  let maxCavityRadius = 0;
  for (const c of ctx.cavity) maxCavityRadius = Math.max(maxCavityRadius, c.radius);
  const ricocheted = primary.finalState === 'ricocheted';
  // Warheads and charges do their work through fragments and jets, so look at every track.
  const blast = ctx.setup.bullet.blast;
  let blastPenetration = 0;
  let blastExit: ShotEvent | undefined;
  if (blast) {
    for (const track of ctx.tracks) {
      for (const k of track.keyframes) blastPenetration = Math.max(blastPenetration, Math.min(ctx.stackDepth, depthOf(ctx, k.pos)));
    }
    for (const e of ctx.events) if (e.type === 'exit' && e.layer === lastLayer && (!blastExit || e.speed > blastExit.speed)) blastExit = e;
  }
  const detonation = ctx.events.find((e) => e.type === 'detonate');
  const penetrator = blast ? deepestTrack(ctx) : undefined;
  return {
    impactSpeed,
    impactEnergyJ: ctx.setup.bullet.behaviour === 'charge' ? (blast?.yieldKg ?? 0) * TNT_J_PER_KG : 0.5 * bulletMassKg(ctx.setup.bullet) * pelletCount * impactSpeed ** 2,
    penetrationM: ricocheted ? 0 : blast ? blastPenetration : maxDepthAll,
    passedThrough: blast ? !!blastExit : !!finalExit && !ricocheted,
    exitSpeed: blast ? (blastExit?.speed ?? 0) : finalExit && !ricocheted ? finalExit.speed : 0,
    ...(blast ? { yieldKg: blast.yieldKg, blastKPa: detonation?.pressureKPa } : {}),
    ...(penetrator ? { penetrator } : {}),
    ...(ctx.setup.bullet.behaviour === 'charge' && blast
      ? {
          blastLayers: blastResponse(blast.yieldKg, ctx.setup.standOffM, ctx.setup.layers).map((l) => ({
            name: l.medium.name,
            pressureKPa: l.pressureKPa,
            outcome: l.outcome,
          })),
        }
      : {}),
    finalState: primary.finalState,
    finalDiameter: last.diameter,
    fragments: ctx.tracks.filter((t) => t.kind === 'fragment').length,
    ricocheted,
    maxCavityDiameter: 2 * maxCavityRadius,
    energyDepositedJ: ctx.depositedJ,
    velocityVsDepth: ctx.vd,
  };
}

/** The track that got deepest into the target, with its speed against depth, for the results chart. */
function deepestTrack(ctx: Context): ShotSummary['penetrator'] {
  let best: { track: Track; depth: number } | null = null;
  for (const track of ctx.tracks) {
    let depth = 0;
    for (const k of track.keyframes) depth = Math.max(depth, Math.min(ctx.stackDepth, depthOf(ctx, k.pos)));
    if (depth > 0 && (!best || depth > best.depth)) best = { track, depth };
  }
  if (!best) return undefined;
  const inside = best.track.keyframes.filter((k) => depthOf(ctx, k.pos) >= 0);
  const stride = Math.max(1, Math.ceil(inside.length / 60));
  const curve = inside.filter((_, i) => i % stride === 0).map((k) => ({ depth: Math.min(ctx.stackDepth, depthOf(ctx, k.pos)), speed: k.speed }));
  return { trackId: best.track.id, startSpeed: inside[0]?.speed ?? 0, curve };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
