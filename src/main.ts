import './style.css';
import * as THREE from 'three';
import { createRenderer, watchResize } from './scene/renderer';
import { createCameraRig } from './scene/camera';
import { createStudio } from './scene/studio';
import { createPostFx } from './scene/postfx';
import { createTarget, disposeTarget, SHOT_Y, TARGET_FRONT_X } from './models/targets';
import { createBulletModel, disposeBulletModel } from './models/bullet';
import { simulateShot } from './sim/timeline';
import { Playback } from './sim/playback';
import { bulletMassKg, DEFAULT_BULLET_ID, getBullet, type BulletSpec } from './data/bullets';
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
  let bullet = createBulletModel(spec);
  const placeBullet = () => {
    bullet.group.position.set(TARGET_FRONT_X - STAND_OFF_M, SHOT_Y, 0);
    bullet.group.visible = false;
    scene.add(bullet.group);
  };
  placeBullet();

  mountBulletSelector(overlay, {
    initialId: spec.id,
    onChange: (next: BulletSpec) => {
      spec = next;
      scene.remove(bullet.group);
      disposeBulletModel(bullet);
      bullet = createBulletModel(spec);
      placeBullet();
      playback.stop();
    },
  });

  const panel = mountControls(overlay, {
    initialRate: playback.rate,
    onRateChange: (rate) => (playback.rate = rate),
    onFire: () => {
      const diameterM = spec.caliberMm / 1000;
      const { medium, thickness, angleDeg } = target;
      // Crude stand-in until the physics engine (#5): expanding rounds open to their full
      // ratio, and an angled target is a longer straight path through the material.
      const expands = spec.behaviour === 'expand' && spec.muzzleVelocityMs >= (spec.expansionThresholdMs ?? 0);
      const pathLength = thickness / Math.cos(THREE.MathUtils.degToRad(angleDeg));
      const timeline = simulateShot({
        massKg: bulletMassKg(spec),
        diameterM,
        muzzleVelocity: spec.muzzleVelocityMs,
        expandedDiameterM: expands ? diameterM * (spec.expansionRatio ?? 1) : diameterM,
        expansionDistanceM: 0.02,
        startX: TARGET_FRONT_X - STAND_OFF_M,
        targetFrontX: TARGET_FRONT_X,
        targetBackX: TARGET_FRONT_X + pathLength,
        medium,
      });
      playback.start(timeline);
      bullet.group.visible = true;
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
    bullet.group.visible = false;
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
