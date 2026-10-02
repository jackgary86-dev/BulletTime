import * as THREE from 'three';
import { GEL_BODY_NAME, WATER_BODY_NAME } from '../models/targets';
import type { TargetLayer } from '../sim/engine';
import type { Timeline } from '../sim/types';
import { BloodPackEffect, type OrganicResult } from './bloodPackEffect';
import { GlassCracks } from './glassEffect';
import { GelEffect } from './gelEffect';
import { HoleMarks } from './holes';
import { loadHardEffect } from './hardEffect';
import { loadPanelEffect } from './panelEffect';
import { loadSandEffect } from './sandEffect';
import { ParticleSystem } from './particles';

/**
 * Picks and drives the per-medium impact effects for a shot: loaded on Fire,
 * advanced with sim time, cleared on reset or when the target changes.
 */
export class TargetEffects {
  readonly group = new THREE.Group();
  readonly particles = new ParticleSystem();
  private readonly gel = new GelEffect(this.particles);
  private readonly holes = new HoleMarks();
  private readonly glass = new GlassCracks();
  private readonly blood = new BloodPackEffect(this.particles, this.gel);
  /** Blood packs and bone from the last shot into an organic target, or null. */
  organic: OrganicResult | null = null;

  constructor() {
    this.group.name = 'target-effects';
    this.group.add(this.particles.group, this.gel.group, this.holes.group, this.glass.group);
  }

  load(timeline: Timeline, target: THREE.Group, targetLayers: TargetLayer[], angleDeg: number): void {
    this.clear();
    const layers = targetLayers.map((l) => l.medium);
    layers.forEach((medium, layer) => {
      if (medium.behaviour === 'gel') {
        const body = target.getObjectByName(GEL_BODY_NAME);
        if (body instanceof THREE.Mesh) {
          this.gel.load(timeline, body, layer);
          this.organic = this.blood.load(timeline, body, layer);
        }
      } else if (medium.behaviour === 'water') {
        const body = target.getObjectByName(WATER_BODY_NAME);
        if (body instanceof THREE.Mesh) this.gel.load(timeline, body, layer, 'water');
      } else if (medium.behaviour === 'sand') {
        loadSandEffect(timeline, layer, this.particles, this.holes);
      } else if (medium.behaviour === 'wood' || medium.behaviour === 'drywall') {
        loadPanelEffect(timeline, medium, layer, this.particles, this.holes);
      }
    });
    loadHardEffect(timeline, layers, this.particles, this.holes);
    this.glass.load(timeline, layers, targetLayers.map((l) => l.offset), angleDeg, this.particles, this.holes);
  }

  /** Sim time when the last effect has settled (dust cleared, debris gone). */
  get endTime(): number {
    return this.particles.endTime;
  }

  clear(): void {
    this.gel.clear();
    this.holes.clear();
    this.glass.clear();
    this.blood.clear();
    this.organic = null;
    this.particles.clear();
  }

  update(t: number): void {
    this.gel.update(t);
    this.holes.update(t);
    this.glass.update(t);
    this.blood.update(t);
    this.particles.update(t);
  }
}
