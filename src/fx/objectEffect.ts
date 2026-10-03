import * as THREE from 'three';
import { BOWLING_BALL_CRACK_J, MELON_BURST_J, energyIntoLayer } from '../data/objects';
import type { MediumLook } from '../data/media';
import { layerGroupName, OBJECT_BODY_NAME } from '../models/targets';
import type { TargetLayer } from '../sim/engine';
import { seededRandom } from '../sim/random';
import type { ShotEvent, Timeline } from '../sim/types';
import type { HoleMarks } from './holes';
import { FLOOR_Y, type BurstSpec, type ParticleSystem } from './particles';

/**
 * Showpiece objects (#156). Each one has its own signature effect on top of
 * the physics: the watermelon swells and bursts, the bottle shatters round its
 * water, the bowling ball cracks into chunks, and the gong shudders.
 *
 * Like the particles, every moving piece is a closed form of its spawn state,
 * so the effect scrubs both ways.
 */

const MELON = { rind: 0x2f5a25, flesh: 0xc41a30, juice: 0xd8324a, seed: 0x1a1210, white: 0xe9efcf };
const BOTTLE = { glass: 0x9fe0b8, water: 0xbfe6f5 };
const BALL = { resin: 0x2b2f3a, shell: 0x1d2c6e, chip: 0x3a4b9a, dust: 0xbfc4d0 };

/** How long a watermelon or bowling ball holds together after the hit before it gives way, in seconds. */
const MELON_SWELL_S = 450e-6;
const BALL_CRACK_S = 350e-6;

interface Piece {
  mesh: THREE.Object3D;
  t0: number;
  p0: THREE.Vector3;
  v: THREE.Vector3;
  spinAxis: THREE.Vector3;
  spin: number;
  /** Height of the piece's lowest point below its centre, so it rests on the floor. */
  rest: number;
}

interface ObjectState {
  body: THREE.Object3D;
  look: MediumLook;
  centre: THREE.Vector3;
  /** Sim time the body vanishes (burst, shattered or cracked apart), or Infinity. */
  goneAt: number;
  /** Swelling before a burst, or a jiggle after a hit: [start time, peak scale, duration]. */
  pulses: [number, number, number][];
  /** Shudder of a struck plate: [start time, amplitude in radians]. */
  shudders: [number, number][];
  /** A water fill that balloons out and fades after the bottle shatters. */
  water?: { mesh: THREE.Mesh; material: THREE.MeshPhysicalMaterial; t0: number };
}

/** How long the bottle's water column bulges out and fades before it is all spray, in seconds. */
const WATER_BULGE_S = 0.8e-3;

/** A struck gong's lowest bending mode, in hertz, and how fast it dies away, in seconds. */
const GONG_HZ = 140;
const GONG_DECAY_S = 6e-3;

