import * as THREE from 'three';
import { getRegion } from './data/dummy';
import { STANDARD_RESOLUTION, ULTRA_RESOLUTION } from './data/physics';
import { clampAimToObjects, shapeLayers } from './data/objects';
import { physicsLayers, stackDepth } from './data/stacks';
import { getBullet, type BulletSpec } from './data/bullets';
import { MuzzleEffect } from './fx/muzzle';
import { ShotRenderer } from './fx/shotRenderer';
import type { BurstSpec } from './fx/particles';
import { TargetEffects } from './fx/targetEffects';
import { addVapourTrails } from './fx/wake';
import { createDummy } from './models/dummy';
import { createTargetStack, disposeTarget, SHOT_Y, TARGET_FRONT_X } from './models/targets';
import { disposeTree } from './scene/dispose';
import { flashExposure, HIGHSPEED_GRADE, LAB_GRADE } from './scene/gradePass';
import { createPostFx, type PostFx } from './scene/postfx';
import { QUALITY, type QualitySettings } from './scene/quality';
import { createStudio, type LightingMode, type Studio } from './scene/studio';
import { simulate } from './sim/engine';
import { seededRandom } from './sim/random';
import { activeShot, appendShot, priorDamage, SHOT_GAP_S } from './sim/session';
import { patternSeed, roundOffsets } from './sim/firePattern';
import type { Timeline } from './sim/types';
import { hasMuzzle } from './data/modes';
import type { FirePlan } from './ui/shotsPanel';
import type { TargetSetup } from './ui/stackEditor';

/** The bullet starts this far in front of the target face, in metres. */
export const STAND_OFF_M = 0.5;
/** Playback may run this much past the physics so impact effects can settle, in seconds. */
const EFFECT_TAIL_S = 8e-3;
/** In group fire, each round leaves this long after the previous one has finished, in seconds. */
const GROUP_GAP_S = 1e-3;

/**
 * One shooting lane: its own studio scene, target, round, shot session and
 * effects. The app normally has one; comparison mode (#14) runs a second lane
 * beside it on the same clock and camera.
 */
export class Lane {
  readonly scene: THREE.Scene;
  readonly studio: Studio;
  readonly postFx: PostFx;
  readonly shot = new ShotRenderer();
  readonly effects = new TargetEffects();
  readonly muzzle = new MuzzleEffect();
  /** Every shot fired since the last Reset, on one timeline (#22). */
  session: Timeline | null = null;
  /** Where the last Fire starts on the session timeline. */
  lastFireStart = 0;
  private targetGroup: THREE.Group | null = null;
  private lighting: LightingMode = 'lab';
  private quality: QualitySettings = QUALITY.medium;

  /**
   * `scene` lets a new lane reuse the emptied scene of a disposed one: the
   * renderer keeps per-scene buffers it never frees (the transmission pass that
   * draws gel and glass), so a fresh scene each time would leak them (#133).
   */
  constructor(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    public setup: TargetSetup,
    public spec: BulletSpec,
    scene: THREE.Scene = new THREE.Scene(),
  ) {
    this.scene = scene;
    this.studio = createStudio(this.scene, renderer);
    this.postFx = createPostFx(renderer, this.scene, camera);
    this.muzzle.setPosition(new THREE.Vector3(TARGET_FRONT_X - STAND_OFF_M, SHOT_Y, 0));
    this.scene.add(this.muzzle.group, this.shot.group, this.effects.group);
    this.setTarget(setup);
  }

  get lineY(): number {
    return shotLineY(this.setup);
  }

  /** Largest face dimension in the target, in metres, for framing. */
  get faceSpan(): number {
    return Math.max(0.3, ...this.setup.layers.map((l) => Math.max(l.medium.heightM, l.medium.widthM)));
  }

  get depth(): number {
    return stackDepth(this.setup.layers);
  }

  setTarget(setup: TargetSetup): void {
    this.setup = setup;
    if (this.targetGroup) {
      this.scene.remove(this.targetGroup);
      disposeTarget(this.targetGroup);
    }
    this.targetGroup = setup.dummy ? createDummy(setup.dummy) : createTargetStack(setup.layers, setup.angleDeg);
    this.scene.add(this.targetGroup);
    this.studio.fitContactShadow(this.targetGroup);
    this.clear();
  }

  setLightingMode(mode: LightingMode): void {
    this.lighting = mode;
    this.studio.setLightingMode(mode);
    this.postFx.grade.setGrade(mode === 'highspeed' ? HIGHSPEED_GRADE : LAB_GRADE);
    this.applyPostFx();
  }

