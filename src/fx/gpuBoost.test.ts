import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { boostFor, NO_GPU, parseGpuBoosts, type GpuLookMesh } from './gpuParticles';
import { ParticleSystem, type BurstSpec, type ParticleLook } from './particles';

beforeAll(() => {
  // ParticleSystem paints a puff texture on a canvas; a stub is enough here.
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => undefined }),
    }),
  };
});

describe('reading the boosts from the query string', () => {
  it('is off without a flag', () => {
    expect(parseGpuBoosts('')).toEqual({ all: 0, per: new Map() });
    expect(boostFor(NO_GPU, 'chunk')).toBe(0);
  });

  it('takes one number for every look, from either name, and a bare flag means 1', () => {
    expect(parseGpuBoosts('?gpuparticles=20').all).toBe(20);
    expect(parseGpuBoosts('?gpuchunks=7').all).toBe(7);
    expect(parseGpuBoosts('?gpuparticles').all).toBe(1);
    expect(parseGpuBoosts('?gpuparticles=banana').all).toBe(1);
  });

  it('lets single looks differ from the rest', () => {
    const boosts = parseGpuBoosts('?gpuparticles=20&gpuboost=vapour:1,chunk:30');
    expect(boostFor(boosts, 'vapour')).toBe(1);
    expect(boostFor(boosts, 'chunk')).toBe(30);
    expect(boostFor(boosts, 'grain')).toBe(20);
  });

  it('moves only the named looks when there is no general boost', () => {
    const boosts = parseGpuBoosts('?gpuboost=chunk:5');
    expect(boostFor(boosts, 'chunk')).toBe(5);
    expect(boostFor(boosts, 'dust')).toBe(0);
  });

  it('keeps a 0 (stay on the CPU), allows fractions, and caps every boost', () => {
    const boosts = parseGpuBoosts('?gpuparticles=20&gpuboost=spark:0,flake:0.5,chunk:999');
    expect(boostFor(boosts, 'spark')).toBe(0);
    expect(boostFor(boosts, 'flake')).toBe(0.5);
    expect(boostFor(boosts, 'chunk')).toBe(50);
    expect(parseGpuBoosts('?gpuparticles=999').all).toBe(50);
  });

  it('ignores entries it cannot read', () => {
    const boosts = parseGpuBoosts('?gpuboost=chunk,dust:abc,:3,grain:-2,spark:,shard:4');
    expect([...boosts.per]).toEqual([['shard', 4]]);
  });
});

const burst = (look: ParticleLook): BurstSpec => ({
  look,
  t0: 0.001,
  origin: new THREE.Vector3(0, 0.1, 0),
  axis: new THREE.Vector3(0, 1, 0),
  spread: 1,
  count: 10,
  speed: [1, 5],
  size: [0.002, 0.01],
  life: [0.1, 0.2],
  drag: 1,
  color: 0x888888,
  seed: 5,
});

/** What the system holds for a look: the GPU mesh if it has one, else the CPU list's length. */
function held(system: ParticleSystem, look: ParticleLook): { gpu: boolean; count: number; capacity?: number } {
  const internals = system as unknown as { gpuMeshes: Map<ParticleLook, GpuLookMesh>; particles: Map<ParticleLook, unknown[]> };
  const gpu = internals.gpuMeshes.get(look);
  return gpu ? { gpu: true, count: gpu.count, capacity: gpu.capacity } : { gpu: false, count: internals.particles.get(look)!.length };
}

describe('a particle system with a boost per look', () => {
  it('gives each look its own multiple, and leaves a look at 0 on the CPU path', () => {
    const system = new ParticleSystem(parseGpuBoosts('?gpuparticles=4&gpuboost=vapour:1,spark:0'));
    for (const look of ['chunk', 'vapour', 'spark'] as const) system.add(burst(look));
    expect(held(system, 'chunk')).toMatchObject({ gpu: true, count: 40 });
    expect(held(system, 'vapour')).toMatchObject({ gpu: true, count: 10 });
    expect(held(system, 'spark')).toEqual({ gpu: false, count: 10 });
  });

  it('moves only the named looks when there is no general boost', () => {
    const system = new ParticleSystem(parseGpuBoosts('?gpuboost=chunk:2'));
    system.add(burst('chunk'));
    system.add(burst('grain'));
    expect(held(system, 'chunk')).toMatchObject({ gpu: true, count: 20 });
    expect(held(system, 'grain')).toEqual({ gpu: false, count: 10 });
  });

  it('sizes each look\'s buffers and cap by its own boost, fractions included', () => {
    const system = new ParticleSystem(parseGpuBoosts('?gpuboost=chunk:0.5,grain:3'));
    system.add(burst('chunk'));
    system.add(burst('grain'));
    // Usual caps are 1500 for a chunk and 3000 for a grain, and buffers hold twice that for the Ultra tier.
    expect(held(system, 'chunk')).toMatchObject({ count: 5, capacity: 1500 });
    expect(held(system, 'grain')).toMatchObject({ count: 30, capacity: 18000 });
  });

  it('stops a look at its own boosted cap', () => {
    const system = new ParticleSystem(parseGpuBoosts('?gpuboost=chunk:2'));
    system.add({ ...burst('chunk'), count: 100000 });
    // 1500 x capScale 1 x boost 2.
    expect(held(system, 'chunk').count).toBe(3000);
  });

  it('draws nothing from the GPU path with no boosts at all', () => {
    const system = new ParticleSystem(NO_GPU);
    system.add(burst('chunk'));
    expect(held(system, 'chunk')).toEqual({ gpu: false, count: 10 });
  });
});
