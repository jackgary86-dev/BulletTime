import * as THREE from 'three';
import { crinkleNormalMap } from './crinkleTexture';
import type { ParticleSystem } from './particles';
import { sampleTrack } from '../sim/sample';
import type { ShotEvent, Timeline, Track } from '../sim/types';

/**
 * The bullet's wake in air (#72): a Mach cone trailing from the nose of a
 * supersonic round and a short turbulent shimmer behind its base, both drawn
 * as faintly refracting glass-like shells so they bend the background the way
 * schlieren footage shows, plus a vapour trail that lingers and fades.
 */

const SOUND_SPEED = 343;
/** How far back the visible Mach cone reaches, in metres. */
const CONE_LENGTH_M = 0.09;
/** Length of the turbulent wake behind the base at full speed, in metres. */
const WAKE_LENGTH_M = 0.07;

/** Air that bends light a little: refraction only, no tint or reflections to speak of. */
function airMaterial(normalMap?: THREE.Texture): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0,
    transmission: 1,
    ior: 1.25,
    thickness: 0.003,
    specularIntensity: 0.06,
    normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

export interface Wake {
  group: THREE.Group;
  /** Shows the wake for a bullet at `speed` (m/s), `inAir` or not, whose base is `length` behind the nose. */
  update(inAir: boolean, speed: number, diameter: number, length: number): void;
  dispose(): void;
}

export function createWake(): Wake {
  const group = new THREE.Group();
  group.name = 'wake';
  // Cone with its apex at the origin (the nose) opening back along -x.
  const coneGeometry = new THREE.ConeGeometry(1, 1, 48, 1, true);
  coneGeometry.translate(0, -0.5, 0);
  coneGeometry.rotateZ(-Math.PI / 2);
  const cone = new THREE.Mesh(coneGeometry, airMaterial());
  const shimmerMap = crinkleNormalMap().clone();
  shimmerMap.wrapS = shimmerMap.wrapT = THREE.RepeatWrapping;
  shimmerMap.repeat.set(3, 6);
  shimmerMap.needsUpdate = true;
  // The turbulent wake: a tube trailing from the base and narrowing as it closes up, rippled by a shimmer map.
  const wakeGeometry = new THREE.CylinderGeometry(1, 0.45, 1, 24, 1, true);
  wakeGeometry.translate(0, -0.5, 0);
  wakeGeometry.rotateZ(-Math.PI / 2);
  const wake = new THREE.Mesh(wakeGeometry, airMaterial(shimmerMap));
  group.add(cone, wake);
  for (const mesh of [cone, wake]) {
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
  }

  return {
    group,
    update(inAir, speed, diameter, length) {
      group.visible = inAir;
      if (!inAir) return;
      const mach = speed / SOUND_SPEED;
      cone.visible = mach > 1.05;
      if (cone.visible) {
        const spread = Math.tan(Math.asin(1 / mach)) * CONE_LENGTH_M;
        cone.scale.set(CONE_LENGTH_M, spread, spread);
      }
      const k = Math.min(1, speed / 900);
      wake.position.x = -length;
      wake.scale.set(WAKE_LENGTH_M * (0.4 + 0.6 * k), diameter * 0.6, diameter * 0.6);
      // Drift the shimmer down the wake so it boils even while scrubbing slowly.
      shimmerMap.offset.y = (wake.position.x * 50 + speed * 1e-3) % 1;
    },
    dispose() {
      coneGeometry.dispose();
      wakeGeometry.dispose();
      (cone.material as THREE.Material).dispose();
      (wake.material as THREE.Material).dispose();
      shimmerMap.dispose();
    },
  };
}

/** Times when the track is in open air (before the target, after an exit, after a ricochet). */
export function airIntervals(track: Track, events: ShotEvent[]): [number, number][] {
  const own = events.filter((e) => e.trackId === track.id).sort((a, b) => a.t - b.t);
  const intervals: [number, number][] = [];
  let start: number | null = track.spawnT;
  for (const e of own) {
    if ((e.type === 'impact' || e.type === 'enter' || e.type === 'stop' || e.type === 'splash' || e.type === 'detonate') && start !== null) {
      intervals.push([start, e.t]);
      start = null;
    } else if ((e.type === 'exit' || e.type === 'ricochet') && start === null) {
      start = e.t;
    }
  }
  if (start !== null) intervals.push([start, track.endT]);
  return intervals;
}

/** A faint trail of heated air and vapour along each bullet's flight in the open, lingering a few milliseconds. */
export function addVapourTrails(timeline: Timeline, particles: ParticleSystem): void {
  for (const shot of timeline.shots) {
    const track = timeline.tracks[shot.primaryId];
    if (!track || track.kind !== 'bullet') continue;
    for (const [a, b] of airIntervals(track, timeline.events)) {
      const step = 0.012;
      let t = a;
      while (t < b) {
        const frame = sampleTrack(track, t);
        if (!frame || frame.speed < 50) break;
        particles.add({
          look: 'vapour',
          t0: t,
          origin: new THREE.Vector3(frame.pos.x, frame.pos.y, frame.pos.z),
          originJitter: frame.diameter,
          axis: new THREE.Vector3(0, 1, 0),
          spread: Math.PI,
          count: 2,
          speed: [0.2, 1.5],
          size: [frame.diameter * 1.2, frame.diameter * 2.5],
          life: [3e-3, 7e-3],
          drag: 100,
          color: 0xdde3e8,
          colorJitter: 0.1,
          grow: 3,
          seed: Math.round(t * 1e7) + track.id,
        });
        t += step / frame.speed;
      }
    }
  }
}
