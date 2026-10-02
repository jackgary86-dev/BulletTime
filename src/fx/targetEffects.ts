import * as THREE from 'three';
import type { MediumSpec } from '../data/media';
import { GEL_BODY_NAME } from '../models/targets';
import type { Timeline } from '../sim/types';
import { GelEffect } from './gelEffect';
import { ParticleSystem } from './particles';

/**
 * Picks and drives the per-medium impact effects for a shot: loaded on Fire,
 * advanced with sim time, cleared on reset or when the target changes.
 */
export class TargetEffects {
  readonly group = new THREE.Group();
  readonly particles = new ParticleSystem();
  private readonly gel = new GelEffect(this.particles);

  constructor() {
    this.group.name = 'target-effects';
    this.group.add(this.particles.group, this.gel.group);
  }

  load(timeline: Timeline, target: THREE.Group, layers: MediumSpec[]): void {
    this.clear();
    layers.forEach((medium, layer) => {
      if (medium.behaviour === 'gel') {
        const body = target.getObjectByName(GEL_BODY_NAME);
        if (body instanceof THREE.Mesh) this.gel.load(timeline, body, layer);
      }
    });
  }

  clear(): void {
    this.gel.clear();
    this.particles.clear();
  }

  update(t: number): void {
    this.gel.update(t);
    this.particles.update(t);
  }
}
