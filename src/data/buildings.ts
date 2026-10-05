/**
 * Mock test buildings on the proving ground (#246): a block house, a
 * two-storey concrete frame with brick infill, and a light steel shed. Each
 * is a preset whose struck wall and far wall are the physics layers, with the
 * interior as the air gap between them; the rest of the structure is drawn
 * round the struck wall (see `models/buildings.ts`). Pure data, so the
 * dimensions and layer stacks can be tested without three.js.
 */
export type BuildingId = 'block-house' | 'frame-panel' | 'frame-column' | 'steel-shed';

export interface BuildingSpec {
  id: BuildingId;
  name: string;
  /** Across the struck face (z), along the shot (x) and up, m. */
  widthM: number;
  depthM: number;
  heightM: number;
  /** The struck wall's medium and thickness, and the far wall's. */
  front: { medium: string; thicknessM: number };
  back: { medium: string; thicknessM: number };
  /** What a steep dive meets (#250): the roof, the room below it and the floor it lands on. */
  roof: { medium: string; thicknessM: number; roomM: number; floor: { medium: string; thicknessM: number } };
}

/** Storey height of the concrete frame, floor to floor, m, and its slab thickness. */
export const FRAME_STOREY_M = 3;
export const FRAME_SLAB_M = 0.25;
/** Column section of the frame, m (square). */
export const FRAME_COLUMN_M = 0.4;

export const BUILDINGS: Record<BuildingId, BuildingSpec> = {
  'block-house': {
    id: 'block-house',
    name: 'Block house',
    widthM: 4,
    depthM: 4,
    heightM: 3,
    front: { medium: 'block-house-wall', thicknessM: 0.3 },
    back: { medium: 'block-house-back', thicknessM: 0.3 },
    roof: { medium: 'roof-slab', thicknessM: 0.25, roomM: 2.6, floor: { medium: 'floor-slab', thicknessM: 0.15 } },
  },
  'frame-panel': {
    id: 'frame-panel',
    name: 'Concrete frame (infill panel)',
    widthM: 8,
    depthM: 6,
    heightM: 2 * FRAME_STOREY_M,
    front: { medium: 'frame-infill', thicknessM: 0.23 },
    back: { medium: 'frame-infill-back', thicknessM: 0.23 },
    roof: { medium: 'roof-slab', thicknessM: FRAME_SLAB_M, roomM: FRAME_STOREY_M - FRAME_SLAB_M, floor: { medium: 'floor-slab', thicknessM: FRAME_SLAB_M } },
  },
  'frame-column': {
    id: 'frame-column',
    name: 'Concrete frame (column)',
    widthM: 8,
    depthM: 6,
    heightM: 2 * FRAME_STOREY_M,
    front: { medium: 'frame-column', thicknessM: FRAME_COLUMN_M },
    back: { medium: 'frame-column-back', thicknessM: FRAME_COLUMN_M },
    roof: { medium: 'roof-slab', thicknessM: FRAME_SLAB_M, roomM: FRAME_STOREY_M - FRAME_SLAB_M, floor: { medium: 'floor-slab', thicknessM: FRAME_SLAB_M } },
  },
  'steel-shed': {
    id: 'steel-shed',
    name: 'Steel shed',
    widthM: 10,
    depthM: 6,
    heightM: 4,
    front: { medium: 'shed-sheet', thicknessM: 0.0008 },
    back: { medium: 'shed-sheet-back', thicknessM: 0.0008 },
    // The ridge is a metre above the eaves; a dive meets the sloping roof sheet and the concrete floor 3 m below.
    roof: { medium: 'shed-sheet-back', thicknessM: 0.0008, roomM: 3, floor: { medium: 'floor-slab', thicknessM: 0.15 } },
  },
};

/** The air gap between the struck wall and the far wall: the interior, m. */
export function interiorGapM(b: BuildingSpec): number {
  return b.depthM - b.front.thicknessM - b.back.thicknessM;
}

/** Which building a medium is the struck wall of, if any. */
export function buildingForFront(mediumId: string): BuildingSpec | undefined {
  return Object.values(BUILDINGS).find((b) => b.front.medium === mediumId);
}
