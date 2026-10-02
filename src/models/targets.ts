import * as THREE from 'three';
import type { MediumLook, MediumSpec } from '../data/media';
import { ORGANIC_LAYOUTS } from '../data/organic';
import { stackOffsets, type StackLayer } from '../data/stacks';
import { createSupport, SHARED_STAND_MATERIALS } from './stands';
import { concreteMaps, drywallPaperMaps, gelSurfaceMaps, paintFlakeNormalMap, woodMaps, wovenBagMaps, steelPlateMaps, waterRippleNormalMap } from './textures';

export { standSteel } from './stands';

/** Height of the shot line above the floor, in metres. Every target is centred on it. */
export const SHOT_Y = 0.16;
/** World x of every target's front face; the lab grid's zero mark sits here. */
export const TARGET_FRONT_X = -0.2;

/** Name of the gel block mesh, so effects can find and deform it. */
export const GEL_BODY_NAME = 'gel-body';
export const WATER_BODY_NAME = 'water-body';
export const BLOOD_PACK_PREFIX = 'blood-pack-';
export const BONE_ROD_NAME = 'bone-rod';

/** Synthetic bone simulant: off-white, slightly yellow. */
export const BONE_COLOR = 0xe9dfc8;

/**
 * A target ready to place in the scene: its front face is at the group origin,
 * it extends along +x by `thickness`, and it is rotated about the vertical axis
 * through the impact point by the impact angle.
 */
export function createTarget(spec: MediumSpec, thickness: number, angleDeg: number): THREE.Group {
  return createTargetStack([{ medium: spec, thickness, gapM: 0 }], angleDeg);
}

/** Name of the group holding stack layer `i` (its body and its stand). */
export const layerGroupName = (i: number) => `layer-${i}`;

/**
 * A stack of target layers along the shot line (#24), front face at the shot
 * line's target point. The impact angle turns the whole stack.
 */
export function createTargetStack(layers: StackLayer[], angleDeg: number): THREE.Group {
  const group = new THREE.Group();
  group.name = `target:${layers.map((l) => l.medium.id).join('+')}`;
  group.position.set(TARGET_FRONT_X, SHOT_Y, 0);
  group.rotation.y = THREE.MathUtils.degToRad(angleDeg);

  const offsets = stackOffsets(layers);
  layers.forEach(({ medium: spec, thickness, look }, i) => {
    const layer = new THREE.Group();
    layer.name = layerGroupName(i);
    layer.position.x = offsets[i];
    const body = buildBody(spec, thickness, look ?? spec.look);
    body.position.x = thickness / 2;
    layer.add(body);
    layer.add(createSupport(spec, thickness, SHOT_Y, look ?? spec.look));
    group.add(layer);
  });

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
    for (const m of materials) if (!SHARED_STAND_MATERIALS.has(m)) m.dispose();
  });
}

