import * as THREE from 'three';
import type { MediumLook, MediumSpec } from '../data/media';
import { bloodColor, onReducedGoreChange, reducedGore } from '../data/content';
import { ORGANIC_LAYOUTS } from '../data/organic';
import { stackOffsets, type StackLayer } from '../data/stacks';
import { createSupport, SHARED_STAND_MATERIALS } from './stands';
import { plateStandSpans } from './plateStandLayout';
import { brickMaterial, concreteMaterial, shedSheetMaterial } from './buildings';
import { hullPaint } from './tank';
import { bowlingBallTexture, watermelonTexture, concreteMaps, brickMaps, BRICK_TILE_M, drywallPaperMaps, gelSurfaceMaps, paintFlakeNormalMap, woodMaps, wovenBagMaps, earthMaps, steelPlateMaps, waterRippleNormalMap } from './textures';

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
/** Name of a showpiece object's body (#156), so its effect can hide, shake or break it. */
export const OBJECT_BODY_NAME = 'object-body';
/** Name of a metal plate's body (#221), so its effect can bulge the back face. */
export const PLATE_BODY_NAME = 'plate-body';

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
/** `shotY` is the height of the stack's centre line above the floor (the bench line, or higher on the range, #231). */
export function createTargetStack(layers: StackLayer[], angleDeg: number, shotY = SHOT_Y): THREE.Group {
  const group = new THREE.Group();
  group.name = `target:${layers.map((l) => l.medium.id).join('+')}`;
  group.position.set(TARGET_FRONT_X, shotY, 0);
  group.rotation.y = THREE.MathUtils.degToRad(angleDeg);

  const offsets = stackOffsets(layers);
  const standSpans = plateStandSpans(layers);
  layers.forEach(({ medium: spec, thickness, look }, i) => {
    const layer = new THREE.Group();
    layer.name = layerGroupName(i);
    layer.position.x = offsets[i];
    const body = buildBody(spec, thickness, look ?? spec.look);
    body.position.x = thickness / 2;
    layer.add(body);
    // A plate bolted to the one before it rides in that plate's stand (#232).
    const span = standSpans[i];
    if (span !== null) layer.add(createSupport(spec, span, shotY, look ?? spec.look));
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
          // The temporary cavity inside is drawn as a see-through air pocket after the block (#154);
          // the block must not hide it in the depth buffer.
          depthWrite: false,
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
      const door = new THREE.Group();
      door.add(new THREE.Mesh(new THREE.BoxGeometry(t, h, w), [primer, paint, paint, paint, paint, paint]));
      // The window (dark glass in a black surround) across the top third, and a chrome handle, proud of the paint.
      const proud = -t / 2 - 0.0008;
      const glassPane = new THREE.Mesh(new THREE.BoxGeometry(0.0008, h * 0.3, w * 0.86), new THREE.MeshPhysicalMaterial({ color: 0x0a1218, roughness: 0.05, metalness: 0.2, clearcoat: 1 }));
      glassPane.position.set(proud, h * 0.33, 0);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.0006, h * 0.33, w * 0.9), new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.5 }));
      trim.position.set(proud + 0.0003, h * 0.33, 0);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.014, w * 0.32), new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.2, metalness: 1 }));
      handle.position.set(-t / 2 - 0.006, h * 0.1, w * 0.22);
      door.add(trim, glassPane, handle);
      return door;
    }

    case 'concrete': {
      const maps = concreteMaps('cast');
      return new THREE.Mesh(
        tileUvs(new THREE.BoxGeometry(t, h, w), 0.5),
        new THREE.MeshStandardMaterial({ ...maps, roughness: 1 }),
      );
    }

    case 'brickWall': {
      const maps = brickMaps();
      return new THREE.Mesh(
        tileUvs(new THREE.BoxGeometry(t, h, w), BRICK_TILE_M),
        new THREE.MeshStandardMaterial({ ...maps, roughness: 1 }),
      );
    }

    case 'tankHull':
      // The tank's near hull side, painted olive; the rest of the vehicle is its support.
      return named(new THREE.Mesh(new THREE.BoxGeometry(t, h, w), hullPaint()), PLATE_BODY_NAME);

    case 'blockHouse':
    case 'frameColumn':
      return new THREE.Mesh(tileUvs(new THREE.BoxGeometry(t, h, w), 0.5), concreteMaterial());

    case 'frameInfill':
      return new THREE.Mesh(tileUvs(new THREE.BoxGeometry(t, h, w), BRICK_TILE_M), brickMaterial());

    case 'shedSheet': {
      // Corrugated sheet, its ribs about 100 mm apart.
      const geometry = tileUvs(new THREE.BoxGeometry(Math.max(t, 0.002), h, w), 0.4);
      return new THREE.Mesh(geometry, shedSheetMaterial());
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
      // Copper, brass, lead and the other metals share the sheet look, tinted (#261).
      if (spec.tint !== undefined) scale.color.setHex(spec.tint);
      // Cast iron (#296) is a matte mid grey, not blue-black mill scale: the dark cracks and holes show on it.
      if (spec.brittle) {
        const grey = new THREE.MeshStandardMaterial({ color: spec.tint ?? 0x8d9096, roughnessMap: mill.roughnessMap, normalMap: mill.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), metalness: 0.3, roughness: 0.9 });
        return named(new THREE.Mesh(new THREE.BoxGeometry(t, h, w), grey), PLATE_BODY_NAME);
      }
      if (spec.look === 'mildSteel') return named(new THREE.Mesh(new THREE.BoxGeometry(t, h, w), scale), PLATE_BODY_NAME);
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
      return named(new THREE.Mesh(new THREE.BoxGeometry(t, h, w), [painted, painted, scale, scale, scale, scale]), PLATE_BODY_NAME);
    }

    case 'plasticJug':
      // Milky translucent HDPE with a faint waxy sheen.
      return new THREE.Mesh(
        new THREE.BoxGeometry(t, h, w),
        new THREE.MeshPhysicalMaterial({ color: 0xf1f3ef, roughness: 0.35, transmission: 0.55, thickness: t * 4, ior: 1.5, attenuationColor: new THREE.Color(0xdfe6e2), attenuationDistance: 0.02 }),
      );

    case 'phoneBack':
      // Brushed aluminium back; named so the plate dishing works on it like on any thin metal.
      return named(new THREE.Mesh(new THREE.BoxGeometry(t, h, w), new THREE.MeshStandardMaterial({ color: 0xbfc4ca, roughness: 0.32, metalness: 1 })), PLATE_BODY_NAME);

    case 'paperStack': {
      // A phone book: pages on three sides, a dark cover front and back, a spine on one edge.
      const pages = pageEdgeMaterial();
      const cover = new THREE.MeshStandardMaterial({ color: 0x1d2b44, roughness: 0.55 });
      const spine = new THREE.MeshStandardMaterial({ color: 0x15203a, roughness: 0.5 });
      // BoxGeometry material order: +x, -x, +y, -y, +z, -z. The shot goes through the covers (±x); the spine is -z.
      return new THREE.Mesh(new THREE.BoxGeometry(t, h, w), [cover, cover, pages, pages, pages, spine]);
    }

    case 'waterJug': {
      // The water in a jug (#240): the body between the two skins, then the shoulder, neck, cap and handle on top.
      const jug = new THREE.Group();
      const water = new THREE.Mesh(
        new THREE.BoxGeometry(t, h * 0.86, w * 0.97),
        new THREE.MeshPhysicalMaterial({ color: 0xd8eef7, roughness: 0.03, transmission: 1, thickness: t, ior: 1.33, attenuationColor: new THREE.Color(0x58b4d8), attenuationDistance: 0.6, specularIntensity: 1 }),
      );
      water.position.y = -h * 0.07;
      water.name = WATER_BODY_NAME;
      jug.add(water);
      const plastic = new THREE.MeshPhysicalMaterial({ color: 0xf1f3ef, roughness: 0.35, transmission: 0.55, thickness: 0.004, ior: 1.5 });
      const top = h * 0.5;
      const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.03, Math.min(t, w) * 0.42, h * 0.1, 20), plastic);
      shoulder.position.y = top - h * 0.12 - h * 0.07 + h * 0.07;
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.03, 20), plastic);
      neck.position.y = shoulder.position.y + h * 0.05 + 0.015;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 20), new THREE.MeshStandardMaterial({ color: 0x2a6fd6, roughness: 0.45 }));
      cap.position.y = neck.position.y + 0.025;
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.007, 8, 20, Math.PI), plastic);
      handle.rotation.set(0, Math.PI / 2, 0);
      handle.position.set(0, shoulder.position.y + 0.01, 0.0);
      jug.add(shoulder, neck, cap, handle);
      return jug;
    }

    case 'phoneCell':
      // Dark laminate pouch.
      return new THREE.Mesh(new THREE.BoxGeometry(t, h, w), new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.5, metalness: 0.4 }));

    case 'sandbag':
      return createSandbag(t, h, w);

    case 'earthBerm':
      return createEarthBerm(t, h, w);

    case 'glass': {
      const pane = new THREE.MeshPhysicalMaterial({
        color: 0xf4fffa,
        roughness: 0.01,
        transmission: 1,
        thickness: t,
        ior: 1.52,
        attenuationColor: new THREE.Color(0x9fe0c4), // float glass green edge tint
        attenuationDistance: 0.08,
        specularIntensity: 1,
      });
      // Looking into a cut edge you see through the full width of the pane: deep bottle green.
      const edge = new THREE.MeshPhysicalMaterial({ color: 0x4f9c80, roughness: 0.08, transmission: 0.4, thickness: 0.05, ior: 1.52 });
      return new THREE.Mesh(new THREE.BoxGeometry(t, h, w), [pane, pane, edge, edge, edge, edge]);
    }

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

    case 'bowlingBall':
    case 'steelBall':
    case 'gong':
    case 'watermelon':
    case 'bottle': {
      const body = buildObject(look, t, h, w);
      body.name = OBJECT_BODY_NAME;
      return body;
    }

    case 'bone':
      // Bone simulant normally lives inside the test dummy (models/dummy.ts); on its own it is a plain plate.
      return new THREE.Mesh(new THREE.BoxGeometry(t, h, w), new THREE.MeshStandardMaterial({ color: BONE_COLOR, roughness: 0.6 }));
  }
}

