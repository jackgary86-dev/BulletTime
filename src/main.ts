import './style.css';
import * as THREE from 'three';
import { createRenderer, watchResize } from './scene/renderer';
import { createCameraRig } from './scene/camera';
import { createStudio } from './scene/studio';
import { createPostFx } from './scene/postfx';
import { createTarget, disposeTarget, SHOT_Y, TARGET_FRONT_X } from './models/targets';
import { layersFor, simulate } from './sim/engine';
import { Playback } from './sim/playback';
import { samplePrimary } from './sim/sample';
import { ShotRenderer } from './fx/shotRenderer';
import { DEFAULT_BULLET_ID, getBullet, type BulletSpec } from './data/bullets';
import { DEFAULT_MEDIUM_ID } from './data/media';
import { mountOverlay } from './ui/overlay';
import { mountControls } from './ui/controls';
import { mountBulletSelector } from './ui/bulletSelector';
import { mountMediumSelector, type TargetSetup } from './ui/mediumSelector';

/** The bullet starts this far in front of the target face, in metres. */
const STAND_OFF_M = 0.5;

function bootstrap(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
  const overlay = document.querySelector<HTMLElement>('#overlay');
  if (!canvas || !overlay) throw new Error('BulletTime: missing #viewport or #overlay element');

  const renderer = createRenderer(canvas);
  const scene = new THREE.Scene();
  const { camera, controls } = createCameraRig(canvas);
  createStudio(scene, renderer);

  const playback = new Playback();
  const postFx = createPostFx(renderer, scene, camera);
  mountOverlay(overlay);

  let spec = getBullet(DEFAULT_BULLET_ID);
  const shot = new ShotRenderer();
  scene.add(shot.group);

  mountBulletSelector(overlay, {
    initialId: spec.id,
    onChange: (next: BulletSpec) => {
      spec = next;
      playback.stop();
      shot.clear();
    },
  });

  const panel = mountControls(overlay, {
    initialRate: playback.rate,
    onRateChange: (rate) => (playback.rate = rate),
    onFire: () => {
      const { medium, thickness, angleDeg } = target;
      const timeline = simulate({
        bullet: spec,
        layers: layersFor(medium, thickness),
        angleDeg,
        impactPoint: { x: TARGET_FRONT_X, y: SHOT_Y, z: 0 },
        standOffM: STAND_OFF_M,
      });
      shot.load(timeline, spec);
      playback.start(timeline);
    },
  });

  let targetGroup: THREE.Group | null = null;
  const rebuildTarget = (setup: TargetSetup) => {
    if (targetGroup) {
      scene.remove(targetGroup);
      disposeTarget(targetGroup);
    }
    targetGroup = createTarget(setup.medium, setup.thickness, setup.angleDeg);
    scene.add(targetGroup);
    playback.stop();
    shot.clear();
  };
  const target = mountMediumSelector(overlay, { initialId: DEFAULT_MEDIUM_ID, onChange: rebuildTarget });
  rebuildTarget(target);

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
    const t = playback.update(delta);
    if (t !== null && playback.timeline) {
      shot.update(t);
      const primary = samplePrimary(playback.timeline, t);
      panel.setReadout(t, primary?.speed ?? 0);
    }

    controls.update();
    postFx.setFocus(camera.position.distanceTo(controls.target));
    postFx.render();
  });
}

bootstrap();
