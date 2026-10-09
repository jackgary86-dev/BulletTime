import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HoleMarks, markFace, type HoleSpec, type MarkFace } from './holes';

/** A target like the real one: a group turned by the impact angle, holding plate layers one behind another along x. */
function stack(plates: { x: number; t: number; h: number; w: number }[], angle = 0.5) {
  const target = new THREE.Group();
  target.position.set(2, 1, 0.3);
  target.rotation.y = angle;
  const layers = plates.map((p, i) => {
    const layer = new THREE.Group();
    layer.name = `layer-${i}`;
    layer.position.x = p.x;
    const body = new THREE.Mesh(new THREE.BoxGeometry(p.t, p.h, p.w));
    body.position.x = p.t / 2;
    layer.add(body);
    // A stand rides in the layer too; it must not widen the face.
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2, 2));
    stand.position.set(p.t / 2, -1.5, 0);
    layer.add(stand);
    target.add(layer);
    return { layer, body };
  });
  target.updateMatrixWorld(true);
  return { target, layers };
}

const faceOf = ({ layer, body }: { layer: THREE.Object3D; body: THREE.Object3D }) => markFace(layer, body)!;

/** A world point and outward normal on a layer's front face, from a position in the layer's own frame. */
function onFront(layer: THREE.Object3D, local: [number, number, number]) {
  const pos = layer.localToWorld(new THREE.Vector3(...local));
  const normal = new THREE.Vector3(-1, 0, 0).transformDirection(layer.matrixWorld);
  return { pos: { x: pos.x, y: pos.y, z: pos.z }, normal: { x: normal.x, y: normal.y, z: normal.z } };
}

/** Whether the planes keep a world point (every one of them reads it as on the inside). */
const keeps = (face: MarkFace, point: THREE.Vector3) => face.planes.every((plane) => plane.distanceToPoint(point) >= -1e-9);

const mark = (over: Partial<HoleSpec> & Pick<HoleSpec, 'pos' | 'normal'>): HoleSpec => ({
  t: 0,
  radius: 0.2,
  ragged: 0.5,
  color: 0x222222,
  seed: 1,
  ...over,
});

const bigMark = {
  crater: { radius: 0.6, color: 0x888888, irregularity: 0.7 },
  streaks: { count: 12, length: [0.3, 1.2] as [number, number], width: 0.05, color: 0x777777 },
  cracks: { count: 6, length: [0.2, 0.9] as [number, number], width: 0.01, color: 0x111111 },
  glow: { radius: 0.4, cool: 0.01 },
};

/** Every material in a mark: its meshes' own and its instanced parts'. */
function materialsOf(holes: HoleMarks): THREE.Material[] {
  const out: THREE.Material[] = [];
  holes.group.traverse((o) => {
    const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) out.push(m);
  });
  return out;
}

describe('the face a mark sits on', () => {
  it('is the body in its layer\'s own frame, however the stack is turned, and leaves the stand out', () => {
    const { layers } = stack([{ x: 0, t: 0.01, h: 0.3, w: 0.4 }], 0.9);
    const face = faceOf(layers[0]);
    expect(face.box.min.y).toBeCloseTo(-0.15);
    expect(face.box.max.y).toBeCloseTo(0.15);
    expect(face.box.min.z).toBeCloseTo(-0.2);
    expect(face.box.max.z).toBeCloseTo(0.2);
  });

  it('keeps points on the plate and drops points past each edge, in world space', () => {
    const { layers } = stack([{ x: 0, t: 0.01, h: 0.3, w: 0.4 }], 0.9);
    const { layer } = layers[0];
    const face = faceOf(layers[0]);
    const at = (y: number, z: number) => layer.localToWorld(new THREE.Vector3(0, y, z));
    expect(keeps(face, at(0, 0))).toBe(true);
    expect(keeps(face, at(0.14, 0.19))).toBe(true);
    for (const [y, z] of [[0.16, 0], [-0.16, 0], [0, 0.21], [0, -0.21]]) expect(keeps(face, at(y, z))).toBe(false);
  });
});