export class ObjectEffect {
  readonly group = new THREE.Group();
  private objects: ObjectState[] = [];
  private pieces: Piece[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(
    private readonly particles: ParticleSystem,
    private readonly holes: HoleMarks,
  ) {
    this.group.name = 'object-effects';
  }

  load(timeline: Timeline, target: THREE.Group, layers: TargetLayer[]): void {
    this.clear();
    target.updateMatrixWorld(true);
    layers.forEach((layer, index) => {
      const { medium } = layer;
      if (!medium.shape) return;
      const body = target.getObjectByName(layerGroupName(layer.stack ?? 0))?.getObjectByName(OBJECT_BODY_NAME);
      if (!body) return;
      const state: ObjectState = { body, look: medium.look, centre: body.getWorldPosition(new THREE.Vector3()), goneAt: Infinity, pulses: [], shudders: [] };
      this.objects.push(state);
      const size = { x: layer.thickness / 2, y: medium.heightM / 2, z: medium.widthM / 2 };
      timeline.shots.forEach((shot, s) => {
        const end = timeline.shots[s + 1]?.start ?? Infinity;
        const events = timeline.events.filter((e) => e.layer === index && e.t >= shot.start && e.t < end && timeline.tracks[e.trackId]?.kind !== 'fragment');
        const entry = events.find((e) => e.type === 'impact' || e.type === 'enter');
        if (!entry || entry.t >= state.goneAt) return;
        const exit = events.find((e) => e.type === 'exit');
        const energy = energyIntoLayer(timeline, index, s);
        const seed = 1560 + s * 31 + index * 7;
        switch (medium.look) {
          case 'watermelon':
            this.melon(state, size, entry, exit, energy, seed);
            break;
          case 'bottle':
            this.bottle(state, size, entry, exit, energy, seed);
            break;
          case 'bowlingBall':
            this.bowlingBall(state, size.y, entry, energy, seed);
            break;
          case 'gong':
            state.shudders.push([entry.t, Math.min(0.03, 0.004 + energy / 60000)]);
            break;
        }
      });
    });
  }

  /** Hydrodynamic burst: the pressure pulse from the bullet swells the melon until the rind splits outward. */
  private melon(state: ObjectState, size: Vec, entry: ShotEvent, exit: ShotEvent | undefined, energy: number, seed: number): void {
    const k = Math.min(1, energy / 2500);
    const inward = vec(entry.pos).sub(state.centre).normalize();
    // A mist of juice blows back out of the entry.
    this.particles.add(spray('droplet', entry.t, vec(entry.pos), inward, 0.6, 60 + 200 * k, [5, 25 + 40 * k], [0.0008, 0.0025], MELON.juice, seed));
    if (exit) {
      // The exit throws a cone of flesh and juice after the bullet.
      const out = vec(exit.pos).sub(state.centre).normalize();
      this.particles.add(spray('chunk', exit.t, vec(exit.pos), out, 0.6, 60 + 200 * k, [4, 25 + exit.speed * 0.04], [0.004, 0.014], MELON.flesh, seed + 3));
      this.particles.add(spray('blob', exit.t, vec(exit.pos), out, 0.5, 80 + 300 * k, [10, 60 + exit.speed * 0.08], [0.002, 0.008], MELON.flesh, seed + 1));
      this.particles.add(spray('droplet', exit.t, vec(exit.pos), out, 0.7, 120 + 300 * k, [15, 80 + exit.speed * 0.1], [0.0008, 0.003], MELON.juice, seed + 2));
    }
    if (energy < MELON_BURST_J) {
      // Holed but whole: it jiggles as the cavity collapses, and shows a dark entry hole in the rind.
      state.pulses.push([entry.t, 1.05, 1.2e-3]);
      this.holes.add({ t: entry.t, pos: entry.pos, normal: inward, radius: 0.004, ragged: 0.6, color: 0x3a0a10, noHalo: true, seed });
      if (exit) this.holes.add({ t: exit.t, pos: exit.pos, normal: vec(exit.pos).sub(state.centre).normalize(), radius: 0.009, ragged: 0.9, color: 0x5a0a14, crater: { radius: 0.016, color: MELON.flesh }, seed: seed + 1 });
      return;
    }
    const burst = entry.t + MELON_SWELL_S * (1.2 - 0.5 * k);
    state.pulses.push([entry.t, 1.12 + 0.08 * k, burst - entry.t]);
    state.goneAt = burst;
    const speed = 12 + 40 * k;
    this.shell(state, size, burst, speed, { outer: MELON.rind, inner: MELON.flesh, rim: MELON.white }, 16, seed + 3);
    // The flesh goes everywhere: chunks, pulp and juice, out from the shot line in every direction.
    for (const [axis, i] of AXES.map((a, i) => [a, i] as const)) {
      // Spawned through the whole volume, so the flesh fills the space the rind leaves.
      this.particles.add(spray('chunk', burst, state.centre, axis, 1.0, 120 + 200 * k, [speed * 0.2, speed * 1.1], [0.008, 0.03], MELON.flesh, seed + 10 + i, size.y * 1.2));
      this.particles.add(spray('blob', burst, state.centre, axis, 1.0, 80 + 160 * k, [speed * 0.3, speed * 1.4], [0.003, 0.009], MELON.flesh, seed + 40 + i, size.y));
      this.particles.add(spray('droplet', burst, state.centre, axis, 1.1, 160 + 260 * k, [speed * 0.5, speed * 2], [0.001, 0.004], MELON.juice, seed + 20 + i, size.y));
    }
    this.particles.add(spray('grain', burst, state.centre, new THREE.Vector3(0, 1, 0), Math.PI, 60, [speed * 0.3, speed], [0.003, 0.005], MELON.seed, seed + 30, 0.05));
  }

  /** The glass gives way at once and the water inside bursts outward from the shot line. */
  private bottle(state: ObjectState, size: Vec, entry: ShotEvent, exit: ShotEvent | undefined, energy: number, seed: number): void {
    const k = Math.min(1, energy / 1200);
    state.goneAt = entry.t + 40e-6;
    const speed = 20 + 40 * k;
    const centre = new THREE.Vector3(state.centre.x, vec(entry.pos).y, state.centre.z);
    // Glass: a ring of shards round the shot line, a puff of glass dust at the entry, and a few curved pieces of wall.
    for (const [axis, i] of AXES.map((a, i) => [a, i] as const)) {
      this.particles.add(spray('shard', state.goneAt, centre, axis, 1.0, 90 + 120 * k, [speed * 0.5, speed * 2], [0.002, 0.009], BOTTLE.glass, seed + i, size.z));
    }
    this.particles.add(spray('shard', entry.t, vec(entry.pos), new THREE.Vector3(-1, 0, 0), 0.8, 60, [10, 40], [0.001, 0.004], BOTTLE.glass, seed + 9));
    this.shell(state, size, state.goneAt, speed, { outer: BOTTLE.glass, glass: true, cylinder: true }, 50, seed + 3);
    // Water: droplets out in every direction, a jet after the bullet, and the water column ballooning out.
    for (const [axis, i] of AXES.map((a, i) => [a, i] as const)) {
      this.particles.add(spray('droplet', state.goneAt, centre, axis, 1.1, 180 + 300 * k, [speed * 0.2, speed * 1.2], [0.002, 0.008], BOTTLE.water, seed + 20 + i, size.z));
    }
    if (exit) this.particles.add(spray('droplet', exit.t, vec(exit.pos), new THREE.Vector3(1, 0, 0), 0.45, 200, [20, 40 + exit.speed * 0.1], [0.001, 0.004], BOTTLE.water, seed + 30));
    const water = state.body.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.renderOrder === -1);
    if (water) {
      const material = (water.material as THREE.MeshPhysicalMaterial).clone();
      this.materials.push(material);
      const mesh = new THREE.Mesh(water.geometry, material);
      state.body.getWorldPosition(mesh.position);
      this.group.add(mesh);
      mesh.visible = false;
      state.water = { mesh, material, t0: state.goneAt };
    }
  }

