/**
 * Armor lab (#157): the plate material catalogue. Every armor-lab model reads
 * its material properties from here, the way `data/media.ts` drives the
 * bullet lab, so adding a plate material only needs a new entry.
 *
 * Values are rounded, openly published room-temperature figures (handbook
 * data such as ASM/MatWeb, and the target-resistance values used with the
 * Alekseevskii–Tate model in the open terminal-ballistics literature, e.g.
 * Anderson & Walker's long-rod work and Zukas, "Impact Dynamics"). They are a
 * simplified teaching model, not engineering design data.
 */

export type PlateMaterialId = 'rha' | 'mild-steel' | 'cast-iron' | 'copper' | 'al-5083';

export interface PlateMaterial {
  id: PlateMaterialId;
  name: string;
  /** One line for the UI. */
  description: string;
  /** kg/m³ */
  density: number;
  /** Quasi-static yield (or 0.2% proof) strength, Pa. */
  yieldPa: number;
  /**
   * Target resistance Rt for the Alekseevskii–Tate model, Pa: the effective
   * pressure the plate resists penetration with, several times its yield.
   */
  targetResistancePa: number;
  /** Brinell hardness (HB). */
  brinell: number;
  /** Spall (dynamic tensile) strength, Pa: the tension that tears a scab off the rear face. */
  spallStrengthPa: number;
  /** Longitudinal (bar) sound speed, m/s: how fast a stress pulse crosses the plate. */
  soundSpeed: number;
  /** °C */
  meltingPointC: number;
  /** J/(kg·K) */
  specificHeat: number;
  /** W/(m·K) */
  thermalConductivity: number;
  /**
   * Thickness efficiency against full-bore shot, relative to RHA (1): a plate
   * of this material resists like `factor × thickness` of RHA.
   */
  rhaThicknessFactor: number;
  /** Colour of the sectioned plate on the cross-section. */
  color: string;
}

export const PLATE_MATERIALS: PlateMaterial[] = [
  {
    id: 'rha',
    name: 'RHA (rolled homogeneous armor)',
    description: 'Quenched and tempered armor steel, about 300 HB. Every penetration figure is quoted against it.',
    density: 7850,
    yieldPa: 1.0e9,
    targetResistancePa: 5.5e9,
    brinell: 300,
    spallStrengthPa: 4.0e9,
    soundSpeed: 5900,
    meltingPointC: 1500,
    specificHeat: 460,
    thermalConductivity: 35,
    rhaThicknessFactor: 1,
    color: '#6e7680',
  },
  {
    id: 'mild-steel',
    name: 'Mild steel',
    description: 'Ordinary structural steel: the same density as RHA, but softer and more ductile, so it dishes and stretches more.',
    density: 7850,
    yieldPa: 0.3e9,
    targetResistancePa: 2.8e9,
    brinell: 130,
    spallStrengthPa: 1.8e9,
    soundSpeed: 5900,
    meltingPointC: 1510,
    specificHeat: 470,
    thermalConductivity: 50,
    rhaThicknessFactor: 0.75,
    color: '#8a9098',
  },
  {
    id: 'cast-iron',
    name: 'Cast iron',
    description: 'Grey cast iron: hard but brittle and weak in tension. It cracks, shatters and spalls easily.',
    density: 7200,
    yieldPa: 0.4e9,
    targetResistancePa: 3.6e9,
    brinell: 200,
    spallStrengthPa: 0.6e9,
    soundSpeed: 4600,
    meltingPointC: 1200,
    specificHeat: 460,
    thermalConductivity: 50,
    rhaThicknessFactor: 0.8,
    color: '#4a4d52',
  },
  {
    id: 'copper',
    name: 'Copper',
    description: 'Dense but soft. Under impact it flows like a thick liquid, with heavy plastic flow round the crater.',
    density: 8960,
    yieldPa: 0.2e9,
    targetResistancePa: 2.0e9,
    brinell: 60,
    spallStrengthPa: 1.3e9,
    soundSpeed: 4760,
    meltingPointC: 1085,
    specificHeat: 385,
    thermalConductivity: 400,
    rhaThicknessFactor: 0.55,
    color: '#b87333',
  },
  {
    id: 'al-5083',
    name: 'Aluminium 5083',
    description: 'A light armor alloy, a third the density of steel. It needs about three times the thickness of RHA to stop the same shot.',
    density: 2660,
    yieldPa: 0.23e9,
    // Rt for aluminium armor alloys spans roughly 1–2 GPa in the open literature. 1.8 GPa sits in that range and
    // above the tungsten rod's 1.5 GPa yield: with Rt under Yp, the Tate model drives a rod deeper into aluminium
    // than the hydrodynamic limit L·√(ρp/ρt), which no real rod does (#162).
    targetResistancePa: 1.8e9,
    brinell: 75,
    spallStrengthPa: 1.0e9,
    soundSpeed: 6320,
    meltingPointC: 600,
    specificHeat: 900,
    thermalConductivity: 117,
    rhaThicknessFactor: 0.35,
    color: '#c7ccd1',
  },
];

export const DEFAULT_PLATE_MATERIAL_ID: PlateMaterialId = 'rha';

export function getPlateMaterial(id: PlateMaterialId): PlateMaterial {
  const material = PLATE_MATERIALS.find((m) => m.id === id);
  if (!material) throw new Error(`Unknown plate material id: ${id}`);
  return material;
}