  /** Particle budget, post-processing and shadows for a quality level (#16). New shots use the new particle budget. */
  setQuality(quality: QualitySettings): void {
    this.quality = quality;
    this.shot.setQuality(quality);
    this.effects.particles.density = quality.particleDensity;
    this.effects.particles.capScale = quality.particleCap;
    this.studio.setShadowMapSize(Math.max(quality.shadowMapSize, 256));
    this.applyPostFx();
    // Shadow on/off changes the shaders every lit material needs.
    this.scene.traverse((obj) => {
      const material = (obj as THREE.Mesh).material;
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.needsUpdate = true;
    });
  }

  private applyPostFx(): void {
    // A bright scene would bloom everywhere; keep bloom for genuinely hot highlights.
    this.postFx.bloom.enabled = this.quality.bloom && this.lighting !== 'highspeed';
    this.postFx.depthOfField.enabled = this.quality.depthOfField;
    this.postFx.ambientOcclusion.enabled = this.quality.ambientOcclusion;
    // Without real shadows or occlusion, a baked soft shadow keeps the target on the floor.
    this.studio.contactShadow.visible = !this.quality.ambientOcclusion && this.quality.shadowMapSize === 0;
  }

  clear(): void {
    this.session = null;
    this.lastFireStart = 0;
    this.shot.clear();
    this.effects.clear();
  }

  /**
   * Fires the plan (one round, a group or a burst) and returns the session
   * timeline. `fresh` starts a new session at t = 0 instead of adding to it.
   */
  fire(plan: FirePlan, fresh = false): Timeline {
    if (fresh) this.clear();
    const { angleDeg } = this.setup;
    const layers = physicsLayers(this.setup.layers);
    const face = faceLimits(this.setup);
    const lineY = this.lineY;
    const offsets = roundOffsets(plan.mode, plan.count, plan.spreadM, seededRandom(patternSeed(plan.mode, this.session?.shots.length ?? 0)));
    const limitY = face.y - 0.01;
    const limitZ = face.z - 0.01;
    const fireStart = this.session ? this.session.duration + SHOT_GAP_S : 0;
    let offset = fireStart;
    offsets.forEach((o, i) => {
      // A group scatters round the aim point; a burst climbs with recoil (#153). Every round stays on the face.
      // Round objects (#156) keep the shot inside their outline, and the bullet crosses the chord at that point.
      const { y, z } = clampAimToObjects(
        this.setup.layers,
        Math.max(-limitY, Math.min(limitY, plan.aimY + o.y)),
        Math.max(-limitZ, Math.min(limitZ, plan.aimZ + o.z)),
      );
      const part = simulate({
        bullet: this.spec,
        layers: shapeLayers(layers, y, z),
        angleDeg,
        impactPoint: { x: TARGET_FRONT_X, y: lineY + y, z },
        standOffM: this.spec.standoffM ?? STAND_OFF_M,
        damage: priorDamage(this.session),
        resolution: this.quality.fineSimulation ? ULTRA_RESOLUTION : STANDARD_RESOLUTION,
      });
      // Stored relative to the bench shot line, so the muzzle can follow it.
      part.shots[0].aim = { y: lineY - SHOT_Y + y, z };
      this.session = appendShot(this.session, part, offset);
      offset = plan.mode === 'burst' ? fireStart + ((i + 1) * 60) / plan.rpm : offset + part.duration + GROUP_GAP_S;
    });
    const timeline = this.session!;
    this.lastFireStart = fireStart;
    this.shot.load(timeline, this.setup.layers[0]?.medium.hardness);
    if (this.targetGroup) this.effects.load(timeline, this.targetGroup, layers, angleDeg);
    if (hasMuzzle(this.spec)) for (const shot of timeline.shots) this.effects.particles.add(muzzleSmoke(shot.start, shot.aim));
    addVapourTrails(timeline, this.effects.particles);
    // Let the dust settle before the shot ends, so the final frame shows the holes and craters.
    timeline.duration = Math.max(timeline.duration, Math.min(this.effects.endTime, timeline.duration + EFFECT_TAIL_S));
    return timeline;
  }

  /**
   * Frees everything this lane put on the GPU (lane B going away, #133): its
   * scene, shadow map and post-processing, except what `keep` (lane A's scene)
   * shares with it.
   */
  dispose(keep: THREE.Object3D | null = null): void {
    this.clear();
    this.shot.dispose();
    if (this.targetGroup) disposeTarget(this.targetGroup);
    this.targetGroup = null;
    disposeTree(this.scene, keep);
    for (const pass of this.postFx.composer.passes) pass.dispose();
    this.postFx.composer.dispose();
    // Empty the scene so the next lane can reuse it.
    this.scene.clear();
  }