  /** Pistol rounds bury themselves in the shell; rifle rounds crack the ball into a few big chunks. */
  private bowlingBall(state: ObjectState, r: number, entry: ShotEvent, energy: number, seed: number): void {
    const k = Math.min(1, energy / 4000);
    const normal = vec(entry.pos).sub(state.centre).normalize();
    // Blue chips and pale resin dust out of the crater.
    this.particles.add(spray('chunk', entry.t, vec(entry.pos), normal, 0.9, 20 + 40 * k, [4, 20 + 20 * k], [0.0015, 0.005], BALL.chip, seed));
    this.particles.add({ ...spray('dust', entry.t, vec(entry.pos), normal, 1.0, 40 + 80 * k, [2, 15], [0.008, 0.02], BALL.dust, seed + 1), grow: 3, drag: 150, gravity: 2, life: [2e-3, 6e-3] });
    const cracked = energy > BOWLING_BALL_CRACK_J;
    if (!cracked)
      this.holes.add({
      t: entry.t,
      pos: entry.pos,
      normal,
      radius: 0.0045,
      ragged: 0.6,
      color: 0x0a0a0c,
      noHalo: true,
      crater: { radius: 0.012 + 0.01 * k, color: BALL.dust, roughness: 0.9, irregularity: 0.6 },
      cracks: { count: 3 + Math.round(3 * k), length: [0.01, 0.025], width: 0.0008, color: 0x07080c },
      seed: seed + 2,
    });
    if (!cracked) return;
    state.goneAt = entry.t + BALL_CRACK_S;
    const speed = 5 + 18 * k;
    this.shell(state, { x: r, y: r, z: r }, state.goneAt, speed, { outer: BALL.shell, inner: BALL.resin, thick: true }, 7, seed + 3);
    this.particles.add({ ...spray('dust', state.goneAt, state.centre, new THREE.Vector3(0, 1, 0), Math.PI, 160, [1, 8 + 10 * k], [0.015, 0.04], BALL.dust, seed + 4, r * 0.7), grow: 4, drag: 120, gravity: 1, life: [4e-3, 12e-3] });
    this.particles.add(spray('chunk', state.goneAt, state.centre, new THREE.Vector3(0, 1, 0), Math.PI, 90, [speed * 0.5, speed * 2], [0.003, 0.012], BALL.resin, seed + 5, r * 0.6));
  }

