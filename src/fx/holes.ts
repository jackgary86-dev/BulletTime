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
  /** A shallow pit or dent around the opening, drawn under it (concrete crater, steel dent). */
  crater?: {
    radius: number;
    color: THREE.ColorRepresentation;
    roughness?: number;
    metalness?: number;
    /** Edge irregularity, 0–1 (default 0.45). */
    irregularity?: number;
  };
  /** Thin cracks radiating from the hole (concrete). */
  cracks?: {
    count: number;
    length: [number, number];
    width: number;
    color: THREE.ColorRepresentation;
  };
  /** Draw only the crater and cracks, not a dark opening (a dent or a pit that did not go through). */
  noOpening?: boolean;
  /** Skip the soft dark bruise ring around the hole. */
  noHalo?: boolean;
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
    if (!spec.noOpening) {
      const hole = new THREE.Mesh(
        new THREE.ShapeGeometry(new THREE.Shape(points)),
        new THREE.MeshStandardMaterial({ color: spec.color, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3 }),
      );
      object.add(hole);
    }

    if (spec.crater) {
      const c = spec.crater;
      const rim: THREE.Vector2[] = [];
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        const jag = c.irregularity ?? 0.45;
        const r = c.radius * (1 - jag * 0.55 + jag * rand());
        rim.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r * stretch));
      }
      const crater = new THREE.Mesh(
        new THREE.ShapeGeometry(new THREE.Shape(rim)),
        new THREE.MeshStandardMaterial({
          color: c.color,
          roughness: c.roughness ?? 1,
          metalness: c.metalness ?? 0,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
      );
      object.add(crater);
    }

    if (spec.cracks) {
      const c = spec.cracks;
      // Each crack is a short zig-zag of thin flat segments heading outward.
      const segments: THREE.Matrix4[] = [];
      for (let i = 0; i < c.count; i++) {
        let a = (i / c.count) * Math.PI * 2 + rand() * 0.6;
        const total = c.length[0] + (c.length[1] - c.length[0]) * rand();
        let r = spec.radius * 0.8;
        while (r < total) {
          const step = Math.min(total - r, total * (0.15 + 0.2 * rand()));
          const a2 = a + (rand() - 0.5) * 0.5;
          const x1 = Math.cos(a) * r;
          const y1 = Math.sin(a) * r;
          const x2 = Math.cos(a2) * (r + step);
          const y2 = Math.sin(a2) * (r + step);
          const len = Math.hypot(x2 - x1, y2 - y1);
          const width = c.width * (1 - (r / total) * 0.7);
          segments.push(
            new THREE.Matrix4().compose(
              new THREE.Vector3((x1 + x2) / 2, (y1 + y2) / 2, 0),
              new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(y2 - y1, x2 - x1)),
              new THREE.Vector3(len, width, 1),
            ),
          );
          r += step;
          a = a2;
        }
      }
      const cracks = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color: c.color, polygonOffset: true, polygonOffsetFactor: -2 }),
        segments.length,
      );
      segments.forEach((m, i) => cracks.setMatrixAt(i, m));
      object.add(cracks);
    }

    // A soft scorch/bruise ring around the opening.
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(spec.radius * 0.9, spec.radius * (1.8 + spec.ragged), 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    halo.scale.y = stretch;
    halo.position.z = -OFFSET * 0.5;
    if (!spec.noHalo) object.add(halo);

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
    object.renderOrder = this.holes.length;
    object.traverse((o) => (o.renderOrder = this.holes.length));
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
