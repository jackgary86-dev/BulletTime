/**
 * Armor lab (#157): the projectile catalogue, described only by each family's
 * state at the moment it reaches the plate: material, diameter, length, mass
 * and velocity, and for a shaped-charge jet its tip and tail velocity and
 * effective length. Nothing about how a munition is designed or built is
 * modelled; the models only need what arrives at the plate.
 *
 * Proportions are typical, openly published figures (rounded), scaled with
 * the gun calibre. They are a simplified teaching model.
 */

export type MunitionFamilyId = 'ap-shot' | 'apfsds' | 'heat' | 'hesh' | 'he-frag';

/** Projectile (or jet) material at impact. */
export type PenetratorMaterial = 'steel' | 'tungsten-alloy' | 'copper';

export const PENETRATOR_DENSITY: Record<PenetratorMaterial, number> = {
  steel: 7850,
  'tungsten-alloy': 17600,
  copper: 8960,
};

/** Yield strength of the penetrator material, Pa (the Tate model's Yp). */
export const PENETRATOR_YIELD: Record<PenetratorMaterial, number> = {
  steel: 1.2e9,
  'tungsten-alloy': 1.5e9,
  copper: 0.3e9,
};

export const MIN_CALIBRE_MM = 40;
export const MAX_CALIBRE_MM = 150;

export interface MunitionFamily {
  id: MunitionFamilyId;
  name: string;
  /** One line for the picker. */
  description: string;
  /** A short classroom paragraph on how it defeats (or fails to defeat) the plate. */
  explainer: string;
  /** Impact velocity of the projectile, m/s: the user can pick anything in [min, max]. */
  velocity: { min: number; max: number; default: number };
}

export const MUNITION_FAMILIES: MunitionFamily[] = [
  {
    id: 'ap-shot',
    name: 'Full-bore AP shot',
    description: 'A solid hardened-steel shot as wide as the gun bore, at 800–1,000 m/s.',
    explainer:
      'A blunt, heavy steel shot pushes the plate ahead of it. The metal deforms plastically round the nose; in a thin enough plate the shot shears out a plug and punches through. Penetration grows with mass and velocity and falls quickly with plate thickness and slope (De Marre ballistic limit).',
    velocity: { min: 700, max: 1050, default: 900 },
  },
  {
    id: 'apfsds',
    name: 'APFSDS long rod',
    description: 'A long, thin tungsten-alloy rod at 1,400–1,800 m/s.',
    explainer:
      'At these speeds the pressure at the rod tip is far above the strength of either metal, so rod and plate both flow like fluids. The rod head mushrooms and is eaten away as it digs a crater about twice its diameter; it keeps going until the rod is used up. A long, dense rod goes deepest (Alekseevskii–Tate erosion).',
    velocity: { min: 1400, max: 1800, default: 1650 },
  },
  {
    id: 'heat',
    name: 'Shaped-charge jet (HEAT)',
    description: 'A thin copper jet at 2–8 km/s, as from a missile, RPG or HEAT shell.',
    explainer:
      'The round itself is slow; what does the work is a thin stretching jet of copper whose tip travels about 8 km/s. Its pressure dwarfs the plate’s strength, so the plate behaves like a fluid and the depth depends mainly on the jet’s length and the two densities (the density law, P ≈ L·√(ρjet/ρplate)). It leaves a narrow, deep, tapering hole.',
    velocity: { min: 150, max: 900, default: 300 },
  },
  {
    id: 'hesh',
    name: 'HESH squash head',
    description: 'A soft-nosed round that flattens against the plate and does not penetrate.',
    explainer:
      'The head squashes flat against the face and sends a sharp compression pulse into the plate. At the free rear face the pulse reflects as tension; where that tension beats the metal’s spall strength, a disc (a scab) tears off the inside face and flies off. Thick or tough plates stop the pulse before it can do this.',
    velocity: { min: 400, max: 800, default: 700 },
  },
  {
    id: 'he-frag',
    name: 'HE fragmentation',
    description: 'A burst of many small steel fragments and a blast load on the face.',
    explainer:
      'Plenty of energy, but spread over dozens of small fragments, each one well below the plate’s ballistic limit. Against thick armor they only pit and dent the face and bounce off; only thin plate is holed. It shows why concentrating energy matters.',
    velocity: { min: 300, max: 900, default: 600 },
  },
];

/** What every family looks like at the plate. Lengths in metres, mass in kg, speeds in m/s. */
interface ImpactBase {
  family: MunitionFamilyId;
  calibreMm: number;
  /** Impact velocity of the projectile (for a shaped charge, of the round, not the jet). */
  velocity: number;
  material: PenetratorMaterial;
  density: number;
}

export interface SolidImpact extends ImpactBase {
  family: 'ap-shot' | 'apfsds' | 'hesh';
  diameter: number;
  length: number;
  mass: number;
}

export interface JetImpact extends ImpactBase {
  family: 'heat';
  /** Cone diameter: sets the jet's scale and the hole size. */
  coneDiameter: number;
  jetTipVelocity: number;
  jetTailVelocity: number;
  /** Effective jet length that reaches the plate, before it particulates. */
  jetLength: number;
  /** Jet diameter at the tip. */
  jetDiameter: number;
}

