/**
 * Armor lab (#172): the 3D sectioned view. The plates of a stack stand on a
 * steel bench in the same dark lab as the simulators, each sawn in half along
 * the shot line so the channel shows. The solids come from `section3d.ts`
 * (profiles revolved half a turn); the cut face is painted with the 2D section
 * drawing, so the field overlays look the same in both views; the crater wall
 * glows with the energy deposited; the thrown pieces follow their fragment
 * tracks onto the bench.
 *
 * Shares the Armor lab's playback: `render(t, fragmentT)` draws one instant,
 * so the 2D/3D toggle switches without re-firing.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { disposeTree } from '../scene/dispose';
import { QUALITY, initialQuality } from '../scene/quality';
import { createRenderer, viewSize } from '../scene/renderer';
import { createStudio } from '../scene/studio';
import { buildOverlay } from './fieldOverlay';
import type { PenetratorMaterial } from './munitions';
import { sectionShapes, type SectionLayout } from './section';
import { PLATE_RADIUS_SHARE, roomHalfHeight, section3d, type Fragment3d, type PlateSolid, type ProfilePoint } from './section3d';
import { drawSection, shade, type OverlayId } from './sectionDraw';
import type { StackTimeline } from './stack';
import { extendedFrame } from './stackView';

/** Height of the shot line above the lab floor, m (the simulators' focus height), unless the stack needs more room. */
const SHOT_LINE_Y = 0.15;
/** Segments round the half-revolution. */
const LATHE_SEGMENTS = 36;
/** Pixels across the cut-face texture along the shot line. */
const FACE_TEXTURE_PX = 512;
const BENCH_DEPTH = 0.6;
const BENCH_COLOR = 0x2a2d33;

const PENETRATOR_COLOR: Record<PenetratorMaterial, number> = {
  steel: 0xc4ccd8,
  'tungsten-alloy': 0x8a8f99,
  copper: 0xe39a55,
};

const FRAGMENT_COLOR: Record<Fragment3d['kind'], number> = {
  plug: 0x9aa3ad,
  scab: 0xb4bcc6,
  penetrator: 0xc4ccd8,
  shard: 0xd0d6de,
  jet: 0xe39a55,
  spall: 0xa8b0ba,
};

export interface View3d {
  /** The stack to show, or null to clear. Rebuilds the materials and reframes the camera. */
  setStack(stack: StackTimeline | null): void;
  /** Draws the stack at stack time `t`, with the pieces at `fragmentT` (s), under a field overlay. */
  render(t: number, fragmentT: number, overlay: OverlayId): void;
  /** Call when the canvas changes size or becomes visible. */
  resize(): void;
  dispose(): void;
}

/** One plate's meshes and the offscreen canvas its cut face is painted on. */
interface PlateView {
  group: THREE.Group;
  outer: THREE.MeshStandardMaterial;
  crater: THREE.MeshStandardMaterial;
  face: THREE.MeshBasicMaterial;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  solids: THREE.Mesh[];
  faceMesh: THREE.Mesh | null;
  stand: THREE.Mesh;
}

/** Revolves a profile half a turn about the shot line: local Y is the shot line, and the kept half is z ≤ 0 (behind the cut). */
function lathe(points: ProfilePoint[]): THREE.LatheGeometry {
  const pts = points.map((p) => new THREE.Vector2(Math.max(0, p.r), p.x));
  return new THREE.LatheGeometry(pts, LATHE_SEGMENTS, Math.PI / 2, Math.PI);
}

/** The cut face: the outline mirrored about the axis, in the x–y plane, with UVs mapping the plate's rectangle onto the texture. */
function faceGeometry(plate: PlateSolid): THREE.BufferGeometry | null {
  const top = plate.outline.map((p) => new THREE.Vector2(p.x, p.r));
  const bottom = [...plate.outline].reverse().map((p) => new THREE.Vector2(p.x, -p.r)).filter((p) => Math.abs(p.y) > 1e-9);
  const pts = [...top, ...bottom];
  if (pts.length < 3) return null;
  const shape = new THREE.Shape(pts);
  const geometry = new THREE.ShapeGeometry(shape);
  const pos = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const los = plate.rearX - plate.frontX;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) - plate.frontX) / los, (pos.getY(i) + plate.radiusM) / (2 * plate.radiusM));
  }
  uv.needsUpdate = true;
  return geometry;
}

