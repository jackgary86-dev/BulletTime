import * as THREE from 'three';
import type { MediumSpec } from '../data/media';
import { BONE_COLOR } from '../models/targets';
import { sampleTrack } from '../sim/sample';
import type { Timeline } from '../sim/types';
import type { HoleMarks } from './holes';
import type { ParticleSystem } from './particles';

/**
 * Bone simulant (#25): a small punched entry hole with short cracks running
 * out of it, a wider bevelled exit (bone breaks out in a cone on the far
 * side), and bone fragments driven forward into the gel behind it, where
 * they stop within a few centimetres.
 */
export function loadBoneEffect(timeline: Timeline, layers: MediumSpec[], particles: ParticleSystem, holes: HoleMarks): void {
  let seed = 1301;
  for (const e of timeline.events) {
    const medium = e.layer === undefined ? undefined : layers[e.layer];
    if (medium?.behaviour !== 'bone') continue;
    const track = timeline.tracks.find((tr) => tr.id === e.trackId);
    if (!track || track.kind === 'fragment') continue;
    const d = sampleTrack(track, e.t)?.diameter ?? track.baseDiameter;
    const energy = 0.5 * track.massKg * e.speed ** 2;
    const k = Math.min(1, Math.sqrt(energy / 2000));
    const pos = new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z);

    if (e.type === 'impact' || e.type === 'enter') {
      holes.add({
        t: e.t,
        pos: e.pos,
        normal: e.normal ?? { x: -1, y: 0, z: 0 },
        radius: d * 0.55,
        ragged: 0.3,
        color: 0x3a0d0a,
        noHalo: true,
        crater: { radius: d * (0.9 + 0.4 * k), color: 0xcdbd9c, roughness: 0.9 },
        cracks: { count: 4 + Math.round(4 * k), length: [d * 1.5, 0.012 + 0.03 * k], width: 0.0006, color: 0x5b4a36 },
        seed: seed++,
      });
      // A puff of bone dust back out of the entry.
      particles.add({
        look: 'dust',
        t0: e.t,
        duration: 80e-6,
        origin: pos.clone(),
        originJitter: d,
        axis: new THREE.Vector3(-1, 0, 0),
        spread: 0.9,
        count: Math.round(10 + 20 * k),
        speed: [2, 10],
        size: [0.002, 0.006],
        life: [2e-3, 5e-3],
        drag: 300,
        color: BONE_COLOR,
        colorJitter: 0.1,
      });
    } else if (e.type === 'exit') {
      // The exit is bevelled: a wider, rougher break on the far face.
      holes.add({
        t: e.t,
        pos: e.pos,
        normal: e.normal ?? { x: 1, y: 0, z: 0 },
        radius: d * (0.8 + 0.5 * k),
        ragged: 0.8,
        color: 0x3a0d0a,
        noHalo: true,
        crater: { radius: d * (1.6 + 1.2 * k), color: 0xcdbd9c, roughness: 0.95, irregularity: 0.7 },
        cracks: { count: 5 + Math.round(5 * k), length: [d * 2, 0.02 + 0.03 * k], width: 0.0007, color: 0x5b4a36 },
        seed: seed++,
      });
      // Fragments carried forward with the bullet; the gel stops them within a few centimetres.
      particles.add({
        look: 'chunk',
        t0: e.t,
        duration: 120e-6,
        origin: pos.clone(),
        originJitter: d,
        axis: new THREE.Vector3(1, 0, 0),
        spread: 0.7,
        count: Math.round(20 + 50 * k),
        speed: [20, 60 + 0.25 * e.speed],
        size: [0.001, 0.004],
        life: [1, 1],
        drag: 2500,
        color: BONE_COLOR,
        colorJitter: 0.15,
      });
    }
  }
}
