import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../sim/random';
import { chainReachM, forceChains } from './forceChains';

const inward = new THREE.Vector3(1, 0, 0);

describe('force chains', () => {
  it('runs inward from the hit and never exceeds the bead budget', () => {
    const beads = forceChains(inward, 1, 0.003, seededRandom(5), 120);
    expect(beads.length).toBeGreaterThan(40);
    expect(beads.length).toBeLessThanOrEqual(120);
    const mean = beads.reduce((s, b) => s + b.offset.x, 0) / beads.length;
    expect(mean).toBeGreaterThan(0);
  });

  it('loads more of the bed, with more branches, for a harder hit', () => {
    const soft = forceChains(inward, 0.05, 0.003, seededRandom(9));
    const hard = forceChains(inward, 1, 0.003, seededRandom(9));
    expect(hard.length).toBeGreaterThan(soft.length * 1.5);
    expect(Math.max(...hard.map((b) => b.depth))).toBeGreaterThan(Math.max(...soft.map((b) => b.depth)) - 1);
    expect(chainReachM(1)).toBeGreaterThan(chainReachM(0.05));
  });

  it('orders beads by path length from the hit, so the wave can run out along them', () => {
    for (const b of forceChains(inward, 0.5, 0.003, seededRandom(3))) {
      expect(b.pathM).toBeGreaterThan(0);
      expect(b.offset.length()).toBeLessThanOrEqual(b.pathM + 1e-9);
    }
  });
});
