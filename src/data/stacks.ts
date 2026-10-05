import { layersFor, type TargetLayer } from '../sim/engine';
import { BUILDINGS, interiorGapM } from './buildings';
import { getMedium, type MediumLook, type MediumSpec } from './media';

/** One layer of a target stack (#24): a medium, its thickness, and the air gap in front of it. */
export interface StackLayer {
  medium: MediumSpec;
  /** Thickness along the shot line, in metres. */
  thickness: number;
  /** Air gap between the previous layer's back face and this layer's front face, in metres (0 for the first). */
  gapM: number;
  /** Draws the layer with another look than its medium's own (a car door's skins are mild steel). */
  look?: MediumLook;
}

export const MAX_STACK_LAYERS = 4;
export const MAX_GAP_M = 0.4;

export interface StackPreset {
  id: string;
  name: string;
  layers: { medium: string; thickness?: number; gapM?: number; look?: MediumLook }[];
  /** Proving-ground preset: not offered in the Bullet lab. */
  heavy?: boolean;
}

/** Classic barrier tests: something in front of a gel block. */
export const STACK_PRESETS: StackPreset[] = [
  {
    id: 'wall-gel',
    name: 'Interior wall + gel',
    // Two drywall sheets on a 9 cm stud cavity, then a gel block behind the wall.
    layers: [{ medium: 'drywall' }, { medium: 'drywall', gapM: 0.09 }, { medium: 'gel10', gapM: 0.15, thickness: 0.4 }],
  },
  {
    id: 'wood-gel',
    name: 'Wooden wall + gel',
    layers: [{ medium: 'pine', thickness: 0.038 }, { medium: 'gel10', gapM: 0.15, thickness: 0.4 }],
  },
  {
    id: 'cardoor-gel',
    name: 'Car door + gel',
    // Outer skin, the hollow door, inner skin, then the gel.
    layers: [
      { medium: 'steel-mild', thickness: 0.0009, look: 'carDoorOuter' },
      { medium: 'steel-mild', thickness: 0.0009, gapM: 0.1, look: 'carDoorInner' },
      { medium: 'gel10', gapM: 0.1, thickness: 0.4 },
    ],
  },
  {
    id: 'glass-gel',
    name: 'Auto glass + gel',
    layers: [{ medium: 'glass', thickness: 0.006 }, { medium: 'gel10', gapM: 0.3, thickness: 0.4 }],
  },
  {
    id: 'car-door',
    name: 'Car door',
    // Outer skin, the hollow door, inner skin: the same two skins as the door in front of gel. A shot at the
    // window regulator would meet more steel; the model has no regulator, so this is a shot through clear door.
    layers: [
      { medium: 'steel-mild', thickness: 0.0009, look: 'carDoorOuter' },
      { medium: 'steel-mild', thickness: 0.0009, gapM: 0.1, look: 'carDoorInner' },
    ],
  },
  {
    id: 'drywall-wall',
    name: 'Drywall wall',
    // Two sheets of gypsum board over a 9 cm stud bay.
    layers: [{ medium: 'drywall' }, { medium: 'drywall', gapM: 0.09 }],
  },
  {
    id: 'water-jug',
    name: 'Water jug',
    // A thin polyethylene skin round water: skin, 20 cm of water, skin.
    layers: [{ medium: 'polyethylene' }, { medium: 'water', thickness: 0.2, gapM: 0, look: 'waterJug' }, { medium: 'polyethylene', gapM: 0 }],
  },
  {
    id: 'smartphone',
    name: 'Smartphone',
    // Cover glass, battery pouch, aluminium back.
    layers: [{ medium: 'phone-glass' }, { medium: 'phone-cell', gapM: 0.001 }, { medium: 'phone-frame', gapM: 0.001 }],
  },
  {
    id: 'phone-book',
    name: 'Phone book',
    layers: [{ medium: 'phonebook' }],
  },
  {
    id: 'concrete-gel',
    name: 'Cinder block + gel',
    layers: [{ medium: 'cinder-block' }, { medium: 'gel10', gapM: 0.1, thickness: 0.4 }],
  },
  // Proving-ground presets (#232), for Artillery and Missile.
  { id: 'plate-large', name: 'Large RHA plate', layers: [{ medium: 'rha-plate' }], heavy: true },
  {
    id: 'plate-spaced',
    name: 'Spaced plates (300 mm gap)',
    layers: [{ medium: 'ar500-plate', thickness: 0.025 }, { medium: 'rha-plate', thickness: 0.1, gapM: 0.3 }],
    heavy: true,
  },
  // Full-size walls on the proving ground (#231).
  { id: 'bunker', name: 'Bunker wall', layers: [{ medium: 'bunker-wall' }], heavy: true },
  {
    id: 'bunker-berm',
    name: 'Bunker wall backed by earth',
    layers: [{ medium: 'bunker-wall', thickness: 0.4 }, { medium: 'earth-berm-full', gapM: 0.05 }],
    heavy: true,
  },
  {
    id: 'brick-cavity',
    name: 'Cavity brick wall',
    layers: [{ medium: 'brick-wall-full', thickness: 0.1 }, { medium: 'brick-wall-full', thickness: 0.1, gapM: 0.05 }],
    heavy: true,
  },
  // Three 300 mm RHA plates bolted face to face (#233): thick enough that a missile's jet stops inside and its depth shows.
  {
    id: 'plate-block',
    name: 'RHA block (3 x 300 mm)',
    layers: [{ medium: 'rha-plate', thickness: 0.3 }, { medium: 'rha-plate', thickness: 0.3, gapM: 0 }, { medium: 'rha-plate', thickness: 0.3, gapM: 0 }],
    heavy: true,
  },
  { id: 'tank', name: 'Tank, broadside', layers: [{ medium: 'tank-hull' }], heavy: true },
  {
    id: 'plate-concrete',
    name: 'Plate in front of concrete',
    layers: [{ medium: 'rha-plate', thickness: 0.05 }, { medium: 'reinforced-concrete', gapM: 0.2 }],
    heavy: true,
  },
  {
    id: 'era-plate',
    name: 'Reactive tile + RHA',
    // The tile fires on a single shaped charge and spoils its jet; a tandem warhead clears it with the first charge.
    layers: [{ medium: 'era-tile' }, { medium: 'rha', thickness: 0.5, gapM: 0.05 }],
    heavy: true,
  },
  // Mock test buildings (#246): the struck wall, the room as an air gap, then the far wall.
  ...Object.values(BUILDINGS).map((b) => ({
    id: `building-${b.id}`,
    name: b.name,
    layers: [
      { medium: b.front.medium, thickness: b.front.thicknessM },
      { medium: b.back.medium, thickness: b.back.thicknessM, gapM: interiorGapM(b) },
    ],
    heavy: true,
  })),
];

