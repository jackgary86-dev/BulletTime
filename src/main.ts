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
import { MuzzleEffect } from './fx/muzzle';
import { TargetEffects } from './fx/targetEffects';
import { CameraDirector } from './scene/cameraDirector';
import { DEFAULT_BULLET_ID, getBullet, type BulletSpec } from './data/bullets';
import { DEFAULT_MEDIUM_ID } from './data/media';
import { mountOverlay } from './ui/overlay';
import { mountControls } from './ui/controls';
import { mountBulletSelector } from './ui/bulletSelector';
import { mountMediumSelector, type TargetSetup } from './ui/mediumSelector';
import { mountScrubber } from './ui/scrubber';

/** The bullet starts this far in front of the target face, in metres. */
const STAND_OFF_M = 0.5;

function bootstrap(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
  const overlay = document.querySelector<HTMLElement>('#overlay');
  if (!canvas || !overlay) throw new Error('BulletTime: missing #viewport or #overlay element');

  const renderer = createRenderer(canvas);
  const scene = new THREE.Scene();
  const { camera, controls } = createCameraRig(canvas);
  const studio = createStudio(scene, renderer);

  const playback = new Playback();
  const postFx = createPostFx(renderer, scene, camera);
  mountOverlay(overlay);

  const scrubber = mountScrubber(overlay, playback);
  const director = new CameraDirector(camera, controls, (mode) => panel.setCameraMode(mode));
  const muzzle = new MuzzleEffect();
  muzzle.setPosition(new THREE.Vector3(TARGET_FRONT_X - STAND_OFF_M, SHOT_Y, 0));
  scene.add(muzzle.group);

  let spec = getBullet(DEFAULT_BULLET_ID);
  const shot = new ShotRenderer();
  scene.add(shot.group);
  const effects = new TargetEffects();
  scene.add(effects.group);

  mountBulletSelector(overlay, {
    initialId: spec.id,
    onChange: (next: BulletSpec) => {
      spec = next;
      clearShot();
    },
  });

  const clearShot = () => {
    playback.stop();
    shot.clear();
    effects.clear();
    scrubber.hide();
    panel.setHasShot(false);
  };

  const panel = mountControls(overlay, {
    initialRate: playback.rate,
    initialCamera: 'auto',
    onRateChange: (rate) => (playback.rate = rate),
    onCameraChange: (mode) => director.setMode(mode),
    onLightingChange: (mode) => {
      studio.setLightingMode(mode);
      // A bright scene would bloom everywhere; keep bloom for genuinely hot highlights.
      postFx.bloom.enabled = mode !== 'highspeed';
    },
    onReplay: () => {
      if (!playback.timeline) return;
      playback.start(playback.timeline);
      scrubber.sync();
    },
    onReset: () => {
      clearShot();
      director.reset();
    },
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
      if (targetGroup) effects.load(timeline, targetGroup, [medium]);
      playback.start(timeline);
      scrubber.load(timeline);
      panel.setHasShot(true);
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
    director.setTarget(new THREE.Vector3(TARGET_FRONT_X, SHOT_Y, 0), setup.thickness);
    clearShot();
  };
  const target = mountMediumSelector(overlay, { initialId: DEFAULT_MEDIUM_ID, onChange: rebuildTarget });
  rebuildTarget(target);
  director.reset();

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
      effects.update(t);
      const primary = samplePrimary(playback.timeline, t);
      panel.setReadout(t, primary?.speed ?? 0);
      scrubber.sync();
    }

    director.update(delta, t, playback.timeline);
    muzzle.update(t, camera);
    postFx.setFocus(director.focusDistance);
    postFx.render();
  });
}

bootstrap();
