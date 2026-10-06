import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { seededRandom } from '../sim/random';
import { writeBurst, type SpawnBuffers } from './gpuParticles';
import { FLOOR_Y, ParticleSystem, type BurstSpec, type ParticleLook } from './particles';

/** The CPU path's per-particle state, as ParticleSystem keeps it. */
interface CpuParticle {
  t0: number;
  life: number;
  p: THREE.Vector3;
  v: THREE.Vector3;
  size: number;
  drag: number;
  gravity: number;
  stretch: number;
  grow: number;
  spin: number;
  spinAxis: THREE.Vector3;
  start: THREE.Quaternion;
  aspect: THREE.Vector3;
  landAge: number;
  landPos: THREE.Vector3 | null;
  color: THREE.Color;
}

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

function buffers(n: number): SpawnBuffers {
  const f = (k: number) => new Float32Array(n * k);
  return { P: f(4), V: f(4), A: f(4), AX: f(4), ST: f(4), AS: f(4), LA: f(4), C: f(3) };
}

const SOLID_LOOKS: ReadonlySet<ParticleLook> = new Set(['chunk', 'splinter', 'shard', 'grain', 'flake']);

const spec = (look: ParticleLook, over: Partial<BurstSpec>): BurstSpec => ({
  look,
  t0: 0.001,
  origin: new THREE.Vector3(0.02, 0.06, -0.01),
  axis: new THREE.Vector3(0.2, -0.4, 1),
  spread: 0.9,
  count: 300,
  speed: [2, 12],
  size: [0.002, 0.012],
  life: [0.5, 2],
  drag: 1.5,
  color: 0x9a8f80,
  seed: 4242,
  ...over,
});

const cases: [string, BurstSpec, boolean][] = [
  ['chunks that fall and land', spec('chunk', { gravity: 9.8, originJitter: 0.01, duration: 1e-3 }), false],
  ['grain with no drag, streaked', spec('grain', { drag: 0, stretch: 6, speed: [20, 90], life: [80e-6, 120e-6], size: [0.0006, 0.0016] }), false],
  ['grain streaked and aimed straight back', spec('grain', { axis: new THREE.Vector3(-1, 0, 0), spread: 0.0001, stretch: 3, gravity: 9.8 }), false],
  ['a hollow crown of grains with grow', spec('grain', { innerSpread: 0.4, spread: 1.1, grow: 2.5, colorJitter: 0.4, gravity: 9.8 }), false],
  ['dust cloud cards', spec('dust', { grow: 3, gravity: 0.2, drag: 4, life: [0.01, 0.04] }), false],
  ['vapour', spec('vapour', { grow: 4, drag: 20 }), false],
  ['chunks in free flight', spec('chunk', { gravity: 9.8 }), true],
];

describe('GPU spawn writes what the CPU path builds', () => {
  for (const [name, burst, freeFlight] of cases) {
    it(name, () => {
      const system = new ParticleSystem();
      system.freeFlight = freeFlight;
      system.add(burst);
      const cpu = (system as unknown as { particles: Map<ParticleLook, CpuParticle[]> }).particles.get(burst.look)!;
      expect(cpu.length).toBe(burst.count);

      const buf = buffers(burst.count);
      const latest = writeBurst(buf, 0, burst, seededRandom(burst.seed!), burst.count, { solid: SOLID_LOOKS.has(burst.look), freeFlight, floorY: FLOOR_Y });

      // Float32 storage: compare to a few parts per million.
      const same = (got: number, want: number, what: string, i: number) => {
        const tolerance = 4e-6 * Math.max(1, Math.abs(want));
        if (Math.abs(got - want) > tolerance) throw new Error(`particle ${i} ${what}: ${got} vs ${want}`);
      };
      let landed = 0;
      let end = 0;
      cpu.forEach((q, i) => {
        const o = i * 4;
        const at = (a: Float32Array, k: number) => a[o + k];
        same(at(buf.P, 0), q.p.x, 'p.x', i);
        same(at(buf.P, 1), q.p.y, 'p.y', i);
        same(at(buf.P, 2), q.p.z, 'p.z', i);
        same(at(buf.P, 3), q.t0, 't0', i);
        same(at(buf.V, 0), q.v.x, 'v.x', i);
        same(at(buf.V, 1), q.v.y, 'v.y', i);
        same(at(buf.V, 2), q.v.z, 'v.z', i);
        same(at(buf.V, 3), q.life, 'life', i);
        same(at(buf.A, 0), q.drag, 'drag', i);
        same(at(buf.A, 1), q.gravity, 'gravity', i);
        same(at(buf.A, 2), q.size, 'size', i);
        same(at(buf.A, 3), q.spin, 'spin', i);
        same(at(buf.AX, 0), q.spinAxis.x, 'axis.x', i);
        same(at(buf.AX, 1), q.spinAxis.y, 'axis.y', i);
        same(at(buf.AX, 2), q.spinAxis.z, 'axis.z', i);
        same(at(buf.ST, 0), q.start.x, 'start.x', i);
        same(at(buf.ST, 1), q.start.y, 'start.y', i);
        same(at(buf.ST, 2), q.start.z, 'start.z', i);
        same(at(buf.ST, 3), q.start.w, 'start.w', i);
        same(at(buf.AS, 0), q.aspect.x, 'aspect.x', i);
        same(at(buf.AS, 1), q.aspect.y, 'aspect.y', i);
        same(at(buf.AS, 2), q.aspect.z, 'aspect.z', i);
        same(at(buf.AS, 3), q.stretch, 'stretch', i);
        same(at(buf.LA, 3), q.grow, 'grow', i);
        if (Number.isFinite(q.landAge)) {
          landed++;
          same(at(buf.AX, 3), q.landAge, 'landAge', i);
          same(at(buf.LA, 0), q.landPos!.x, 'land.x', i);
          same(at(buf.LA, 1), q.landPos!.y, 'land.y', i);
          same(at(buf.LA, 2), q.landPos!.z, 'land.z', i);
        } else {
          expect(at(buf.AX, 3)).toBeGreaterThan(1e19);
        }
        same(buf.C[i * 3], q.color.r, 'r', i);
        same(buf.C[i * 3 + 1], q.color.g, 'g', i);
        same(buf.C[i * 3 + 2], q.color.b, 'b', i);
        end = Math.max(end, q.t0 + q.life);
      });
      same(latest, end, 'latest end', 0);
      // The landing cases must actually exercise the floor search, and free flight must never land.
      if (name.includes('land')) expect(landed).toBeGreaterThan(20);
      if (freeFlight || burst.look === 'dust' || burst.look === 'vapour') expect(landed).toBe(0);
    });
  }
});
