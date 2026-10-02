import './style.css';
import * as THREE from 'three';
import { createRenderer, watchResize } from './scene/renderer';
import { createCameraRig } from './scene/camera';
import { createStudio } from './scene/studio';
import { createPostFx } from './scene/postfx';
import { createTargetStand } from './models/targetStand';
import { mountOverlay } from './ui/overlay';

function bootstrap(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
  const overlay = document.querySelector<HTMLElement>('#overlay');
  if (!canvas || !overlay) throw new Error('BulletTime: missing #viewport or #overlay element');

  const renderer = createRenderer(canvas);
  const scene = new THREE.Scene();
  const { camera, controls } = createCameraRig(canvas);
  createStudio(scene, renderer);
  scene.add(createTargetStand());

  const postFx = createPostFx(renderer, scene, camera);
  mountOverlay(overlay);

  watchResize((width, height) => {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    postFx.setSize(width, height);
  });

  renderer.setAnimationLoop(() => {
    controls.update();
    postFx.setFocus(camera.position.distanceTo(controls.target));
    postFx.render();
  });
}

bootstrap();