export function mountView3d(canvas: HTMLCanvasElement): View3d {
  const quality = QUALITY[initialQuality()];
  const renderer = createRenderer(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.shadowMap.enabled = quality.shadowMapSize > 0;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.005, 50);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.04;
  controls.maxDistance = 8;
  controls.maxPolarAngle = Math.PI * 0.495;
  const studio = createStudio(scene, renderer);
  studio.setShadowMapSize(quality.shadowMapSize);

  /** Everything that belongs to the shot, in stack coordinates (x along the shot line from the first plate's face). */
  const rig = new THREE.Group();
  scene.add(rig);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: BENCH_COLOR, metalness: 0.5, roughness: 0.6 }));
  bench.castShadow = true;
  bench.receiveShadow = true;
  scene.add(bench);

  const standMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3e45, metalness: 0.4, roughness: 0.7 });
  const penetratorMaterial = new THREE.MeshStandardMaterial({ color: 0xc4ccd8, metalness: 0.9, roughness: 0.35 });
  const jetMaterial = new THREE.MeshStandardMaterial({ color: 0xffc07a, emissive: 0xff9a3c, emissiveIntensity: 2.5, metalness: 0.2, roughness: 0.4 });
  const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 24);
  const unitCone = new THREE.ConeGeometry(1, 1, 24);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const body = new THREE.Mesh(unitCylinder, penetratorMaterial);
  const nose = new THREE.Mesh(unitCone, penetratorMaterial);
  body.rotation.z = -Math.PI / 2;
  nose.rotation.z = -Math.PI / 2;
  body.castShadow = nose.castShadow = true;
  rig.add(body, nose);

  const fragmentPool: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[] = [];
  const fragmentMaterials = new Map<Fragment3d['kind'], THREE.MeshStandardMaterial>();
  const fragmentMaterial = (kind: Fragment3d['kind'], hot: boolean) => {
    const key = `${kind}:${hot}` as Fragment3d['kind'];
    let m = fragmentMaterials.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: FRAGMENT_COLOR[kind], metalness: 0.7, roughness: 0.5, emissive: hot ? 0xff7a2a : 0x000000, emissiveIntensity: hot ? 1.8 : 0 });
      fragmentMaterials.set(key, m);
    }
    return m;
  };

  let stack: StackTimeline | null = null;
  let plates: PlateView[] = [];
  /** Height of the shot line above the lab floor, m. */
  let shotY = SHOT_LINE_Y;
  let half = 0;

  const clearPlates = () => {
    for (const p of plates) {
      rig.remove(p.group);
      disposeTree(p.group, null);
      p.texture.dispose();
      p.face.dispose();
      p.outer.dispose();
      p.crater.dispose();
      scene.remove(p.stand);
      p.stand.geometry.dispose();
    }
    plates = [];
  };

  const setStack = (next: StackTimeline | null) => {
    clearPlates();
    stack = next;
    if (!stack) {
      bench.visible = false;
      return;
    }
    half = roomHalfHeight(stack);
    const radius = PLATE_RADIUS_SHARE * half;
    shotY = Math.max(SHOT_LINE_Y, half + 0.04);
    const last = stack.stages[stack.stages.length - 1];
    const pathM = last.startM + last.timeline.result.losThicknessM;
    rig.position.set(-pathM / 2, shotY, 0);

    // The bench: from the floor up to the fragment room's floor, as long as the room.
    const room = stack.fragments?.room;
    const fragStage = stack.stages[stack.fragmentStage];
    const left = room ? fragStage.startM + room.leftX : -half;
    const right = room ? fragStage.startM + room.rightX : pathM + half;
    const benchTop = shotY - half;
    bench.visible = true;
    bench.scale.set(Math.max(right - left, pathM + 2 * half) + 0.05, benchTop, BENCH_DEPTH);
    bench.position.set((left + right) / 2 - pathM / 2, benchTop / 2, -BENCH_DEPTH * 0.3);

    plates = stack.stages.map((stage) => {
      const outer = new THREE.MeshStandardMaterial({ color: stage.layer.material.color, metalness: 0.75, roughness: 0.42, side: THREE.DoubleSide });
      const crater = new THREE.MeshStandardMaterial({ color: shade(stage.layer.material.color, 0.55), metalness: 0.6, roughness: 0.7, side: THREE.DoubleSide, emissive: 0xff6a1e, emissiveIntensity: 0 });
      const canvas = document.createElement('canvas');
      const los = stage.timeline.result.losThicknessM;
      canvas.width = FACE_TEXTURE_PX;
      canvas.height = Math.min(1024, Math.max(64, Math.round((FACE_TEXTURE_PX * 2 * radius) / los)));
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const face = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
      const group = new THREE.Group();
      rig.add(group);
      // The clamp holding the plate on the bench, under its lower rim.
      const stand = new THREE.Mesh(unitBox, standMaterial);
      stand.castShadow = stand.receiveShadow = true;
      const standH = Math.max(0.005, half - radius);
      stand.scale.set(Math.max(los, 0.012), standH, radius * 0.5);
      stand.position.set(stage.startM + los / 2 - pathM / 2, benchTop + standH / 2, -radius * 0.25);
      scene.add(stand);
      return { group, outer, crater, face, texture, canvas, ctx: canvas.getContext('2d')!, solids: [], faceMesh: null, stand };
    });
    studio.fitContactShadow(bench);

    // Frame the stack from the front and a little above, far enough to see the whole bench.
    const span = Math.max(pathM, 2 * half);
    const dist = Math.max(0.3, 2.6 * span);
    controls.target.set(0, shotY, 0);
    camera.position.set(dist * 0.45, shotY + dist * 0.28, dist * 0.9);
    controls.update();
  };

  /** Paints a plate's cut face with the 2D section drawing, plate filling the canvas. */
  const paintFace = (view: PlateView, index: number, t: number, fragmentT: number, overlay: OverlayId) => {
    if (!stack) return;
    const stage = stack.stages[index];
    const { canvas, ctx } = view;
    const w = canvas.width;
    const h = canvas.height;
    const los = stage.timeline.result.losThicknessM;
    const layout: SectionLayout = { width: w, height: h, pxPerM: w / los, frontX: 0, rearX: w, axisY: h / 2, plate: { x: 0, y: 0, width: w, height: h } };
    const localT = t - stage.offsetT;
    const frame = extendedFrame(stage, localT);
    const shapes = sectionShapes(stage.timeline, frame, layout, fragmentT - stage.offsetT);
    // The round is a solid in the scene, not a drawing on the face.
    shapes.penetrator.hidden = true;
    const field = overlay === 'temperature' || overlay === 'stress' || overlay === 'pressure' ? overlay : null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawSection(
      ctx,
      shapes,
      { plateColor: stage.layer.material.color, penetratorMaterial: stage.shot.impact.material, overlay, jet: stage.shot.impact.family === 'heat' },
      { field: field ? buildOverlay(stage.timeline, Math.max(0, fragmentT - stage.offsetT), field, layout) : null, legend: false },
    );
    view.texture.needsUpdate = true;
  };

  const render = (t: number, fragmentT: number, overlay: OverlayId) => {
    if (stack) {
      const view = section3d(stack, t, fragmentT);
      view.plates.forEach((plate, i) => {
        const pv = plates[i];
        for (const m of pv.solids) {
          pv.group.remove(m);
          m.geometry.dispose();
        }
        pv.solids = [];
        if (pv.faceMesh) {
          pv.group.remove(pv.faceMesh);
          pv.faceMesh.geometry.dispose();
          pv.faceMesh = null;
        }
        for (const surface of plate.surfaces) {
          const mesh = new THREE.Mesh(lathe(surface.points), surface.kind === 'crater' ? pv.crater : pv.outer);
          mesh.rotation.z = -Math.PI / 2;
          mesh.castShadow = mesh.receiveShadow = true;
          pv.group.add(mesh);
          pv.solids.push(mesh);
        }
        const faceGeo = faceGeometry(plate);
        if (faceGeo) {
          pv.faceMesh = new THREE.Mesh(faceGeo, pv.face);
          pv.group.add(pv.faceMesh);
        }
        pv.crater.emissiveIntensity = overlay === 'none' ? 0 : 2.2 * plate.heat;
        paintFace(pv, i, t, fragmentT, overlay);
      });

      // The round.
      const p = view.penetrator;
      const length = p.noseX - p.tailX;
      const shown = !p.hidden && length > 1e-6;
      body.visible = nose.visible = shown;
      if (shown) {
        const material = p.jet ? jetMaterial : penetratorMaterial;
        if (!p.jet) penetratorMaterial.color.set(PENETRATOR_COLOR[stack.stages[0].shot.impact.material]);
        body.material = nose.material = material;
        const noseLen = p.jet ? 0 : Math.min(length * 0.5, p.radiusM * 1.6);
        const bodyLen = Math.max(1e-6, length - noseLen);
        body.scale.set(p.radiusM, bodyLen, p.radiusM);
        body.position.set(p.tailX + bodyLen / 2, 0, 0);
        nose.visible = noseLen > 0;
        nose.scale.set(p.radiusM, Math.max(1e-6, noseLen), p.radiusM);
        nose.position.set(p.noseX - noseLen / 2, 0, 0);
      }

      // The pieces.
      while (fragmentPool.length < view.fragments.length) {
        const m = new THREE.Mesh(unitBox, fragmentMaterial('shard', false));
        m.castShadow = true;
        rig.add(m);
        fragmentPool.push(m);
      }
      fragmentPool.forEach((m, i) => {
        const f = view.fragments[i];
        m.visible = !!f;
        if (!f) return;
        m.material = fragmentMaterial(f.kind, f.hot);
        const thick = Math.max(f.widthM * 0.35, 0.002);
        m.scale.set(Math.max(f.lengthM, 0.003), Math.max(f.widthM, 0.003), thick);
        // Resting pieces lie flat on the bench rather than standing on an edge.
        m.position.set(f.x, f.resting ? f.y + thick / 2 : f.y, f.z);
        m.rotation.set(f.resting ? Math.PI / 2 : 0, 0, f.angle);
      });
    } else {
      body.visible = nose.visible = false;
      for (const m of fragmentPool) m.visible = false;
    }
    controls.update();
    renderer.render(scene, camera);
  };

  const resize = () => {
    const [w, h] = viewSize(canvas);
    if (w < 2 || h < 2) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  return {
    setStack,
    render,
    resize,
    dispose() {
      window.removeEventListener('resize', resize);
      clearPlates();
      controls.dispose();
      disposeTree(scene, null);
      for (const m of fragmentMaterials.values()) m.dispose();
      unitCylinder.dispose();
      unitCone.dispose();
      unitBox.dispose();
      renderer.dispose();
    },
  };
}
