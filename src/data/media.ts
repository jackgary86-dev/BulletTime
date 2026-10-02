/**
 * The target media catalogue. Each entry drives the selector, the procedural
 * target model and the simulation; adding a medium only needs an entry here
 * (plus a look in `models/targets.ts` if it needs a new appearance).
 *
 * Densities are real-world values. Drag and strength constants are tuning
 * values chosen so penetration lands near well-known reference results; they
 * are plausible, not a validated engineering model.
 */

/** Broad behaviour family; the physics engine and effects key off this. */
export type MediumBehaviour =
  | 'gel' // soft tissue simulant: temporary + permanent cavity
  | 'water' // splash, cavitation, rapid deceleration
  | 'wood' // splinters, exit spall, grain-dependent
  | 'drywall' // easy pass-through, gypsum dust
  | 'concrete' // cratering, chips, dust, ricochet at shallow angles
  | 'steel' // splash/flatten, sparks, dent or perforation
  | 'sand' // grains scatter, strong stopping power
  | 'glass' // radial + concentric cracks, shards, deflection
  | 'ice'; // brittle, cracks and chunks

/** Which procedural look builds the target. */
export type MediumLook =
  | 'gel'
  | 'waterTank'
  | 'pine'
  | 'oak'
  | 'drywall'
  | 'concrete'
  | 'mildSteel'
  | 'ar500'
  | 'sandbag'
  | 'glass'
  | 'ice';

export interface RangeM {
  min: number;
  max: number;
  default: number;
}

export interface MediumSpec {
  id: string;
  name: string;
  description: string;
  behaviour: MediumBehaviour;
  look: MediumLook;
  /** kg/m³ */
  density: number;
  /** Target thickness along the shot line, in metres. */
  thickness: RangeM;
  /** Face size: height and width across the shot line, in metres. */
  heightM: number;
  widthM: number;
  /** Whether the impact angle control applies (thin plates and walls, not volumes). */
  angleAdjustable: boolean;

  // --- Tuning constants for the physics engine (#5) ---
  /** Drag coefficient for ½·ρ·Cd·A·v² inside the medium. */
  dragCoefficient: number;
  /** Material strength term in pascals, applied as resistance × frontal area. */
  resistancePa: number;
  /** 0 (soft) to 1 (hardened steel); raises deformation and ricochet chance. */
  hardness: number;
  /** Impact angle (degrees from head-on) above which ricochet becomes likely; omit if it never ricochets. */
  ricochetAngleDeg?: number;
  /** Distance scale for the yaw neck relative to 10% gel (1 = same as gel). */
  yawNeckScale: number;
}

