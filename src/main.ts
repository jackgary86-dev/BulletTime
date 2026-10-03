import './style.css';
import * as THREE from 'three';
import { createRenderer, watchResize } from './scene/renderer';
import { createCameraRig } from './scene/camera';
import { TARGET_FRONT_X } from './models/targets';
import { Playback } from './sim/playback';
import { samplePrimary } from './sim/sample';
import { CameraDirector } from './scene/cameraDirector';
import { DEFAULT_BULLET_ID, getBullet, type BulletSpec } from './data/bullets';
import { DEFAULT_MEDIUM_ID } from './data/media';
import { mountOverlay } from './ui/overlay';
import { mountControls } from './ui/controls';
import { mountBulletSelector } from './ui/bulletSelector';
import { mountStackEditor, type TargetSetup } from './ui/stackEditor';
import { mountScrubber } from './ui/scrubber';
import { mountShotResults } from './ui/shotResults';
import { mountShotsPanel, type FirePlan } from './ui/shotsPanel';
import { mountComparePanel } from './ui/comparePanel';
import { mountCameraHud } from './ui/cameraHud';
import { physicsLayers } from './data/stacks';
import { faceLimits, Lane } from './lane';
import type { LightingMode } from './scene/studio';
import { initialQuality, QUALITY, saveQuality, type QualityLevel } from './scene/quality';
import type { Timeline } from './sim/types';
import { attachLoader } from './ui/loader';
import { contentGate } from './ui/contentWarning';
import { buildCues, CueTrack } from './audio/cues';
import { playSound, unlockAudio } from './audio/sounds';

/** Vertical field of view in comparison mode: each half is narrow, so pull the view wider. */
const COMPARE_FOV = 48;
/** Width of the left and right control columns, in CSS pixels. */
const SIDE_PANEL_PX = 316;

