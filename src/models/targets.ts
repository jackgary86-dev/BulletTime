import * as THREE from 'three';
import type { MediumSpec } from '../data/media';
import { burlapTexture, concreteTexture, steelTexture, woodTexture } from './textures';

/** Height of the shot line above the floor, in metres. Every target is centred on it. */
export const SHOT_Y = 0.16;
/** World x of every target's front face; the lab grid's zero mark sits here. */
export const TARGET_FRONT_X = -0.2;

/** Name of the gel block mesh, so effects can find and deform it. */
export const GEL_BODY_NAME = 'gel-body';

const standSteel = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.35, metalness: 0.9 });

/**
 * A target ready to place in the scene: its front face is at the group origin,
 * it extends along +x by `thickness`, and it is rotated about the vertical axis
 * through the impact point by the impact angle.
 */
export function createTarget(spec: MediumSpec, thickness: number, angleDeg: number): THREE.Group {
  const group = new THREE.Group();
  group.name = `target:${spec.id}`;
  group.position.set(TARGET_FRONT_X, SHOT_Y, 0);
  group.rotation.y = THREE.MathUtils.degToRad(angleDeg);

  const body = buildBody(spec, thickness);
  body.position.x = thickness / 2;
  group.add(body);

  const bottom = SHOT_Y - spec.heightM / 2;
  if (bottom > 0.03) group.add(createStand(spec, thickness, bottom));
  else group.add(createFeet(spec, thickness));

  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return group;
}

/** Frees geometry and per-target materials. Shared textures are kept. */
export function disposeTarget(group: THREE.Group): void {
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry.dispose();
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of materials) if (m !== standSteel) m.dispose();
  });
}

/** The target body, centred on its own origin, thickness along x. */
function buildBody(spec: MediumSpec, t: number): THREE.Object3D {
  const h = spec.heightM;
  const w = spec.widthM;

  switch (spec.look) {
    case 'gel': {
      // Finely subdivided so the gel effect can bulge the block and pull out the exit cone.
      const gel = new THREE.Mesh(
        new THREE.BoxGeometry(t, h, w, Math.ceil(t / 0.005), 24, 24),
        new THREE.MeshPhysicalMaterial({
          color: 0xfff3dc,
          roughness: 0.08,
          transmission: 0.96,
          thickness: w,
          ior: 1.35,
          attenuationColor: new THREE.Color(0xf3c98a),
          attenuationDistance: 1.2,
          specularIntensity: 0.8,
          clearcoat: 0.4,
          clearcoatRoughness: 0.1,
        }),
      );
      gel.name = GEL_BODY_NAME;
      return gel;
    }

    case 'waterTank': {
      const tank = new THREE.Group();
      const wall = 0.005;
      // Thin walls use plain alpha blending rather than transmission: three.js transmissive
      // surfaces can't see other transmissive surfaces, so the water would vanish behind them.
      const glass = new THREE.MeshPhysicalMaterial({
        color: 0xe6f6ff,
        roughness: 0.02,
        transparent: true,
        opacity: 0.12,
        specularIntensity: 1,
        clearcoat: 1,
        depthWrite: false,
      });
      const water = new THREE.Mesh(
        new THREE.BoxGeometry(t - wall * 2, h * 0.88 - wall, w - wall * 2),
        new THREE.MeshPhysicalMaterial({
          color: 0xcfeaff,
          roughness: 0.03,
          transmission: 0.97,
          thickness: w,
          ior: 1.33,
          attenuationColor: new THREE.Color(0x3f9fd0),
          attenuationDistance: 0.3,
          specularIntensity: 1,
        }),
      );
      water.position.y = -h * 0.06;
      // Five-sided open-top tank.
      const panels: [number, number, number, number, number, number][] = [
        [wall, h, w, -t / 2 + wall / 2, 0, 0],
        [wall, h, w, t / 2 - wall / 2, 0, 0],
        [t, h, wall, 0, 0, -w / 2 + wall / 2],
        [t, h, wall, 0, 0, w / 2 - wall / 2],
        [t, wall, w, 0, -h / 2 + wall / 2, 0],
      ];
      for (const [sx, sy, sz, px, py, pz] of panels) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), glass);
        panel.position.set(px, py, pz);
        tank.add(panel);
      }
      tank.add(water);
      return tank;
    }

    case 'pine':
    case 'oak': {
      const map = woodTexture(spec.look);
      return new THREE.Mesh(
        new THREE.BoxGeometry(t, h, w),
        new THREE.MeshStandardMaterial({ map, roughness: spec.look === 'oak' ? 0.6 : 0.72 }),
      );
    }

    case 'drywall': {
      // Paper faces front and back, exposed gypsum on the cut edges.
      const paper = new THREE.MeshStandardMaterial({ color: 0xece8de, roughness: 0.9 });
      const backPaper = new THREE.MeshStandardMaterial({ color: 0xa79f8c, roughness: 0.95 });
      const gypsum = new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 1 });
      // BoxGeometry material order: +x, -x, +y, -y, +z, -z.
      return new THREE.Mesh(new THREE.BoxGeometry(t, h, w), [backPaper, paper, gypsum, gypsum, gypsum, gypsum]);
    }

    case 'concrete': {
      const map = concreteTexture();
      return new THREE.Mesh(
        new THREE.BoxGeometry(t, h, w),
        new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: 2, roughness: 0.95 }),
      );
    }

    case 'cinderBlock': {
      // Front and back shells joined by top and bottom webs; the core is open toward the camera.
      const map = concreteTexture();
      const material = new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: 3, roughness: 1, color: 0xb4b0a8 });
      const shell = Math.min(spec.shellM ?? 0.032, t / 3);
      const web = 0.035;
      const block = new THREE.Group();
      const parts: [number, number, number, number, number][] = [
        [shell, h, w, -t / 2 + shell / 2, 0],
        [shell, h, w, t / 2 - shell / 2, 0],
        [t - shell * 2, web, w, 0, h / 2 - web / 2],
        [t - shell * 2, web, w, 0, -h / 2 + web / 2],
      ];
      for (const [sx, sy, sz, px, py] of parts) {
        const part = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
        part.position.set(px, py, 0);
        block.add(part);
      }
      return block;
    }

    case 'mildSteel':
    case 'ar500': {
      const painted = spec.look === 'ar500';
      const map = steelTexture(painted ? 'painted' : 'mill');
      return new THREE.Mesh(
        new THREE.BoxGeometry(t, h, w),
        new THREE.MeshStandardMaterial({
          map,
          metalness: painted ? 0.15 : 0.7,
          roughness: painted ? 0.7 : 0.38,
          // The studio is dark, so lift bare steel's reflections enough to read as metal.
          envMapIntensity: painted ? 1 : 3,
        }),
      );
    }

    case 'sandbag':
      return createSandbag(t, h, w);

    case 'glass':
      return new THREE.Mesh(
        new THREE.BoxGeometry(t, h, w),
        new THREE.MeshPhysicalMaterial({
          color: 0xe8fff6,
          roughness: 0.01,
          transmission: 1,
          thickness: t,
          ior: 1.52,
          attenuationColor: new THREE.Color(0x9fe0c4), // float glass green edge tint
          attenuationDistance: 0.08,
          specularIntensity: 1,
        }),
      );

    case 'ice':
      return new THREE.Mesh(
        new THREE.BoxGeometry(t, h, w, 1, 1, 1),
        new THREE.MeshPhysicalMaterial({
          color: 0xf2fbff,
          roughness: 0.12,
          transmission: 0.95,
          thickness: w,
          ior: 1.31,
          attenuationColor: new THREE.Color(0xbfe4f5),
          attenuationDistance: 0.6,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
        }),
      );
  }
}

