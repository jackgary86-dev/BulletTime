import * as THREE from 'three';
import type { MediumSpec } from '../data/media';
import { sampleTrack } from '../sim/sample';
import type { Timeline } from '../sim/types';
import type { HoleMarks } from './holes';
import type { ParticleSystem } from './particles';

/**
 * Wood and drywall: splinters and spall, gypsum dust, and the entry and exit
 * holes left behind. Wood grain runs vertically in the target texture, so wood
 * tears and splinters preferentially along world y.
 */

const GRAIN = new THREE.Vector3(0, 1, 0);

interface Look {
  /** Colour seen down the hole. */
  hole: number;
  /** Raw, freshly torn material. */
  raw: number;
  /** Paint/paper/surface colour for flaps. */
  face: number;
}

const LOOKS: Record<string, Look> = {
  pine: { hole: 0x1c120a, raw: 0xf0d3a0, face: 0xd9b27a },
  oak: { hole: 0x140c06, raw: 0xc99a62, face: 0x9a6b3c },
  drywall: { hole: 0x1a1a1a, raw: 0xf6f4ee, face: 0xece8de },
  plasticJug: { hole: 0x101418, raw: 0xf2f2ec, face: 0xe8ecea },
  phoneCell: { hole: 0x0c0c0e, raw: 0x9a9ea6, face: 0x2a2d33 },
  // Sheet materials with a look of their own (#261): the hole, the cut edge and the crushed face.
  polycarbonate: { hole: 0x0d1114, raw: 0xdce8ee, face: 0xc3d3db },
  mdf: { hole: 0x1a120b, raw: 0xb99a72, face: 0x8c7150 },
  osb: { hole: 0x160e07, raw: 0xcaa569, face: 0xb08a50 },
  cementBoard: { hole: 0x1c1c1b, raw: 0xd2d1cc, face: 0xa8a7a1 },
  fibreglass: { hole: 0x0f1411, raw: 0xe2eee0, face: 0xc7dac6 },
  kevlar: { hole: 0x0c0b08, raw: 0xe2c64c, face: 0xc7a73a },
};

