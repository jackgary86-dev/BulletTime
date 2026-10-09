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
    /** Height ÷ width of the pit, on top of the hole's own stretch (spall and scab are not round). */
    stretch?: number;
  };
  /** A soft-edged scorch or soot cloud: a noisy radial fade rather than a hard shape (a shell's blast on steel). */
  scorch?: { radius: number; color: THREE.ColorRepresentation; opacity: number };
  /** Thin cracks radiating from the hole (concrete). */
  cracks?: {
    count: number;
    length: [number, number];
    width: number;
    color: THREE.ColorRepresentation;
  };
  /** Draw only the crater and cracks, not a dark opening (a dent or a pit that did not go through). */
  noOpening?: boolean;
  /** Radial streaks on the face (lead splash). Drawn like cracks but straighter and tapering. */
  streaks?: {
    count: number;
    length: [number, number];
    width: number;
    color: THREE.ColorRepresentation;
  };
  /** A hot ring round a perforation that glows and cools over `cool` seconds (#58). */
  glow?: { radius: number; cool: number };
  /** Skip the soft dark bruise ring around the hole. */
  noHalo?: boolean;
  seed: number;
}

const OFFSET = 0.0006;

/** How far outside a face a hit may land and still count as on it (a mark right at the edge, a fragment hole on the rim). */
const FACE_SLACK = 0.02;

/**
 * A flat face that marks sit on, as it was when the shot loaded (#318): the box of the body in its layer's own frame,
 * and the four planes (in world space, normals pointing in) that bound it across and up. Marks are flat decals drawn
 * in front of the face, so without these a mark sized from a big round hangs in the air past the plate's edge.
 */
export interface MarkFace {
  /** World to the layer's frame (x through the thickness, y up, z across). */
  toLocal: THREE.Matrix4;
  /** The body's extent in that frame. */
  box: THREE.Box3;
  /** The layer's thickness axis in world space: the direction its front and back faces point along. */
  across: THREE.Vector3;
  /** The sides, in world space: up, down, left and right of the face. A fragment is kept where all four are positive. */
  planes: THREE.Plane[];
}

/**
 * The face of a layer's body: its extent in the layer's own frame, from the meshes themselves, so it is right for any
 * size of plate and any impact angle. Null if the body has no geometry.
 */
export function markFace(layer: THREE.Object3D, body: THREE.Object3D): MarkFace | null {
  layer.updateWorldMatrix(true, true);
  const toLocal = layer.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  body.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(toLocal.clone().multiply(mesh.matrixWorld)));
  });
  if (box.isEmpty()) return null;
  // Normals point into the face, so a fragment on the wrong side of any of them is clipped.
  const planes = [
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -box.min.y),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), box.max.y),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -box.min.z),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), box.max.z),
  ].map((plane) => plane.applyMatrix4(layer.matrixWorld));
  return { toLocal, box, across: new THREE.Vector3(1, 0, 0).transformDirection(layer.matrixWorld), planes };
}

export class HoleMarks {
  readonly group = new THREE.Group();
  private readonly holes: { t: number; object: THREE.Object3D; glow?: { material: THREE.MeshBasicMaterial; cool: number } }[] = [];
  /** The faces of the target now loaded, so each mark can be cut off at the edge of the one it is on (#318). */
  private faces: MarkFace[] = [];

  constructor() {
    this.group.name = 'holes';
  }

  /** The faces of the target about to be marked; call before the shot's marks are added. */
  setFaces(faces: MarkFace[]): void {
    this.faces = faces;
  }

