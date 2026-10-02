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
import { mountOrganicReadout } from './ui/organicReadout';
import { mountShotsPanel } from './ui/shotsPanel';
import { activeShot, appendShot, priorDamage, SHOT_GAP_S } from './sim/session';
import { seededRandom } from './sim/random';
import type { Timeline } from './sim/types';

/** The bullet starts this far in front of the target face, in metres. */
const STAND_OFF_M = 0.5;
/** Playback may run this much past the physics so impact effects can settle, in seconds. */
const EFFECT_TAIL_S = 8e-3;
/** In group fire, each round leaves this long after the previous one has finished, in seconds. */
const GROUP_GAP_S = 1e-3;

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
  const organic = mountOrganicReadout(overlay);
  const shotsPanel = mountShotsPanel(overlay);
  /** Every shot fired since the last Reset, on one timeline (#22). */
  let session: Timeline | null = null;
  let lastFireStart = 0;
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
    // Switching rounds keeps the damage already in the target: the next shot just uses the new round.
    onChange: (next: BulletSpec) => {
      spec = next;
    },
  });

  const clearShot = () => {
    session = null;
    shotsPanel.setSession(null);
    playback.stop();
    shot.clear();
    effects.clear();
    organic.hide();
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
    // Replays the last Fire: the last single shot, or the whole group or burst.
    onReplay: () => {
      if (!playback.timeline) return;
      playback.start(playback.timeline, lastFireStart);
      scrubber.sync();
    },
    onReset: () => {
      clearShot();
      director.reset();
    },
    onFire: () => {
      const { medium, thickness, angleDeg } = target;
      const layers = layersFor(medium, thickness);
      const plan = shotsPanel.plan();
      const rounds = plan.mode === 'single' ? 1 : plan.count;
      const rand = seededRandom(9001 + (session?.shots.length ?? 0));
      const limitY = medium.heightM / 2 - 0.01;
      const limitZ = medium.widthM / 2 - 0.01;
      const fireStart = session ? session.duration + SHOT_GAP_S : 0;
      let offset = fireStart;
      for (let i = 0; i < rounds; i++) {
        // Groups and bursts scatter around the aim point, uniformly over a disc of the spread radius.
        const r = plan.mode === 'single' ? 0 : plan.spreadM * Math.sqrt(rand());
        const a = rand() * Math.PI * 2;
        const y = Math.max(-limitY, Math.min(limitY, plan.aimY + r * Math.sin(a)));
        const z = Math.max(-limitZ, Math.min(limitZ, plan.aimZ + r * Math.cos(a)));
        const part = simulate({
          bullet: spec,
          layers,
          angleDeg,
          impactPoint: { x: TARGET_FRONT_X, y: SHOT_Y + y, z },
          standOffM: STAND_OFF_M,
          damage: priorDamage(session),
        });
        part.shots[0].aim = { y, z };
        session = appendShot(session, part, offset);
        offset = plan.mode === 'burst' ? fireStart + ((i + 1) * 60) / plan.rpm : offset + part.duration + GROUP_GAP_S;
      }
      const timeline = session!;
      lastFireStart = fireStart;
      shot.load(timeline);
      if (targetGroup) effects.load(timeline, targetGroup, layers, angleDeg);
      if (effects.organic) organic.show(effects.organic);
      else organic.hide();
      // Let the dust settle before the shot ends, so the final frame shows the holes and craters.
      timeline.duration = Math.max(timeline.duration, Math.min(effects.endTime, timeline.duration + EFFECT_TAIL_S));
      director.setTarget(new THREE.Vector3(TARGET_FRONT_X, SHOT_Y + plan.aimY, plan.aimZ), thickness);
      playback.start(timeline, fireStart);
      scrubber.load(timeline);
      shotsPanel.setSession(sessionSummary(timeline));
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
    shotsPanel.setLimits(setup.medium.heightM / 2, setup.medium.widthM / 2);
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
    // The muzzle flash belongs to whichever shot is playing, at that shot's aim point.
    const current = t !== null && playback.timeline ? activeShot(playback.timeline, t) : null;
    if (current) muzzle.setPosition(new THREE.Vector3(TARGET_FRONT_X - STAND_OFF_M, SHOT_Y + current.aim.y, current.aim.z));
    muzzle.update(current && t !== null ? t - current.start : null, camera);
    postFx.setFocus(director.focusDistance);
    postFx.render();
  });
}

/** Totals for the shots panel: shots fired, energy delivered and the group size (widest spread of impacts). */
function sessionSummary(timeline: Timeline) {
  let groupM = 0;
  for (const a of timeline.shots)
    for (const b of timeline.shots) groupM = Math.max(groupM, Math.hypot(a.aim.y - b.aim.y, a.aim.z - b.aim.z));
  return {
    shots: timeline.shots.length,
    energyJ: timeline.shots.reduce((sum, s) => sum + s.summary.impactEnergyJ, 0),
    groupM,
  };
}

bootstrap();
