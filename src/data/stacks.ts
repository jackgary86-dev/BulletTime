import { layersFor, type TargetLayer } from '../sim/engine';
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
    id: 'concrete-gel',
    name: 'Cinder block + gel',
    layers: [{ medium: 'cinder-block' }, { medium: 'gel10', gapM: 0.1, thickness: 0.4 }],
  },
];

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