  /**
   * The face a mark at a position, facing a direction, is on, or null when it is not on the front or back of a known one (a
   * mark on a cut edge is left alone). The nearest face wins, so a gap between plates cannot hand a mark to the wrong one.
   */
  private faceOf(pos: THREE.Vector3, normal: THREE.Vector3): MarkFace | null {
    let best: MarkFace | null = null;
    let bestOut = Infinity;
    const local = new THREE.Vector3();
    for (const face of this.faces) {
      local.copy(pos).applyMatrix4(face.toLocal);
      // Only the front and back faces: the normal must run along the thickness.
      if (Math.abs(face.across.dot(normal)) < 0.7) continue;
      // How far outside the box it is (0 when on or inside it).
      const out = Math.max(face.box.min.x - local.x, local.x - face.box.max.x, face.box.min.y - local.y, local.y - face.box.max.y, face.box.min.z - local.z, local.z - face.box.max.z, 0);
      if (out <= FACE_SLACK && out < bestOut) {
        best = face;
        bestOut = out;
      }
    }
    return best;
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
        rim.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r * stretch * (c.stretch ?? 1)));
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

    if (spec.scorch) {
      const sc = spec.scorch;
      const scorch = new THREE.Mesh(
        new THREE.PlaneGeometry(sc.radius * 2, sc.radius * 2 * stretch),
        new THREE.MeshStandardMaterial({
          color: sc.color,
          alphaMap: scorchTexture(),
          opacity: sc.opacity,
          transparent: true,
          roughness: 1,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
      );
      // A quarter turn per seed, so two scorches on one wall do not share the same blotches.
      scorch.rotation.z = rand() * Math.PI * 2;
      object.add(scorch);
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

    if (spec.streaks) {
      const c = spec.streaks;
      const streaks = new THREE.InstancedMesh(
        new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, -0.5), new THREE.Vector2(1, 0), new THREE.Vector2(0, 0.5)])),
        new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 }),
        c.count,
      );
      const m = new THREE.Matrix4();
      for (let i = 0; i < c.count; i++) {
        // A thin spike pointing outward from the impact, wide at its root.
        const a = (i / c.count) * Math.PI * 2 + (rand() - 0.5) * 0.5;
        const length = c.length[0] + (c.length[1] - c.length[0]) * rand();
        m.compose(
          new THREE.Vector3(Math.cos(a) * spec.radius * 0.5, Math.sin(a) * spec.radius * 0.5 * stretch, 0),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a),
          new THREE.Vector3(length, c.width * (0.6 + 0.8 * rand()), 1),
        );
        streaks.setMatrixAt(i, m);
      }
      object.add(streaks);
    }

    let glow: { material: THREE.MeshBasicMaterial; cool: number } | undefined;
    if (spec.glow) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xff7a1a,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(spec.radius * 0.6, spec.glow.radius, 32), material);
      ring.scale.y = stretch;
      object.add(ring);
      glow = { material, cool: spec.glow.cool };
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

    // Cut every part of the mark off at the edge of the face it is on, whatever its size.
    const face = this.faceOf(new THREE.Vector3(spec.pos.x, spec.pos.y, spec.pos.z), normal);
    if (face) {
      object.traverse((o) => {
        const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const m of Array.isArray(material) ? material : material ? [material] : []) m.clippingPlanes = face.planes;
      });
    }

    object.visible = false;
    object.renderOrder = this.holes.length;
    object.traverse((o) => (o.renderOrder = this.holes.length));
    this.group.add(object);
    this.holes.push({ t: spec.t, object, glow });
  }

  clear(): void {
    for (const { object } of this.holes) {
      // Materials hold no textures and are left to the garbage collector:
      // disposing them would make three.js recompile their shaders next shot (#135).
      object.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.group.remove(object);
    }
    this.holes.length = 0;
    this.faces = [];
  }

  update(t: number): void {
    for (const hole of this.holes) {
      hole.object.visible = t >= hole.t;
      if (hole.glow) {
        // White-hot at first, cooling through orange to nothing.
        const heat = Math.exp(-Math.max(0, t - hole.t) / hole.glow.cool);
        hole.glow.material.opacity = heat;
        hole.glow.material.color.setRGB(1, 0.35 + 0.6 * heat * heat, 0.08 + 0.7 * heat ** 4).multiplyScalar(1 + 2 * heat);
      }
    }
  }
}

let scorchMap: THREE.CanvasTexture | null = null;

/** White at the centre fading to nothing at the edge, broken up with noise so it reads as soot, not a gradient. */
function scorchTexture(): THREE.CanvasTexture {
  if (scorchMap) return scorchMap;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const fade = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  fade.addColorStop(0, 'rgba(255,255,255,1)');
  fade.addColorStop(0.45, 'rgba(255,255,255,0.8)');
  fade.addColorStop(0.75, 'rgba(255,255,255,0.35)');
  fade.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);
  // Soot is patchy: lots of small bites out of the cloud, a few bright flecks in it.
  const rand = seededRandom(7);
  for (let i = 0; i < 900; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 1 + rand() * 9;
    ctx.fillStyle = rand() < 0.8 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  scorchMap = new THREE.CanvasTexture(canvas);
  return scorchMap;
}
