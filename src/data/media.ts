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
  | 'ice' // brittle, cracks and chunks
  | 'plastic' // thin polymer: a clean hole, a few white chips (#240)
  | 'bone'; // bone simulant: hard, brittle, cracks and throws fragments

/** Which procedural look builds the target. */
export type MediumLook =
  | 'gel'
  | 'waterTank'
  | 'pine'
  | 'oak'
  | 'drywall'
  | 'concrete'
  | 'cinderBlock'
  | 'mildSteel'
  /** Car door skins (#60): mild steel physics, painted outer and primed inner panel. */
  | 'carDoorOuter'
  | 'carDoorInner'
  | 'ar500'
  | 'sandbag'
  | 'glass'
  | 'ice'
  | 'bone'
  /** Milky polyethylene, a water jug's wall (#240). */
  | 'plasticJug'
  /** A phone's battery pouch: dark laminate (#240). */
  | 'phoneCell'
  // Showpiece objects (#156)
  | 'bowlingBall'
  | 'steelBall'
  | 'gong'
  | 'watermelon'
  | 'bottle';

/**
 * Outline of a showpiece object across the shot line (#156). Slabs leave it
 * out. The path through the object, and where the aim may go, follow it.
 * - sphere / ellipsoid: round in both directions (the shot line runs through its depth).
 * - cylinder: an upright cylinder, round across (z) and straight up and down (y).
 * - disc: a flat disc facing the shooter, round on the face but of even thickness.
 */
export type ObjectShape = 'sphere' | 'ellipsoid' | 'cylinder' | 'disc';

export interface RangeM {
  min: number;
  max: number;
  default: number;
}

