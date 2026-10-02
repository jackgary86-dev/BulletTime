import * as THREE from 'three';
import { acousticFabricMaps, hazardStripeTexture, labFloorMaps, paintedBlockMaps, rubberBackstopMaps } from './labTextures';

/**
 * The indoor ballistics lab around the target (#53): a sealed concrete floor,
 * painted block walls with acoustic panels, a rubber bullet trap behind the
 * grid board, and a ceiling with strip lights. Units are metres; the target
 * sits at the origin and shots travel along +x.
 */
export interface LabSet {
  group: THREE.Group;
  floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  /** Walls, ceiling and backstop: hidden for the bright high-speed backdrop. */
  room: THREE.Group;
  /** Light washing the backstop and back wall, so the room reads in the dark lab. */
  wash: THREE.SpotLight;
}

const ROOM = {
  /** Half the room's width, along the shot line. */
  halfX: 5,
  backZ: -2.6,
  frontZ: 6,
  height: 3.2,
};

/** Where the bullet trap's rubber face stands, behind the grid board. */
const BACKSTOP_Z = -0.85;
const BACKSTOP_W = 2.6;
const BACKSTOP_H = 1.6;

export function createLabSet(): LabSet {
  const group = new THREE.Group();
  group.name = 'lab-set';
  const floor = createFloor();
  group.add(floor);

  const room = new THREE.Group();
  room.name = 'lab-room';
  room.add(createWalls(), createBackstop(), createCeiling());
  group.add(room);

  // A broad, dim wash from the ceiling onto the backstop and back wall.
  const wash = new THREE.SpotLight(0xdfe6f0, 9, 9, Math.PI / 3.2, 0.9, 1.4);
  wash.position.set(0.4, ROOM.height - 0.2, 1.2);
  wash.target.position.set(0, 0.7, BACKSTOP_Z);
  room.add(wash, wash.target);

  return { group, floor, room, wash };
}

function createFloor(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> {
  const size = 16;
  const maps = labFloorMaps();
  // The texture covers 2.4 m, two slabs.
  for (const t of [maps.map, maps.roughnessMap, maps.normalMap]) t.repeat.set(size / 2.4, size / 2.4);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({
      color: 0x6a6a6a,
      map: maps.map,
      roughnessMap: maps.roughnessMap,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughness: 1,
      metalness: 0,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  // Offset so a slab joint doesn't run straight under the target.
  floor.position.set(0.5, 0, 0.35);
  floor.receiveShadow = true;
  floor.name = 'floor';
  return floor;
}

/** A wall material with the painted block maps tiled at real block size (the tile is 1.6 m by 1.6 m). */
function blockWallMaterial(widthM: number, heightM: number, tint: number): THREE.MeshStandardMaterial {
  const maps = paintedBlockMaps();
  const clone = (t: THREE.Texture) => {
    const c = t.clone();
    c.repeat.set(widthM / 1.6, heightM / 1.6);
    c.needsUpdate = true;
    return c;
  };
  return new THREE.MeshStandardMaterial({
    color: tint,
    map: clone(maps.map),
    roughnessMap: clone(maps.roughnessMap),
    normalMap: clone(maps.normalMap),
    roughness: 1,
    // Walls face inward only, so an orbiting camera outside the room sees through them.
    side: THREE.FrontSide,
  });
}

function createWalls(): THREE.Group {
  const walls = new THREE.Group();
  const width = ROOM.halfX * 2;
  const depth = ROOM.frontZ - ROOM.backZ;

  const back = new THREE.Mesh(new THREE.PlaneGeometry(width, ROOM.height), blockWallMaterial(width, ROOM.height, 0x8a9096));
  back.position.set(0, ROOM.height / 2, ROOM.backZ);
  walls.add(back);

  const front = new THREE.Mesh(new THREE.PlaneGeometry(width, ROOM.height), blockWallMaterial(width, ROOM.height, 0x8a9096));
  front.position.set(0, ROOM.height / 2, ROOM.frontZ);
  front.rotation.y = Math.PI;
  walls.add(front);

  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(depth, ROOM.height), blockWallMaterial(depth, ROOM.height, 0x8a9096));
    wall.position.set(side * ROOM.halfX, ROOM.height / 2, (ROOM.frontZ + ROOM.backZ) / 2);
    wall.rotation.y = -side * (Math.PI / 2);
    walls.add(wall);
  }

  // Dark rubber skirting along the base of every wall.
  const skirtMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.8 });
  const skirt = (length: number, x: number, z: number, rotY: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, 0.12, 0.02), skirtMaterial);
    mesh.position.set(x, 0.06, z);
    mesh.rotation.y = rotY;
    walls.add(mesh);
  };
  skirt(width, 0, ROOM.backZ + 0.01, 0);
  skirt(width, 0, ROOM.frontZ - 0.01, 0);
  skirt(depth, -ROOM.halfX + 0.01, (ROOM.frontZ + ROOM.backZ) / 2, Math.PI / 2);
  skirt(depth, ROOM.halfX - 0.01, (ROOM.frontZ + ROOM.backZ) / 2, Math.PI / 2);

  walls.add(createAcousticPanels());
  return walls;
}

