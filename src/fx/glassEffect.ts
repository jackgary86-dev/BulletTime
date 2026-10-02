import * as THREE from 'three';
import type { MediumSpec } from '../data/media';
import { SHOT_Y, TARGET_FRONT_X } from '../models/targets';
import { seededRandom } from '../sim/random';
import { sampleTrack } from '../sim/sample';
import type { ShotEvent, Timeline } from '../sim/types';
import type { HoleMarks } from './holes';
import type { ParticleSystem } from './particles';

/**
 * Glass (and ice): a frosted crush zone at the hole, radial cracks racing out
 * at the speed of crack propagation, concentric cracks joining them a moment
 * later, and shards thrown forward out of the back face (plus a few blown back
 * toward the shooter). The bullet's deflection comes from the physics.
 */

/** Crack tips in soda-lime glass run at roughly 1.5 km/s; ice is a bit slower. */
const CRACK_SPEED = { glass: 1500, ice: 1100 };
/** Concentric cracks form this long after the radial crack has passed their radius. */
const RING_DELAY_S = 25e-6;
const OFFSET = 0.0008;

interface Segment {
  t: number;
  matrix: THREE.Matrix4;
  /** Brightness of this bit of crack, 0–1. */
  shade: number;
}

export class GlassCracks {
  readonly group = new THREE.Group();
  private webs: { mesh: THREE.InstancedMesh; times: number[] }[] = [];

  constructor() {
    this.group.name = 'glass-cracks';
  }

