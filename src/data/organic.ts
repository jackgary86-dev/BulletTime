/**
 * Organic target layouts (issue #19): fake blood packs suspended in ballistic
 * gel, MythBusters style, plus an optional synthetic bone rod.
 *
 * Positions are in the gel block's own frame: `depth` is the fraction of the
 * block's thickness from the entry face (0) to the back face (1); `y` and `z`
 * are metres from the shot line (up and across).
 */

export interface BloodPack {
  depth: number;
  y: number;
  z: number;
  /** Half-sizes of the sachet: along the shot, up and across, in metres. */
  size: [number, number, number];
}

export interface BoneRod {
  depth: number;
  /** Offset across the shot line, in metres; the rod runs vertically. */
  z: number;
  radius: number;
  length: number;
}

export interface OrganicLayout {
  id: string;
  packs: BloodPack[];
  bone?: BoneRod;
}

/**
 * A pack bursts when the temporary cavity wall pushes this far into it
 * (the sachet is squeezed past what the thin plastic can take), in metres.
 * Smaller = more fragile packs.
 */
export const PACK_BURST_SQUEEZE_M = 0.006;
/** And only if the cavity is still fast enough there: peak cavity radius at least this, in metres. */
export const PACK_BURST_MIN_CAVITY_M = 0.012;
/** How long a burst pack takes to empty, in seconds. */
export const PACK_DRAIN_S = 2.5e-3;

export const ORGANIC_LAYOUTS: Record<string, OrganicLayout> = {
  single: {
    id: 'single',
    packs: [{ depth: 0.35, y: 0.005, z: 0, size: [0.025, 0.035, 0.04] }],
  },
  cluster: {
    id: 'cluster',
    packs: [
      { depth: 0.25, y: 0.03, z: -0.025, size: [0.02, 0.025, 0.025] },
      { depth: 0.3, y: -0.035, z: 0.02, size: [0.02, 0.025, 0.025] },
      { depth: 0.5, y: 0.0, z: 0.0, size: [0.022, 0.028, 0.028] },
      { depth: 0.62, y: 0.04, z: 0.035, size: [0.02, 0.022, 0.025] },
      { depth: 0.75, y: -0.04, z: -0.04, size: [0.018, 0.025, 0.022] },
    ],
  },
  // A rough torso cross-section: heart left of centre, lungs either side, liver low, spine at the back.
  torso: {
    id: 'torso',
    packs: [
      { depth: 0.3, y: 0.01, z: 0.025, size: [0.035, 0.045, 0.035] }, // heart
      { depth: 0.4, y: 0.05, z: -0.06, size: [0.06, 0.07, 0.04] }, // right lung
      { depth: 0.4, y: 0.05, z: 0.08, size: [0.06, 0.07, 0.035] }, // left lung
      { depth: 0.45, y: -0.08, z: -0.03, size: [0.06, 0.035, 0.06] }, // liver
      { depth: 0.6, y: -0.02, z: 0.0, size: [0.03, 0.03, 0.025] }, // aorta region
    ],
    bone: { depth: 0.85, z: 0.0, radius: 0.012, length: 0.28 },
  },
  // Test dummy (#25): a heart pack in the chest's organ layer, a liver pack in the abdomen.
  'dummy-heart': {
    id: 'dummy-heart',
    packs: [{ depth: 0.5, y: 0.005, z: 0.005, size: [0.024, 0.034, 0.03] }],
  },
  'dummy-liver': {
    id: 'dummy-liver',
    packs: [{ depth: 0.45, y: 0.012, z: -0.03, size: [0.05, 0.035, 0.06] }],
  },
};
