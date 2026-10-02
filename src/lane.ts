import * as THREE from 'three';
import { getRegion } from './data/dummy';
import { physicsLayers, stackDepth } from './data/stacks';
import type { BulletSpec } from './data/bullets';
import { MuzzleEffect } from './fx/muzzle';
import { ShotRenderer } from './fx/shotRenderer';
import { TargetEffects } from './fx/targetEffects';
import { createDummy } from './models/dummy';
import { createTargetStack, disposeTarget, SHOT_Y, TARGET_FRONT_X } from './models/targets';
import { createPostFx, type PostFx } from './scene/postfx';
import { QUALITY, type QualitySettings } from './scene/quality';
import { createStudio, type LightingMode, type Studio } from './scene/studio';
import { simulate } from './sim/engine';
import { seededRandom } from './sim/random';
import { activeShot, appendShot, priorDamage, SHOT_GAP_S } from './sim/session';
import type { Timeline } from './sim/types';
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
  readonly scene = new THREE.Scene();
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

  constructor(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    public setup: TargetSetup,
    public spec: BulletSpec,
  ) {
    this.studio = createStudio(this.scene, renderer);
    this.postFx = createPostFx(renderer, this.scene, camera);
    this.muzzle.setPosition(new THREE.Vector3(TARGET_FRONT_X - STAND_OFF_M, SHOT_Y, 0));
    this.scene.add(this.muzzle.group, this.shot.group, this.effects.group);
    this.setTarget(setup);
  }

  get lineY(): number {
    return shotLineY(this.setup);
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
    this.clear();
  }

  setLightingMode(mode: LightingMode): void {
    this.lighting = mode;
    this.studio.setLightingMode(mode);
    this.applyPostFx();
  }

  /** Particle budget, post-processing and shadows for a quality level (#16). New shots use the new particle budget. */
  setQuality(quality: QualitySettings): void {
    this.quality = quality;
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
    const rounds = plan.mode === 'single' ? 1 : plan.count;
    const rand = seededRandom(9001 + (this.session?.shots.length ?? 0));
    const limitY = face.y - 0.01;
    const limitZ = face.z - 0.01;
    const fireStart = this.session ? this.session.duration + SHOT_GAP_S : 0;
    let offset = fireStart;
    for (let i = 0; i < rounds; i++) {
      // Groups and bursts scatter around the aim point, uniformly over a disc of the spread radius.
      const r = plan.mode === 'single' ? 0 : plan.spreadM * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      const y = Math.max(-limitY, Math.min(limitY, plan.aimY + r * Math.sin(a)));
      const z = Math.max(-limitZ, Math.min(limitZ, plan.aimZ + r * Math.cos(a)));
      const part = simulate({
        bullet: this.spec,
        layers,
        angleDeg,
        impactPoint: { x: TARGET_FRONT_X, y: lineY + y, z },
        standOffM: STAND_OFF_M,
        damage: priorDamage(this.session),
      });
      // Stored relative to the bench shot line, so the muzzle can follow it.
      part.shots[0].aim = { y: lineY - SHOT_Y + y, z };
      this.session = appendShot(this.session, part, offset);
      offset = plan.mode === 'burst' ? fireStart + ((i + 1) * 60) / plan.rpm : offset + part.duration + GROUP_GAP_S;
    }
    const timeline = this.session!;
    this.lastFireStart = fireStart;
    this.shot.load(timeline);
    if (this.targetGroup) this.effects.load(timeline, this.targetGroup, layers, angleDeg);
    // Let the dust settle before the shot ends, so the final frame shows the holes and craters.
    timeline.duration = Math.max(timeline.duration, Math.min(this.effects.endTime, timeline.duration + EFFECT_TAIL_S));
    return timeline;
  }

  /** Frees the target and the post-processing buffers (lane B going away). */
  dispose(): void {
    this.clear();
    if (this.targetGroup) disposeTarget(this.targetGroup);
    this.targetGroup = null;
    this.postFx.composer.dispose();
  }

  /** Advances the shot, effects and muzzle flash to sim time `t` (null when nothing is playing). */
  update(t: number | null, camera: THREE.Camera): void {
    const timeline = t !== null ? this.session : null;
    if (timeline && t !== null) {
      this.shot.update(t);
      this.effects.update(t);
    }
    // The muzzle flash belongs to whichever shot is playing, at that shot's aim point.
    const current = timeline && t !== null ? activeShot(timeline, t) : null;
    if (current) this.muzzle.setPosition(new THREE.Vector3(TARGET_FRONT_X - STAND_OFF_M, SHOT_Y + current.aim.y, current.aim.z));
    this.muzzle.update(current && t !== null ? t - current.start : null, camera);
  }
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