/** Showpiece objects (#156), centred on their own origin like every body, the shot line along +x. */
function buildObject(look: 'bowlingBall' | 'steelBall' | 'gong' | 'watermelon' | 'bottle', t: number, h: number, w: number): THREE.Object3D {
  switch (look) {
    case 'bowlingBall': {
      const r = h / 2;
      const ball = new THREE.Group();
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(r, 64, 40),
        new THREE.MeshPhysicalMaterial({ map: bowlingBallTexture(), roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.04 }),
      );
      ball.add(shell);
      // Thumb and two finger holes on the top, turned away from the shooter.
      const holeMaterial = new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.9 });
      const holes: [number, number, number][] = [
        [0.012, 0.35, 0],
        [0.01, -0.05, -0.22],
        [0.01, -0.05, 0.22],
      ];
      for (const [radius, tilt, spin] of holes) {
        const hole = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), holeMaterial);
        const dir = new THREE.Vector3(Math.sin(tilt) * 0.6 + 0.35, 0.8, Math.sin(spin)).normalize();
        hole.position.copy(dir).multiplyScalar(r * 1.001);
        hole.lookAt(dir.clone().multiplyScalar(r * 2));
        ball.add(hole);
      }
      return ball;
    }

    case 'steelBall': {
      const r = h / 2;
      const ball = new THREE.Group();
      ball.add(new THREE.Mesh(new THREE.SphereGeometry(r, 64, 40), new THREE.MeshStandardMaterial({ color: 0xe2e6ea, metalness: 1, roughness: 0.26, envMapIntensity: 2.6 })));
      // A rubber ring under it so it can't roll off the cart.
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.45, r * 0.08, 10, 32), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -r * 0.9 + r * 0.08;
      ball.add(ring);
      return ball;
    }

    case 'gong': {
      // A round plate facing the shooter: orange paint on the faces, bare steel round the cut edge.
      const mill = steelPlateMaps('mill');
      const edge = new THREE.MeshStandardMaterial({ map: mill.map, roughnessMap: mill.roughnessMap, metalness: 0.75, roughness: 1, envMapIntensity: 2 });
      const paint = new THREE.MeshStandardMaterial({ color: 0xd8642a, roughness: 0.55, metalness: 0.05 });
      const disc = new THREE.CylinderGeometry(h / 2, h / 2, t, 72);
      disc.rotateZ(Math.PI / 2);
      // CylinderGeometry groups: side, top, bottom.
      return new THREE.Mesh(disc, [edge, paint, paint]);
    }

    case 'watermelon': {
      const geometry = new THREE.SphereGeometry(1, 64, 40);
      // Poles along the melon's length (the shot line, x), so the stripes run end to end.
      geometry.rotateZ(-Math.PI / 2);
      const pos = geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setXYZ(i, (pos.getX(i) * t) / 2, (pos.getY(i) * h) / 2, (pos.getZ(i) * w) / 2);
      geometry.computeVertexNormals();
      return new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({ map: watermelonTexture(), roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.35 }));
    }

    case 'bottle': {
      const r = w / 2;
      const bottle = new THREE.Group();
      // Side profile from the base up: the straight body, the shoulder, the neck and the lip.
      const base = -h / 2;
      const profile = [
        [0, base],
        [r * 0.92, base],
        [r, base + 0.006],
        [r, h / 2],
        [r * 0.8, h / 2 + 0.03],
        [r * 0.36, h / 2 + 0.06],
        [r * 0.32, h / 2 + 0.1],
        [r * 0.38, h / 2 + 0.104],
        [r * 0.38, h / 2 + 0.11],
      ].map(([x, y]) => new THREE.Vector2(x, y));
      const glass = new THREE.MeshPhysicalMaterial({
        color: 0x7cc79a,
        roughness: 0.03,
        transparent: true,
        opacity: 0.32,
        specularIntensity: 1,
        clearcoat: 1,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      bottle.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 48), glass));
      // Water up into the shoulder.
      const fill = [
        [0, base + 0.004],
        [r * 0.94, base + 0.004],
        [r * 0.94, h / 2],
        [r * 0.74, h / 2 + 0.03],
        [0, h / 2 + 0.03],
      ].map(([x, y]) => new THREE.Vector2(x, y));
      const water = new THREE.Mesh(
        new THREE.LatheGeometry(fill, 48),
        new THREE.MeshPhysicalMaterial({ color: 0xcfeef5, roughness: 0.04, transparent: true, opacity: 0.45, specularIntensity: 1, depthWrite: false }),
      );
      water.renderOrder = -1;
      bottle.add(water);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.4, r * 0.4, 0.014, 24), new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.3 }));
      cap.position.y = h / 2 + 0.112;
      bottle.add(cap);
      return bottle;
    }
  }
}

