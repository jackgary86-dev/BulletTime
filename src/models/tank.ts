import * as THREE from 'three';
import type { MediumSpec } from '../data/media';
import { steelPlateMaps } from './textures';

/**
 * A procedural main battle tank (#231), parked broadside on the proving
 * ground. The shot strikes its near hull side, which is the target layer
 * itself (the plate body, so it dishes and holes like any plate); this builds
 * the rest of the vehicle round it: the hull (hollow, so what gets through
 * shows inside), tracks, road wheels, sprocket and idler, and a turret
 * traversed away from the shooter with its gun over the far side.
 *
 * Built in the layer's frame, like the other supports: the struck plate is
 * centred at x = t / 2, y = 0 is the shot line, the floor is at y = -shotY
 * and z runs along the vehicle's length. A shape for a target only: no
 * internals beyond plain panels.
 */

/** Across the hull, outside to outside, m. */
const HULL_WIDTH_M = 3.4;
/** Track width, m. */
const TRACK_WIDTH_M = 0.62;
const WHEEL_R = 0.33;
const ROAD_WHEELS = 7;

/** Olive drab paint over the painted plate maps (which are cream, so the tint carries). */
const OLIVE = 0x6b7340;

export function hullPaint(): THREE.MeshStandardMaterial {
  const paint = steelPlateMaps('painted');
  return new THREE.MeshStandardMaterial({
    color: OLIVE,
    map: paint.map,
    roughnessMap: paint.roughnessMap,
    normalMap: paint.normalMap,
    normalScale: new THREE.Vector2(0.4, 0.4),
    metalness: 0.1,
    roughness: 1,
  });
}

