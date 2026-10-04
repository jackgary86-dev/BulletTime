import * as THREE from 'three';
import { sampleTrack } from '../sim/sample';
import type { Timeline } from '../sim/types';
import type { HoleMarks } from './holes';
import { forceChains } from './forceChains';
import type { ParticleSystem } from './particles';
import { seededRandom } from '../sim/random';

/**
 * Sandbag: the burlap is punched with a small frayed hole, a fountain of sand
 * grains and fine dust sprays back out of it, and anything that gets through
 * drags a stream of grains out of the back.
 */

/** How fast load runs out along a chain of grains, in metres per second (well below the speed of sound in the grains). */
const CHAIN_WAVE_MS = 150;
/** A lit grain glows for this long, in seconds. */
const CHAIN_LIFE_S = 2.5e-3;
const SAND = { chain: 0xffe2a8, grain: 0xc9b48a, dust: 0xb5a27c, hole: 0x2a2116, fibre: 0x8f7a55 };

export function loadSandEffect(timeline: Timeline, layer: number, particles: ParticleSystem, holes: HoleMarks): void {
  let seed = 301;
  for (const e of timeline.events) {
    if (e.layer !== layer) continue;
    const track = timeline.tracks.find((tr) => tr.id === e.trackId);
    if (!track || track.kind === 'fragment') continue;
    const d = sampleTrack(track, e.t)?.diameter ?? track.baseDiameter;
    const w = track.kind === 'pellet' ? 0.3 : 1;
    const k = Math.min(1, Math.sqrt((0.5 * track.massKg * e.speed ** 2) / 3000));
    const normal = new THREE.Vector3(e.normal?.x ?? -1, e.normal?.y ?? 0, e.normal?.z ?? 0).normalize();
    const origin = new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z);

    if (e.type === 'impact' || e.type === 'enter' || e.type === 'exit') {
      const exit = e.type === 'exit';
      holes.add({
        t: e.t,
        pos: e.pos,
        normal,
        radius: d * (exit ? 0.9 : 0.6),
        ragged: 0.6,
        color: SAND.hole,
        rim: { count: 12, length: [d * 0.3, d * 0.8], width: d * 0.15, color: SAND.fibre, lift: exit ? 0.8 : 0.3 },
        seed: seed++,
      });
      if (!exit) {
        // Load runs into the bed down branching chains of single grains, the harder the hit the more of them.
        const rand = seededRandom(seed * 7919 + Math.round(e.t * 1e7));
        for (const bead of forceChains(normal.clone().negate(), k, 0.003, rand, Math.round(260 * w))) {
          const thin = 1 - 0.22 * bead.depth;
          particles.add({
            look: 'chain',
            t0: e.t + bead.pathM / CHAIN_WAVE_MS,
            origin: origin.clone().add(bead.offset),
            axis: normal,
            spread: 0,
            count: 1,
            speed: [0, 0],
            size: [0.0034 * thin, 0.0044 * thin],
            life: [CHAIN_LIFE_S * thin, CHAIN_LIFE_S * thin * 1.4],
            drag: 1,
            color: SAND.chain,
            colorJitter: 0.3,
            seed: Math.floor(rand() * 1e6),
          });
        }
      }
      // Grains: a tight jet out of the hole, falling on ballistic arcs.
      particles.add({
        look: 'grain',
        t0: e.t,
        duration: exit ? 1.5e-3 : 600e-6,
        origin,
        originJitter: d,
        axis: normal,
        spread: exit ? 0.5 : 0.8,
        count: Math.round((exit ? 260 : 180) * w * (0.4 + k)),
        speed: exit ? [10, 40 + e.speed * 0.1] : [3, 15 + 25 * k],
        size: [0.0006, 0.0016],
        life: [6e-3, 20e-3],
        drag: 15,
        gravity: 9.8,
        color: SAND.grain,
        colorJitter: 0.35,
      });
      particles.add({
        look: 'dust',
        t0: e.t,
        duration: 500e-6,
        origin,
        originJitter: 0.005,
        axis: normal,
        spread: 1,
        count: Math.round(50 * w * (0.4 + k)),
        speed: [1, 8],
        size: [0.006, 0.016],
        life: [1.5e-3, 4e-3],
        drag: 150,
        gravity: 2,
        color: SAND.dust,
        grow: 3,
      });
    }
  }
}
