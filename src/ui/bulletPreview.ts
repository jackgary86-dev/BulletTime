import * as THREE from 'three';
import type { BulletSpec } from '../data/bullets';
import { createBulletModel, disposeBulletModel, type BulletModel } from '../models/bullet';
import { BASE_VIEW_WIDTH_M, previewScale, scaleNote } from './bulletPreviewScale';

/** Width of the preview window at scale 1, in metres. The window zooms out for rounds too big for it. */
const VIEW_WIDTH_M = BASE_VIEW_WIDTH_M;

/**
 * A small, separate renderer that shows the selected projectile at true scale
 * against a millimetre ruler, so rounds can be compared by size. It renders
 * only while the model turns, at a modest resolution.
 */
export interface BulletPreview {
  show(spec: BulletSpec): void;
}

/** The note under the preview says what the ruler ticks are when the view is zoomed out. */
export type ScaleNoteListener = (note: string) => void;

export function createBulletPreview(canvas: HTMLCanvasElement, onScale?: ScaleNoteListener): BulletPreview {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xfff2e0, 3);
  key.position.set(0.3, 1, 1);
  const rim = new THREE.DirectionalLight(0x8fb8ff, 2);
  rim.position.set(-1, 0.4, -1);
  scene.add(key, rim, new THREE.HemisphereLight(0xb0b8c8, 0x202020, 1.2));

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 1);
  camera.position.set(0, 0, 0.5);
  const ruler = createRuler();
  scene.add(ruler);
  /** How far the view is zoomed out for the round on show; the ruler and model are drawn at this scale. */
  let zoom = 1;

  let model: BulletModel | null = null;
  const spinner = new THREE.Group();
  scene.add(spinner);

  const resize = () => {
    const width = canvas.clientWidth || 260;
    const height = canvas.clientHeight || 100;
    renderer.setSize(width, height, false);
    const halfW = (VIEW_WIDTH_M * zoom) / 2;
    const halfH = (halfW * height) / width;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  renderer.setAnimationLoop((time) => {
    // Turn about the bullet's own axis so jacket, tip and bands catch the light.
    spinner.rotation.x = time * 0.0008;
    renderer.render(scene, camera);
  });

  return {
    show(spec) {
      if (model) {
        spinner.remove(model.group);
        disposeBulletModel(model);
      }
      model = createBulletModel(spec);
      // Big rounds zoom the view out (#preview-fit), so the ruler grows with it and its ticks stay whole millimetres.
      zoom = previewScale(model.length, spec.caliberMm / 1000);
      ruler.scale.setScalar(zoom);
      resize();
      onScale?.(scaleNote(zoom));
      // Left-align the base on the ruler's zero mark.
      model.group.position.x = (-VIEW_WIDTH_M / 2 + 0.004) * zoom + model.length;
      spinner.add(model.group);
    },
  };
}

/** Tick marks every millimetre, taller every 5 mm and 10 mm, along the bottom of the view. */
function createRuler(): THREE.LineSegments {
  const points: number[] = [];
  const x0 = -VIEW_WIDTH_M / 2 + 0.004;
  const y0 = -0.0175;
  for (let mm = 0; mm <= 84; mm++) {
    const h = mm % 10 === 0 ? 0.0035 : mm % 5 === 0 ? 0.0022 : 0.0012;
    const x = x0 + mm * 0.001;
    points.push(x, y0, 0, x, y0 + h, 0);
  }
  points.push(x0, y0, 0, x0 + 0.084, y0, 0);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x8a93a1, transparent: true, opacity: 0.8 }),
  );
}
