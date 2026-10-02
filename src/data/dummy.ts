import { getMedium } from './media';
import type { StackLayer } from './stacks';

/**
 * The clinical ballistic test dummy (#25): a lab gel torso and head on a
 * stand, with bone simulant (skull, ribs, spine), brain, lung and organ
 * simulants, and blood packs for the heart and liver. Each aim region is a
 * stack of layers along the shot line, front to back, so the physics and
 * effects treat it like any other stack.
 *
 * Positions are in the dummy's own frame: x is depth from the chest's front
 * surface (toward the back), y is height above the floor, z is across.
 */

export type DummyRegionId = 'head' | 'chest' | 'abdomen';

export interface DummyRegion {
  id: DummyRegionId;
  name: string;
  /** Height of this region's shot line above the floor, in metres. */
  shotY: number;
  /** Depth of the region's front surface from the chest's front surface, in metres. */
  frontX: number;
  /** How far the aim may move off the region centre (up/down, across), in metres. */
  aim: { y: number; z: number };
  /** Size of the region's gel cross-section (height, width) for the cavity effect. */
  section: { h: number; w: number };
  layers: { medium: string; thickness: number; organic?: string }[];
}

export const DUMMY_PRESET_ID = 'dummy';

export const DUMMY_REGIONS: DummyRegion[] = [
  {
    id: 'head',
    name: 'Head',
    shotY: 0.75,
    frontX: 0.01,
    aim: { y: 0.03, z: 0.025 },
    section: { h: 0.2, w: 0.15 },
    // Gel skin, skull, brain, skull, gel skin: about 18 cm front to back.
    layers: [
      { medium: 'gel10', thickness: 0.006 },
      { medium: 'bone-sim', thickness: 0.007 },
      { medium: 'brain-sim', thickness: 0.154 },
      { medium: 'bone-sim', thickness: 0.007 },
      { medium: 'gel10', thickness: 0.006 },
    ],
  },
  {
    id: 'chest',
    name: 'Chest',
    shotY: 0.49,
    frontX: 0,
    aim: { y: 0.04, z: 0.03 },
    section: { h: 0.2, w: 0.32 },
    // Gel, sternum, lung, heart (blood pack), spine, gel: 24 cm.
    layers: [
      { medium: 'gel10', thickness: 0.015 },
      { medium: 'bone-sim', thickness: 0.01 },
      { medium: 'lung-sim', thickness: 0.1 },
      { medium: 'organ-sim', thickness: 0.06, organic: 'dummy-heart' },
      { medium: 'bone-sim', thickness: 0.03 },
      { medium: 'gel10', thickness: 0.025 },
    ],
  },
  {
    id: 'abdomen',
    name: 'Abdomen',
    shotY: 0.3,
    frontX: 0,
    aim: { y: 0.04, z: 0.03 },
    section: { h: 0.18, w: 0.32 },
    // Gel, liver and gut (blood pack), gel, spine, gel: 24 cm.
    layers: [
      { medium: 'gel10', thickness: 0.03 },
      { medium: 'organ-sim', thickness: 0.13, organic: 'dummy-liver' },
      { medium: 'gel10', thickness: 0.025 },
      { medium: 'bone-sim', thickness: 0.03 },
      { medium: 'gel10', thickness: 0.025 },
    ],
  },
];

export function getRegion(id: DummyRegionId): DummyRegion {
  return DUMMY_REGIONS.find((r) => r.id === id)!;
}

/** The region's layers as a gap-free stack. */
export function regionLayers(region: DummyRegion): StackLayer[] {
  return region.layers.map((l) => ({ medium: getMedium(l.medium), thickness: l.thickness, gapM: 0 }));
}
