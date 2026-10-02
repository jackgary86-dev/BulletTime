import { getBullet, type BulletSpec } from '../data/bullets';
import { getMedium } from '../data/media';
import type { SimResolution } from '../data/physics';
import { physicsLayers, type StackLayer } from '../data/stacks';
import { layersFor, simulate, type PriorDamage } from './engine';
import type { Timeline } from './types';

/** Test helpers: fire a catalogue round into a medium (or a stack) the way the app does. */
export interface Shot {
  bullet: string;
  medium?: string;
  thickness?: number;
  angleDeg?: number;
  /** Override the muzzle velocity, in m/s. */
  speed?: number;
  stack?: StackLayer[];
  aim?: { y: number; z: number };
  damage?: PriorDamage[];
  resolution?: SimResolution;
}

export function bulletAt(id: string, speed?: number): BulletSpec {
  const bullet = getBullet(id);
  return speed === undefined ? bullet : { ...bullet, muzzleVelocityMs: speed };
}

export function fire(shot: Shot): Timeline {
  const medium = getMedium(shot.medium ?? 'gel10');
  const layers = shot.stack ? physicsLayers(shot.stack) : layersFor(medium, shot.thickness ?? medium.thickness.default);
  return simulate({
    bullet: bulletAt(shot.bullet, shot.speed),
    layers,
    angleDeg: shot.angleDeg ?? 0,
    impactPoint: { x: -0.2, y: 0.16 + (shot.aim?.y ?? 0), z: shot.aim?.z ?? 0 },
    standOffM: 0.5,
    damage: shot.damage,
    resolution: shot.resolution,
  });
}