  load(
    timeline: Timeline,
    layers: MediumSpec[],
    layerOffsets: number[],
    angleDeg: number,
    particles: ParticleSystem,
    holes: HoleMarks,
  ): void {
    this.clear();
    let seed = 701;
    layers.forEach((medium, layer) => {
      if (medium.behaviour !== 'glass' && medium.behaviour !== 'ice') return;
      const ice = medium.behaviour === 'ice';
      // Pane centre and in-plane axes, in world space.
      const angle = THREE.MathUtils.degToRad(angleDeg);
      const normalOut = new THREE.Vector3(-Math.cos(angle), 0, Math.sin(angle));
      const side = new THREE.Vector3(0, 1, 0).cross(normalOut).normalize();
      const front = new THREE.Vector3(TARGET_FRONT_X, SHOT_Y, 0).addScaledVector(normalOut, -(layerOffsets[layer] ?? 0));
      const half = { y: medium.heightM / 2, s: medium.widthM / 2 };

      for (const e of timeline.events) {
        if (e.layer !== layer) continue;
        const track = timeline.tracks.find((tr) => tr.id === e.trackId);
        if (!track || track.kind === 'fragment') continue;
        const d = sampleTrack(track, e.t)?.diameter ?? track.baseDiameter;
        const energy = 0.5 * track.massKg * e.speed ** 2;
        const k = Math.min(1, Math.sqrt(energy / 3000));
        const w = track.kind === 'pellet' ? 0.3 : 1;
        const pos = new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z);

        if (e.type === 'impact' || e.type === 'enter' || e.type === 'ricochet') {
          const normal = vec(e.normal) ?? normalOut.clone();
          const glancing = e.type === 'ricochet';
          // Crushed, frosted cone around the hole.
          holes.add({
            t: e.t,
            pos: e.pos,
            normal,
            radius: d * 0.5,
            ragged: 0.5,
            color: 0x0b0f12,
            noOpening: glancing,
            noHalo: true,
            crater: { radius: d * (glancing ? 1.2 : 1.6 + 1.5 * k), color: ice ? 0xf4fbff : 0xdfe9ee, roughness: 0.9, irregularity: 0.5 },
            seed: seed++,
          });
          const local = pos.clone().sub(front);
          const bounds = {
            yMin: -half.y - local.y,
            yMax: half.y - local.y,
            sMin: -half.s - local.dot(side),
            sMax: half.s - local.dot(side),
          };
          const reach = glancing ? 0.04 : Math.min(0.35, 0.08 + 0.3 * k);
          this.addWeb(e, pos, normalOut, side, bounds, reach, ice, d, seed++);
          // A few slivers blown back toward the shooter.
          particles.add(shards(e.t, pos, normal, 1.0, 25 * w * (0.3 + k), [5, 30], ice));
        } else if (e.type === 'exit') {
          const normal = vec(e.normal) ?? normalOut.clone().negate();
          // The back face spalls: a cone of shards following the bullet, plus fine glitter.
          particles.add(shards(e.t, pos, normal, 0.7, 160 * w * (0.3 + k), [20, 60 + e.speed * 0.25], ice));
          particles.add({
            look: 'grain',
            t0: e.t,
            duration: 100e-6,
            origin: pos.clone(),
            originJitter: 0.004,
            axis: normal.clone(),
            spread: 0.6,
            count: Math.round(200 * w * (0.3 + k)),
            speed: [30, 80 + e.speed * 0.3],
            size: [0.0003, 0.0009],
            life: [3e-3, 10e-3],
            drag: 25,
            gravity: 9.8,
            color: ice ? 0xeaf6ff : 0xcfe8dd,
            colorJitter: 0.3,
          });
        }
      }
    });
  }

  private addWeb(
    e: ShotEvent,
    pos: THREE.Vector3,
    normalOut: THREE.Vector3,
    side: THREE.Vector3,
    bounds: { yMin: number; yMax: number; sMin: number; sMax: number },
    reach: number,
    ice: boolean,
    diameter: number,
    seed: number,
  ): void {
    const rand = seededRandom(seed);
    const speed = ice ? CRACK_SPEED.ice : CRACK_SPEED.glass;
    const inside = (s: number, y: number) => s > bounds.sMin && s < bounds.sMax && y > bounds.yMin && y < bounds.yMax;
    const segments: Segment[] = [];
    const segment = (x1: number, y1: number, x2: number, y2: number, t: number, width: number) => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 1e-5) return;
      // Each fracture face is twisted about its own length, so it catches the light at its own
      // angle: some segments glint, others stay dark, as real cracks do.
      const along = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(y2 - y1, x2 - x1));
      const twist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (rand() - 0.5) * 1.6);
      segments.push({
        t,
        matrix: new THREE.Matrix4().compose(new THREE.Vector3((x1 + x2) / 2, (y1 + y2) / 2, 0), along.multiply(twist), new THREE.Vector3(len, width, 1)),
        shade: 0.5 + 0.5 * rand(),
      });
    };

    // Radial cracks: zig-zag lines from the crush zone outward, each recording where it is at each ring radius.
    const radials = ice ? 6 + Math.floor(rand() * 4) : 10 + Math.floor(rand() * 7);
    const ringRadii = [0.25, 0.5, 0.8].map((f) => f * reach * (0.8 + 0.4 * rand()));
    const ringPoints: (THREE.Vector2 | null)[][] = ringRadii.map(() => []);
    const start = diameter * 1.2;
    for (let i = 0; i < radials; i++) {
      let a = (i / radials) * Math.PI * 2 + (rand() - 0.5) * 0.4;
      const length = reach * (0.6 + 0.6 * rand());
      let r = start;
      let x = Math.cos(a) * r;
      let y = Math.sin(a) * r;
      const crossed = ringRadii.map(() => null as THREE.Vector2 | null);
      while (r < length) {
        const step = Math.min(length - r, 0.006 + 0.012 * rand());
        a += (rand() - 0.5) * (ice ? 0.5 : 0.25);
        const nr = r + step;
        const nx = Math.cos(a) * nr;
        const ny = Math.sin(a) * nr;
        if (!inside(nx, ny)) break;
        segment(x, y, nx, ny, e.t + nr / speed, 0.00045 * (1.3 - (0.8 * r) / length));
        ringRadii.forEach((rr, j) => {
          if (!crossed[j] && r < rr && nr >= rr) crossed[j] = new THREE.Vector2(nx, ny);
        });
        // Occasional branch.
        if (rand() < 0.06) {
          const ba = a + (rand() < 0.5 ? -1 : 1) * (0.3 + 0.4 * rand());
          const bl = 0.01 + 0.03 * rand();
          const bx = nx + Math.cos(ba) * bl;
          const by = ny + Math.sin(ba) * bl;
          if (inside(bx, by)) segment(nx, ny, bx, by, e.t + (nr + bl) / speed, 0.0003);
        }
        x = nx;
        y = ny;
        r = nr;
      }
      crossed.forEach((p, j) => ringPoints[j].push(p));
    }

    // Concentric cracks: bowed chords joining neighbouring radials at each ring, with gaps.
    ringRadii.forEach((rr, j) => {
      const pts = ringPoints[j];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        if (!p || !q || rand() < 0.25) continue;
        const t = e.t + rr / speed + RING_DELAY_S * (1 + rand());
        const mid = p.clone().add(q).multiplyScalar(0.5);
        const bow = mid.clone().normalize().multiplyScalar(rr * 0.06 * (rand() - 0.3));
        const m = mid.add(bow);
        if (!inside(m.x, m.y)) continue;
        segment(p.x, p.y, m.x, m.y, t, 0.00035);
        segment(m.x, m.y, q.x, q.y, t, 0.00035);
      }
    });

    segments.sort((a, b) => a.t - b.t);
    const mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      // Mirror-like fracture faces: they show the room and softboxes, rather than glowing white.
      new THREE.MeshStandardMaterial({
        color: ice ? 0xffffff : 0xeaf6f0,
        metalness: 1,
        roughness: 0.3,
        envMapIntensity: 5,
        // A faint glow keeps every crack readable even where it reflects nothing bright.
        emissive: 0x3a4644,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      segments.length,
    );
    const shade = new THREE.Color();
    segments.forEach((s, i) => {
      mesh.setMatrixAt(i, s.matrix);
      mesh.setColorAt(i, shade.setScalar(s.shade));
    });
    mesh.count = 0;
    mesh.frustumCulled = false;
    // Lay the web on the entry face: local x along the pane's side axis, y up, z out of the face.
    const up = new THREE.Vector3(0, 1, 0);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, normalOut));
    mesh.position.copy(pos).addScaledVector(normalOut, OFFSET);
    this.group.add(mesh);
    this.webs.push({ mesh, times: segments.map((s) => s.t) });
  }

  clear(): void {
    for (const { mesh } of this.webs) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.webs = [];
  }

  update(t: number): void {
    for (const { mesh, times } of this.webs) {
      // Segments are sorted by the time the crack reaches them.
      let lo = 0;
      let hi = times.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= t) lo = mid + 1;
        else hi = mid;
      }
      mesh.count = lo;
    }
  }
}

function vec(v: { x: number; y: number; z: number } | undefined): THREE.Vector3 | null {
  return v ? new THREE.Vector3(v.x, v.y, v.z).normalize() : null;
}

function shards(t: number, origin: THREE.Vector3, axis: THREE.Vector3, spread: number, count: number, speed: [number, number], ice: boolean) {
  return {
    look: 'shard' as const,
    t0: t,
    duration: 150e-6,
    origin: origin.clone(),
    originJitter: 0.01,
    axis: axis.clone(),
    spread,
    count: Math.round(count),
    speed,
    size: ice ? ([0.003, 0.012] as [number, number]) : ([0.002, 0.009] as [number, number]),
    life: [4e-3, 15e-3] as [number, number],
    drag: 15,
    gravity: 9.8,
    color: ice ? 0xf2fbff : 0xd8f0e6,
    colorJitter: 0.2,
  };
}
