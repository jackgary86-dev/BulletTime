import * as THREE from 'three';
import { FRAME_COLUMN_M, FRAME_SLAB_M, FRAME_STOREY_M, type BuildingSpec } from '../data/buildings';
import { BRICK_TILE_M, brickMaps, canvas, concreteMaps, normalMapFromHeight, toTexture } from './textures';

/**
 * Mock test buildings on the proving ground (#246), drawn round their struck
 * wall like the tank round its hull side. Built in the struck layer's frame:
 * the wall is centred at x = t / 2, y = 0 is the shot line, the floor is at
 * y = -shotY, the building runs back along +x to its far wall (a layer of its
 * own) and across in z. Walls the shot can reach are layers; everything here
 * is the rest of the structure, hollow inside so a breach shows the room.
 */

export function createBuilding(b: BuildingSpec, shotY: number): THREE.Group {
  const group = new THREE.Group();
  group.name = `stand-building:${b.id}`;
  const floor = -shotY;
  if (b.id === 'block-house') blockHouse(group, b, floor);
  else if (b.id === 'steel-shed') steelShed(group, b, floor);
  else concreteFrame(group, b, floor, b.id === 'frame-column');
  return group;
}

/** Cast concrete, tiled by world size. */
export function concreteMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ ...concreteMaps('cast'), roughness: 1 });
}

export function brickMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ ...brickMaps(), roughness: 1 });
}

/** A box spanning [x0, x1] x [y0, y1] x [z0, z1], with its texture tiled at `tileM`. */
function slab(group: THREE.Group, material: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tileM = 0.5): THREE.Mesh {
  const geometry = worldUvs(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), tileM);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

/** Box UVs in metres over `tileM`, so a long wall repeats its texture instead of stretching it. */
function worldUvs(geometry: THREE.BoxGeometry, tileM: number): THREE.BoxGeometry {
  const pos = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const [a, c] = nx > 0.5 ? [pos.getZ(i), pos.getY(i)] : ny > 0.5 ? [pos.getX(i), pos.getZ(i)] : [pos.getX(i), pos.getY(i)];
    uv.setXY(i, a / tileM, c / tileM);
  }
  uv.needsUpdate = true;
  return geometry;
}

/** Four 300 mm walls round a room, a slab roof and a door in the side wall facing the camera. */
function blockHouse(group: THREE.Group, b: BuildingSpec, floor: number): void {
  const concrete = concreteMaterial();
  const wall = b.front.thicknessM;
  const halfW = b.widthM / 2;
  const top = floor + b.heightM;
  // Side walls between the front and back walls (those two are layers).
  slab(group, concrete, 0, b.depthM, floor, top, -halfW, -halfW + wall);
  // The near side wall has a door: two piers and a lintel.
  const door = { from: b.depthM * 0.55, to: b.depthM * 0.55 + 0.9, height: 2.1 };
  slab(group, concrete, 0, door.from, floor, top, halfW - wall, halfW);
  slab(group, concrete, door.to, b.depthM, floor, top, halfW - wall, halfW);
  slab(group, concrete, door.from, door.to, floor + door.height, top, halfW - wall, halfW);
  // Roof slab with a small overhang, and a floor slab inside.
  slab(group, concrete, -0.1, b.depthM + 0.1, top, top + 0.25, -halfW - 0.1, halfW + 0.1);
  slab(group, concrete, wall, b.depthM - wall, floor, floor + 0.05, -halfW + wall, halfW - wall);
}

/**
 * Two storeys of columns and slabs with brick infill. The struck layer is a
 * ground-floor panel between two columns, or a column itself; the far
 * ground-floor panel is a layer too. Every other panel and column is drawn
 * here; the ends stay open so the frame reads.
 */
function concreteFrame(group: THREE.Group, b: BuildingSpec, floor: number, columnStruck: boolean): void {
  const concrete = concreteMaterial();
  const brick = brickMaterial();
  const halfW = b.widthM / 2;
  const c = FRAME_COLUMN_M;
  const storey = FRAME_STOREY_M;
  const infill = b.back.thicknessM;
  // Column lines across the face: a panel struck between the inner pair, or a column struck at the centre.
  const columnsZ = columnStruck ? [-halfW + c / 2, 0, halfW - c / 2] : [-halfW + c / 2, -(1.8 + c / 2), 1.8 + c / 2, halfW - c / 2];
  const lines = [0, b.depthM / 2, b.depthM];
  for (const [li, lx] of lines.entries()) {
    const x0 = li === 0 ? 0 : li === lines.length - 1 ? b.depthM - c : lx - c / 2;
    for (const z of columnsZ) {
      const onShotLine = columnStruck && z === 0;
      // No interior column on the shot line: the shot crosses the room clear to the far column.
      if (onShotLine && li === 1) continue;
      // The struck column's and the far column's ground storeys are layers.
      slab(group, concrete, x0, x0 + c, onShotLine ? floor + storey - FRAME_SLAB_M : floor, floor + 2 * storey, z - c / 2, z + c / 2);
    }
  }
  // First-floor and roof slabs, with a parapet upstand on the roof.
  for (const level of [1, 2]) {
    const y = floor + level * storey;
    slab(group, concrete, -0.15, b.depthM + 0.15, y - FRAME_SLAB_M, y, -halfW - 0.15, halfW + 0.15);
  }
  const roof = floor + 2 * storey;
  slab(group, concrete, -0.15, 0.05, roof, roof + 0.6, -halfW - 0.15, halfW + 0.15);

  // Infill between the columns on the front and back faces, both storeys, except the layers.
  const bays: [number, number][] = [];
  for (let i = 0; i < columnsZ.length - 1; i++) bays.push([columnsZ[i] + c / 2, columnsZ[i + 1] - c / 2]);
  const panelH = storey - FRAME_SLAB_M;
  for (const face of ['front', 'back'] as const) {
    const x0 = face === 'front' ? 0 : b.depthM - infill;
    for (const [z0, z1] of bays) {
      for (const level of [0, 1]) {
        const y0 = floor + level * storey;
        // The ground-floor panels on the shot line, front and back, are layers.
        if (level === 0 && z0 < 0 && z1 > 0) continue;
        slab(group, brick, x0, x0 + infill, y0, y0 + panelH, z0, z1, BRICK_TILE_M);
        // Upper-floor panels have a window, drawn as dark glass on the outside face.
        if (level === 1 && z1 - z0 > 2) {
          const glass = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(1.6, (z1 - z0) * 0.5), 1.1), new THREE.MeshStandardMaterial({ color: 0x1b2228, roughness: 0.3, metalness: 0.4 }));
          glass.rotation.y = face === 'front' ? -Math.PI / 2 : Math.PI / 2;
          glass.position.set(face === 'front' ? x0 - 0.003 : x0 + infill + 0.003, y0 + panelH * 0.55, (z0 + z1) / 2);
          group.add(glass);
        }
      }
    }
  }
}