export function loadPanelEffect(
  timeline: Timeline,
  medium: MediumSpec,
  layer: number,
  particles: ParticleSystem,
  holes: HoleMarks,
): void {
  const look = LOOKS[medium.look] ?? LOOKS.pine;
  const wood = medium.behaviour === 'wood';
  const events = timeline.events.filter((e) => e.layer === layer);
  let seed = 1;

  for (const e of events) {
    const track = timeline.tracks.find((tr) => tr.id === e.trackId);
    if (!track || track.kind === 'fragment') continue;
    // Pellets and later bursts get lighter effects so buckshot stays readable.
    const weight = track.kind === 'pellet' ? 0.25 : 1;
    const frame = sampleTrack(track, e.t);
    const diameter = frame?.diameter ?? track.baseDiameter;
    const energy = 0.5 * track.massKg * e.speed ** 2;
    const k = Math.min(1, Math.sqrt(energy / 2000));
    const normal = toVec(e.normal ?? { x: e.type === 'exit' ? 1 : -1, y: 0, z: 0 });
    const origin = toVec(e.pos);

    if (e.type === 'impact' || e.type === 'enter') {
      holes.add({
        t: e.t,
        pos: e.pos,
        normal,
        radius: diameter * (wood ? 0.5 : 0.6),
        stretch: wood ? 1.15 : 1,
        stretchAxis: GRAIN,
        ragged: wood ? 0.35 : 0.5,
        color: look.hole,
        rim: wood
          ? undefined
          : { count: 10, length: [diameter * 0.4, diameter * 0.9], width: diameter * 0.5, color: look.face, lift: 0.5 },
        seed: seed++,
      });
      // Blow-back toward the shooter: small chips (wood) or a gypsum puff (drywall).
      if (wood) {
        particles.add(burst('splinter', e.t, origin, normal, 0.7, 30 * weight * (0.5 + k), [5, 15 + 25 * k], [0.001, 0.003], debris(look.raw), { stretch: 2 }));
      }
      particles.add(dust(e.t, origin, normal, wood ? 0.6 : 1.1, (wood ? 18 : 50) * weight * (0.5 + k), look.raw, wood ? 0.018 : 0.03));
    } else if (e.type === 'exit') {
      // Exit holes are larger and torn: the material spalls outward around the bullet.
      const spall = wood ? 2 + 1.2 * k : 1.6;
      holes.add({
        t: e.t,
        pos: e.pos,
        normal,
        radius: diameter * 0.5 * spall,
        stretch: wood ? 1.6 : 1.1,
        stretchAxis: GRAIN,
        ragged: wood ? 0.9 : 0.7,
        color: look.hole,
        rim: wood
          ? { count: Math.round(22 * (0.5 + k)), length: [diameter * 0.8, diameter * 2.5], width: diameter * 0.35, color: look.raw, lift: 0.9 }
          : { count: 16, length: [diameter * 0.6, diameter * 1.4], width: diameter * 0.7, color: look.raw, lift: 0.7 },
        seed: seed++,
      });
      if (wood) {
        // Splinter cone thrown out of the back face, spread wider along the grain.
        particles.add(burst('splinter', e.t, origin, normal, 0.55, 90 * weight * (0.4 + k), [10, 40 + e.speed * 0.15], [0.002, 0.007], debris(look.raw), { stretch: 5, grainSpread: true }));
        particles.add(burst('chunk', e.t, origin, normal, 0.5, 20 * weight * (0.3 + k), [5, 20 + e.speed * 0.06], [0.002, 0.006], debris(look.raw), {}));
        particles.add(dust(e.t, origin, normal, 0.6, 25 * weight, look.raw, 0.022));
      } else {
        // Drywall: a cone of gypsum chunks and a big chalky cloud.
        particles.add(burst('chunk', e.t, origin, normal, 0.6, 40 * weight, [5, 15 + e.speed * 0.04], [0.002, 0.008], debris(look.raw), {}));
        // Torn facing paper peels off the back face in flakes.
        particles.add({ ...burst('chunk', e.t, origin, normal, 0.8, 18 * weight, [4, 12 + e.speed * 0.03], [0.003, 0.009], debris(look.face), {}), look: 'flake' as const, drag: 90 });
        particles.add(dust(e.t, origin, normal, 0.7, 70 * weight, look.raw, 0.035));
      }
    }
  }
}

/** Debris is lit hard by the key light; a darker base keeps it from blooming into sparks. */
function debris(color: number): number {
  return new THREE.Color(color).multiplyScalar(0.6).getHex();
}

function toVec(v: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function burst(
  look: 'splinter' | 'chunk',
  t: number,
  origin: THREE.Vector3,
  axis: THREE.Vector3,
  spread: number,
  count: number,
  speed: [number, number],
  size: [number, number],
  color: number,
  opts: { stretch?: number; grainSpread?: boolean },
) {
  // Grain-aligned spread: tilt the cone a little toward the grain so the spray fans vertically.
  const a = opts.grainSpread ? axis.clone().addScaledVector(GRAIN, 0.15).normalize() : axis.clone();
  return {
    look,
    t0: t,
    duration: 120e-6,
    origin: origin.clone(),
    originJitter: 0.004,
    axis: a,
    spread,
    count: Math.round(count),
    speed,
    size,
    life: [4e-3, 12e-3] as [number, number],
    drag: 60,
    gravity: 9.8,
    color,
    colorJitter: 0.3,
    stretch: opts.stretch,
  };
}

function dust(t: number, origin: THREE.Vector3, axis: THREE.Vector3, spread: number, count: number, color: number, size: number) {
  return {
    look: 'dust' as const,
    t0: t,
    duration: 400e-6,
    origin: origin.clone(),
    originJitter: 0.006,
    axis: axis.clone(),
    spread,
    count: Math.round(count),
    speed: [1, 12] as [number, number],
    size: [size * 0.4, size] as [number, number],
    life: [2e-3, 6e-3] as [number, number],
    drag: 120,
    gravity: 2,
    color: debris(color),
    colorJitter: 0.1,
    grow: 3,
  };
}
