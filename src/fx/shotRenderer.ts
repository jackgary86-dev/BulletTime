import * as THREE from 'three';
import type { BulletSpec } from '../data/bullets';
import { createBulletModel, disposeBulletModel, type BulletModel } from '../models/bullet';
import { BULLET_MATERIALS } from '../models/materials';
import { sampleTrack } from '../sim/sample';
import type { Keyframe, Timeline } from '../sim/types';

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
  private bullet: BulletModel | null = null;
  private pellets: THREE.Mesh[] = [];
  private readonly fragments: THREE.InstancedMesh;
  private readonly pelletGeometry = new THREE.SphereGeometry(0.5, 20, 14);

  constructor() {
    this.group.name = 'shot';
    const geometry = new THREE.IcosahedronGeometry(0.5, 0);
    const material = new THREE.MeshStandardMaterial({ color: 0x9a8a78, metalness: 0.8, roughness: 0.45 });
    this.fragments = new THREE.InstancedMesh(geometry, material, MAX_FRAGMENTS);
    this.fragments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fragments.count = 0;
    this.fragments.frustumCulled = false;
    this.fragments.castShadow = true;
    this.group.add(this.fragments);
  }

  /** Prepares models for a new shot of `spec`. */
  load(timeline: Timeline, spec: BulletSpec): void {
    this.clear();
    this.timeline = timeline;
    const shot = spec.behaviour === 'shot';
    if (shot) {
      for (const track of timeline.tracks) {
        if (track.kind !== 'pellet') continue;
        const pellet = new THREE.Mesh(this.pelletGeometry, BULLET_MATERIALS.lead);
        pellet.scale.setScalar(track.baseDiameter);
        pellet.castShadow = true;
        pellet.userData.trackId = track.id;
        this.pellets.push(pellet);
        this.group.add(pellet);
      }
    } else {
      this.bullet = createBulletModel(spec);
      this.group.add(this.bullet.group);
    }
  }

  clear(): void {
    if (this.bullet) {
      this.group.remove(this.bullet.group);
      disposeBulletModel(this.bullet);
      this.bullet = null;
    }
    for (const pellet of this.pellets) this.group.remove(pellet);
    this.pellets = [];
    this.fragments.count = 0;
    this.timeline = null;
  }

  update(t: number): void {
    const timeline = this.timeline;
    if (!timeline) return;

    if (this.bullet) {
      const frame = sampleTrack(timeline.tracks[0], t);
      this.bullet.group.visible = !!frame;
      if (frame) {
        place(this.bullet.group, frame);
        this.bullet.setDiameter(frame.diameter);
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

    let count = 0;
    for (const track of timeline.tracks) {
      if (track.kind !== 'fragment' || count >= MAX_FRAGMENTS) continue;
      const frame = sampleTrack(track, t);
      if (!frame) continue;
      const size = Math.max(MIN_FRAGMENT_SIZE, track.baseDiameter);
      tmpPos.set(frame.pos.x, frame.pos.y, frame.pos.z);
      // Tumble each fragment at its own rate.
      tmpQuat.setFromAxisAngle(tmpAxis.set(1, 1, 0).normalize(), (t - track.spawnT) * 4000 + track.id);
      tmpScale.set(size, size * 0.7, size * 0.85);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      this.fragments.setMatrixAt(count++, tmpMatrix);
    }
    this.fragments.count = count;
    this.fragments.instanceMatrix.needsUpdate = true;
  }
}

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
