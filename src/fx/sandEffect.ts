import * as THREE from 'three';
import { sampleTrack } from '../sim/sample';
import type { Timeline } from '../sim/types';
import type { HoleMarks } from './holes';
import { forceChains } from './forceChains';
import type { ParticleSystem } from './particles';
import { seededRandom } from '../sim/random';
import type { MediumSpec } from '../data/media';
import { scaleBurst, shellScale } from './shellScale';

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
/** Packed earth throws darker, damper soil (#296). */
const SOIL = { clod: 0x5e4630, dust: 0x8a7658, grain: 0x7a6244 };

export function loadSandEffect(timeline: Timeline, layer: number, system: ParticleSystem, holes: HoleMarks, medium?: MediumSpec): void {
  let seed = 301;
  const earth = medium?.look === 'earthBerm';
  for (const e of timeline.events) {
    if (e.layer !== layer) continue;
    const track = timeline.tracks.find((tr) => tr.id === e.trackId);
    if (!track || track.kind === 'fragment') continue;
    const d = sampleTrack(track, e.t)?.diameter ?? track.baseDiameter;
    const w = track.kind === 'pellet' ? 0.3 : 1;
    const k = Math.min(1, Math.sqrt((0.5 * track.massKg * e.speed ** 2) / 3000));
    const normal = new THREE.Vector3(e.normal?.x ?? -1, e.normal?.y ?? 0, e.normal?.z ?? 0).normalize();
    const origin = new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z);
    // The grain and dust bursts are tuned for a bullet; a shell (#296) throws bigger pieces over a wider start area.
    const s = shellScale(d);
    const particles = { add: (spec: Parameters<ParticleSystem['add']>[0]) => system.add(scaleBurst(spec, s)) };
    const grainColor = earth ? SOIL.grain : SAND.grain;
    const dustColor = earth ? SOIL.dust : SAND.dust;

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
        color: grainColor,
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
        color: dustColor,
        grow: 3,
      });
      if (earth && !exit) {
        // The soil column (#296): clods and a dust plume thrown up and back off the face, sized to the shell.
        const up = new THREE.Vector3(0, 1, 0).addScaledVector(normal, 0.6).normalize();
        particles.add({
          look: 'chunk',
          t0: e.t,
          duration: 1.2e-3,
          origin,
          originJitter: d * 0.5,
          axis: up,
          spread: 0.45,
          count: Math.round(90 * w * (0.4 + k)),
          speed: [6, 12 + 14 * k],
          size: [0.002, 0.006],
          life: [10e-3, 30e-3],
          drag: 4,
          gravity: 9.8,
          color: SOIL.clod,
          colorJitter: 0.4,
        });
        particles.add({
          look: 'dust',
          t0: e.t,
          duration: 2.5e-3,
          origin,
          originJitter: d * 0.4,
          axis: up,
          spread: 0.5,
          count: Math.round(70 * w * (0.4 + k)),
          speed: [5, 11 + 10 * k],
          size: [0.012, 0.03],
          life: [12e-3, 36e-3],
          drag: 30,
          gravity: 1,
          color: SOIL.dust,
          grow: 4,
        });
      }
    }
  }
}
