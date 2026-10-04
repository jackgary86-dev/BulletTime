import * as THREE from 'three';
import { getBullet } from '../data/bullets';
import { createBulletModel, disposeBulletModel, type BulletModel } from '../models/bullet';
import { BULLET_MATERIALS } from '../models/materials';
import { bodyVisible, crumpleDuration, crumpleProgress } from '../sim/crumple';
import { sampleTrack } from '../sim/sample';
import type { Keyframe, Timeline } from '../sim/types';
import { createMissileTrail, type MissileTrail } from './missileTrail';
import { airIntervals, createMotionStreak, createWake, type MotionStreak, type Wake } from './wake';

const MAX_FRAGMENTS = 256;
/** Fragments are drawn at least this big so they read on screen, in metres. */
const MIN_FRAGMENT_SIZE = 0.0015;

const X_AXIS = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const tmpDir = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const yawQuat = new THREE.Quaternion();
const tmpMatrix = new THREE.Matrix4();
const tmpScale = new THREE.Vector3();
const tmpPos = new THREE.Vector3();

/**
 * Draws every projectile in a timeline at a given time: the bullet (or one ball
 * per pellet) as full models, and fragments as one instanced mesh.
 */
export class ShotRenderer {
  readonly group = new THREE.Group();
  private timeline: Timeline | null = null;
  private targetHardness = CRUMPLE_HARDNESS;
  private bullets: { model: BulletModel; trackId: number; wake: Wake; streak: MotionStreak; air: [number, number][]; trail?: MissileTrail; crumples: boolean }[] = [];
  /**
   * Wakes and streaks from earlier shots, kept for the next one: freeing their
   * materials would make three.js drop the shaders and compile them again on
   * every Fire (#127).
   */
  private spareAir: { wake: Wake; streak: MotionStreak }[] = [];
  /** Missile trails from earlier shots, kept for the next one for the same reason. */
  private spareTrails: MissileTrail[] = [];
  private pellets: THREE.Mesh[] = [];
  /** Lead shards and curled strips of torn jacket (#71); every third fragment is jacket. */
  private readonly fragments: THREE.InstancedMesh;
  private readonly jacketCurls: THREE.InstancedMesh;
  private readonly pelletGeometry = new THREE.SphereGeometry(0.5, 20, 14);

  constructor() {
    this.group.name = 'shot';
    const instanced = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
      const mesh = new THREE.InstancedMesh(geometry, material, MAX_FRAGMENTS);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    this.fragments = instanced(shardGeometry(), new THREE.MeshStandardMaterial({ color: 0x8a8d92, metalness: 0.6, roughness: 0.5, flatShading: true }));
    this.jacketCurls = instanced(
      curlGeometry(),
      new THREE.MeshStandardMaterial({ color: 0xc8733f, metalness: 1, roughness: 0.35, side: THREE.DoubleSide, flatShading: true }),
    );
  }

  /** Prepares models for every shot on the timeline (each shot may be a different round). */
  /** `targetHardness` (0-1, the struck front layer) sets how fast a missile or shell body folds against it (#248). */
  load(timeline: Timeline, targetHardness = CRUMPLE_HARDNESS): void {
    this.clear();
    this.timeline = timeline;
    this.targetHardness = targetHardness;
    for (const shot of timeline.shots) {
      const spec = getBullet(shot.bulletId);
      if (spec.behaviour === 'shot') {
        for (let id = shot.firstTrack; id < shot.firstTrack + shot.trackCount; id++) {
          const track = timeline.tracks[id];
          if (track.kind !== 'pellet') continue;
          const pellet = new THREE.Mesh(this.pelletGeometry, BULLET_MATERIALS.lead);
          pellet.scale.setScalar(track.baseDiameter);
          pellet.castShadow = true;
          pellet.userData.trackId = track.id;
          this.pellets.push(pellet);
          this.group.add(pellet);
        }
      } else {
        const model = createBulletModel(spec);
        const { wake, streak } = this.spareAir.pop() ?? newAir();
        streak.setColor(spec.shape === 'roundNose' && spec.type.toLowerCase().includes('lead') ? 0x8a8f96 : 0xc0804c);
        this.group.add(model.group, wake.group);
        // Powered missiles carry a rocket plume and a smoke trail; a kinetic penetrator coasts.
        const trail = spec.shape === 'missile' ? this.spareTrails.pop() ?? createMissileTrail() : undefined;
        if (trail) this.group.add(trail.group);
        this.bullets.push({ model, trackId: shot.primaryId, wake, streak, trail, crumples: !!spec.blast || spec.shape === 'missile', air: airIntervals(timeline.tracks[shot.primaryId], timeline.events) });
      }
    }
  }