/** A pillow-shaped burlap bag: a subdivided box pinched toward its seams. */
function createSandbag(t: number, h: number, w: number): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(t, h, w, 24, 10, 28);
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const nx = (v.x / t) * 2;
    const ny = (v.y / h) * 2;
    const nz = (v.z / w) * 2;
    // Flatten toward the edges so the bag bulges in the middle like a filled pillow.
    v.y *= (1 - 0.45 * nx ** 4) * (1 - 0.35 * nz ** 6);
    v.x *= 1 - 0.12 * ny ** 2;
    v.z *= 1 - 0.08 * ny ** 2;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  const map = burlapTexture();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: 1.5, roughness: 1 }));
}

/** A lab bench stand: tray under the target and four legs to the floor. */
function createStand(spec: MediumSpec, t: number, bottom: number): THREE.Group {
  const stand = new THREE.Group();
  const trayLength = Math.max(t + 0.02, 0.12);
  const trayWidth = spec.widthM + 0.02;
  const tray = new THREE.Mesh(new THREE.BoxGeometry(trayLength, 0.006, trayWidth), standSteel);
  tray.position.set(t / 2, -spec.heightM / 2 - 0.003, 0);
  stand.add(tray);

  const legHeight = bottom - 0.006;
  const legGeometry = new THREE.CylinderGeometry(0.008, 0.008, legHeight, 16);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeometry, standSteel);
      leg.position.set(t / 2 + sx * (trayLength / 2 - 0.02), -SHOT_Y + legHeight / 2, sz * (trayWidth / 2 - 0.02));
      stand.add(leg);
    }
  }
  return stand;
}

/** Floor clamps that hold a tall panel upright. */
function createFeet(spec: MediumSpec, t: number): THREE.Group {
  const feet = new THREE.Group();
  const footLength = 0.16;
  for (const sz of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(footLength, 0.012, 0.03), standSteel);
    foot.position.set(t / 2, -SHOT_Y + 0.006, sz * (spec.widthM / 2 - 0.03));
    const clamp = new THREE.Mesh(new THREE.BoxGeometry(t + 0.016, 0.04, 0.03), standSteel);
    clamp.position.set(t / 2, -SHOT_Y + 0.012 + 0.02, sz * (spec.widthM / 2 - 0.03));
    feet.add(foot, clamp);
  }
  return feet;
}