/** Whether a mode's target presets list this one (#245): heavy ones outside the Bullet lab, and only heavy ones for Missile. */
export function presetListedIn(preset: StackPreset, mode: string): boolean {
  if (mode === 'missile') return !!preset.heavy;
  return !preset.heavy || mode !== 'bullet';
}

export function presetLayers(preset: StackPreset): StackLayer[] {
  return preset.layers.map((l, i) => {
    const medium = getMedium(l.medium);
    return { medium, thickness: l.thickness ?? medium.thickness.default, gapM: i === 0 ? 0 : (l.gapM ?? 0.1), look: l.look };
  });
}

/** Where each layer starts along the shot line, from the stack's front face, in metres. */
export function stackOffsets(layers: StackLayer[]): number[] {
  const offsets: number[] = [];
  let x = 0;
  layers.forEach((l, i) => {
    x += i === 0 ? 0 : l.gapM;
    offsets.push(x);
    x += l.thickness;
  });
  return offsets;
}

export function stackDepth(layers: StackLayer[]): number {
  const offsets = stackOffsets(layers);
  return offsets.at(-1)! + layers.at(-1)!.thickness;
}

/** The physics layers for a stack: each medium at its offset (hollow blocks split into shells). */
export function physicsLayers(layers: StackLayer[]): TargetLayer[] {
  const offsets = stackOffsets(layers);
  return layers.flatMap((l, i) => layersFor(l.medium, l.thickness, offsets[i], i));
}