  clear(): void {
    for (const { model, wake, streak, trail } of this.bullets) {
      this.group.remove(model.group, wake.group);
      if (trail) {
        this.group.remove(trail.group);
        this.spareTrails.push(trail);
      }
      disposeBulletModel(model);
      this.spareAir.push({ wake, streak });
    }
    this.bullets = [];
    for (const pellet of this.pellets) this.group.remove(pellet);
    this.pellets = [];
    this.fragments.count = 0;
    this.jacketCurls.count = 0;
    this.timeline = null;
  }

  /** Frees the spare wakes and streaks kept for later shots. */
  dispose(): void {
    this.clear();
    for (const { wake, streak } of this.spareAir) {
      wake.dispose();
      streak.dispose();
    }
    this.spareAir = [];
    for (const trail of this.spareTrails) trail.dispose();
    this.spareTrails = [];
  }

  /** Places every projectile at sim time `t`; `shutterS` is one frame's exposure, for motion blur (#74). */
  update(t: number, shutterS = 0): void {
    const timeline = this.timeline;
    if (!timeline) return;

    for (const { model, trackId, wake, streak, air, trail, crumples } of this.bullets) {
      const track = timeline.tracks[trackId];
      let frame = sampleTrack(track, t);
      // A missile or shell is not gone the instant it bursts (#248): the body stays at the face and folds up.
      let crush: number | undefined;
      if (!frame && crumples) {
        const last = track.keyframes[track.keyframes.length - 1];
        const since = t - last.t;
        const duration = crumpleDuration(model.length, last.speed, this.targetHardness);
        if (since >= 0 && bodyVisible(since, duration)) {
          frame = { ...last, speed: 0 };
          crush = crumpleProgress(since, duration);
        }
      }
      model.group.visible = !!frame;
      if (frame) {
        place(model.group, frame);
        model.setDiameter(frame.diameter, crush ?? frame.crush);
        // The wake follows the flight path, not the bullet's yaw.
        wake.group.position.copy(model.group.position);
        wake.group.quaternion.setFromUnitVectors(X_AXIS, tmpDir.set(frame.dir.x, frame.dir.y, frame.dir.z));
      }
      const inAir = !!frame && air.some(([a, b]) => t >= a && t < b);
      wake.update(inAir, frame?.speed ?? 0, frame?.diameter ?? 0, model.length);
      wake.group.visible = !!frame;
      streak.update(!!frame, (frame?.speed ?? 0) * shutterS, frame?.diameter ?? 0);
      if (trail) {
        if (frame) {
          trail.group.position.copy(model.group.position);
          trail.group.quaternion.setFromUnitVectors(X_AXIS, tmpDir.set(frame.dir.x, frame.dir.y, frame.dir.z));
        }
        trail.update(inAir, model.length, frame?.diameter ?? 0, performance.now() / 1000);
      }
    }

    for (const pellet of this.pellets) {
      const frame = sampleTrack(timeline.tracks[pellet.userData.trackId as number], t);
      pellet.visible = !!frame;
      if (frame) {
        pellet.position.set(frame.pos.x, frame.pos.y, frame.pos.z);
        // Flattened pellets read as wider discs.
        const d = frame.diameter;
        const base = timeline.tracks[pellet.userData.trackId as number].baseDiameter;
        pellet.scale.set(base * (base / d), d, d);
      }
    }

    let shards = 0;
    let curls = 0;
    for (const track of timeline.tracks) {
      if (track.kind !== 'fragment') continue;
      const curl = track.id % 3 === 0;
      if ((curl ? curls : shards) >= MAX_FRAGMENTS) continue;
      const frame = sampleTrack(track, t);
      if (!frame) continue;
      const size = Math.max(MIN_FRAGMENT_SIZE, track.baseDiameter);
      tmpPos.set(frame.pos.x, frame.pos.y, frame.pos.z);
      // Tumble each fragment about its own axis at its own rate.
      const a = track.id * 2.399;
      tmpAxis.set(Math.cos(a), Math.sin(a * 1.7), Math.sin(a)).normalize();
      tmpQuat.setFromAxisAngle(tmpAxis, (t - track.spawnT) * (2500 + (track.id % 7) * 600) + track.id);
      const stretch = 0.75 + ((track.id * 37) % 10) / 20;
      tmpScale.set(size * stretch, size * 0.7, size * (1.6 - stretch));
      const travel = frame.speed * shutterS;
      if (travel > size * 0.5) {
        // Motion blur: smeared along the flight path over the frame's exposure.
        tmpQuat.setFromUnitVectors(X_AXIS, tmpDir.set(frame.dir.x, frame.dir.y, frame.dir.z));
        tmpScale.set(Math.min(size * 14, size + travel), size * 0.7, size * 0.7);
      }
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      if (curl) this.jacketCurls.setMatrixAt(curls++, tmpMatrix);
      else this.fragments.setMatrixAt(shards++, tmpMatrix);
    }
    this.fragments.count = shards;
    this.jacketCurls.count = curls;
    this.fragments.instanceMatrix.needsUpdate = true;
    this.jacketCurls.instanceMatrix.needsUpdate = true;
  }
}