  /**
   * Breaks the body's outline into `count` curved pieces of its surface that
   * fly out from the shot line, spinning. Each piece copies the body's own
   * outer material (with its texture) and gets an inner face of `inner`.
   */
  private shell(
    state: ObjectState,
    size: Vec,
    t0: number,
    speed: number,
    look: { outer: number; inner?: number; rim?: number; glass?: boolean; thick?: boolean; cylinder?: boolean },
    count: number,
    seed: number,
  ): void {
    const rand = seededRandom(seed);
    const outer = look.glass
      ? new THREE.MeshPhysicalMaterial({ color: look.outer, roughness: 0.03, transparent: true, opacity: 0.28, specularIntensity: 1, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false })
      : bodyMaterial(state.body)?.clone() ?? new THREE.MeshStandardMaterial({ color: look.outer });
    const inner = look.inner !== undefined ? new THREE.MeshStandardMaterial({ color: look.inner, roughness: 0.7, side: THREE.BackSide }) : null;
    const rim = look.rim !== undefined ? new THREE.MeshStandardMaterial({ color: look.rim, roughness: 0.8, side: THREE.BackSide }) : null;
    this.materials.push(outer, ...(inner ? [inner] : []), ...(rim ? [rim] : []));
    // Bands of latitude round the shot line (x), each cut into sectors, with ragged extents.
    const bands = Math.max(2, Math.round(Math.sqrt(count / 2)));
    const sectors = Math.ceil(count / bands);
    for (let b = 0; b < bands; b++) {
      for (let s = 0; s < sectors; s++) {
        const theta0 = (b / bands) * Math.PI;
        const thetaLen = (Math.PI / bands) * (0.85 + 0.15 * rand());
        const phi0 = ((s + rand() * 0.3) / sectors) * Math.PI * 2;
        const phiLen = ((Math.PI * 2) / sectors) * (0.8 + 0.2 * rand());
        // A bottle breaks into curved strips of its wall: bands up the cylinder, cut round it.
        const outerGeometry = look.cylinder
          ? new THREE.CylinderGeometry(size.z, size.z, (size.y * 2) / bands, 8, 1, true, phi0, phiLen).translate(0, -size.y + ((b + 0.5) * size.y * 2) / bands, 0)
          : patch(size, phi0, phiLen, theta0, thetaLen, 1);
        const centre = patchCentre(outerGeometry);
        outerGeometry.translate(-centre.x, -centre.y, -centre.z);
        this.geometries.push(outerGeometry);
        const piece = new THREE.Group();
        piece.add(new THREE.Mesh(outerGeometry, outer));
        if (inner) {
          // Rind or shell thickness: a white band of rind for the melon, a chunk of core for the ball.
          const depth = look.thick ? 0.55 : 0.88;
          const innerGeometry = patch(size, phi0, phiLen, theta0, thetaLen, depth);
          innerGeometry.translate(-centre.x, -centre.y, -centre.z);
          this.geometries.push(innerGeometry);
          piece.add(new THREE.Mesh(innerGeometry, inner));
          if (rim) {
            const rimGeometry = patch(size, phi0, phiLen, theta0, thetaLen, 0.95);
            rimGeometry.translate(-centre.x, -centre.y, -centre.z);
            this.geometries.push(rimGeometry);
            piece.add(new THREE.Mesh(rimGeometry, rim));
          }
        }
        piece.visible = false;
        this.group.add(piece);
        // Out from the shot line (x), with a little forward drift along it.
        const out = look.cylinder ? new THREE.Vector3(centre.x, centre.y * 0.3, centre.z).normalize() : new THREE.Vector3(centre.x * 0.25, centre.y, centre.z).normalize();
        const v = out.multiplyScalar(speed * (0.6 + 0.8 * rand())).add(new THREE.Vector3(speed * 0.15 * rand(), speed * 0.1 * rand(), 0));
        this.pieces.push({
          mesh: piece,
          t0,
          p0: state.centre.clone().add(centre),
          v,
          spinAxis: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
          spin: (20 + 80 * rand()) * (1 + speed / 20),
          rest: Math.max(size.x, size.y, size.z) * 0.15,
        });
      }
    }
  }