/** A row of fabric-wrapped acoustic panels on the back wall, above the bullet trap. */
function createAcousticPanels(): THREE.InstancedMesh {
  const maps = acousticFabricMaps();
  const panelW = 1.2;
  const panelH = 0.6;
  const columns = 7;
  const rows = 2;
  const geometry = new THREE.BoxGeometry(panelW - 0.04, panelH - 0.04, 0.05);
  const material = new THREE.MeshStandardMaterial({
    color: 0x7b8592,
    map: maps.map,
    normalMap: maps.normalMap,
    roughness: 1,
  });
  const panels = new THREE.InstancedMesh(geometry, material, columns * rows);
  const m = new THREE.Matrix4();
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      m.makeTranslation((c - (columns - 1) / 2) * panelW, 1.75 + r * panelH, ROOM.backZ + 0.03);
      panels.setMatrixAt(i++, m);
    }
  }
  panels.name = 'acoustic-panels';
  return panels;
}

/**
 * Rubber lamella bullet trap in a painted steel frame: the rubber face, two
 * posts, an angled deflector along the top and a striped kick plate.
 */
function createBackstop(): THREE.Group {
  const trap = new THREE.Group();
  trap.name = 'backstop';
  const maps = rubberBackstopMaps();
  // One tile covers 1.3 m by 1.6 m, so each strip is about 8 cm wide.
  for (const t of [maps.map, maps.normalMap]) t.repeat.set(2, 1);
  const rubber = new THREE.Mesh(
    new THREE.BoxGeometry(BACKSTOP_W, BACKSTOP_H, 0.3),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: maps.map,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 0.82,
    }),
  );
  rubber.position.set(0, BACKSTOP_H / 2, BACKSTOP_Z - 0.15);
  rubber.receiveShadow = true;
  trap.add(rubber);

  const frameSteel = new THREE.MeshStandardMaterial({ color: 0x2b3036, metalness: 0.6, roughness: 0.45 });
  const postH = BACKSTOP_H + 0.25;
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, postH, 0.36), frameSteel);
    post.position.set(side * (BACKSTOP_W / 2 + 0.05), postH / 2, BACKSTOP_Z - 0.15);
    post.castShadow = true;
    trap.add(post);
  }
  // Angled top deflector, sloping back toward the trap.
  const deflector = new THREE.Mesh(new THREE.BoxGeometry(BACKSTOP_W + 0.2, 0.012, 0.42), frameSteel);
  deflector.position.set(0, BACKSTOP_H + 0.12, BACKSTOP_Z - 0.05);
  deflector.rotation.x = -0.45;
  trap.add(deflector);

  const kick = new THREE.Mesh(
    new THREE.BoxGeometry(BACKSTOP_W + 0.2, 0.1, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x8a8a8a, map: hazardStripeTexture(), roughness: 0.7, metalness: 0.1 }),
  );
  const stripes = (kick.material as THREE.MeshStandardMaterial).map!;
  stripes.repeat.set(14, 1);
  kick.position.set(0, 0.05, BACKSTOP_Z + 0.01);
  trap.add(kick);
  return trap;
}

/** Dark ceiling with a few glowing strip lights running along the room. */
function createCeiling(): THREE.Group {
  const ceiling = new THREE.Group();
  const width = ROOM.halfX * 2;
  const depth = ROOM.frontZ - ROOM.backZ;
  const slab = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.95, side: THREE.FrontSide }),
  );
  slab.rotation.x = Math.PI / 2;
  slab.position.set(0, ROOM.height, (ROOM.frontZ + ROOM.backZ) / 2);
  ceiling.add(slab);

  const housing = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.5, roughness: 0.5 });
  const tube = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xf2f5ff, emissiveIntensity: 2.2 });
  for (const x of [-2.4, 0, 2.4]) {
    for (const z of [-1.4, 1.2, 3.8]) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.16), housing);
      body.position.set(x, ROOM.height - 0.025, z);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.01, 0.1), tube);
      glow.position.set(x, ROOM.height - 0.055, z);
      ceiling.add(body, glow);
    }
  }
  return ceiling;
}