/** Debris of a concrete panel, per grade (#224). Sizes in metres, speeds in m/s, counts for a full-weight round. */
export interface ConcreteDebris {
  /** Time from impact until the back scab lets go, in seconds. */
  scabReleaseS: number;
  /** Front blow-back cloud: particle count and how long it lingers, as a multiple of a normal dust puff. */
  frontDust: number;
  frontLife: number;
  /** Cloud thrown with the scab, and how long it lingers. */
  rearDust: number;
  rearLife: number;
  /** Angular chips thrown with the scab. */
  chips: { count: number; size: readonly [number, number]; speed: readonly [number, number] };
  /** A few big pieces of the scab, for the strongest grade. */
  slabs?: { count: number; size: readonly [number, number]; speed: readonly [number, number] };
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
  /** Hollow targets: wall thickness of the front and back shells, in metres; the rest is air. */
  shellM?: number;
  /**
   * Gel-like media only: effective pressure that sets the temporary cavity size from the
   * energy deposited per metre (radius = √(dE/dx ÷ π·p)). Lower = bigger cavity.
   */
  cavityPressurePa?: number;
  /** Whether hollow and soft points can open in this medium (soft, wet media). */
  allowsExpansion: boolean;
  /** Extra random deflection of the path on leaving a layer (brittle panes), in degrees. */
  exitDeflectionDeg?: number;
  /** Organic gel targets: which blood-pack layout is suspended inside (see `data/organic.ts`). */
  organicLayout?: string;
  /** Parts that only appear inside a preset (the test dummy's simulants #25, a phone's layers #240), not in the material list. */
  dummyOnly?: boolean;
  /** Proving-ground sized targets (#232): listed in Artillery, Missile and Explosion, never in the Bullet lab. */
  heavy?: boolean;
  /** Showpiece objects (#156): listed under Objects in the picker, with their own outline. */
  shape?: ObjectShape;
  /**
   * Concrete panels (#225): the bullet loses most of its speed crossing the panel (about 0.5 ms), then keeps
   * slowing gently while it drags through the broken back scab. Deceleration in m/s² and how long it lasts.
   * `burst` is an optional short, hard phase first: the slug shoving the scab it has just broken free.
   */
  exitTail?: { decelMs2: number; durationS: number; burst?: { decelMs2: number; durationS: number } };
  /**
   * Concrete panels (#223): measured damage footprints, width × height in metres, for the front spall and the
   * back scab at the reference thickness. They grow or shrink with the panel thickness (see fx/concreteDamage.ts).
   */
  concreteDamage?: {
    spallM: readonly [number, number];
    scabM: readonly [number, number];
    refThicknessM: number;
    /** What the panel throws (#224): when the scab lets go, and the dust, chips and slabs it sheds. */
    debris: ConcreteDebris;
  };
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
    resistancePa: 6.0e6, // with Cd 0.3 these give 9mm FMJ ≈ 65 cm, 9mm JHP ≈ 35 cm, .22 LR ≈ 28 cm
    hardness: 0.02,
    yawNeckScale: 1,
    cavityPressurePa: 0.9e6, // 9mm JHP ≈ 8 cm peak cavity
    allowsExpansion: true,
  },
  {
    id: 'gel-bloodpack',
    name: 'Gel + blood pack',
    description:
      'MythBusters style: a gel block with a sachet of fake blood on the bullet path. Watch it rupture and the red fluid squirt out of the wound channel.',
    behaviour: 'gel',
    look: 'gel',
    density: 1030,
    thickness: { min: 0.2, max: 0.6, default: 0.4 },
    heightM: 0.15,
    widthM: 0.15,
    angleAdjustable: false,
    dragCoefficient: 0.3,
    resistancePa: 6.0e6,
    hardness: 0.02,
    yawNeckScale: 1,
    cavityPressurePa: 0.9e6,
    allowsExpansion: true,
    organicLayout: 'single',
  },
  {
    id: 'gel-bloodpacks',
    name: 'Gel + blood pack cluster',
    description:
      'Several blood packs at different depths and heights. Packs on the path burst on contact; the temporary cavity bursts nearby ones if it grows big enough.',
    behaviour: 'gel',
    look: 'gel',
    density: 1030,
    thickness: { min: 0.3, max: 0.6, default: 0.45 },
    heightM: 0.18,
    widthM: 0.18,
    angleAdjustable: false,
    dragCoefficient: 0.3,
    resistancePa: 6.0e6,
    hardness: 0.02,
    yawNeckScale: 1,
    cavityPressurePa: 0.9e6,
    allowsExpansion: true,
    organicLayout: 'cluster',
  },
  {
    id: 'gel-torso',
    name: 'Gel torso (organ packs + spine)',
    description:
      'A torso-sized gel block with blood packs where the heart, lungs and liver would be and a synthetic spine rod at the back.',
    behaviour: 'gel',
    look: 'gel',
    density: 1030,
    thickness: { min: 0.22, max: 0.32, default: 0.26 },
    heightM: 0.32,
    widthM: 0.3,
    angleAdjustable: false,
    dragCoefficient: 0.3,
    resistancePa: 6.0e6,
    hardness: 0.02,
    yawNeckScale: 1,
    cavityPressurePa: 0.9e6,
    allowsExpansion: true,
    organicLayout: 'torso',
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
    cavityPressurePa: 0.6e6, // water cavitates more freely than gel
    allowsExpansion: true,
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
    resistancePa: 50e6, // 9mm FMJ ≈ 15 cm of pine
    hardness: 0.15,
    ricochetAngleDeg: 80,
    yawNeckScale: 0.5,
    allowsExpansion: false, // hollow points clog with wood fibre
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
    resistancePa: 90e6,
    hardness: 0.25,
    ricochetAngleDeg: 78,
    yawNeckScale: 0.45,
    allowsExpansion: false,
  },
  {
    id: 'plywood',
    name: 'Plywood (18 mm)',
    description: 'Glued wood veneers. Tougher across than pine, with a splintered, layered exit.',
    behaviour: 'wood',
    look: 'pine',
    density: 600,
    thickness: { min: 0.006, max: 0.036, default: 0.018 },
    heightM: 0.4,
    widthM: 0.4,
    angleAdjustable: true,
    dragCoefficient: 0.42,
    resistancePa: 60e6,
    hardness: 0.2,
    ricochetAngleDeg: 80,
    yawNeckScale: 0.5,
    allowsExpansion: false,
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
    allowsExpansion: false, // gypsum plugs hollow points
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
    allowsExpansion: false,
  },
  // Concrete panels by cube strength (#222). Tuned so the reference projectile (data/concreteReference.ts)
  // meets the measured ballistic limits and residual speeds; see data/concreteGrades.test.ts.
  {
    id: 'concrete-c35',
    name: 'Concrete panel C35 (47 MPa)',
    description: 'Normal-strength concrete slab. Perforates at about 120 m/s with a wide back scab and a heavy dust cloud.',
    behaviour: 'concrete',
    look: 'concrete',
    density: 2300,
    thickness: { min: 0.03, max: 0.15, default: 0.045 },
    heightM: 0.6,
    widthM: 0.6,
    angleAdjustable: true,
    dragCoefficient: 2.4,
    resistancePa: 48e6,
    // The C35 trace is at 68 m/s 0.1 ms after the bullet leaves the panel at about 76 (#225): it loses about
    // 7 m/s in the first 0.1 ms shoving the loose scab, then slows at about 6 m/s per ms (55 m/s at 2.7 ms).
    exitTail: { decelMs2: 6000, durationS: 2e-3, burst: { decelMs2: 70000, durationS: 1e-4 } },
    hardness: 0.6,
    ricochetAngleDeg: 65,
    yawNeckScale: 0.1,
    allowsExpansion: false,
    concreteDamage: {
      spallM: [0.08, 0.07],
      scabM: [0.15, 0.13],
      refThicknessM: 0.045,
      // Many small pieces and a heavy dust cloud.
      debris: { scabReleaseS: 1.8e-3, frontDust: 150, frontLife: 1, rearDust: 210, rearLife: 1, chips: { count: 80, size: [0.0012, 0.005], speed: [15, 60] } },
    },
  },
  {
    id: 'concrete-c75',
    name: 'Concrete panel C75 (87 MPa)',
    description: 'High-strength concrete slab. Perforates at about 140 m/s; fewer, larger chips.',
    behaviour: 'concrete',
    look: 'concrete',
    density: 2400,
    thickness: { min: 0.03, max: 0.15, default: 0.045 },
    heightM: 0.6,
    widthM: 0.6,
    angleAdjustable: true,
    dragCoefficient: 1.5,
    resistancePa: 72e6,
    exitTail: { decelMs2: 4000, durationS: 2e-3 },
    hardness: 0.65,
    ricochetAngleDeg: 65,
    yawNeckScale: 0.1,
    allowsExpansion: false,
    concreteDamage: {
      spallM: [0.1, 0.1],
      scabM: [0.18, 0.16],
      refThicknessM: 0.045,
      // Fewer, bigger chips and less dust.
      debris: { scabReleaseS: 2.2e-3, frontDust: 115, frontLife: 1.2, rearDust: 160, rearLife: 1.2, chips: { count: 50, size: [0.0025, 0.0075], speed: [12, 48] } },
    },
  },
  {
    id: 'concrete-c110',
    name: 'Concrete panel C110 (123 MPa)',
    description: 'Ultra-high-strength concrete slab. Perforates at about 153 m/s and breaks into a few large slabs.',
    behaviour: 'concrete',
    look: 'concrete',
    density: 2450,
    thickness: { min: 0.03, max: 0.15, default: 0.045 },
    heightM: 0.6,
    widthM: 0.6,
    angleAdjustable: true,
    dragCoefficient: 2.4,
    resistancePa: 76e6,
    exitTail: { decelMs2: 3500, durationS: 2e-3 },
    hardness: 0.7,
    ricochetAngleDeg: 65,
    yawNeckScale: 0.1,
    allowsExpansion: false,
    concreteDamage: {
      spallM: [0.08, 0.09],
      scabM: [0.22, 0.2],
      refThicknessM: 0.045,
      // A few large slabs, and the front cloud that lasts longest.
      debris: {
        scabReleaseS: 2.8e-3,
        frontDust: 95,
        frontLife: 1.8,
        rearDust: 190,
        rearLife: 1.8,
        chips: { count: 44, size: [0.003, 0.008], speed: [10, 36] },
        slabs: { count: 3, size: [0.02, 0.035], speed: [8, 30] },
      },
    },
  },
  {
    id: 'cinder-block',
    name: 'Cinder block (hollow)',
    description: 'A hollow concrete masonry block. The bullet punches the front shell, crosses the open core in a swirl of dust, then blasts a plume of grit out of the back shell.',
    behaviour: 'concrete',
    look: 'cinderBlock',
    density: 2100,
    thickness: { min: 0.14, max: 0.24, default: 0.19 },
    heightM: 0.3,
    widthM: 0.19,
    angleAdjustable: true,
    dragCoefficient: 0.9,
    resistancePa: 300e6, // slightly weaker block concrete than solid cast
    hardness: 0.65,
    ricochetAngleDeg: 65,
    yawNeckScale: 0.1,
    shellM: 0.032,
    allowsExpansion: false,
  },
  {
    id: 'steel-mild',
    name: 'Steel plate (mild)',
    description: 'Ordinary structural steel. Handgun rounds splash and dent it; rifle rounds can punch through.',
    behaviour: 'steel',
    look: 'mildSteel',
    density: 7850,
    thickness: { min: 0.0008, max: 0.025, default: 0.006 },
    heightM: 0.3,
    widthM: 0.2,
    angleAdjustable: true,
    dragCoefficient: 1.0,
    resistancePa: 1.2e9,
    hardness: 0.75,
    ricochetAngleDeg: 60,
    yawNeckScale: 0.05,
    allowsExpansion: false,
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
    allowsExpansion: false,
  },
  {
    id: 'aluminum',
    name: 'Aluminium plate',
    description: 'Soft light metal. Handgun rounds dent it and stop; rifle rounds punch through and throw fragments out the back.',
    behaviour: 'steel',
    look: 'mildSteel',
    density: 2700,
    thickness: { min: 0.001, max: 0.025, default: 0.006 },
    heightM: 0.3,
    widthM: 0.2,
    angleAdjustable: true,
    dragCoefficient: 0.9,
    resistancePa: 1.15e9,
    hardness: 0.45,
    ricochetAngleDeg: 62,
    yawNeckScale: 0.1,
    allowsExpansion: false,
  },
  {
    id: 'brick',
    name: 'Brick wall',
    description: 'Fired clay brick. Handgun rounds only chip the face; rifle rounds bury deep, and heavy rifle rounds go through.',
    behaviour: 'concrete',
    look: 'concrete',
    density: 1900,
    thickness: { min: 0.05, max: 0.23, default: 0.09 },
    heightM: 0.3,
    widthM: 0.3,
    angleAdjustable: true,
    dragCoefficient: 1.0,
    resistancePa: 120e6,
    hardness: 0.55,
    ricochetAngleDeg: 70,
    yawNeckScale: 0.1,
    allowsExpansion: false,
  },
  {
    id: 'cardboard',
    name: 'Cardboard box',
    description: 'Corrugated cardboard. Barely slows a bullet, but plugs hollow points.',
    behaviour: 'drywall',
    look: 'drywall',
    density: 150,
    thickness: { min: 0.003, max: 0.05, default: 0.01 },
    heightM: 0.3,
    widthM: 0.3,
    angleAdjustable: true,
    dragCoefficient: 0.3,
    resistancePa: 2e6,
    hardness: 0.05,
    ricochetAngleDeg: 85,
    yawNeckScale: 0.5,
    allowsExpansion: false,
  },
  {
    id: 'phonebook',
    name: 'Phone book',
    description: 'A thick stack of paper. Soaks up pistol rounds better than it looks.',
    behaviour: 'wood',
    look: 'pine',
    density: 700,
    thickness: { min: 0.03, max: 0.12, default: 0.06 },
    heightM: 0.25,
    widthM: 0.2,
    angleAdjustable: true,
    dragCoefficient: 0.5,
    resistancePa: 80e6,
    hardness: 0.1,
    ricochetAngleDeg: 80,
    yawNeckScale: 0.5,
    allowsExpansion: false,
  },
  {
    id: 'sheet-metal',
    name: 'Sheet metal (1 mm)',
    description: 'Thin steel sheet, like a roof panel or car skin. Offers little resistance.',
    behaviour: 'steel',
    look: 'mildSteel',
    density: 7850,
    thickness: { min: 0.0005, max: 0.003, default: 0.001 },
    heightM: 0.3,
    widthM: 0.3,
    angleAdjustable: true,
    dragCoefficient: 0.9,
    resistancePa: 0.9e9,
    hardness: 0.6,
    ricochetAngleDeg: 65,
    yawNeckScale: 0.05,
    allowsExpansion: false,
  },
  {
    id: 'acrylic',
    name: 'Acrylic (Plexiglas)',
    description: 'Clear plastic sheet. Cracks and shatters when a fast round goes through.',
    behaviour: 'glass',
    look: 'glass',
    density: 1180,
    thickness: { min: 0.003, max: 0.05, default: 0.012 },
    heightM: 0.3,
    widthM: 0.3,
    angleAdjustable: true,
    dragCoefficient: 0.5,
    resistancePa: 100e6,
    hardness: 0.3,
    ricochetAngleDeg: 80,
    yawNeckScale: 0.3,
    allowsExpansion: false,
  },
  // Heavy targets for artillery, missile and explosion tests (#180-#182): big faces, thick sections.
  {
    id: 'rha',
    name: 'Armour plate (rolled steel)',
    description: 'Thick rolled homogeneous armour. Defeats nearly everything small; only heavy shot and shaped-charge jets get through.',
    behaviour: 'steel',
    look: 'ar500',
    density: 7850,
    thickness: { min: 0.02, max: 1.0, default: 0.1 },
    heightM: 1.0,
    widthM: 1.0,
    angleAdjustable: true,
    dragCoefficient: 1.0,
    resistancePa: 3.0e9,
    hardness: 1.0,
    ricochetAngleDeg: 68,
    yawNeckScale: 0.05,
    allowsExpansion: false,
    heavy: true,
  },
  {
    id: 'rha-plate',
    name: 'Large RHA plate',
    description: 'Rolled homogeneous armour at proving-ground size (3 x 2 m face, up to 300 mm). HE and HESH do little to it; AP and long-rod shot are what it is for.',
    behaviour: 'steel',
    look: 'ar500',
    density: 7850,
    thickness: { min: 0.05, max: 0.3, default: 0.1 },
    heightM: 2,
    widthM: 3,
    angleAdjustable: true,
    dragCoefficient: 1.0,
    resistancePa: 3.0e9,
    hardness: 1.0,
    ricochetAngleDeg: 68,
    yawNeckScale: 0.05,
    allowsExpansion: false,
    heavy: true,
  },
  {
    id: 'mild-plate',
    name: 'Large mild steel plate',
    description: 'Structural steel plate at proving-ground size. Soft and ductile: thin sections are holed by HE fragments and shells, and it dishes and tears rather than shattering.',
    behaviour: 'steel',
    look: 'mildSteel',
    density: 7850,
    thickness: { min: 0.005, max: 0.1, default: 0.02 },
    heightM: 2,
    widthM: 3,
    angleAdjustable: true,
    dragCoefficient: 1.0,
    resistancePa: 1.2e9,
    hardness: 0.75,
    ricochetAngleDeg: 70,
    yawNeckScale: 0.05,
    allowsExpansion: false,
    heavy: true,
  },
  {
    id: 'ar500-plate',
    name: 'Large AR500 plate',
    description: 'Through-hardened 500 HB plate at proving-ground size. Shatters soft shot and ricochets glancing hits; thick sections stop most shells.',
    behaviour: 'steel',
    look: 'ar500',
    density: 7850,
    thickness: { min: 0.01, max: 0.15, default: 0.025 },
    heightM: 2,
    widthM: 3,
    angleAdjustable: true,
    dragCoefficient: 1.0,
    resistancePa: 3.2e9,
    hardness: 1.0,
    ricochetAngleDeg: 66,
    yawNeckScale: 0.05,
    allowsExpansion: false,
    heavy: true,
  },
  {
    id: 'cast-iron-plate',
    name: 'Large cast iron plate',
    description: 'Grey cast iron at proving-ground size. Hard but brittle: it cracks and throws heavy spall, and fails sooner than steel of the same thickness.',
    behaviour: 'steel',
    look: 'mildSteel',
    density: 7200,
    thickness: { min: 0.02, max: 0.3, default: 0.1 },
    heightM: 2,
    widthM: 3,
    angleAdjustable: true,
    dragCoefficient: 1.0,
    resistancePa: 1.6e9,
    hardness: 0.9,
    ricochetAngleDeg: 64,
    yawNeckScale: 0.05,
    allowsExpansion: false,
    heavy: true,
  },
  {
    id: 'reinforced-concrete',
    name: 'Reinforced concrete wall',
    description: 'A thick wall of concrete with steel bars. Craters, spalls and cracks; only large shells go all the way.',
    behaviour: 'concrete',
    look: 'concrete',
    density: 2400,
    thickness: { min: 0.1, max: 1.5, default: 0.4 },
    heightM: 1.0,
    widthM: 1.0,
    angleAdjustable: true,
    dragCoefficient: 0.9,
    resistancePa: 750e6,
    hardness: 0.75,
    ricochetAngleDeg: 66,
    yawNeckScale: 0.1,
    allowsExpansion: false,
  },
  {
    id: 'packed-earth',
    name: 'Packed earth berm',
    description: 'A compacted earth bank. It soaks up energy over a long path and throws up a column of soil.',
    behaviour: 'sand',
    look: 'sandbag',
    density: 1800,
    thickness: { min: 0.3, max: 3, default: 1 },
    heightM: 1.0,
    widthM: 1.2,
    angleAdjustable: false,
    dragCoefficient: 1.1,
    resistancePa: 25e6,
    hardness: 0.1,
    yawNeckScale: 0.3,
    allowsExpansion: false,
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
    allowsExpansion: true,
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
    allowsExpansion: false,
    exitDeflectionDeg: 4,
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
    allowsExpansion: false,
  },
  // --- Test dummy simulants (#25). Clinical lab materials, tuned like the gel they sit in. ---
  {
    id: 'bone-sim',
    name: 'Bone simulant',
    description: 'Synthetic bone (skull, ribs, spine): a hard, brittle polymer shell that cracks and throws fragments.',
    behaviour: 'bone',
    look: 'bone',
    density: 1900,
    thickness: { min: 0.004, max: 0.04, default: 0.007 },
    heightM: 0.12,
    widthM: 0.1,
    angleAdjustable: false,
    dragCoefficient: 0.6,
    resistancePa: 120e6, // a 7 mm skull plate takes roughly 60-120 m/s off a handgun round
    hardness: 0.45,
    yawNeckScale: 0.5,
    allowsExpansion: false,
    exitDeflectionDeg: 4,
    dummyOnly: true,
  },
  {
    id: 'brain-sim',
    name: 'Brain simulant',
    description: 'Soft brain-simulant gel inside the skull. Shows a violent temporary cavity on a head shot.',
    behaviour: 'gel',
    look: 'gel',
    density: 1040,
    thickness: { min: 0.05, max: 0.2, default: 0.14 },
    heightM: 0.16,
    widthM: 0.12,
    angleAdjustable: false,
    dragCoefficient: 0.3,
    resistancePa: 4.5e6,
    hardness: 0.01,
    yawNeckScale: 1,
    cavityPressurePa: 0.75e6,
    allowsExpansion: true,
    dummyOnly: true,
  },
  {
    id: 'lung-sim',
    name: 'Lung simulant',
    description: 'Low-density, foam-like gel standing in for lung tissue.',
    behaviour: 'gel',
    look: 'gel',
    density: 450,
    thickness: { min: 0.03, max: 0.15, default: 0.1 },
    heightM: 0.2,
    widthM: 0.14,
    angleAdjustable: false,
    dragCoefficient: 0.25,
    resistancePa: 1.5e6,
    hardness: 0.01,
    yawNeckScale: 1.6,
    cavityPressurePa: 0.6e6,
    allowsExpansion: true,
    dummyOnly: true,
  },
  {
    id: 'organ-sim',
    name: 'Organ simulant',
    description: 'Denser gel inserts standing in for the liver and other abdominal organs.',
    behaviour: 'gel',
    look: 'gel',
    density: 1060,
    thickness: { min: 0.03, max: 0.2, default: 0.13 },
    heightM: 0.18,
    widthM: 0.3,
    angleAdjustable: false,
    dragCoefficient: 0.32,
    resistancePa: 7e6,
    hardness: 0.03,
    yawNeckScale: 1,
    cavityPressurePa: 1.0e6,
    allowsExpansion: true,
    dummyOnly: true,
  },
  {
    id: 'polyethylene',
    name: 'Polyethylene sheet (jug wall)',
    description: 'Thin milky HDPE, like a gallon water jug. A bullet makes a clean hole and barely notices it.',
    behaviour: 'plastic',
    look: 'plasticJug',
    density: 950,
    thickness: { min: 0.0005, max: 0.006, default: 0.001 },
    heightM: 0.25,
    widthM: 0.2,
    angleAdjustable: true,
    dragCoefficient: 0.5,
    resistancePa: 25e6, // HDPE yield strength
    hardness: 0.05,
    yawNeckScale: 0.1,
    allowsExpansion: false,
  },
  // Smartphone layers (#240): 150 x 75 mm, each only in the Smartphone preset.
  {
    id: 'phone-glass',
    name: 'Phone display glass',
    description: 'Chemically strengthened cover glass, 0.7 mm.',
    behaviour: 'glass',
    look: 'glass',
    density: 2450,
    thickness: { min: 0.0005, max: 0.002, default: 0.0007 },
    heightM: 0.15,
    widthM: 0.075,
    angleAdjustable: true,
    dragCoefficient: 0.9,
    resistancePa: 60e6,
    hardness: 0.6,
    ricochetAngleDeg: 82,
    yawNeckScale: 0.2,
    allowsExpansion: false,
    exitDeflectionDeg: 3,
    dummyOnly: true,
  },
  {
    id: 'phone-cell',
    name: 'Phone battery pouch',
    description: 'Lithium-polymer pouch cell: foil and polymer laminate about 4 mm thick.',
    behaviour: 'plastic',
    look: 'phoneCell',
    density: 2400,
    thickness: { min: 0.002, max: 0.008, default: 0.004 },
    heightM: 0.15,
    widthM: 0.075,
    angleAdjustable: true,
    dragCoefficient: 0.6,
    resistancePa: 40e6,
    hardness: 0.05,
    yawNeckScale: 0.1,
    allowsExpansion: false,
    dummyOnly: true,
  },
  {
    id: 'phone-frame',
    name: 'Phone aluminium back',
    description: 'A thin aluminium back plate and frame, 0.8 mm.',
    behaviour: 'steel',
    look: 'mildSteel',
    density: 2700,
    thickness: { min: 0.0005, max: 0.002, default: 0.0008 },
    heightM: 0.15,
    widthM: 0.075,
    angleAdjustable: true,
    dragCoefficient: 0.9,
    resistancePa: 1.15e9,
    hardness: 0.45,
    ricochetAngleDeg: 62,
    yawNeckScale: 0.1,
    allowsExpansion: false,
    dummyOnly: true,
  },
  // --- Showpiece objects (#156): everyday things to destroy, with their own models and effects. ---
  {
    id: 'bowling-ball',
    name: 'Bowling ball',
    description:
      'A 16 lb ball: a hard polyurethane shell round a dense resin core. Pistol rounds flatten and bury themselves in it; rifle rounds crack it open in a burst of chunks and dust.',
    behaviour: 'concrete',
    look: 'bowlingBall',
    shape: 'sphere',
    density: 1375, // 7.26 kg in a 21.6 cm sphere
    thickness: { min: 0.216, max: 0.216, default: 0.216 },
    heightM: 0.216,
    widthM: 0.216,
    angleAdjustable: false,
    dragCoefficient: 0.8,
    resistancePa: 150e6, // 9mm FMJ ≈ 6 cm in, .308 just through
    hardness: 0.5,
    yawNeckScale: 0.15,
    allowsExpansion: false,
  },
  {
    id: 'steel-ball',
    name: 'Steel ball (10 cm)',
    description: 'A solid ball of hardened steel. Every round splashes against it in a flash of sparks and a flat disc of lead spray; the ball only takes a bright mark.',
    behaviour: 'steel',
    look: 'steelBall',
    shape: 'sphere',
    density: 7850,
    thickness: { min: 0.1, max: 0.1, default: 0.1 },
    heightM: 0.1,
    widthM: 0.1,
    angleAdjustable: false,
    dragCoefficient: 1.0,
    resistancePa: 3.6e9,
    hardness: 1.0,
    ricochetAngleDeg: 55,
    yawNeckScale: 0.05,
    allowsExpansion: false,
  },
  {
    id: 'gong',
    name: 'Steel gong (swinging plate)',
    description: 'A round mild-steel plate hung on two chains. Pistol rounds dent it in a shower of sparks and set it shuddering; rifle rounds punch a glowing hole straight through.',
    behaviour: 'steel',
    look: 'gong',
    shape: 'disc',
    density: 7850,
    thickness: { min: 0.003, max: 0.012, default: 0.006 },
    heightM: 0.3,
    widthM: 0.3,
    angleAdjustable: false,
    dragCoefficient: 1.0,
    resistancePa: 1.2e9,
    hardness: 0.75,
    ricochetAngleDeg: 60,
    yawNeckScale: 0.05,
    allowsExpansion: false,
  },
  {
    id: 'watermelon',
    name: 'Watermelon',
    description:
      'The classic. A tough rind round flesh that is over 90% water. A fast rifle round sets off a hydrodynamic burst: the rind splits outward and the red flesh sprays across the lab.',
    behaviour: 'water',
    look: 'watermelon',
    shape: 'ellipsoid',
    density: 960,
    // Lying on its side, shot end to end, so the side camera sees its full length.
    thickness: { min: 0.3, max: 0.3, default: 0.3 },
    heightM: 0.2,
    widthM: 0.2,
    angleAdjustable: false,
    dragCoefficient: 0.35,
    resistancePa: 0.8e6, // a little firmer than water
    hardness: 0.02,
    yawNeckScale: 0.7,
    cavityPressurePa: 0.6e6,
    allowsExpansion: true,
  },
  {
    id: 'bottle',
    name: 'Glass bottle of water',
    description: 'A litre glass bottle, full. The glass shatters into a cloud of shards while the water inside bursts outward from the shot line.',
    behaviour: 'water',
    look: 'bottle',
    shape: 'cylinder',
    density: 1000,
    thickness: { min: 0.085, max: 0.085, default: 0.085 },
    heightM: 0.18, // the straight body; the shoulder and neck rise above it
    widthM: 0.085,
    angleAdjustable: false,
    dragCoefficient: 0.35,
    resistancePa: 1.5e6, // water plus two thin glass walls
    hardness: 0.1,
    yawNeckScale: 0.6,
    cavityPressurePa: 0.6e6,
    allowsExpansion: true,
  },
];

