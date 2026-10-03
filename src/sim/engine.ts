import type { BulletSpec } from '../data/bullets';
import { bulletMassKg } from '../data/bullets';
import type { MediumSpec } from '../data/media';
import { PHYSICS as P, STANDARD_RESOLUTION, type SimResolution } from '../data/physics';
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

/** How much of the medium's strength is left at this point, given earlier shots' damage. */
function damageFactor(ctx: Context, pos: Vec3, layer: number, bodyRadius: number): number {
  const damage = ctx.setup.damage;
  if (!damage?.length) return 1;
  let near = 0;
  for (const d of damage) {
    if (d.layer !== layer) continue;
    const dist = Math.hypot(pos.x - d.pos.x, pos.y - d.pos.y, pos.z - d.pos.z);
    if (dist < d.radius * 1.5 + bodyRadius) return DAMAGED_CHANNEL_FACTOR;
    if (dist < WEAKENED_RADIUS_M) near++;
  }
  return Math.max(MIN_WEAKENED_FACTOR, 1 - WEAKEN_PER_HIT * Math.min(near, 4));
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
  impacted: boolean;
  ricocheted: boolean;
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
  };

  const b = setup.bullet;
  const start = sub(setup.impactPoint, v3(setup.standOffM, 0, 0));
  const pellets = b.behaviour === 'shot' ? (b.pellets ?? 9) : 1;
  for (let i = 0; i < pellets; i++) {
    // Pellets leave in a fixed pattern: one centre, the rest on a ring.
    let dir = v3(1, 0, 0);
    if (i > 0 && b.spreadPerMetre) {
      const a = ((i - 1) / (pellets - 1)) * Math.PI * 2;
      dir = normalize(v3(1, Math.sin(a) * b.spreadPerMetre, Math.cos(a) * b.spreadPerMetre));
    }
    ctx.queue.push(makeBody(ctx, pellets > 1 ? 'pellet' : 'bullet', start, dir, b.muzzleVelocityMs, bulletMassKg(b), b.caliberMm / 1000, 0, b));
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
    impacted: false,
    ricocheted: false,
  };
}

function depthOf(ctx: Context, p: Vec3): number {
  return dot(sub(p, ctx.setup.impactPoint), ctx.normal);
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
  const record = () =>
    keyframes.push({
      t: body.t,
      pos: { ...body.pos },
      dir: { ...body.dir },
      speed: body.speed,
      yaw: body.yaw,
      diameter: body.diameter,
    });
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

    let force: number;
    if (medium) {
      force =
        0.5 * medium.density * medium.dragCoefficient * noseFactor * area * body.speed ** 2 +
        medium.resistancePa * area * damageFactor(ctx, body.pos, layerIndex, body.diameter / 2);
    } else {
      force = 0.5 * P.airDensity * P.airDragCoefficient * area * body.speed ** 2;
    }

    const dv = (force / body.mass) * dt;
    const newSpeed = Math.max(0, body.speed - dv);
    const dx = ((body.speed + newSpeed) / 2) * dt;
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
    body.t += dt;
    body.travelled += dx;
    if (body.impacted) body.pathSinceImpact += dx;

    if (medium) {
      body.lastMaterialT = body.t;
      body.layerDist += dx;
      body.materialDist += dx;
      body.maxDepth = Math.max(body.maxDepth, depthOf(ctx, body.pos));
      if (body.id === 0 && step % ctx.res.sampleEvery === 0) ctx.vd.push({ depth: body.pathSinceImpact, speed: body.speed });
      updateExpansion(body, medium);
      updateYawAndBreakup(ctx, body, medium);
    }

    step++;
    if (step % sampleEvery === 0) record();

    // --- End conditions ---
    if (medium && body.speed < P.restSpeed) {
      body.speed = 0;
      if (medium.hardness >= P.splashHardness && body.kind !== 'fragment' && body.state !== 'ricocheted') {
        // Lead and copper meeting steel or concrete they can't defeat splash outward.
        const hardSplash = medium.behaviour === 'steel';
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
      const travelledAway = body.pathSinceImpact > 1.2 || (body.kind === 'fragment' && body.travelled > P.fragmentRangeM);
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
  if (body.bullet?.behaviour === 'explosive') {
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
}

/** Soft bullets flatten against hard media. */
function flatten(body: Body, medium: MediumSpec): void {
  if (medium.hardness <= 0.5 || body.kind === 'fragment') return;
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

function updateYawAndBreakup(ctx: Context, body: Body, medium: MediumSpec): void {
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
      body.yaw = Math.min(Math.PI, body.yaw + (Math.PI / flip) * body.speed * ctx.res.stepS);
    }
  }

  // 5.56 M193: snaps at the cannelure as it turns sideways, if it struck above the threshold.
  if (b.behaviour === 'fragment' && !body.fragmented && body.yaw > 1.0 && body.impactSpeed >= (b.fragmentThresholdMs ?? Infinity)) {
    shed(ctx, body, 0.4, 8, 0.35);
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

/** The 20mm HEI shell detonates on contact, throwing fragments into a forward cone. */
function detonate(ctx: Context, body: Body, index: number): void {
  body.state = 'detonated';
  const count = 28;
  for (let i = 0; i < count; i++) {
    const m = (body.mass * 0.7) / count;
    const dir = perturb(body.dir, 1.1 * Math.sqrt(ctx.rand()), ctx.rand);
    ctx.queue.push(makeBody(ctx, 'fragment', { ...body.pos }, dir, 1100 + 500 * ctx.rand(), m, fragmentDiameter(m), body.t));
  }
  event(ctx, body, 'detonate', { layer: index });
}

function fragmentDiameter(mass: number): number {
  return Math.cbrt((6 * mass) / (Math.PI * P.leadDensity));
}

function addCavitySample(ctx: Context, body: Body, medium: MediumSpec, layer: number, energyPerMetre: number): void {
  const pressure = medium.cavityPressurePa ?? 1e6;
  const { heightM, widthM } = medium;
  // The block bulges, but the cavity can't grow far past its walls.
  const maxRadius = 0.55 * Math.min(heightM, widthM);
  const radius = Math.min(maxRadius, Math.sqrt(energyPerMetre / (Math.PI * pressure)));
  const layerOffset = ctx.setup.layers[layer].offset;
  ctx.cavity.push({
    depth: depthOf(ctx, body.pos) - layerOffset,
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
  return {
    impactSpeed,
    impactEnergyJ: 0.5 * bulletMassKg(ctx.setup.bullet) * pelletCount * impactSpeed ** 2,
    penetrationM: ricocheted ? 0 : maxDepthAll,
    passedThrough: !!finalExit && !ricocheted,
    exitSpeed: finalExit && !ricocheted ? finalExit.speed : 0,
    finalState: primary.finalState,
    finalDiameter: last.diameter,
    fragments: ctx.tracks.filter((t) => t.kind === 'fragment').length,
    ricocheted,
    maxCavityDiameter: 2 * maxCavityRadius,
    energyDepositedJ: ctx.depositedJ,
    velocityVsDepth: ctx.vd,
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
