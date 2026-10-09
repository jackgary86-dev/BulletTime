import * as THREE from 'three';
import { getRegion } from './data/dummy';
import { STANDARD_RESOLUTION, ULTRA_RESOLUTION } from './data/physics';
import { clampAimToObjects, shapeLayers } from './data/objects';
import { physicsLayers, stackDepth } from './data/stacks';
import { getBullet, type BulletSpec } from './data/bullets';
import { MuzzleEffect } from './fx/muzzle';
import { ShotRenderer } from './fx/shotRenderer';
import type { BurstSpec } from './fx/particles';
import { gpuBoostsFromSettings } from './fx/gpuParticles';
import { TargetEffects } from './fx/targetEffects';
import { addVapourTrails } from './fx/wake';
import { createDummy } from './models/dummy';
import { createTargetStack, disposeTarget, SHOT_Y, TARGET_FRONT_X } from './models/targets';
import { siteShotY, type SiteId } from './data/sites';
import { buildingForFront, type BuildingSpec } from './data/buildings';
import { WitnessBlocks } from './fx/witnessBlocks';
import { clampBlocks, type WitnessBlock, type WitnessFrame, type WitnessResult } from './sim/witness';
import { LEVEL, approachHit, clampApproach, engineToWorld, isLevel, type Approach, type ApproachHit } from './sim/approach';
import type { MediumSpec } from './data/media';
import { disposeTree } from './scene/dispose';
import { flashExposure, HIGHSPEED_GRADE, LAB_GRADE } from './scene/gradePass';
import { washScale } from './scene/flash';
import { createPostFx, type PostFx } from './scene/postfx';
import { QUALITY, type QualitySettings } from './scene/quality';
import { createStudio, type LightingMode, type Studio } from './scene/studio';
import { wallClockS } from './scene/still';
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
  /** Gel witness blocks inside a mock building (#249). */
  readonly witness = new WitnessBlocks();
  private witnessLayout: WitnessBlock[] = [];
  /** Where the missile comes from (#250): level and head on unless a dive or bearing is set. */
  private approach: Approach = LEVEL;
  /**
   * The engine always shoots along +x; the shot, its effects and the muzzle are drawn in this frame, turned onto the
   * real path and struck face when the approach is not level (identity otherwise).
   */
  readonly attackFrame = new THREE.Group();
  /** Stands in for the target while the engine's frame is turned: the body effects (plate dish, gel) look for meshes and find none. */
  private readonly frameTarget = new THREE.Group();
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
    /** Where the shots happen (#231): the indoor lab bench, or the outdoor proving ground. */
    readonly site: SiteId = 'lab',
  ) {
    this.scene = scene;
    this.studio = createStudio(this.scene, renderer, site);
    this.postFx = createPostFx(renderer, this.scene, camera);
    this.attackFrame.name = 'attack-frame';
    this.attackFrame.matrixAutoUpdate = false;
    this.attackFrame.add(this.muzzle.group, this.shot.group, this.effects.group);
    this.scene.add(this.attackFrame, this.witness.group);
    this.setTarget(setup);
  }

  get lineY(): number {
    return shotLineY(this.setup, this.baseY);
  }

  /** Height of the target's centre above the ground: the bench line, or on the range half the tallest layer (#231). */
  get baseY(): number {
    return this.setup.dummy ? SHOT_Y : siteShotY(this.site, this.setup.layers.map((l) => l.medium));
  }

  /** Largest face dimension in the target, in metres, for framing. */
  get faceSpan(): number {
    // A building's struck wall is one panel of it: frame the whole building (#246).
    const span = (m: MediumSpec) => {
      const b = buildingForFront(m.id);
      return b ? Math.max(b.heightM, b.widthM) : Math.max(m.heightM, m.widthM);
    };
    return Math.max(0.3, ...this.setup.layers.map((l) => span(l.medium)));
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
    this.targetGroup = setup.dummy ? createDummy(setup.dummy) : createTargetStack(setup.layers, setup.angleDeg, this.baseY);
    this.muzzle.setPosition(new THREE.Vector3(TARGET_FRONT_X - STAND_OFF_M, this.baseY, 0));
    this.scene.add(this.targetGroup);
    this.studio.fitContactShadow(this.targetGroup);
    this.placeWitness();
    this.clear();
  }

  /** Sets where the missile comes from (#250); clears the shot, since earlier rounds came in another way. */
  setApproach(approach: Approach): void {
    this.approach = clampApproach(approach);
    this.clear();
  }

  get currentApproach(): Approach {
    return this.approach;
  }

  /** The face the approach meets and what is behind it, or null for a level run (and outside the proving ground). */
  get approachHit(): ApproachHit | null {
    if (this.site !== 'range' || this.setup.dummy || isLevel(this.approach)) return null;
    return approachHit(this.approach, this.setup.layers, this.baseY);
  }

  /** Where the round meets the target in the world: the struck face's entry point, or the front face at the shot line. */
  get impactWorld(): THREE.Vector3 {
    const hit = this.approachHit;
    return hit ? new THREE.Vector3(TARGET_FRONT_X + hit.entry.x, this.baseY + hit.entry.y, hit.entry.z) : new THREE.Vector3(TARGET_FRONT_X, this.lineY, 0);
  }

  /** The mock building being shot, if the struck layer is one's wall (#246). */
  get building(): BuildingSpec | undefined {
    const front = this.setup.layers[0];
    return this.setup.dummy || !front ? undefined : buildingForFront(front.medium.id);
  }

  /** The room behind the struck wall, for the witness blocks; null when the target is not a building. */
  get witnessFrame(): WitnessFrame | null {
    const b = this.building;
    const front = this.setup.layers[0];
    if (!b || !front) return null;
    return {
      origin: { x: TARGET_FRONT_X, y: this.lineY, z: 0 },
      angleDeg: this.setup.angleDeg,
      wallM: front.thickness,
      roomM: Math.max(0.5, b.depthM - front.thickness - b.back.thicknessM),
      wall: front.medium,
    };
  }

  /** Where the witness blocks stand, kept inside the room; they only appear in a building. */
  setWitnessBlocks(blocks: readonly WitnessBlock[]): void {
    this.witnessLayout = [...blocks];
    this.placeWitness();
    this.clear();
  }

  get witnessBlocks(): WitnessBlock[] {
    const frame = this.witnessFrame;
    const b = this.building;
    return frame && b ? clampBlocks(this.witnessLayout, frame.roomM, b.widthM) : [];
  }

  /** What reached each witness block in the last shot. */
  get witnessResults(): WitnessResult[] {
    return this.witness.results;
  }

  private placeWitness(): void {
    this.witness.setBlocks(this.witnessBlocks, this.witnessFrame, this.baseY);
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
    this.effects.particles.setGpuBoosts(gpuBoostsFromSettings(quality.gpuParticles));
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
    this.witness.clearEffects();
  }

  /**
   * Fires the plan (one round, a group or a burst) and returns the session
   * timeline. `fresh` starts a new session at t = 0 instead of adding to it.
   */
  fire(plan: FirePlan, fresh = false): Timeline {
    if (fresh) this.clear();
    // A dive or a bearing (#250): shoot the layers behind the face it meets, at its obliquity, and turn the drawing onto the real path.
    const hit = this.approachHit;
    const shotSetup: TargetSetup = hit ? { layers: hit.layers, angleDeg: hit.obliquityDeg } : this.setup;
    const { angleDeg } = shotSetup;
    const layers = physicsLayers(shotSetup.layers);
    const face = faceLimits(shotSetup);
    this.effects.particles.freeFlight = !!hit;
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
        shotSetup.layers,
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
      // Stored relative to the target's centre line, so the muzzle can follow it.
      part.shots[0].aim = { y: lineY - this.baseY + y, z };
      this.session = appendShot(this.session, part, offset);
      offset = plan.mode === 'burst' ? fireStart + ((i + 1) * 60) / plan.rpm : offset + part.duration + GROUP_GAP_S;
    });
    const timeline = this.session!;
    this.lastFireStart = fireStart;
    this.setAttackFrame(hit);
    this.shot.load(timeline, shotSetup.layers[0]?.medium.hardness);
    if (this.targetGroup) this.effects.load(timeline, hit ? this.frameTarget : this.targetGroup, layers, angleDeg);
    if (hasMuzzle(this.spec)) for (const shot of timeline.shots) this.effects.particles.add(muzzleSmoke(shot.start, shot.aim, this.baseY));
    addVapourTrails(timeline, this.effects.particles);
    // Witness blocks read the room behind the front wall: only for a level run through it.
    if (hit) this.witness.clearEffects();
    else this.witness.load(timeline);
    // Let the dust settle before the shot ends, so the final frame shows the holes and craters.
    timeline.duration = Math.max(timeline.duration, Math.min(Math.max(this.effects.endTime, this.witness.endTime), timeline.duration + EFFECT_TAIL_S));
    return timeline;
  }

  /** Turns the shot's drawing frame onto the approach's path and face, or back to the engine's own (identity). */
  private setAttackFrame(hit: ApproachHit | null): void {
    const m = this.attackFrame.matrix;
    if (!hit) {
      m.identity();
    } else {
      const lineY = this.lineY;
      this.frameTarget.position.set(TARGET_FRONT_X, lineY, 0);
      const world = this.impactWorld;
      const r = engineToWorld(hit, { x: TARGET_FRONT_X, y: lineY, z: 0 }, { x: world.x, y: world.y, z: world.z });
      m.set(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12], r[13], r[14], r[15]);
    }
    this.attackFrame.matrixWorldNeedsUpdate = true;
  }

  /**
   * Frees everything this lane put on the GPU (lane B going away, #133): its
   * scene, shadow map and post-processing, except what `keep` (lane A's scene)
   * shares with it.
   */
  dispose(keep: THREE.Object3D | null = null): void {
    this.clear();
    this.shot.dispose();
    this.witness.dispose();
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
      this.witness.update(t, shutterS);
    }
    // The muzzle flash belongs to whichever shot is playing, at that shot's aim point.
    const current = timeline && t !== null ? activeShot(timeline, t) : null;
    const flash = current && hasMuzzle(getBullet(current.bulletId)) ? current : null;
    if (flash) this.muzzle.setPosition(new THREE.Vector3(TARGET_FRONT_X - STAND_OFF_M, this.baseY + flash.aim.y, flash.aim.z));
    this.muzzle.update(flash && t !== null ? t - flash.start : null, camera);
    const { shockwave } = this.postFx;
    // A detonation's blast front takes over from the muzzle shell while it is passing.
    const blast = timeline && t !== null ? blastShock(timeline.events, t) : null;
    const shock = blast ?? this.muzzle.shock;
    shockwave.enabled = shock.strength > 0;
    // The blast and the muzzle shell are in the engine's frame; the pass works in the world.
    shockwave.center.copy(shock.center).applyMatrix4(this.attackFrame.matrix);
    shockwave.radius = shock.radius;
    shockwave.strength = shock.strength;
    const { heatHaze } = this.postFx;
    const haze = this.shot.haze;
    heatHaze.enabled = !!timeline && haze.active;
    if (heatHaze.enabled) {
      heatHaze.nozzle.copy(haze.nozzle).applyMatrix4(this.attackFrame.matrix);
      heatHaze.tip.copy(haze.tip).applyMatrix4(this.attackFrame.matrix);
      heatHaze.radius = haze.radius;
      heatHaze.strength = 1;
      heatHaze.time = wallClockS();
    }
    this.postFx.grade.setFlash(current && t !== null ? flashExposure(t - current.start, shutterS) * washScale() : 0);
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
function muzzleSmoke(start: number, aim: { y: number; z: number }, baseY: number): BurstSpec {
  return {
    look: 'dust',
    t0: start + 60e-6,
    duration: 600e-6,
    origin: new THREE.Vector3(TARGET_FRONT_X - STAND_OFF_M + 0.01, baseY + aim.y, aim.z),
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

/** Height of the shot line: the target's centre (`baseY`, the bench height by default), or the dummy region being shot. */
export function shotLineY(setup: TargetSetup, baseY = SHOT_Y): number {
  return setup.dummy ? getRegion(setup.dummy).shotY : baseY;
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