/** The target body, centred on its own origin, thickness along x. */
function buildBody(spec: MediumSpec, t: number, look: MediumLook): THREE.Object3D {
  const h = spec.heightM;
  const w = spec.widthM;

  switch (look) {
    case 'gel': {
      // Finely subdivided so the gel effect can bulge the block and pull out the exit cone.
      const surface = gelSurfaceMaps();
      const gel = new THREE.Mesh(
        new THREE.BoxGeometry(t, h, w, Math.ceil(t / 0.005), 24, 24),
        new THREE.MeshPhysicalMaterial({
          color: 0xffe6bf,
          // Clear and glossy, with faint smudges and finger marks from handling.
          roughness: 0.35,
          roughnessMap: surface.roughnessMap,
          normalMap: surface.normalMap,
          normalScale: new THREE.Vector2(0.25, 0.25),
          transmission: 0.97,
          thickness: w,
          ior: 1.35,
          // Amber deepens with the depth of gel the light passes through.
          attenuationColor: new THREE.Color(0xe0a458),
          attenuationDistance: 0.5,
          // A soft amber glow at grazing angles picks out the block's faces in the dark lab.
          sheen: 0.35,
          sheenColor: new THREE.Color(0xd9a060),
          sheenRoughness: 0.4,
          specularIntensity: 1,
          clearcoat: 0.6,
          clearcoatRoughness: 0.12,
        }),
      );
      gel.name = GEL_BODY_NAME;
      if (spec.organicLayout) addOrganicInserts(gel, spec.organicLayout, t);
      return gel;
    }

    case 'waterTank': {
      const tank = new THREE.Group();
      const wall = 0.005;
      // Thin walls use plain alpha blending rather than transmission: three.js transmissive
      // surfaces can't see other transmissive surfaces, so the water would vanish behind them.
      const glass = new THREE.MeshPhysicalMaterial({
        color: 0xeefbff,
        roughness: 0.02,
        transparent: true,
        opacity: 0.06,
        specularIntensity: 1,
        clearcoat: 1,
        depthWrite: false,
      });
      const water = new THREE.Mesh(
        new THREE.BoxGeometry(t - wall * 2, h * 0.88 - wall, w - wall * 2),
        new THREE.MeshPhysicalMaterial({
          color: 0xf2fbff,
          roughness: 0.02,
          transmission: 1,
          thickness: w,
          ior: 1.33,
          attenuationColor: new THREE.Color(0x58b4d8),
          attenuationDistance: 0.55,
          specularIntensity: 1,
        }),
      );
      water.position.y = -h * 0.06;
      water.name = WATER_BODY_NAME;
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
      // Cut glass edges catch the light green, and black silicone seals the corners.
      const edgeGlass = new THREE.MeshPhysicalMaterial({ color: 0x9fdcc4, roughness: 0.05, transparent: true, opacity: 0.55, depthWrite: false });
      const silicone = new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.6 });
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const seam = new THREE.Mesh(new THREE.BoxGeometry(0.004, h, 0.004), silicone);
          seam.position.set(sx * (t / 2 - wall - 0.002), 0, sz * (w / 2 - wall - 0.002));
          tank.add(seam);
        }
      }
      // Top rims of the four walls: thin bright lines along the open top.
      for (const [sx, sz, px, pz] of [
        [t, wall, 0, -w / 2 + wall / 2],
        [t, wall, 0, w / 2 - wall / 2],
        [wall, w, -t / 2 + wall / 2, 0],
        [wall, w, t / 2 - wall / 2, 0],
      ] as const) {
        const rim = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.002, sz), edgeGlass);
        rim.position.set(px, h / 2 - 0.001, pz);
        tank.add(rim);
      }
      // A still surface with faint ripples, catching the softboxes.
      const ripples = waterRippleNormalMap();
      ripples.repeat.set(2, 2);
      const surface = new THREE.Mesh(
        new THREE.PlaneGeometry(t - wall * 2, w - wall * 2),
        new THREE.MeshPhysicalMaterial({
          color: 0x9cc8dc,
          roughness: 0.04,
          transparent: true,
          opacity: 0.14,
          normalMap: ripples,
          normalScale: new THREE.Vector2(0.15, 0.15),
          specularIntensity: 1,
          depthWrite: false,
        }),
      );
      surface.rotation.x = -Math.PI / 2;
      surface.position.y = -h * 0.06 + (h * 0.88 - wall) / 2 + 0.0005;
      tank.add(surface);
      return tank;
    }

    case 'pine':
    case 'oak': {
      const wood = woodMaps(look);
      const roughness = look === 'oak' ? 0.75 : 0.85;
      const grain = new THREE.MeshStandardMaterial({
        map: wood.map,
        roughnessMap: wood.roughnessMap,
        normalMap: wood.normalMap,
        normalScale: new THREE.Vector2(0.5, 0.5),
        roughness,
      });
      const endGrain = new THREE.MeshStandardMaterial({ map: wood.endGrain, roughness: 0.95 });
      // BoxGeometry material order: +x, -x, +y, -y, +z, -z. The grain runs up the plank, so the cut ends are ±y.
      return new THREE.Mesh(new THREE.BoxGeometry(t, h, w), [grain, grain, endGrain, endGrain, grain, grain]);
    }

    case 'drywall': {
      // Paper faces front and back, exposed gypsum on the cut edges.
      const front = drywallPaperMaps('front');
      const back = drywallPaperMaps('back');
      const paper = new THREE.MeshStandardMaterial({ map: front.map, normalMap: front.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.92 });
      const backPaper = new THREE.MeshStandardMaterial({ map: back.map, normalMap: back.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.95 });
      const gypsum = new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 1 });
      return new THREE.Mesh(new THREE.BoxGeometry(t, h, w), [backPaper, paper, gypsum, gypsum, gypsum, gypsum]);
    }

    case 'carDoorOuter':
    case 'carDoorInner': {
      if (look === 'carDoorInner') {
        // The inner skin: grey e-coat primer, never seen in the showroom.
        return new THREE.Mesh(new THREE.BoxGeometry(t, h, w), new THREE.MeshStandardMaterial({ color: 0x55595e, roughness: 0.6, metalness: 0.3 }));
      }
      // Deep red metallic paint under a glossy clear coat on the outside, primer inside.
      const paint = new THREE.MeshPhysicalMaterial({
        color: 0xa3141f,
        metalness: 0.4,
        roughness: 0.38,
        normalMap: paintFlakeNormalMap(),
        normalScale: new THREE.Vector2(0.2, 0.2),
        clearcoat: 1,
        clearcoatRoughness: 0.03,
      });
      const primer = new THREE.MeshStandardMaterial({ color: 0x55595e, roughness: 0.6, metalness: 0.3 });
      return new THREE.Mesh(new THREE.BoxGeometry(t, h, w), [primer, paint, paint, paint, paint, paint]);
    }

    case 'concrete': {
      const maps = concreteMaps('cast');
      return new THREE.Mesh(
        tileUvs(new THREE.BoxGeometry(t, h, w), 0.5),
        new THREE.MeshStandardMaterial({ ...maps, roughness: 1 }),
      );
    }

    case 'cinderBlock': {
      // Front and back shells joined by webs set in from the top and bottom, so the
      // block shows the H-shaped end of a masonry unit with its core open toward the camera.
      const maps = concreteMaps('block');
      const material = new THREE.MeshStandardMaterial({ ...maps, roughness: 1 });
      const shell = Math.min(spec.shellM ?? 0.032, t / 3);
      const web = 0.035;
      const inset = 0.022;
      const block = new THREE.Group();
      const parts: [number, number, number, number, number][] = [
        [shell, h, w, -t / 2 + shell / 2, 0],
        [shell, h, w, t / 2 - shell / 2, 0],
        [t - shell * 2, web, w, 0, h / 2 - inset - web / 2],
        [t - shell * 2, web, w, 0, -h / 2 + inset + web / 2],
      ];
      for (const [sx, sy, sz, px, py] of parts) {
        const part = new THREE.Mesh(tileUvs(new THREE.BoxGeometry(sx, sy, sz), 0.4), material);
        part.position.set(px, py, 0);
        block.add(part);
      }
      return block;
    }

    case 'mildSteel':
    case 'ar500': {
      // AR500 targets are painted on both faces; their cut edges and mild steel show bare mill scale.
      const mill = steelPlateMaps('mill');
      const scale = new THREE.MeshStandardMaterial({
        map: mill.map,
        roughnessMap: mill.roughnessMap,
        normalMap: mill.normalMap,
        normalScale: new THREE.Vector2(0.6, 0.6),
        metalness: 0.75,
        roughness: 1,
        envMapIntensity: 2,
      });
      if (spec.look === 'mildSteel') return new THREE.Mesh(new THREE.BoxGeometry(t, h, w), scale);
      const paint = steelPlateMaps('painted');
      const painted = new THREE.MeshStandardMaterial({
        map: paint.map,
        roughnessMap: paint.roughnessMap,
        normalMap: paint.normalMap,
        normalScale: new THREE.Vector2(0.4, 0.4),
        metalness: 0,
        roughness: 1,
      });
      // BoxGeometry material order: +x, -x, +y, -y, +z, -z.
      return new THREE.Mesh(new THREE.BoxGeometry(t, h, w), [painted, painted, scale, scale, scale, scale]);
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

    case 'bone':
      // Bone simulant normally lives inside the test dummy (models/dummy.ts); on its own it is a plain plate.
      return new THREE.Mesh(new THREE.BoxGeometry(t, h, w), new THREE.MeshStandardMaterial({ color: BONE_COLOR, roughness: 0.6 }));
  }
}