  /** Advances the shot, effects and muzzle flash to sim time `t` (null when nothing is playing). */
  update(t: number | null, camera: THREE.Camera, shutterS = 0): void {
    const timeline = t !== null ? this.session : null;
    if (timeline && t !== null) {
      this.shot.update(t, shutterS);
      this.effects.update(t, shutterS);
    }
    // The muzzle flash belongs to whichever shot is playing, at that shot's aim point.
    const current = timeline && t !== null ? activeShot(timeline, t) : null;
    const flash = current && hasMuzzle(getBullet(current.bulletId)) ? current : null;
    if (flash) this.muzzle.setPosition(new THREE.Vector3(TARGET_FRONT_X - STAND_OFF_M, SHOT_Y + flash.aim.y, flash.aim.z));
    this.muzzle.update(flash && t !== null ? t - flash.start : null, camera);
    const { shockwave } = this.postFx;
    // A detonation's blast front takes over from the muzzle shell while it is passing.
    const blast = timeline && t !== null ? blastShock(timeline.events, t) : null;
    const shock = blast ?? this.muzzle.shock;
    shockwave.enabled = shock.strength > 0;
    shockwave.center.copy(shock.center);
    shockwave.radius = shock.radius;
    shockwave.strength = shock.strength;
    this.postFx.grade.setFlash(current && t !== null ? flashExposure(t - current.start, shutterS) : 0);
  }
}

/** The blast front of the detonation playing at sim time `t`, as a shell for the shockwave pass, or null. */
const BLAST_SHOCK_END_S = 12e-3;
const blastCenter = new THREE.Vector3();
function blastShock(events: Timeline['events'], t: number): { center: THREE.Vector3; radius: number; strength: number } | null {
  for (const e of events) {
    if (e.type !== 'detonate' || e.yieldKg === undefined || t < e.t) continue;
    const since = t - e.t;
    if (since > BLAST_SHOCK_END_S) continue;
    const w = Math.cbrt(Math.max(0.01, e.yieldKg));
    // Fast and strong at first (several times the speed of sound), then slowing to it as it weakens.
    const radius = Math.max(1e-4, 343 * since * (1 + 2.5 * Math.exp(-since / (1.5e-3 * Math.max(0.5, w)))));
    // A charge in the open sends a stronger front than a shell bursting on a face.
    const gain = e.pressureKPa !== undefined ? 0.4 : 0.25;
    const strength = Math.min(1, gain * w) * (1 - since / BLAST_SHOCK_END_S) ** 2 / (1 + radius / (0.6 * w));
    blastCenter.set(e.pos.x, e.pos.y, e.pos.z);
    return { center: blastCenter, radius, strength };
  }
  return null;
}

/** The grey puff of powder smoke that rolls out of the barrel behind the flash (#63, #65). */
function muzzleSmoke(start: number, aim: { y: number; z: number }): BurstSpec {
  return {
    look: 'dust',
    t0: start + 60e-6,
    duration: 600e-6,
    origin: new THREE.Vector3(TARGET_FRONT_X - STAND_OFF_M + 0.01, SHOT_Y + aim.y, aim.z),
    originJitter: 0.008,
    axis: new THREE.Vector3(1, 0, 0),
    spread: 0.7,
    count: 30,
    speed: [3, 25],
    size: [0.012, 0.03],
    life: [3e-3, 8e-3],
    drag: 250,
    gravity: 0,
    color: 0x9a9893,
    colorJitter: 0.2,
    grow: 4,
  };
}

/** Height of the shot line: the usual bench height, or the dummy region being shot. */
export function shotLineY(setup: TargetSetup): number {
  return setup.dummy ? getRegion(setup.dummy).shotY : SHOT_Y;
}

/** Half-height and half-width that every layer covers, so an aimed shot hits the whole stack. */
export function faceLimits(setup: TargetSetup): { y: number; z: number } {
  // The dummy's layers are anatomy, not slabs: keep the aim inside the region (the fire code keeps 1 cm clear).
  if (setup.dummy) {
    const { aim } = getRegion(setup.dummy);
    return { y: aim.y + 0.01, z: aim.z + 0.01 };
  }
  return {
    y: Math.min(...setup.layers.map((l) => l.medium.heightM / 2)),
    z: Math.min(...setup.layers.map((l) => l.medium.widthM / 2)),
  };
}
