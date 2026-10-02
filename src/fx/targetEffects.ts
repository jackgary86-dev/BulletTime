import * as THREE from 'three';
import type { MediumSpec } from '../data/media';
import { GEL_BODY_NAME } from '../models/targets';
import type { Timeline } from '../sim/types';
import { GelEffect } from './gelEffect';
import { HoleMarks } from './holes';
import { loadHardEffect } from './hardEffect';
import { loadPanelEffect } from './panelEffect';
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

  constructor() {
    this.group.name = 'target-effects';
    this.group.add(this.particles.group, this.gel.group, this.holes.group);
  }

  load(timeline: Timeline, target: THREE.Group, layers: MediumSpec[]): void {
    this.clear();
    layers.forEach((medium, layer) => {
      if (medium.behaviour === 'gel') {
        const body = target.getObjectByName(GEL_BODY_NAME);
        if (body instanceof THREE.Mesh) this.gel.load(timeline, body, layer);
      } else if (medium.behaviour === 'wood' || medium.behaviour === 'drywall') {
        loadPanelEffect(timeline, medium, layer, this.particles, this.holes);
      }
    });
    loadHardEffect(timeline, layers, this.particles, this.holes);
  }

  /** Sim time when the last effect has settled (dust cleared, debris gone). */
  get endTime(): number {
    return this.particles.endTime;
  }

  clear(): void {
    this.gel.clear();
    this.holes.clear();
    this.particles.clear();
  }

  update(t: number): void {
    this.gel.update(t);
    this.holes.update(t);
    this.particles.update(t);
  }
}
