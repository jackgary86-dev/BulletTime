import * as THREE from 'three';
import { GEL_BODY_NAME, WATER_BODY_NAME, layerGroupName } from '../models/targets';
import type { TargetLayer } from '../sim/engine';
import type { Timeline } from '../sim/types';
import { loadBoneEffect } from './boneEffect';
import { BloodPackEffect, type OrganicResult } from './bloodPackEffect';
import { GlassCracks } from './glassEffect';
import { GelEffect } from './gelEffect';
import { HoleMarks } from './holes';
import { loadHardEffect } from './hardEffect';
import { BlastDamage, loadBlastEffect } from './blastEffect';
import { loadPanelEffect } from './panelEffect';
import { loadSandEffect } from './sandEffect';
import { ObjectEffect } from './objectEffect';
import { PlateDish } from './plateDish';
import { ParticleSystem } from './particles';

/**
 * Picks and drives the per-medium impact effects for a shot: loaded on Fire,
 * advanced with sim time, cleared on reset or when the target changes.
 */
export class TargetEffects {
  readonly group = new THREE.Group();
  readonly particles = new ParticleSystem();
  /** One cavity effect (and blood-pack effect) per gel or water layer in the stack. */
  private gels: GelEffect[] = [];
  private bloods: BloodPackEffect[] = [];
  private readonly holes = new HoleMarks();
  private readonly glass = new GlassCracks();
  private readonly objects: ObjectEffect;
  private readonly blastDamage = new BlastDamage();
  private readonly plateDish = new PlateDish();
  /** Blood packs and bone from the last shot into an organic target, or null. */
  organic: OrganicResult | null = null;

  constructor() {
    this.group.name = 'target-effects';
    this.objects = new ObjectEffect(this.particles, this.holes);
    this.group.add(this.particles.group, this.holes.group, this.glass.group, this.objects.group);
  }

  load(timeline: Timeline, target: THREE.Group, targetLayers: TargetLayer[], angleDeg: number): void {
    this.clear();
    const layers = targetLayers.map((l) => l.medium);
    const bodyOf = (layer: number, name: string) => {
      const body = target.getObjectByName(layerGroupName(targetLayers[layer].stack ?? 0))?.getObjectByName(name);
      return body instanceof THREE.Mesh ? body : null;
    };
    layers.forEach((medium, layer) => {
      if (medium.behaviour === 'gel' || medium.behaviour === 'water') {
        const water = medium.behaviour === 'water';
        const body = bodyOf(layer, water ? WATER_BODY_NAME : GEL_BODY_NAME);
        if (!body) return;
        const gel = new GelEffect(this.particles);
        this.gels.push(gel);
        this.group.add(gel.group);
        gel.load(timeline, body, layer, water ? 'water' : 'gel');
        if (!water) {
          const blood = new BloodPackEffect(this.particles, gel);
          this.bloods.push(blood);
          const result = blood.load(timeline, body, layer);
          if (result) this.organic = mergeOrganic(this.organic, result);
        }
      } else if (medium.behaviour === 'sand') {
        loadSandEffect(timeline, layer, this.particles, this.holes);
      } else if (medium.behaviour === 'wood' || medium.behaviour === 'drywall' || medium.behaviour === 'plastic') {
        loadPanelEffect(timeline, medium, layer, this.particles, this.holes);
      }
    });
    loadHardEffect(timeline, targetLayers, this.particles, this.holes);
    loadBlastEffect(timeline, targetLayers, this.particles);
    this.blastDamage.load(timeline, target, targetLayers);
    this.plateDish.load(timeline, target, targetLayers);
    this.objects.load(timeline, target, targetLayers);
    loadBoneEffect(timeline, layers, this.particles, this.holes);
    this.glass.load(timeline, layers, targetLayers.map((l) => l.offset), angleDeg, this.particles, this.holes, target.position.y);
  }

  /** Sim time when the last effect has settled (dust cleared, debris gone). */
  get endTime(): number {
    return this.particles.endTime;
  }

  clear(): void {
    for (const gel of this.gels) {
      gel.dispose();
      this.group.remove(gel.group);
    }
    for (const blood of this.bloods) blood.clear();
    this.gels = [];
    this.bloods = [];
    this.holes.clear();
    this.glass.clear();
    this.objects.clear();
    this.blastDamage.clear();
    this.plateDish.clear();
    this.organic = null;
    this.particles.clear();
  }

  /** `shutterS` is the sim time one frame's exposure covers, for motion blur (#74). */
  update(t: number, shutterS = 0): void {
    for (const gel of this.gels) gel.update(t);
    this.holes.update(t);
    this.glass.update(t);
    this.objects.update(t);
    this.blastDamage.update(t);
    this.plateDish.update(t);
    for (const blood of this.bloods) blood.update(t);
    this.particles.update(t, shutterS);
  }
}

function mergeOrganic(a: OrganicResult | null, b: OrganicResult): OrganicResult {
  if (!a) return b;
  return {
    packs: a.packs + b.packs,
    hit: a.hit + b.hit,
    burstByCavity: a.burstByCavity + b.burstByCavity,
    bone: a.bone || b.bone,
    boneStruck: a.boneStruck || b.boneStruck,
  };
}