/**
 * Fake blood packs (dark red fluid in thin, wet plastic) and an optional bone
 * rod, suspended in the gel. Opaque, so they show through the transmissive gel.
 */
export function addOrganicInserts(gel: THREE.Object3D, layoutId: string, t: number): void {
  const layout = ORGANIC_LAYOUTS[layoutId];
  if (!layout) return;
  const blood = new THREE.MeshPhysicalMaterial({
    color: 0x5a0309,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  layout.packs.forEach((pack, i) => {
    // A sachet: a sphere flattened into a pillow, slightly irregular.
    const geometry = new THREE.SphereGeometry(1, 28, 18);
    const pos = geometry.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      const y = pos.getY(k);
      const z = pos.getZ(k);
      const squish = 1 - 0.25 * x * x;
      pos.setXYZ(k, x, y * squish, z * squish);
    }
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, blood);
    mesh.scale.set(...pack.size);
    mesh.position.set((pack.depth - 0.5) * t, pack.y, pack.z);
    mesh.rotation.x = (i * 0.7) % 0.5;
    mesh.name = `${BLOOD_PACK_PREFIX}${i}`;
    mesh.userData.rest = mesh.scale.clone();
    gel.add(mesh);
  });
  if (layout.bone) {
    const b = layout.bone;
    const bone = new THREE.Mesh(
      new THREE.CylinderGeometry(b.radius, b.radius * 1.1, b.length, 20),
      new THREE.MeshStandardMaterial({ color: BONE_COLOR, roughness: 0.55 }),
    );
    bone.position.set((b.depth - 0.5) * t, 0, b.z);
    bone.name = BONE_ROD_NAME;
    gel.add(bone);
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
  const maps = wovenBagMaps();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ ...maps, roughness: 0.95 }));
}

/**
 * Re-maps a box's UVs so every face shows the texture at the same real-world
 * scale (one tile per `tileM` metres), instead of stretching it per face.
 */
function tileUvs(geometry: THREE.BoxGeometry, tileM: number): THREE.BoxGeometry {
  const pos = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const [a, b] = nx > 0.5 ? [pos.getZ(i), pos.getY(i)] : ny > 0.5 ? [pos.getX(i), pos.getZ(i)] : [pos.getX(i), pos.getY(i)];
    uv.setXY(i, a / tileM + 0.5, b / tileM + 0.5);
  }
  uv.needsUpdate = true;
  return geometry;
}