export const MEDIA: MediumSpec[] = [
  {
    id: 'gel10',
    name: 'Ballistic gelatin (10%)',
    description: 'The standard soft-tissue simulant. Shows the bullet path, the ballooning temporary cavity and the permanent channel.',
    behaviour: 'gel',
    look: 'gel',
    density: 1030,
    thickness: { min: 0.15, max: 0.6, default: 0.4 },
    heightM: 0.15,
    widthM: 0.15,
    angleAdjustable: false,
    dragCoefficient: 0.3,
    resistancePa: 2.0e6, // with Cd 0.3: 9mm JHP ≈ 33 cm
    hardness: 0.02,
    yawNeckScale: 1,
  },
  {
    id: 'water',
    name: 'Water',
    description: 'A glass tank of water. Huge splash, a cavitation bubble trail, and very rapid deceleration; fast rifle bullets can break apart.',
    behaviour: 'water',
    look: 'waterTank',
    density: 1000,
    thickness: { min: 0.2, max: 0.8, default: 0.6 },
    heightM: 0.25,
    widthM: 0.2,
    angleAdjustable: false,
    dragCoefficient: 0.35,
    resistancePa: 0.2e6, // water has no shear strength; drag dominates
    hardness: 0.01,
    yawNeckScale: 0.6,
  },
  {
    id: 'pine',
    name: 'Pine plank',
    description: 'Softwood. Splinters along the grain and blows out a ragged exit spall.',
    behaviour: 'wood',
    look: 'pine',
    density: 500,
    thickness: { min: 0.019, max: 0.15, default: 0.038 },
    heightM: 0.3,
    widthM: 0.14,
    angleAdjustable: true,
    dragCoefficient: 0.4,
    resistancePa: 25e6,
    hardness: 0.15,
    ricochetAngleDeg: 80,
    yawNeckScale: 0.5,
  },
  {
    id: 'oak',
    name: 'Oak plank',
    description: 'Dense hardwood. Much tougher than pine; tighter splintering and a smaller exit hole.',
    behaviour: 'wood',
    look: 'oak',
    density: 750,
    thickness: { min: 0.02, max: 0.15, default: 0.05 },
    heightM: 0.3,
    widthM: 0.14,
    angleAdjustable: true,
    dragCoefficient: 0.45,
    resistancePa: 45e6,
    hardness: 0.25,
    ricochetAngleDeg: 78,
    yawNeckScale: 0.45,
  },
  {
    id: 'drywall',
    name: 'Drywall',
    description: 'A gypsum board with paper faces. Bullets pass straight through in a puff of white dust.',
    behaviour: 'drywall',
    look: 'drywall',
    density: 700,
    thickness: { min: 0.0095, max: 0.025, default: 0.0127 },
    heightM: 0.3,
    widthM: 0.3,
    angleAdjustable: true,
    dragCoefficient: 0.4,
    resistancePa: 8e6,
    hardness: 0.1,
    ricochetAngleDeg: 85,
    yawNeckScale: 0.5,
  },
  {
    id: 'concrete',
    name: 'Concrete block',
    description: 'Solid cast concrete. Craters, flying chips and a dust cloud; bullets flatten or fragment and can ricochet at shallow angles.',
    behaviour: 'concrete',
    look: 'concrete',
    density: 2300,
    thickness: { min: 0.1, max: 0.4, default: 0.19 },
    heightM: 0.19,
    widthM: 0.39,
    angleAdjustable: true,
    dragCoefficient: 0.9,
    resistancePa: 350e6,
    hardness: 0.7,
    ricochetAngleDeg: 65,
    yawNeckScale: 0.1,
  },
  {
    id: 'steel-mild',
    name: 'Steel plate (mild)',
    description: 'Ordinary structural steel. Handgun rounds splash and dent it; rifle rounds can punch through.',
    behaviour: 'steel',
    look: 'mildSteel',
    density: 7850,
    thickness: { min: 0.002, max: 0.025, default: 0.006 },
    heightM: 0.3,
    widthM: 0.2,
    angleAdjustable: true,
    dragCoefficient: 1.0,
    resistancePa: 1.2e9,
    hardness: 0.75,
    ricochetAngleDeg: 60,
    yawNeckScale: 0.05,
  },
  {
    id: 'steel-ar500',
    name: 'Steel plate (AR500)',
    description: 'Hardened armour steel used for shooting targets. Most bullets splash into fragments and leave only a mark.',
    behaviour: 'steel',
    look: 'ar500',
    density: 7850,
    thickness: { min: 0.006, max: 0.02, default: 0.0095 },
    heightM: 0.3,
    widthM: 0.2,
    angleAdjustable: true,
    dragCoefficient: 1.0,
    resistancePa: 3.2e9,
    hardness: 1.0,
    ricochetAngleDeg: 55,
    yawNeckScale: 0.05,
  },
  {
    id: 'sandbag',
    name: 'Sandbag',
    description: 'A filled burlap sandbag. Grains scatter and absorb energy fast; stops most rounds within a bag.',
    behaviour: 'sand',
    look: 'sandbag',
    density: 1600,
    thickness: { min: 0.15, max: 0.5, default: 0.25 },
    heightM: 0.14,
    widthM: 0.35,
    angleAdjustable: false,
    dragCoefficient: 0.8,
    resistancePa: 40e6,
    hardness: 0.35,
    yawNeckScale: 0.15,
  },
  {
    id: 'glass',
    name: 'Glass pane',
    description: 'Float glass. Radial and concentric cracks spread from the hole, shards fly, and the bullet is deflected.',
    behaviour: 'glass',
    look: 'glass',
    density: 2500,
    thickness: { min: 0.003, max: 0.02, default: 0.006 },
    heightM: 0.3,
    widthM: 0.3,
    angleAdjustable: true,
    dragCoefficient: 0.9,
    resistancePa: 60e6, // brittle: little energy to perforate, but high deflection
    hardness: 0.6,
    ricochetAngleDeg: 82,
    yawNeckScale: 0.2,
  },
  {
    id: 'ice',
    name: 'Ice block',
    description: 'A clear block of ice. Brittle and hard: cracks spider out and chunks burst from the entry and exit.',
    behaviour: 'ice',
    look: 'ice',
    density: 917,
    thickness: { min: 0.1, max: 0.6, default: 0.3 },
    heightM: 0.2,
    widthM: 0.2,
    angleAdjustable: false,
    dragCoefficient: 0.5,
    resistancePa: 15e6,
    hardness: 0.3,
    yawNeckScale: 0.5,
  },
];

export const DEFAULT_MEDIUM_ID = 'gel10';

export function getMedium(id: string): MediumSpec {
  const medium = MEDIA.find((m) => m.id === id);
  if (!medium) throw new Error(`Unknown medium id: ${id}`);
  return medium;
}

/** Maximum impact angle the control allows, in degrees from head-on. */
export const MAX_IMPACT_ANGLE_DEG = 75;
