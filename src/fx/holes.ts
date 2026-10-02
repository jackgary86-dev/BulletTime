import * as THREE from 'three';
import { seededRandom } from '../sim/random';
import type { Vec3 } from '../sim/types';

/**
 * Bullet holes that stay in the target after the shot: a dark, ragged-edged
 * opening on the face plus an optional torn rim (wood spall, paper flaps).
 * Each hole appears at its event time, so scrubbing back before the impact
 * hides it again.
 */

export interface HoleSpec {
  t: number;
  pos: Vec3;
  /** Points out of the face the hole is in. */
  normal: Vec3;
  radius: number;
  /** How much longer than wide the opening is, stretched along `stretchAxis` (wood tears along the grain). */
  stretch?: number;
  stretchAxis?: THREE.Vector3;
  /** Edge raggedness, 0 (clean punch) to 1 (torn). */
  ragged: number;
  /** Colour of the opening (what you see down the hole). */
  color: THREE.ColorRepresentation;
  /** Optional torn rim: splinter fins or paper flaps standing out of the face. */
  rim?: {
    count: number;
    length: [number, number];
    width: number;
    color: THREE.ColorRepresentation;
    /** How far the fins lean out of the face, radians from flat (π/2 = straight out). */
    lift: number;
  };
  seed: number;
}

const OFFSET = 0.0006;

export class HoleMarks {
  readonly group = new THREE.Group();
  private readonly holes: { t: number; object: THREE.Object3D }[] = [];

  constructor() {
    this.group.name = 'holes';
  }

  add(spec: HoleSpec): void {
    const rand = seededRandom(spec.seed);
    const object = new THREE.Group();
    const normal = new THREE.Vector3(spec.normal.x, spec.normal.y, spec.normal.z).normalize();
    object.position.set(spec.pos.x, spec.pos.y, spec.pos.z).addScaledVector(normal, OFFSET);
    // Local +z is the face normal; local +y points along the stretch axis when there is one.
    const up = (spec.stretchAxis ?? new THREE.Vector3(0, 1, 0)).clone();
    up.addScaledVector(normal, -up.dot(normal));
    if (up.lengthSq() < 1e-6) up.set(1, 0, 0).addScaledVector(normal, -normal.x);
    up.normalize();
    const side = new THREE.Vector3().crossVectors(up, normal);
    object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, normal));

    const stretch = spec.stretch ?? 1;
    const points: THREE.Vector2[] = [];
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = spec.radius * (1 + spec.ragged * (rand() - 0.35) * 0.9);
      points.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r * stretch));
    }
    const hole = new THREE.Mesh(
      new THREE.ShapeGeometry(new THREE.Shape(points)),
      new THREE.MeshStandardMaterial({ color: spec.color, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    object.add(hole);

    // A soft scorch/bruise ring around the opening.
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(spec.radius * 0.9, spec.radius * (1.8 + spec.ragged), 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    halo.scale.y = stretch;
    halo.position.z = -OFFSET * 0.5;
    object.add(halo);

    if (spec.rim) {
      const rim = spec.rim;
      const fin = new THREE.BoxGeometry(1, 1, 1);
      fin.translate(0, 0.5, 0);
      const material = new THREE.MeshStandardMaterial({ color: rim.color, roughness: 0.85 });
      const fins = new THREE.InstancedMesh(fin, material, rim.count);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      for (let i = 0; i < rim.count; i++) {
        const a = rand() * Math.PI * 2;
        const along = Math.abs(Math.sin(a));
        // Fins along the grain come out longer, like wood fibres peeling away.
        const length = (rim.length[0] + (rim.length[1] - rim.length[0]) * rand()) * (1 + (stretch - 1) * along);
        const r = spec.radius * (0.85 + 0.3 * rand());
        // Rotate the fin to point radially, then tilt it up out of the face.
        e.set(0, 0, a - Math.PI / 2);
        q.setFromEuler(e);
        const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.cos(a + Math.PI / 2), Math.sin(a + Math.PI / 2), 0), rim.lift * (0.6 + 0.8 * rand()));
        q.premultiply(tilt);
        m.compose(
          new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r * stretch, 0),
          q,
          new THREE.Vector3(rim.width * (0.5 + rand()), length, rim.width * 0.4),
        );
        fins.setMatrixAt(i, m);
      }
      fins.castShadow = true;
      object.add(fins);
    }

    object.visible = false;
    this.group.add(object);
    this.holes.push({ t: spec.t, object });
  }

  clear(): void {
    for (const { object } of this.holes) {
      object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        (mesh.material as THREE.Material | undefined)?.dispose?.();
      });
      this.group.remove(object);
    }
    this.holes.length = 0;
  }

  update(t: number): void {
    for (const hole of this.holes) hole.object.visible = t >= hole.t;
  }
}