export interface FragmentImpact extends ImpactBase {
  family: 'he-frag';
  diameter: number;
  mass: number;
  /** The fragments reaching the face: how many, their mass range (kg) and speed range (m/s). */
  fragments: { count: number; mass: [number, number]; velocity: [number, number] };
}

export type ImpactState = SolidImpact | JetImpact | FragmentImpact;

/** Reference sizes the scaling is anchored to (rounded open figures). */
export const REFERENCE = {
  /** A 120 mm-class long rod: about 27 mm × 700 mm tungsten heavy alloy. */
  rodCalibreMm: 120,
  rodDiameterRatio: 27 / 120,
  rodLengthToDiameter: 26,
  /** Long rods get relatively shorter at small calibres: L/D 15 at 40 mm. */
  smallRodLengthToDiameter: 15,
  /** 88 mm full-bore shot of about 10 kg. */
  shotCalibreMm: 88,
  shotMassKg: 10.2,
  /** 120 mm-class squash head of about 17 kg. */
  heshCalibreMm: 120,
  heshMassKg: 17,
  /** 155 mm-class HE shell of about 43 kg. */
  heCalibreMm: 155,
  heMassKg: 43,
  /** Shaped-charge cone about 0.8 × calibre; jet reaches about 6 cone diameters into RHA. */
  coneToCalibre: 0.8,
  jetRhaConeDiameters: 6,
  jetTipVelocity: 8000,
  jetTailVelocity: 2000,
  rhaDensity: 7850,
} as const;

export function getFamily(id: MunitionFamilyId): MunitionFamily {
  const family = MUNITION_FAMILIES.find((f) => f.id === id);
  if (!family) throw new Error(`Unknown munition family: ${id}`);
  return family;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * The family's state at impact for a gun calibre (mm, clamped to 40–150) and
 * an optional impact velocity (clamped to the family's range).
 */
export function impactState(id: MunitionFamilyId, calibreMm: number, velocity?: number): ImpactState {
  const family = getFamily(id);
  const cal = clamp(calibreMm, MIN_CALIBRE_MM, MAX_CALIBRE_MM);
  const D = cal / 1000;
  const v = clamp(velocity ?? family.velocity.default, family.velocity.min, family.velocity.max);
  switch (id) {
    case 'ap-shot': {
      // Mass scales with the cube of calibre; length follows from the mass of a steel cylinder.
      const mass = REFERENCE.shotMassKg * (cal / REFERENCE.shotCalibreMm) ** 3;
      const density = PENETRATOR_DENSITY.steel;
      return { family: id, calibreMm: cal, velocity: v, material: 'steel', density, diameter: D, mass, length: mass / (density * Math.PI * (D / 2) ** 2) };
    }
    case 'apfsds': {
      const diameter = D * REFERENCE.rodDiameterRatio;
      const t = clamp((cal - MIN_CALIBRE_MM) / (REFERENCE.rodCalibreMm - MIN_CALIBRE_MM), 0, 1);
      const lengthToDiameter = REFERENCE.smallRodLengthToDiameter + t * (REFERENCE.rodLengthToDiameter - REFERENCE.smallRodLengthToDiameter);
      const length = diameter * lengthToDiameter;
      const density = PENETRATOR_DENSITY['tungsten-alloy'];
      return { family: id, calibreMm: cal, velocity: v, material: 'tungsten-alloy', density, diameter, length, mass: density * Math.PI * (diameter / 2) ** 2 * length };
    }
    case 'hesh': {
      const mass = REFERENCE.heshMassKg * (cal / REFERENCE.heshCalibreMm) ** 3;
      const density = PENETRATOR_DENSITY.steel;
      return { family: id, calibreMm: cal, velocity: v, material: 'steel', density, diameter: D, mass, length: 4 * D };
    }
    case 'heat': {
      const coneDiameter = D * REFERENCE.coneToCalibre;
      const density = PENETRATOR_DENSITY.copper;
      // Effective length chosen so the density law gives about 6 cone diameters into RHA.
      const jetLength = (REFERENCE.jetRhaConeDiameters * coneDiameter) / Math.sqrt(density / REFERENCE.rhaDensity);
      return {
        family: id,
        calibreMm: cal,
        velocity: v,
        material: 'copper',
        density,
        coneDiameter,
        jetTipVelocity: REFERENCE.jetTipVelocity,
        jetTailVelocity: REFERENCE.jetTailVelocity,
        jetLength,
        jetDiameter: coneDiameter * 0.05,
      };
    }
    case 'he-frag': {
      const mass = REFERENCE.heMassKg * (cal / REFERENCE.heCalibreMm) ** 3;
      return {
        family: id,
        calibreMm: cal,
        velocity: v,
        material: 'steel',
        density: PENETRATOR_DENSITY.steel,
        diameter: D,
        mass,
        fragments: { count: Math.round(20 + cal / 5), mass: [0.001, 0.003 + cal * 0.0002], velocity: [1200, 1800] },
      };
    }
  }
}