/** The large steel plates (#232), listed in Artillery and Missile. The 1 x 1 m `rha` stays as the small test coupon. */
export const LARGE_PLATE_IDS = ['rha-plate', 'mild-plate', 'ar500-plate', 'cast-iron-plate'] as const;

/** Missile targets are at least this big across the smaller side of the face, in metres (#245). */
export const MISSILE_MIN_FACE_M = 2;

/**
 * Whether a mode's material picker lists this medium (#245): heavy targets never appear in the Bullet lab,
 * and Missile lists only targets a missile could sensibly be fired at, never the bullet-scale blocks.
 */
export function mediumListedIn(medium: MediumSpec, mode: string): boolean {
  if (medium.dummyOnly) return false;
  if (mode === 'missile') return Math.min(medium.heightM, medium.widthM) >= MISSILE_MIN_FACE_M;
  return !medium.heavy || mode !== 'bullet';
}

export const DEFAULT_MEDIUM_ID = 'gel10';

export function getMedium(id: string): MediumSpec {
  const medium = MEDIA.find((m) => m.id === id);
  if (!medium) throw new Error(`Unknown medium id: ${id}`);
  return medium;
}

/** Maximum impact angle the control allows, in degrees from head-on. */
export const MAX_IMPACT_ANGLE_DEG = 75;