  clear(): void {
    for (const o of this.objects) {
      o.body.visible = true;
      o.body.scale.setScalar(1);
      o.body.rotation.set(0, 0, 0);
    }
    this.objects = [];
    this.pieces = [];
    this.group.clear();
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
    this.materials.length = 0;
    this.geometries.length = 0;
  }

  update(t: number): void {
    for (const o of this.objects) {
      o.body.visible = t < o.goneAt;
      let scale = 1;
      for (const [t0, peak, duration] of o.pulses) {
        const u = (t - t0) / duration;
        if (u < 0) continue;
        // A burst swells all the way to its peak; a jiggle swells and settles back with a wobble.
        scale *= o.goneAt < Infinity ? 1 + (peak - 1) * Math.min(1, u) ** 2 : 1 + (peak - 1) * Math.sin(Math.min(u, 3) * Math.PI) * Math.exp(-u);
      }
      o.body.scale.setScalar(scale);
      let angle = 0;
      for (const [t0, amplitude] of o.shudders) {
        const dt = t - t0;
        if (dt > 0) angle += amplitude * Math.sin(2 * Math.PI * GONG_HZ * dt) * Math.exp(-dt / GONG_DECAY_S);
      }
      o.body.rotation.set(0, angle, angle * 0.4);
      if (o.water) {
        const dt = t - o.water.t0;
        o.water.mesh.visible = dt >= 0 && dt < WATER_BULGE_S;
        if (o.water.mesh.visible) {
          const u = dt / WATER_BULGE_S;
          o.water.mesh.scale.set(1 + 1.5 * u, 1 + 0.2 * u, 1 + 1.5 * u);
          o.water.material.opacity = 0.35 * (1 - u) ** 2;
        }
      }
    }
    for (const p of this.pieces) {
      const dt = t - p.t0;
      p.mesh.visible = dt >= 0;
      if (dt < 0) continue;
      const pos = p.p0.clone().addScaledVector(p.v, dt);
      pos.y -= 4.9 * dt * dt;
      pos.y = Math.max(pos.y, FLOOR_Y + p.rest);
      p.mesh.position.copy(pos);
      p.mesh.quaternion.setFromAxisAngle(p.spinAxis, p.spin * dt);
    }
  }

  dispose(): void {
    this.clear();
  }
}

type Vec = { x: number; y: number; z: number };

/** Four directions out from the shot line, so a burst throws its debris all the way round. */
const AXES = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0.2, 0, 1).normalize(), new THREE.Vector3(0.2, 0, -1).normalize()];

function vec(v: Vec): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

/** The body's first mesh material, so its broken pieces keep its paint and texture. */
function bodyMaterial(body: THREE.Object3D): THREE.Material | null {
  let found: THREE.Material | null = null;
  body.traverse((o) => {
    if (!found && o instanceof THREE.Mesh) found = Array.isArray(o.material) ? o.material[0] : o.material;
  });
  return found;
}

/**
 * A curved piece of an ellipsoid's surface with semi-axes `size`, scaled by
 * `depth` (1 = the outer surface). Latitude runs round the shot line (x).
 */
function patch(size: Vec, phi0: number, phiLen: number, theta0: number, thetaLen: number, depth: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 10, 6, phi0, phiLen, theta0, thetaLen);
  // SphereGeometry's poles are on y; turn them onto x so the bands circle the shot line.
  g.rotateZ(-Math.PI / 2);
  g.scale(size.x * depth, size.y * depth, size.z * depth);
  return g;
}

function patchCentre(g: THREE.BufferGeometry): THREE.Vector3 {
  g.computeBoundingBox();
  return g.boundingBox!.getCenter(new THREE.Vector3());
}

function spray(
  look: BurstSpec['look'],
  t: number,
  origin: THREE.Vector3,
  axis: THREE.Vector3,
  spread: number,
  count: number,
  speed: [number, number],
  size: [number, number],
  color: number,
  seed: number,
  jitter = 0.004,
): BurstSpec {
  return {
    look,
    t0: t,
    duration: 150e-6,
    origin: origin.clone(),
    originJitter: jitter,
    axis: axis.clone().normalize(),
    spread,
    count: Math.round(count),
    speed,
    size,
    life: [4e-3, 15e-3],
    drag: look === 'droplet' || look === 'blob' ? 15 : 20,
    gravity: 9.8,
    color,
    colorJitter: 0.25,
    seed,
  };
}
