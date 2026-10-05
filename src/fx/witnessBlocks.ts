import * as THREE from 'three';
import { createTargetStack, disposeTarget } from '../models/targets';
import { layersFor } from '../sim/engine';
import type { Timeline } from '../sim/types';
import { WITNESS_BLOCK, WITNESS_GEL, blockFrontWorld, witnessResults, type WitnessBlock, type WitnessFrame, type WitnessResult } from '../sim/witness';
import { TargetEffects } from './targetEffects';

interface Placed {
  block: WitnessBlock;
  group: THREE.Group;
  effects: TargetEffects;
}

/**
 * The gel witness blocks standing in a mock building (#249): one gel block on
 * its cart per position, and after a shot each block plays its own gel
 * effects (temporary cavity, permanent channel) for the pieces that reached it.
 */
export class WitnessBlocks {
  readonly group = new THREE.Group();
  results: WitnessResult[] = [];
  private placed: Placed[] = [];
  private frame: WitnessFrame | null = null;

  constructor() {
    this.group.name = 'witness-blocks';
  }

  /** Stands blocks at `blocks` in the room `frame` describes (none when `frame` is null), on the floor `baseY` below the shot line. */
  setBlocks(blocks: readonly WitnessBlock[], frame: WitnessFrame | null, baseY: number): void {
    this.removeAll();
    this.frame = frame;
    if (!frame) return;
    for (const block of blocks) {
      const group = createTargetStack([{ medium: WITNESS_GEL, thickness: WITNESS_BLOCK.depthM, gapM: 0 }], frame.angleDeg, baseY);
      const front = blockFrontWorld(block, frame);
      group.position.set(front.x, baseY, front.z);
      group.name = `witness-block:${block.distM.toFixed(2)},${block.lateralM.toFixed(2)}`;
      const effects = new TargetEffects();
      this.group.add(group, effects.group);
      this.placed.push({ block, group, effects });
    }
  }

  /** Works out what reached each block in `timeline` and loads its gel effects. */
  load(timeline: Timeline): WitnessResult[] {
    this.clearEffects();
    const frame = this.frame;
    if (!frame || this.placed.length === 0) return (this.results = []);
    this.results = witnessResults(timeline, frame, this.placed.map((p) => p.block));
    const layers = layersFor(WITNESS_GEL, WITNESS_BLOCK.depthM);
    this.results.forEach((r, i) => {
      if (r.timeline) this.placed[i].effects.load(r.timeline, this.placed[i].group, layers, frame.angleDeg);
    });
    return this.results;
  }

  /** When the last block's effects settle, s. */
  get endTime(): number {
    return Math.max(0, ...this.placed.map((p) => p.effects.endTime));
  }

  update(t: number, shutterS: number): void {
    for (const p of this.placed) p.effects.update(t, shutterS);
  }

  clearEffects(): void {
    this.results = [];
    for (const p of this.placed) p.effects.clear();
  }

  private removeAll(): void {
    this.clearEffects();
    for (const p of this.placed) {
      this.group.remove(p.group, p.effects.group);
      disposeTarget(p.group);
    }
    this.placed = [];
  }

  dispose(): void {
    this.removeAll();
  }
}