/** Corrugated galvanised sheet: soft vertical ribs as a normal map, with a little weathering. */
function corrugatedMaterial(): THREE.MeshStandardMaterial {
  const [colour, cctx] = canvas(64, 64);
  const [height, hctx] = canvas(64, 64);
  for (let x = 0; x < 64; x++) {
    const v = 0.5 + 0.5 * Math.cos((x / 64) * Math.PI * 2 * 4);
    const g = Math.round(150 + v * 40);
    cctx.fillStyle = `rgb(${g - 6}, ${g}, ${g - 2})`;
    cctx.fillRect(x, 0, 1, 64);
    const h = Math.round(v * 255);
    hctx.fillStyle = `rgb(${h}, ${h}, ${h})`;
    hctx.fillRect(x, 0, 1, 64);
  }
  const map = toTexture(colour);
  const normalMap = toTexture(normalMapFromHeight(height, 3), false);
  return new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.55, metalness: 0.7 });
}

export function shedSheetMaterial(): THREE.MeshStandardMaterial {
  return corrugatedMaterial();
}

/** A light steel portal frame clad in corrugated sheet, with a gable roof whose ridge runs across the face. */
function steelShed(group: THREE.Group, b: BuildingSpec, floor: number): void {
  const sheet = corrugatedMaterial();
  const steel = new THREE.MeshStandardMaterial({ color: 0x5d6670, roughness: 0.5, metalness: 0.8 });
  const halfW = b.widthM / 2;
  const eaves = floor + 3;
  const ridge = floor + b.heightM;
  // Posts round the walls, inside the cladding.
  for (let z = -halfW + 0.1; z <= halfW - 0.1 + 1e-6; z += (b.widthM - 0.2) / 4) {
    for (const x of [0.08, b.depthM - 0.08]) slab(group, steel, x - 0.06, x + 0.06, floor, eaves, z - 0.06, z + 0.06, 1);
  }
  // Gable end walls (z = ±halfW): sheet in the outline of the wall and gable.
  const gable = new THREE.Shape();
  gable.moveTo(0, 0);
  gable.lineTo(b.depthM, 0);
  gable.lineTo(b.depthM, eaves - floor);
  gable.lineTo(b.depthM / 2, ridge - floor);
  gable.lineTo(0, eaves - floor);
  gable.lineTo(0, 0);
  for (const side of [-1, 1]) {
    const geometry = new THREE.ExtrudeGeometry(gable, { depth: 0.01, bevelEnabled: false });
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 0.4, uv.getY(i) / 0.4);
    const end = new THREE.Mesh(geometry, sheet);
    end.position.set(0, floor, side * halfW - (side > 0 ? 0.01 : 0));
    end.castShadow = end.receiveShadow = true;
    group.add(end);
  }
  // Roof: two sloping sheets from the eaves over the front and back walls up to the ridge, on rafters.
  const run = b.depthM / 2 + 0.2;
  const rise = ridge - eaves;
  const length = Math.hypot(run, rise);
  const pitch = Math.atan2(rise, run);
  for (const side of [-1, 1]) {
    const geometry = new THREE.BoxGeometry(length, 0.01, b.widthM + 0.3);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (length / 0.4), uv.getY(i) * ((b.widthM + 0.3) / 0.4));
    const roof = new THREE.Mesh(geometry, sheet);
    roof.rotation.z = side < 0 ? pitch : -pitch;
    roof.position.set(b.depthM / 2 + (side * run) / 2, (eaves + ridge) / 2, 0);
    roof.castShadow = roof.receiveShadow = true;
    group.add(roof);
  }
  // Ridge and eaves beams.
  slab(group, steel, b.depthM / 2 - 0.07, b.depthM / 2 + 0.07, ridge - 0.18, ridge - 0.04, -halfW, halfW, 1);
  for (const x of [0.08, b.depthM - 0.08]) slab(group, steel, x - 0.07, x + 0.07, eaves - 0.15, eaves, -halfW, halfW, 1);
}
