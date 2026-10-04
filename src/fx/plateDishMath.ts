import type { TargetLayer } from '../sim/engine';
import type { Timeline, Vec3 } from '../sim/types';

/**
 * Rear dishing of a metal plate (#221). In the thin-plate reference the back face bulges about 0.3 bullet
 * diameters between contact and exit, centred on the shot line, then opens into a petalled hole. A plate that
 * holds keeps a smaller dent. Pure functions of the timeline, so scrubbing works; the mesh work is in plateDish.ts.
 */
export interface Dish {
  layer: number;
  trackId: number;
  /** Where the bullet struck, in world coordinates. */
  pos: Vec3;
  /** Contact time and how long the bulge takes to grow, in seconds. */
  t0: number;
  riseS: number;
  /** Final height of the bulge on the back face, in metres. */
  depthM: number;
  /** Gaussian width: 2.5 bullet radii. */
  sigmaM: number;
}

/** Peak bulge as a multiple of the bullet diameter when the bullet goes through, and when it does not. */
export const DISH_PERFORATED = 0.3;
export const DISH_HELD = 0.2;
/** Time a plate that holds takes to reach its dent, in seconds (the reference shows about 20 us). */
export const DISH_HELD_RISE_S = 20e-6;
/** Guard against a zero interval, in seconds. */
const MIN_RISE_S = 1e-7;

/** How much a plate of this thickness bows: thin sheet fully, a plate four calibres thick not at all. */
export function dishStiffness(thicknessM: number, diameterM: number): number {
  return Math.min(1, Math.max(0, 1 - (thicknessM / diameterM - 1) / 3));
}

export function planDishes(timeline: Timeline, layers: TargetLayer[]): Dish[] {
  const dishes: Dish[] = [];
  for (const e of timeline.events) {
    if ((e.type !== 'impact' && e.type !== 'enter') || e.layer === undefined) continue;
    const medium = layers[e.layer]?.medium;
    if (!medium || medium.behaviour !== 'steel' || medium.shape) continue;
    const track = timeline.tracks.find((t) => t.id === e.trackId);
    if (!track || track.kind === 'fragment') continue;
    const same = (x: { trackId: number; layer?: number }) => x.trackId === e.trackId && x.layer === e.layer;
    // A glancing blow skids along the face; it does not bow the plate.
    if (timeline.events.some((x) => x.type === 'ricochet' && same(x))) continue;
    // The bullet's own calibre: the drawn diameter at contact is larger than the bullet.
    const d = track.baseDiameter;
    const stiff = dishStiffness(layers[e.layer].thickness, d);
    if (stiff <= 0) continue;
    const exit = timeline.events.find((x) => x.type === 'exit' && same(x));
    dishes.push({
      layer: e.layer,
      trackId: e.trackId,
      pos: e.pos,
      t0: e.t,
      riseS: exit ? Math.max(MIN_RISE_S, exit.t - e.t) : DISH_HELD_RISE_S,
      depthM: d * stiff * (exit ? DISH_PERFORATED : DISH_HELD),
      sigmaM: 1.25 * d,
    });
  }
  return dishes;
}

/** Height of the bulge at its centre at sim time `t`: nothing before contact, smooth growth, then it stays. */
export function dishDepthAt(dish: Dish, t: number): number {
  const u = Math.min(1, Math.max(0, (t - dish.t0) / dish.riseS));
  return dish.depthM * u * u * (3 - 2 * u);
}

/** Gaussian falloff with distance from the shot line, 1 at the centre. */
export function dishFalloff(dish: Dish, distanceM: number): number {
  return Math.exp(-(distanceM * distanceM) / (2 * dish.sigmaM * dish.sigmaM));
}
