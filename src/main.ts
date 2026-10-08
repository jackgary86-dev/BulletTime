import './style.css';
import * as THREE from 'three';
import { createRenderer, viewSize, watchResize } from './scene/renderer';
import { createCameraRig } from './scene/camera';
import { TARGET_FRONT_X } from './models/targets';
import { Playback } from './sim/playback';
import { samplePrimary } from './sim/sample';
import { CameraDirector } from './scene/cameraDirector';
import { getBullet, type BulletSpec, type SimulatorId } from './data/bullets';
import { MODES, framingReach } from './data/modes';
import { siteForMode } from './data/sites';
import { mountWitnessPanel } from './ui/witnessPanel';
import { mountApproachPanel } from './ui/approachPanel';
import { blockFrontWorld } from './sim/witness';
import { DEFAULT_MEDIUM_ID } from './data/media';
import { mountOverlay } from './ui/overlay';
import { mountCleanFrame } from './ui/cleanFrame';
import { FIRST_SHOT, markFirstShotSeen, openWithShotNow } from './ui/firstShot';
import { isStill } from './scene/still';
import { ResolutionGovernor, displayFrameMs } from './scene/resolutionGovernor';
import { mountControls } from './ui/controls';
import { mountBulletSelector } from './ui/bulletSelector';
import { mountStackEditor, type TargetSetup } from './ui/stackEditor';
import { applyReplayLink, parseReplayLink } from './ui/replayLink';
import { showNotice } from './ui/notice';
import { mountScrubber } from './ui/scrubber';
import { mountShotResults } from './ui/shotResults';
import { mountShotsPanel, type FirePlan } from './ui/shotsPanel';
import { mountComparePanel } from './ui/comparePanel';
import { mountCameraHud } from './ui/cameraHud';
import { mountRangeGame } from './ui/rangeGame';
import { stageSetup } from './game/range';
import { physicsLayers } from './data/stacks';
import { faceLimits, Lane } from './lane';
import type { LightingMode } from './scene/studio';
import { initialQuality, QUALITY, saveQuality, type QualityLevel } from './scene/quality';
import type { Timeline } from './sim/types';
import { attachLoader } from './ui/loader';
import { contentGate } from './ui/contentWarning';
import { chooseSimulator } from './ui/launcher';
import { mountArmorLab } from './ui/armorLab';
import { loadImpactBeat, saveImpactBeat } from './ui/beatSetting';
import { buildCues, CueTrack, cueStretch } from './audio/cues';
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
  // A fresh player skips the launcher and sees one shot play itself first (#241).
  const firstShot = openWithShotNow();
  const choice = firstShot ? 'bullet' : await chooseSimulator();
  if (choice === 'armor') {
    // The Armor lab is a 2D teaching screen: no renderer, no lane.
    document.body.classList.add('mode-armor');
    mountArmorLab(overlay);
    loader.finish();
    document.body.dataset.ready = 'true';
    return;
  }
  const mode: SimulatorId = choice;
  const modeInfo = MODES[mode];
  document.body.classList.add(`mode-${mode}`);
  await loader.progress(0.1, 'Starting the renderer');
  // The display's own frame interval, before anything 3D draws: adaptive resolution aims at it on a display under 60 Hz (#332).
  const refreshMs = await displayFrameMs();
  const renderer = createRenderer(canvas);
  const { camera, controls } = createCameraRig(canvas);
  const baseFov = camera.fov;

  const playback = new Playback();
  playback.impactBeat = loadImpactBeat();
  // Shot and impact sounds (#120), from lane A only: two lanes at once would just be noise.
  const cueTrack = new CueTrack();
  mountOverlay(overlay, modeInfo.title);

  const hud = mountCameraHud(overlay);
  const scrubber = mountScrubber(overlay, playback);
  const results = mountShotResults(overlay, 'lane-a');
  const resultsB = mountShotResults(overlay, 'lane-b');
  const shotsPanel = mountShotsPanel(overlay);
  const director = new CameraDirector(camera, controls, (mode) => panel.setCameraMode(mode));
  // Shells, missiles and charges are tested outdoors on the proving ground (#231): see further, orbit wider.
  const site = siteForMode(mode);
  if (site === 'range') {
    director.setOutdoors(true);
    camera.far = 400;
    camera.updateProjectionMatrix();
    controls.maxDistance = 45;
  }
  let lighting: LightingMode = 'lab';
  let quality: QualityLevel = initialQuality();
  /** Renderer-wide parts of the quality setting; each lane applies the rest. */
  // Adaptive resolution (#332): never at Low, and never on a screenshot path, which must be the same every run.
  const governor = new ResolutionGovernor(Math.max(1000 / 60, refreshMs));
  const governed = () => quality !== 'low' && !isStill() && !new URLSearchParams(location.search).has('clean');
  const setPixelRatio = () => renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[quality].pixelRatio) * (governed() ? governor.scale : 1));
  const applyQuality = () => {
    const q = QUALITY[quality];
    governor.reset();
    setPixelRatio();
    renderer.shadowMap.enabled = q.shadowMapSize > 0;
    renderer.transmissionResolutionScale = q.transmissionScale;
    for (const lane of lanes()) lane.setQuality(q);
  };

  let spec = getBullet(modeInfo.defaultId);
  director.setReach(framingReach(spec));
  // Lane A is the main setup; lane B only exists while comparing (#14).
  let laneA: Lane | null = null;
  let laneB: Lane | null = null;
  const lanes = () => [laneA, laneB].filter((l): l is Lane => !!l);

  mountBulletSelector(overlay, {
    initialId: spec.id,
    mode,
    // Switching rounds keeps the damage already in the target: the next shot just uses the new round.
    onChange: (next: BulletSpec) => {
      spec = next;
      if (laneA) laneA.spec = next;
      director.setReach(framingReach(next));
    },
  });

  let witnessPanel: ReturnType<typeof mountWitnessPanel> | null = null;
  const clearShot = () => {
    for (const lane of lanes()) lane.clear();
    cueTrack.clear();
    shotsPanel.setSession(null);
    playback.stop();
    results.hide();
    resultsB.hide();
    scrubber.hide();
    panel.setHasShot(false);
    witnessPanel?.showResults(null);
  };

  /** Set while the first-launch shot plays (#241); the loop reveals the panels when it stops. */
  let revealAfterFirstShot = false;
  const revealPanels = () => {
    if (!document.body.classList.contains('first-shot')) return;
    document.body.classList.remove('first-shot');
    document.body.classList.add('first-shot-done');
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'first-shot-pick';
    pick.textContent = 'Pick a simulator';
    pick.addEventListener('click', () => location.assign(location.pathname));
    overlay.append(pick);
    window.setTimeout(() => pick.classList.add('fade'), 9000);
  };
  // A click or key during the first shot brings the panels in early.
  const revealEarly = () => {
    if (!revealAfterFirstShot) return;
    revealAfterFirstShot = false;
    revealPanels();
  };
  canvas.addEventListener('pointerdown', revealEarly);
  window.addEventListener('keydown', revealEarly);
  const cleanFrame = mountCleanFrame(overlay, new URLSearchParams(location.search).has('clean'));
  const panel = mountControls(overlay, {
    initialRate: playback.rate,
    initialImpactBeat: playback.impactBeat,
    initialCamera: 'side',
    initialQuality: quality,
    onRateChange: (rate) => (playback.rate = rate),
    onCleanFrame: () => cleanFrame.toggle(),
    onImpactBeatChange: (on) => {
      playback.impactBeat = on;
      saveImpactBeat(on);
      if (playback.timeline) scrubber.load(playback.timeline);
    },
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
    onFire: () => fireShot(shotsPanel.plan()),
  });

  /** Fires `plan` from lane A (and lane B when comparing) and starts the replay; returns lane A's timeline. */
  function fireShot(plan: FirePlan): Timeline | null {
    if (!laneA) return null;
    // Comparing: both lanes fire fresh from t = 0 so they stay in step.
    const timeline = laneA.fire(plan, !!laneB);
    const hit = laneA.approachHit;
    // A dive or bearing (#250) says which face it met and how obliquely.
    const faceName = hit ? (hit.face === 'top' ? (laneA.setup.layers[0]?.medium.id === 'tank-hull' ? 'Turret roof' : 'Roof') : hit.face === 'side' ? 'Side wall' : 'Front face') : '';
    results.setLabel(laneB ? `A · ${laneA.spec.name} ${laneA.spec.type}` : hit ? `${faceName}, ${Math.round(hit.obliquityDeg)}° from square on` : null);
    if (laneB) resultsB.setLabel(`B · ${laneB.spec.name} ${laneB.spec.type}`);
    results.show(timeline, laneA.setup.layers, physicsLayers(laneA.setup.layers), laneA.effects.organic);
    witnessPanel?.showResults(laneA.witnessResults.length ? laneA.witnessResults : null);
    let clock: Timeline = timeline;
    if (laneB) {
      const b = laneB.fire(plan, true);
      resultsB.show(b, laneB.setup.layers, physicsLayers(laneB.setup.layers), laneB.effects.organic);
      // One clock for both: as long as the longer of the two shots.
      clock = { ...timeline, duration: Math.max(timeline.duration, b.duration) };
    }
    director.setFrame(laneA.attackFrame.matrix);
    director.setAim(laneA.approachHit ? laneA.impactWorld : new THREE.Vector3(TARGET_FRONT_X, laneA.lineY + plan.aimY, plan.aimZ));
    unlockAudio();
    playback.start(clock, laneA.lastFireStart);
    cueTrack.load(buildCues(timeline, physicsLayers(laneA.setup.layers), getBullet), laneA.lastFireStart);
    scrubber.load(clock);
    shotsPanel.setSession(sessionSummary(timeline));
    panel.setHasShot(true);
    return timeline;
  }

  const syncWitness = () => {
    if (!laneA || !witnessPanel) return;
    const frame = laneA.witnessFrame;
    witnessPanel.setBuilding(laneA.building ?? null, frame?.roomM ?? 1);
    witnessPanel.setBlocks(laneA.witnessBlocks);
    // The inside view stands at the back of the room, off the shot line and a little up, looking at the breach.
    if (frame) {
      const from = blockFrontWorld({ distM: frame.roomM - 0.4, lateralM: 0.9 }, frame);
      const look = blockFrontWorld({ distM: 0, lateralM: 0 }, frame);
      director.setInside({ from: new THREE.Vector3(from.x, from.y + 0.5, from.z), look: new THREE.Vector3(look.x, look.y, look.z) });
    } else director.setInside(null);
  };
  const rebuildTarget = (setup: TargetSetup) => {
    if (!laneA) return;
    laneA.setTarget(setup);
    syncWitness();
    const face = faceLimits(setup);
    shotsPanel.setLimits(face.y, face.z);
    director.setTarget(laneA.impactWorld, laneA.depth, laneA.faceSpan);
    clearShot();
  };
  const startTargetId = modeInfo.defaultTargetId ?? DEFAULT_MEDIUM_ID;
  const target = mountStackEditor(overlay, { initialId: startTargetId, initialThicknessM: modeInfo.defaultTargetThicknessM, mode, onChange: rebuildTarget });
  await loader.progress(0.25, site === 'range' ? 'Building the proving ground' : 'Building the lab');
  // Gel witness blocks inside a mock building (#249), in the target panel; only the proving ground has buildings.
  const witnessHost = overlay.querySelector<HTMLElement>('.medium-panel');
  witnessPanel =
    site === 'range' && witnessHost
      ? mountWitnessPanel(witnessHost, {
          onChange: (blocks) => {
            laneA?.setWitnessBlocks(blocks);
            clearShot();
            syncWitness();
          },
          onInsideView: () => director.setMode('inside'),
        })
      : null;
  laneA = new Lane(renderer, camera, target, spec, undefined, site);
  // Missile approach (#250): dive and bearing, in the missile panel.
  const bulletHost = overlay.querySelector<HTMLElement>('.bullet-panel');
  const approachPanel =
    mode === 'missile' && bulletHost
      ? mountApproachPanel(bulletHost, (approach) => {
          if (!laneA) return;
          laneA.setApproach(approach);
          clearShot();
          director.setTarget(laneA.impactWorld, laneA.depth, laneA.faceSpan);
        })
      : null;
  rebuildTarget(target);
  director.reset();

  const [width0, height0] = viewSize(canvas);
  const size = { width: width0, height: height0 };
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
  watchResize(canvas, (width, height) => {
    size.width = width;
    size.height = height;
    layout();
  });

  /** Lane B's emptied scene, reused the next time Compare turns on (see Lane's constructor, #133). */
  let spareScene: THREE.Scene | undefined;
  const compare = mountComparePanel(overlay, { bulletId: modeInfo.defaultId, mediumId: startTargetId, thicknessM: modeInfo.defaultTargetThicknessM, mode }, {
    onToggle: (on) => {
      if (on) {
        laneB = new Lane(renderer, camera, compare.setup, compare.spec, spareScene, site);
        laneB.setLightingMode(lighting);
        laneB.setQuality(QUALITY[quality]);
      } else if (laneB) {
        laneB.dispose(laneA?.scene ?? null);
        spareScene = laneB.scene;
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
  // The range challenge (#151): a shot-placement game played on lane A.
  const app = document.querySelector<HTMLElement>('#app')!;
  let saved: { rate: number } | null = null;
  const range = mountRangeGame(app, {
    begin() {
      if (laneB) overlay.querySelector<HTMLButtonElement>('.compare-toggle')?.click();
      saved = { rate: playback.rate };
      playback.rate = 1 / 1000;
      overlay.classList.add('range-mode');
      director.setMode('auto');
    },
    setStage(stage) {
      if (!laneA) return 0.05;
      laneA.spec = getBullet(stage.bulletId);
      const setup = stageSetup(stage);
      laneA.setTarget(setup);
      clearShot();
      director.setTarget(new THREE.Vector3(TARGET_FRONT_X, laneA.lineY, 0), laneA.depth, laneA.faceSpan);
      const face = faceLimits(setup);
      // The scoring circle stays 1 cm inside the face, where the fire code keeps every shot.
      return Math.min(face.y, face.z) - 0.01;
    },
    fire(aimY, aimZ) {
      const timeline = fireShot({ ...shotsPanel.plan(), mode: 'single', aimY, aimZ })!;
      return timeline.shots.at(-1)!.summary;
    },
    replayDone: () => !playback.isPlaying,
    skipReplay() {
      playback.seek(playback.duration);
      scrubber.sync();
    },
    end() {
      overlay.classList.remove('range-mode');
      if (saved) playback.rate = saved.rate;
      saved = null;
      if (laneA) laneA.spec = spec;
      rebuildTarget(target);
      director.reset();
    },
  });
  overlay.querySelector('.compare-panel')?.prepend(range.entry);

  applyQuality();
  layout();

  await loader.progress(0.5, 'Compiling shaders');
  await warmUp(laneA, renderer, camera, shotsPanel.plan(), (fraction, text) => loader.progress(0.5 + 0.45 * fraction, text));
  // Still mode (#243) starts on the settled framing, so a screenshot never catches the opening glide.
  if (isStill()) director.reset();
  else director.intro();

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop((timestamp) => {
    timer.update(timestamp);
    // Cap the step so a slow frame doesn't skip a large chunk of the shot.
    // Never negative: after a long stall (shaders compiling for a new target) the frame timestamps can
    // step backwards, and a negative step blows up the camera spring into NaN.
    const rawDelta = timer.getDelta();
    const delta = Math.max(0, Math.min(rawDelta, 0.1));
    // A frame that ran slow or fast steps the render scale (#332); the raw time, so a stall reads as one.
    if (governed() && governor.frame(rawDelta * 1000)) {
      setPixelRatio();
      layout();
    }
    // Read before update: the frame that reaches the end of the shot stops playback but still plays its sounds.
    const advancing = playback.isPlaying;
    // While a shot plays only the two readouts sit over the scene; the results come in when it stops (#239).
    overlay.classList.toggle('shot-playing', advancing);
    if (revealAfterFirstShot && !advancing && playback.timeline) {
      revealAfterFirstShot = false;
      revealPanels();
    }
    const t = playback.update(delta);
    if (t !== null && playback.timeline) {
      const primary = samplePrimary(playback.timeline, t);
      panel.setReadout(t, primary?.speed ?? 0);
      hud.set(t, primary?.speed ?? 0);
      scrubber.sync();
      results.update(t);
      if (laneB) resultsB.update(t);
      for (const sound of cueTrack.update(t, advancing)) playSound(sound, cueStretch(sound, playback.beat));
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

  // A replay link (#230): fire the chosen setup and park the replay a set time after first contact.
  const link = parseReplayLink(location.search);
  if (link && !laneB) {
    const ignored = applyReplayLink(overlay, link);
    if (ignored.length) showNotice(`${modeInfo.title} does not list ${ignored.join(', ')}, so the default setup is used.`);
    if (link.witness && laneA) {
      laneA.setWitnessBlocks(link.witness);
      syncWitness();
    }
    if (link.approach && laneA && approachPanel) {
      approachPanel.set(link.approach);
      laneA.setApproach(approachPanel.get());
      director.setTarget(laneA.impactWorld, laneA.depth, laneA.faceSpan);
    }
    const timeline = fireShot(shotsPanel.plan());
    if (timeline) {
      playback.seek((timeline.shots[0]?.impactTime ?? 0) + link.atS);
      scrubber.sync();
    }
  }
  // First launch (#241): fire the fixed shot with every panel hidden; they come in once it lands.
  if (firstShot && !link && !laneB) {
    document.body.classList.add('first-shot');
    applyReplayLink(overlay, { atS: 0, bullet: FIRST_SHOT.bullet, medium: FIRST_SHOT.medium });
    fireShot(shotsPanel.plan());
    markFirstShotSeen();
    revealAfterFirstShot = true;
  }
  // A replay link may change the target and round after start-up, which re-frames the view: snap to it in still mode.
  if (isStill()) director.reset();
  // A replay link's camera (#261): a close-up for thin sheets that are a few pixels across from the side.
  if (link?.view && !laneB) director.resetTo(link.view);
  // Tells a screenshot run (#243) the scene is built and any replay link is parked.
  document.body.dataset.ready = 'true';
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