/** Target hardness the crumple assumes when the struck material is not given. */
const CRUMPLE_HARDNESS = 0.8;

/** Points a model (nose along local +x, origin at the nose) along the keyframe's direction, then yaws it. */
function place(object: THREE.Object3D, frame: Keyframe): void {
  object.position.set(frame.pos.x, frame.pos.y, frame.pos.z);
  tmpDir.set(frame.dir.x, frame.dir.y, frame.dir.z);
  object.quaternion.setFromUnitVectors(X_AXIS, tmpDir);
  if (frame.yaw > 1e-3) {
    // Yaw about the axis perpendicular to travel in the horizontal plane, pivoting near the centre.
    tmpAxis.crossVectors(tmpDir, UP);
    if (tmpAxis.lengthSq() < 1e-6) tmpAxis.set(0, 0, 1);
    tmpAxis.normalize();
    yawQuat.setFromAxisAngle(tmpAxis, frame.yaw);
    object.quaternion.premultiply(yawQuat);
  }
}

/** A jagged lead shard: a stretched, faceted lump with sharp corners. */
function shardGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const pos = g.getAttribute('position');
  const moved = new Map<string, THREE.Vector3>();
  const p = new THREE.Vector3();
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const key = `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
    if (!moved.has(key)) moved.set(key, p.clone().multiplyScalar(0.55 + 0.8 * rand()));
    const to = moved.get(key)!;
    pos.setXYZ(i, to.x, to.y, to.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A torn strip of jacket curled back on itself, with ragged edges. */
function curlGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.35, 0.35, 0.8, 10, 3, true, 0, Math.PI * 1.3);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    // Ragged top and bottom edges, and a twist along the strip.
    const y = pos.getY(i);
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const r = 0.35 * (1 + 0.25 * Math.sin(a * 3 + y * 4));
    pos.setXYZ(i, Math.cos(a + y * 0.8) * r, y + (Math.abs(y) > 0.3 ? 0.08 * Math.sin(a * 7) : 0), Math.sin(a + y * 0.8) * r);
  }
  g.computeVertexNormals();
  return g;
}

/** A wake with its motion streak attached. */
function newAir(): { wake: Wake; streak: MotionStreak } {
  const wake = createWake();
  const streak = createMotionStreak(0xc0804c);
  wake.group.add(streak.mesh);
  return { wake, streak };
}