/** The fluid inside a fake blood pack. */
const PACK_FLUID = 0x6a0610;
/** Every pack material built so far, recoloured in place when reduced gore is switched (#109). */
const packMaterials = new Set<WeakRef<THREE.MeshPhysicalMaterial>>();
onReducedGoreChange(() => {
  for (const ref of packMaterials) {
    const material = ref.deref();
    if (material) tintPack(material);
    else packMaterials.delete(ref);
  }
});

/** Blood-red fluid with a pink sheen, or blue simulant with a pale blue sheen under reduced gore. */
function tintPack(material: THREE.MeshPhysicalMaterial): void {
  material.color.setHex(bloodColor(PACK_FLUID));
  material.sheenColor.setHex(reducedGore() ? 0x9ad0ff : 0xff9a9a);
}

/**
 * Fake blood packs (dark red fluid in thin, wet plastic) and an optional bone
 * rod, suspended in the gel. Opaque, so they show through the transmissive gel.
 */
export function addOrganicInserts(gel: THREE.Object3D, layoutId: string, t: number): void {
  const layout = ORGANIC_LAYOUTS[layoutId];
  if (!layout) return;
  // Fluid seen through a glossy film: deep red with a pale sheen where the film catches the light.
  const blood = new THREE.MeshPhysicalMaterial({
    color: PACK_FLUID,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    sheen: 0.6,
    sheenRoughness: 0.35,
    sheenColor: new THREE.Color(0xff9a9a),
  });
  tintPack(blood);
  packMaterials.add(new WeakRef(blood));
  // The heat-sealed seam round the edge of the sachet: clear plastic film over a thin line of fluid.
  const seamFilm = new THREE.MeshPhysicalMaterial({ color: 0xd9b0b0, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 });
  const seam = new THREE.TorusGeometry(1, 0.05, 6, 48);
  seam.rotateY(Math.PI / 2);
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
    mesh.add(new THREE.Mesh(seam, seamFilm));
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
/**
 * A mound of packed earth (#296): the struck face stays flat and upright (the
 * hit marks sit on it), the sides slope in toward a rounded, lumpy top.
 */
function createEarthBerm(t: number, h: number, w: number): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(t, h, w, 16, 24, 28);
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const up = Math.min(1, Math.max(0, v.y / h + 0.5));
    const edge = Math.abs(v.x) / (t / 2);
    // The sides lean in toward the top, and the top shoulders round off.
    const lean = 1 - 0.5 * up ** 1.6;
    v.z *= lean;
    // Lumps on the sides and top only; the flat front and back faces stay true.
    if (edge < 0.999) {
      const lump = Math.sin(v.x * 9 + v.z * 7) * Math.sin(v.z * 11 - v.x * 5) * 0.03;
      v.y += lump * up * h * 0.5;
      v.z += lump * w * 0.15 * (1 - up);
    }
    // A slightly domed top.
    if (up > 0.98) v.y -= 0.12 * h * (1 - (1 - edge ** 2) * (1 - (Math.abs(v.z) / (w / 2)) ** 2));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // Tile the soil at a real scale: about 0.6 m a repeat.
  const uv = geometry.attributes.uv;
  const normal = geometry.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const [a, b] = nx > 0.5 ? [pos.getZ(i), pos.getY(i)] : ny > 0.5 ? [pos.getX(i), pos.getZ(i)] : [pos.getX(i), pos.getY(i)];
    uv.setXY(i, a / 0.6 + 0.5, b / 0.6 + 0.5);
  }
  geometry.computeVertexNormals();
  const maps = earthMaps();
  for (const m of [maps.map, maps.roughnessMap, maps.normalMap]) m.wrapS = m.wrapT = THREE.RepeatWrapping;
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ ...maps, roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8) }));
}

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
function named<T extends THREE.Object3D>(object: T, name: string): T {
  object.name = name;
  return object;
}

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

/** Pages seen edge-on: fine cream and grey lines, repeated along the height of the block. */
function pageEdgeMaterial(): THREE.MeshStandardMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < 64; y++) {
    ctx.fillStyle = y % 4 === 0 ? '#bdb7a6' : y % 4 === 2 ? '#e8e3d2' : '#f4f0e2';
    ctx.fillRect(0, y, 8, 1);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1, 4);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.9 });
}