describe('marks cut off at the edge of their plate', () => {
  it('puts the plate\'s four planes on every part of a big mark, instanced streaks and cracks included', () => {
    const { layers } = stack([{ x: 0, t: 0.01, h: 0.3, w: 0.4 }]);
    const face = faceOf(layers[0]);
    const holes = new HoleMarks();
    holes.setFaces([face]);
    holes.add(mark({ ...onFront(layers[0].layer, [0, 0.02, 0.01]), ...bigMark }));
    const materials = materialsOf(holes);
    // Opening, crater, streaks, cracks, glow ring and halo.
    expect(materials.length).toBeGreaterThanOrEqual(6);
    for (const m of materials) expect(m.clippingPlanes).toBe(face.planes);
  });

  it('gives each layer of a stack its own planes, so a back plate\'s marks never show on the front one', () => {
    const { layers } = stack([
      { x: 0, t: 0.01, h: 0.3, w: 0.4 },
      { x: 0.1, t: 0.025, h: 0.6, w: 0.8 },
    ]);
    const front = faceOf(layers[0]);
    const back = faceOf(layers[1]);
    const holes = new HoleMarks();
    holes.setFaces([front, back]);
    holes.add(mark({ ...onFront(layers[0].layer, [0, 0, 0]), ...bigMark }));
    holes.add(mark({ ...onFront(layers[1].layer, [0, 0, 0]), ...bigMark, seed: 2 }));
    const objects = holes.group.children;
    const planesOf = (object: THREE.Object3D) => ((object.children[0] as THREE.Mesh).material as THREE.Material).clippingPlanes;
    expect(planesOf(objects[0])).toBe(front.planes);
    expect(planesOf(objects[1])).toBe(back.planes);
  });

  it('assigns a mark on the very edge to its plate, and ignores one well off every plate', () => {
    const { layers } = stack([{ x: 0, t: 0.01, h: 0.3, w: 0.4 }]);
    const face = faceOf(layers[0]);
    const holes = new HoleMarks();
    holes.setFaces([face]);
    holes.add(mark({ ...onFront(layers[0].layer, [0, 0.15, 0.2]), ...bigMark }));
    holes.add(mark({ ...onFront(layers[0].layer, [0, 0.5, 0]), ...bigMark, seed: 2 }));
    const [edge, away] = holes.group.children;
    expect(((edge.children[0] as THREE.Mesh).material as THREE.Material).clippingPlanes).toBe(face.planes);
    expect(((away.children[0] as THREE.Mesh).material as THREE.Material).clippingPlanes).toBeNull();
  });

  it('leaves marks on a cut edge alone (they sit on the boundary the planes would clip away)', () => {
    const { layers } = stack([{ x: 0, t: 0.01, h: 0.3, w: 0.4 }]);
    const holes = new HoleMarks();
    holes.setFaces([faceOf(layers[0])]);
    // On the top edge: the normal points up, across the thickness axis.
    const pos = layers[0].layer.localToWorld(new THREE.Vector3(0.005, 0.15, 0));
    const up = new THREE.Vector3(0, 1, 0);
    holes.add(mark({ pos: { x: pos.x, y: pos.y, z: pos.z }, normal: { x: up.x, y: up.y, z: up.z }, ...bigMark }));
    for (const m of materialsOf(holes)) expect(m.clippingPlanes).toBeNull();
  });

  it('forgets the faces on clear, so marks added without a new target are not clipped to the old one', () => {
    const { layers } = stack([{ x: 0, t: 0.01, h: 0.3, w: 0.4 }]);
    const holes = new HoleMarks();
    holes.setFaces([faceOf(layers[0])]);
    holes.clear();
    holes.add(mark({ ...onFront(layers[0].layer, [0, 0, 0]), ...bigMark }));
    for (const m of materialsOf(holes)) expect(m.clippingPlanes).toBeNull();
  });
});