export function createTank(spec: MediumSpec, t: number, shotY: number): THREE.Group {
  const tank = new THREE.Group();
  tank.name = 'stand-tank';
  const paint = hullPaint();
  const trackMetal = new THREE.MeshStandardMaterial({ color: 0x2b2a27, roughness: 0.75, metalness: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1f1a, roughness: 0.9 });

  const floor = -shotY;
  const halfLen = spec.widthM / 2;
  const plateTop = spec.heightM / 2;
  const plateBottom = -spec.heightM / 2;
  const add = (mesh: THREE.Mesh) => {
    tank.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m));
    mesh.position.set(x, y, z);
    return mesh;
  };

  // Upper hull: roof, far side, front and rear plates round the struck near side. Hollow inside.
  const wall = Math.max(0.04, t);
  box(HULL_WIDTH_M, 0.05, spec.widthM, paint, HULL_WIDTH_M / 2, plateTop - 0.025, 0);
  box(wall, spec.heightM, spec.widthM, paint, HULL_WIDTH_M - wall / 2, 0, 0);
  box(HULL_WIDTH_M, spec.heightM, 0.06, paint, HULL_WIDTH_M / 2, 0, -halfLen + 0.03);
  // Sloped glacis at the front, from the roof edge down and forward to the nose.
  const noseDz = 0.9;
  const noseDy = spec.heightM + 0.1;
  const glacis = box(HULL_WIDTH_M, 0.06, Math.hypot(noseDz, noseDy), paint, HULL_WIDTH_M / 2, plateTop - noseDy / 2, halfLen + noseDz / 2);
  glacis.rotation.x = Math.atan2(noseDy, noseDz);
  box(HULL_WIDTH_M, spec.heightM, 0.06, paint, HULL_WIDTH_M / 2, 0, halfLen - 0.03);

  // Lower hull between the tracks, and the belly.
  const bellyY = floor + 0.45;
  const innerW = HULL_WIDTH_M - 2 * TRACK_WIDTH_M;
  box(innerW, plateBottom - bellyY, spec.widthM - 0.4, dark, HULL_WIDTH_M / 2, (plateBottom + bellyY) / 2, 0);

  // Tracks: a stadium-shaped loop of track under each side, with road wheels, sprocket and idler.
  const trackTop = plateBottom - 0.02;
  const trackH = trackTop - floor;
  for (const x0 of [0, HULL_WIDTH_M - TRACK_WIDTH_M]) {
    const loop = new THREE.Shape();
    const r = trackH / 2;
    const zA = -halfLen + r;
    const zB = halfLen + 0.15 - r;
    loop.moveTo(zA, floor);
    loop.lineTo(zB, floor);
    loop.absarc(zB, floor + r, r, -Math.PI / 2, Math.PI / 2, false);
    loop.lineTo(zA, trackTop);
    loop.absarc(zA, floor + r, r, Math.PI / 2, (3 * Math.PI) / 2, false);
    const geometry = new THREE.ExtrudeGeometry(loop, { depth: TRACK_WIDTH_M, bevelEnabled: false, curveSegments: 16 });
    // Shape lies in its own x-y (z along the vehicle, y up); extrude along +x across the hull.
    geometry.rotateY(-Math.PI / 2);
    geometry.translate(x0 + TRACK_WIDTH_M, 0, 0);
    add(new THREE.Mesh(geometry, trackMetal));

    // Wheels stand just proud of the track's outer face, so they read from the side.
    const face = x0 === 0 ? -0.02 : HULL_WIDTH_M + 0.02;
    const span = zB - zA;
    for (let i = 0; i < ROAD_WHEELS; i++) {
      const z = zA + 0.2 + (i / (ROAD_WHEELS - 1)) * (span - 0.4);
      wheel(tank, face, floor + WHEEL_R + 0.04, z, WHEEL_R, paint, rubber);
    }
    wheel(tank, face, floor + r, zB, r * 0.75, trackMetal, trackMetal);
    wheel(tank, face, floor + r, zA, r * 0.7, paint, rubber);
  }

  // Turret: a low faceted casting on the roof, traversed to point its gun away from the shooter.
  const plan = new THREE.Shape();
  const tw = 2.6;
  const tl = 2.4;
  plan.moveTo(-tw / 2, -tl / 2);
  plan.lineTo(tw / 2 - 0.5, -tl / 2);
  plan.lineTo(tw / 2, -tl / 4);
  plan.lineTo(tw / 2, tl / 4);
  plan.lineTo(tw / 2 - 0.5, tl / 2);
  plan.lineTo(-tw / 2, tl / 2);
  const turretH = 0.7;
  const turretGeometry = new THREE.ExtrudeGeometry(plan, { depth: turretH, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 1 });
  // Plan in x-z, height up y.
  turretGeometry.rotateX(-Math.PI / 2);
  const turret = add(new THREE.Mesh(turretGeometry, paint));
  const turretX = HULL_WIDTH_M / 2;
  const turretZ = -0.3;
  turret.position.set(turretX, plateTop, turretZ);
  // Commander's cupola.
  const cupola = add(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.25, 16), paint));
  cupola.position.set(turretX - 0.3, plateTop + turretH + 0.2, turretZ - 0.5);
  // Mantlet and gun, along +x over the far side.
  box(0.35, 0.45, 0.8, paint, turretX + tw / 2 + 0.12, plateTop + turretH / 2 + 0.05, turretZ);
  const gunLength = 5.2;
  const gun = add(new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.085, gunLength, 14), paint));
  gun.rotation.z = -Math.PI / 2 + 0.03;
  gun.position.set(turretX + tw / 2 + 0.25 + gunLength / 2, plateTop + turretH / 2 + 0.1, turretZ);
  const evacuator = add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.6, 14), paint));
  evacuator.rotation.z = -Math.PI / 2;
  evacuator.position.set(turretX + tw / 2 + 2.2, plateTop + turretH / 2 + 0.17, turretZ);

  return tank;
}

/** A wheel facing out across the hull: tyre, disc and hub. */
function wheel(group: THREE.Group, x: number, y: number, z: number, r: number, disc: THREE.Material, tyre: THREE.Material): void {
  const w = 0.16;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 20), tyre);
  rim.rotation.z = Math.PI / 2;
  rim.position.set(x, y, z);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r * 0.82, w + 0.02, 20), disc);
  face.rotation.z = Math.PI / 2;
  face.position.set(x, y, z);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.25, r * 0.25, w + 0.06, 10), disc);
  hub.rotation.z = Math.PI / 2;
  hub.position.set(x, y, z);
  group.add(rim, face, hub);
}
