import type { SimulatorId } from './bullets';
import type { MediumSpec } from './media';

/**
 * Where each simulator is set (#231). Bullet shots happen on a bench in the
 * indoor lab; shells, missiles and charges are tested on an outdoor proving
 * ground with full-size targets standing on the ground.
 *
 * The site decides the height of the shot line: in the lab every target is
 * centred on the bench line; on the range a target stands on the ground and the
 * line runs through the middle of the tallest layer, so a 3 m wall is struck
 * at 1.5 m and a small block is lifted onto a stand at a sensible height.
 * Pure data, so the rules can be tested without three.js.
 */
export type SiteId = 'lab' | 'range';

export interface SiteInfo {
  id: SiteId;
  name: string;
  /** Height of the shot line above the floor for small targets, m. */
  baseShotY: number;
}

export const SITES: Record<SiteId, SiteInfo> = {
  lab: { id: 'lab', name: 'High-speed lab', baseShotY: 0.16 },
  range: { id: 'range', name: 'Proving ground', baseShotY: 0.6 },
};

export function siteForMode(mode: SimulatorId): SiteId {
  return mode === 'bullet' ? 'lab' : 'range';
}

/**
 * The shot line's height above the ground for a target made of these layers,
 * m. In the lab it is the bench line. On the range it is half the tallest
 * layer (so that layer stands on the ground), and never below the site's base
 * height, so small targets stand on supports rather than in the gravel.
 */
export function siteShotY(site: SiteId, layers: readonly Pick<MediumSpec, 'heightM' | 'groundClearanceM'>[]): number {
  const base = SITES[site].baseShotY;
  if (site === 'lab') return base;
  // A layer that rides above the ground (a tank's hull side over its tracks) lifts the line to its middle.
  const tallest = layers.reduce((m, l) => Math.max(m, l.heightM / 2 + (l.groundClearanceM ?? 0)), 0);
  return Math.max(base, tallest);
}
