import './style.css';
import * as THREE from 'three';
import { createRenderer, watchResize } from './scene/renderer';
import { createCameraRig } from './scene/camera';
import { createStudio } from './scene/studio';
import { createPostFx } from './scene/postfx';
import {
  createTargetStand,
  PREVIEW_BLOCK_BACK_X,
  PREVIEW_BLOCK_CENTER_Y,
  PREVIEW_BLOCK_FRONT_X,
} from './models/targetStand';
import { createBulletModel } from './models/bullet';
import { simulateShot } from './sim/timeline';
import { Playback } from './sim/playback';
import { SLICE_BULLET, SLICE_GEL, SLICE_STAND_OFF_M } from './data/sliceShot';
import { mountOverlay } from './ui/overlay';
import { mountControls } from './ui/controls';

function bootstrap(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
  const overlay = document.querySelector<HTMLElement>('#overlay');
  if (!canvas || !overlay) throw new Error('BulletTime: missing #viewport or #overlay element');

  const renderer = createRenderer(canvas);
  const scene = new THREE.Scene();
  const { camera, controls } = createCameraRig(canvas);
  createStudio(scene, renderer);
  scene.add(createTargetStand());

  const bullet = createBulletModel();
  bullet.group.position.y = PREVIEW_BLOCK_CENTER_Y;
  bullet.group.visible = false;
  scene.add(bullet.group);

  const playback = new Playback();
  const postFx = createPostFx(renderer, scene, camera);
  mountOverlay(overlay);

  const panel = mountControls(overlay, {
    initialRate: playback.rate,
    onRateChange: (rate) => (playback.rate = rate),
    onFire: () => {
      const timeline = simulateShot({
        ...SLICE_BULLET,
        startX: PREVIEW_BLOCK_FRONT_X - SLICE_STAND_OFF_M,
        targetFrontX: PREVIEW_BLOCK_FRONT_X,
        targetBackX: PREVIEW_BLOCK_BACK_X,
        medium: SLICE_GEL,
      });
      playback.start(timeline);
      bullet.group.visible = true;
    },
  });

  watchResize((width, height) => {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    postFx.setSize(width, height);
  });

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop((timestamp) => {
    timer.update(timestamp);
    // Cap the step so a slow frame doesn't skip a large chunk of the shot.
    const delta = Math.min(timer.getDelta(), 0.1);
    const frame = playback.update(delta);
    if (frame) {
      bullet.group.position.x = frame.x;
      bullet.setDiameter(frame.diameter);
      panel.setReadout(frame.t, frame.v);
    }

    controls.update();
    postFx.setFocus(camera.position.distanceTo(controls.target));
    postFx.render();
  });
}

bootstrap();