async function bootstrap(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
  const overlay = document.querySelector<HTMLElement>('#overlay');
  if (!canvas || !overlay) throw new Error('BulletTime: missing #viewport or #overlay element');

  // Nothing renders until the player has seen the mature-content warning (#109).
  await contentGate();
  await loader.progress(0.1, 'Starting the renderer');
  const renderer = createRenderer(canvas);
  const { camera, controls } = createCameraRig(canvas);
  const baseFov = camera.fov;

  const playback = new Playback();
  // Shot and impact sounds (#120), from lane A only: two lanes at once would just be noise.
  const cueTrack = new CueTrack();
  mountOverlay(overlay);

  const hud = mountCameraHud(overlay);
  const scrubber = mountScrubber(overlay, playback);
  const results = mountShotResults(overlay, 'lane-a');
  const resultsB = mountShotResults(overlay, 'lane-b');
  const shotsPanel = mountShotsPanel(overlay);
  const director = new CameraDirector(camera, controls, (mode) => panel.setCameraMode(mode));
  let lighting: LightingMode = 'lab';
  let quality: QualityLevel = initialQuality();
  /** Renderer-wide parts of the quality setting; each lane applies the rest. */
  const applyQuality = () => {
    const q = QUALITY[quality];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    renderer.shadowMap.enabled = q.shadowMapSize > 0;
    renderer.transmissionResolutionScale = q.transmissionScale;
    for (const lane of lanes()) lane.setQuality(q);
  };

  let spec = getBullet(DEFAULT_BULLET_ID);
  // Lane A is the main setup; lane B only exists while comparing (#14).
  let laneA: Lane | null = null;
  let laneB: Lane | null = null;
  const lanes = () => [laneA, laneB].filter((l): l is Lane => !!l);

  mountBulletSelector(overlay, {
    initialId: spec.id,
    // Switching rounds keeps the damage already in the target: the next shot just uses the new round.
    onChange: (next: BulletSpec) => {
      spec = next;
      if (laneA) laneA.spec = next;
    },
  });

  const clearShot = () => {
    for (const lane of lanes()) lane.clear();
    cueTrack.clear();
    shotsPanel.setSession(null);
    playback.stop();
    results.hide();
    resultsB.hide();
    scrubber.hide();
    panel.setHasShot(false);
  };

  const panel = mountControls(overlay, {
    initialRate: playback.rate,
    initialCamera: 'auto',
    initialQuality: quality,
    onRateChange: (rate) => (playback.rate = rate),
    onCameraChange: (mode) => director.setMode(mode),
    onLightingChange: (mode) => {
      lighting = mode;
      for (const lane of lanes()) lane.setLightingMode(mode);
    },
    onQualityChange: (level) => {
      quality = level;
      saveQuality(level);
      applyQuality();
      layout();
    },
    // Replays the last Fire: the last single shot, or the whole group or burst.
    onReplay: () => {
      if (!playback.timeline || !laneA) return;
      unlockAudio();
      playback.start(playback.timeline, laneA.lastFireStart);
      cueTrack.rewind(laneA.lastFireStart);
      scrubber.sync();
    },
    onReset: () => {
      clearShot();
      director.reset();
    },
    onFire: () => {
      if (!laneA) return;
      const plan = shotsPanel.plan();
      // Comparing: both lanes fire fresh from t = 0 so they stay in step.
      const timeline = laneA.fire(plan, !!laneB);
      results.setLabel(laneB ? `A · ${laneA.spec.name} ${laneA.spec.type}` : null);
      if (laneB) resultsB.setLabel(`B · ${laneB.spec.name} ${laneB.spec.type}`);
      results.show(timeline, laneA.setup.layers, physicsLayers(laneA.setup.layers), laneA.effects.organic);
      let clock: Timeline = timeline;
      if (laneB) {
        const b = laneB.fire(plan, true);
        resultsB.show(b, laneB.setup.layers, physicsLayers(laneB.setup.layers), laneB.effects.organic);
        // One clock for both: as long as the longer of the two shots.
        clock = { ...timeline, duration: Math.max(timeline.duration, b.duration) };
      }
      director.setTarget(new THREE.Vector3(TARGET_FRONT_X, laneA.lineY + plan.aimY, plan.aimZ), laneA.depth);
      unlockAudio();
      playback.start(clock, laneA.lastFireStart);
      cueTrack.load(buildCues(timeline, physicsLayers(laneA.setup.layers), getBullet), laneA.lastFireStart);
      scrubber.load(clock);
      shotsPanel.setSession(sessionSummary(timeline));
      panel.setHasShot(true);
    },
  });

  const rebuildTarget = (setup: TargetSetup) => {
    if (!laneA) return;
    laneA.setTarget(setup);
    const face = faceLimits(setup);
    shotsPanel.setLimits(face.y, face.z);
    director.setTarget(new THREE.Vector3(TARGET_FRONT_X, laneA.lineY, 0), laneA.depth);
    clearShot();
  };
  const target = mountStackEditor(overlay, { initialId: DEFAULT_MEDIUM_ID, onChange: rebuildTarget });
  await loader.progress(0.25, 'Building the lab');
  laneA = new Lane(renderer, camera, target, spec);
  rebuildTarget(target);
  director.reset();

  const size = { width: window.innerWidth, height: window.innerHeight };
  const layout = () => {
    const { width, height } = size;
    const comparing = !!laneB;
    renderer.setSize(width, height, false);
    const laneWidth = comparing ? Math.floor(width / 2) : width;
    camera.aspect = laneWidth / height;
    camera.fov = comparing ? COMPARE_FOV : baseFov;
    camera.updateProjectionMatrix();
    for (const lane of lanes()) {
      lane.postFx.composer.setPixelRatio(renderer.getPixelRatio());
      lane.postFx.setSize(laneWidth, height);
    }
    overlay.classList.toggle('comparing', comparing);
  };
  watchResize((width, height) => {
    size.width = width;
    size.height = height;
    layout();
  });

  const compare = mountComparePanel(overlay, { bulletId: DEFAULT_BULLET_ID, mediumId: DEFAULT_MEDIUM_ID }, {
    onToggle: (on) => {
      if (on) {
        laneB = new Lane(renderer, camera, compare.setup, compare.spec);
        laneB.setLightingMode(lighting);
        laneB.setQuality(QUALITY[quality]);
      } else if (laneB) {
        laneB.dispose();
        laneB = null;
      }
      clearShot();
      // Two full panels would cover both targets; start them folded to one line each.
      results.setFolded(on);
      resultsB.setFolded(on);
      layout();
    },
    onChange: (bSpec, bSetup) => {
      if (!laneB) return;
      laneB.spec = bSpec;
      laneB.setTarget(bSetup);
      clearShot();
    },
  });
  applyQuality();
  layout();

  await loader.progress(0.5, 'Compiling shaders');
  await warmUp(laneA, renderer, camera, shotsPanel.plan(), (fraction, text) => loader.progress(0.5 + 0.45 * fraction, text));
  director.intro();

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop((timestamp) => {
    timer.update(timestamp);
    // Cap the step so a slow frame doesn't skip a large chunk of the shot.
    const delta = Math.min(timer.getDelta(), 0.1);
    // Read before update: the frame that reaches the end of the shot stops playback but still plays its sounds.
    const advancing = playback.isPlaying;
    const t = playback.update(delta);
    if (t !== null && playback.timeline) {
      const primary = samplePrimary(playback.timeline, t);
      panel.setReadout(t, primary?.speed ?? 0);
      hud.set(t, playback.fps, playback.shutterS);
      scrubber.sync();
      results.update(t);
      if (laneB) resultsB.update(t);
      for (const sound of cueTrack.update(t, advancing)) playSound(sound);
    } else hud.hide();
    director.update(delta, t, playback.timeline);

    const { width, height } = size;
    const all = lanes();
    const laneWidth = all.length > 1 ? Math.floor(width / 2) : width;
    renderer.setScissorTest(all.length > 1);
    // The side panels cover the outer edge of each half, so slide each lane's view toward the middle.
    const slide = all.length > 1 && width > 900 ? Math.min(SIDE_PANEL_PX / 2, laneWidth / 4) : 0;
    all.forEach((lane, i) => {
      lane.update(t, camera, playback.shutterS);
      lane.postFx.setFocus(director.focusDistance);
      // Side by side: each lane draws into its own half of the canvas, through the same camera.
      renderer.setViewport(i * laneWidth, 0, laneWidth, height);
      renderer.setScissor(i * laneWidth, 0, laneWidth, height);
      if (slide) {
        // A wider virtual view, cropped: lane A shows its left part (scene shifted right), lane B its right part.
        camera.aspect = (laneWidth + 2 * slide) / height;
        camera.setViewOffset(laneWidth + 2 * slide, height, i === 0 ? 0 : 2 * slide, 0, laneWidth, height);
      }
      lane.postFx.render();
      if (slide) {
        camera.aspect = laneWidth / height;
        camera.clearViewOffset();
      }
    });
  });
  await loader.progress(1, 'Ready');
  loader.finish();
}

/**
 * Compiles every shader the lab and a first shot need while the loading screen
 * is up (#77), so the first Fire doesn't stall: the scene as built, then a
 * throwaway shot (bullet, cavity, particles, muzzle flash), then each
 * post-processing pass, by drawing a frame of each. The shot is cleared again,
 * just as Reset would.
 */
async function warmUp(
  lane: Lane,
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  plan: FirePlan,
  progress: (fraction: number, status: string) => Promise<void>,
): Promise<void> {
  await renderer.compileAsync(lane.scene, camera);
  await progress(0.4, 'Warming up effects');
  const timeline = lane.fire(plan, true);
  for (const t of [30e-6, timeline.impactTime + 150e-6]) {
    lane.update(t, camera, 1e-6);
    await renderer.compileAsync(lane.scene, camera);
    lane.postFx.render();
  }
  await progress(0.8, 'Preparing the first frame');
  lane.clear();
  lane.update(null, camera);
  lane.postFx.render();
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

const loader = attachLoader();
bootstrap().catch((error: unknown) => {
  console.error(error);
  loader.fail(`BulletTime couldn't start: ${error instanceof Error ? error.message : String(error)}. It needs a browser with WebGL 2.`);
});
