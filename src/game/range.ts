import { getBullet } from '../data/bullets';
import { getMedium } from '../data/media';
import { STACK_PRESETS, presetLayers } from '../data/stacks';
import type { ShotSummary } from '../sim/types';
import type { TargetSetup } from '../ui/stackEditor';

/**
 * The range challenge (#151): five stages of two shots each. Every stage fixes
 * a round and a target; the player places each shot through a swaying scope and
 * scores by how close it lands to the centre of the target face.
 */

export interface RangeStage {
  name: string;
  bulletId: string;
  /** A single medium id, or a stack preset id. */
  target: { medium: string; thickness?: number } | { preset: string };
  /** Peak reticle sway as a fraction of the scoring radius. Later stages sway more. */
  sway: number;
  /** Tint of the target face in the scope. */
  faceColor: string;
}

export const SHOTS_PER_STAGE = 2;

export const RANGE_STAGES: RangeStage[] = [
  { name: 'Gel block', bulletId: '9mm-jhp', target: { medium: 'gel10', thickness: 0.4 }, sway: 0.06, faceColor: '#b9853f' },
  { name: 'Auto glass', bulletId: '45acp-fmj', target: { preset: 'glass-gel' }, sway: 0.09, faceColor: '#6f8f96' },
  { name: 'Water tank', bulletId: '556-m193', target: { medium: 'water' }, sway: 0.12, faceColor: '#4f7488' },
  { name: 'Steel plate', bulletId: '308-sp', target: { medium: 'steel-ar500' }, sway: 0.15, faceColor: '#5d6670' },
  { name: 'Concrete', bulletId: '50bmg-fmj', target: { medium: 'concrete' }, sway: 0.18, faceColor: '#8d8a84' },
];

export const MAX_SCORE = RANGE_STAGES.length * SHOTS_PER_STAGE * 10;

/** The target setup a stage shoots at. */
export function stageSetup(stage: RangeStage): TargetSetup {
  if ('preset' in stage.target) {
    const id = stage.target.preset;
    const preset = STACK_PRESETS.find((p) => p.id === id);
    if (!preset) throw new Error(`Unknown stack preset: ${id}`);
    return { layers: presetLayers(preset), angleDeg: 0 };
  }
  const medium = getMedium(stage.target.medium);
  return { layers: [{ medium, thickness: stage.target.thickness ?? medium.thickness.default, gapM: 0 }], angleDeg: 0 };
}

/** The round a stage fires, as shown to the player. */
export function stageRound(stage: RangeStage): string {
  const b = getBullet(stage.bulletId);
  return `${b.name} ${b.type}`;
}

/**
 * Points for a shot at (x, y), in units of the scoring radius from the target's
 * centre: 10 inside the innermost tenth, down to 1 at the edge, 0 outside.
 */
export function scoreShot(x: number, y: number): number {
  const r = Math.hypot(x, y);
  if (r > 1) return 0;
  return Math.max(1, 10 - Math.floor(r * 10));
}

/** Breathing: steady while held (for a while), then worse while the shooter recovers. */
export type Breath = 'normal' | 'held' | 'recover';
export const HOLD_MAX_S = 2.5;
export const RECOVER_S = 2;
const BREATH_SWAY: Record<Breath, number> = { normal: 1, held: 0.2, recover: 2 };

/**
 * Reticle sway at time t (seconds), in units of the scoring radius: two slow,
 * incommensurate wobbles per axis, like a rifle held offhand.
 */
export function swayAt(t: number, amplitude: number, breath: Breath): { x: number; y: number } {
  const a = amplitude * BREATH_SWAY[breath];
  return {
    x: a * (0.7 * Math.sin(1.1 * t) + 0.3 * Math.sin(2.3 * t + 0.7)),
    y: a * (0.7 * Math.cos(0.9 * t + 0.3) + 0.3 * Math.sin(1.9 * t + 2)),
  };
}

/** One line on what the bullet did, for the score card. */
export function describeImpact(s: ShotSummary): string {
  const mm = `${(s.finalDiameter * 1000).toFixed(1)} mm`;
  const cm = (m: number) => (m < 0.01 ? `${(m * 1000).toFixed(1)} mm` : `${(m * 100).toFixed(1)} cm`);
  if (s.ricocheted) return `Ricocheted off the face at ${Math.round(s.impactSpeed)} m/s.`;
  if (s.finalState === 'detonated') return 'Detonated on contact.';
  const state =
    s.finalState === 'expanded'
      ? `expanded to ${mm}`
      : s.finalState === 'deformed'
        ? `flattened to ${mm}`
        : s.finalState === 'fragmented'
          ? `broke into ${s.fragments} fragments`
          : s.finalState === 'splashed'
            ? 'splashed apart'
            : 'stayed intact';
  const path = s.passedThrough
    ? `Went through ${cm(s.penetrationM)} and out at ${Math.round(s.exitSpeed)} m/s`
    : `Stopped after ${cm(s.penetrationM)}`;
  return `${path}; the bullet ${state}.`;
}
