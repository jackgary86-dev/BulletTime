import * as THREE from 'three';

/**
 * The force chains a hit sets up in packed grains (sandbags, earth). Load does
 * not spread evenly: it runs down thin, branching chains of single grains, the
 * more of the bed the harder the hit (the top row of the high-speed footage of
 * a sphere striking a bed of grains is a sparse tree, the middle row a dense
 * one). This builds one such tree as a list of grain positions, each with the
 * path length from the point of impact, so the effect can light them in turn
 * as the stress wave runs out along them.
 */

export interface ChainBead {
  /** Offset from the point of impact, in metres, in the target's frame. */
  offset: THREE.Vector3;
  /** Distance along the chain from the point of impact, in metres. */
  pathM: number;
  /** 0 at the trunk, rising with each fork: thinner branches carry less load. */
  depth: number;
}

interface Branch {
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  steps: number;
  depth: number;
  pathM: number;
}

const MAX_DEPTH = 3;

/** How far the loaded region reaches into the bed for an impact of strength `k` (0 to 1), in metres. */
export function chainReachM(k: number): number {
  return 0.05 + 0.13 * Math.min(1, Math.max(0, k));
}

/**
 * Builds the tree for an impact of strength `k` (0 to 1) into grains of diameter `grainM`,
 * heading `inward` (a unit vector). `maxBeads` caps the total so a hard hit stays affordable.
 */
export function forceChains(inward: THREE.Vector3, k: number, grainM: number, rand: () => number, maxBeads = 260): ChainBead[] {
  const beads: ChainBead[] = [];
  const axis = inward.clone().normalize();
  const helper = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(axis, helper).normalize();
  const w = new THREE.Vector3().crossVectors(axis, u);
  const trunkSteps = Math.round(chainReachM(k) / grainM);
  const roots = 3 + Math.round(3 * k);
  const stack: Branch[] = [];
  for (let i = 0; i < roots; i++) {
    // Chains leave the hit in a fan about the inward direction, none straight backward.
    const tilt = 0.15 + 0.7 * rand();
    const turn = rand() * Math.PI * 2;
    const dir = axis.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(u, Math.sin(tilt) * Math.cos(turn)).addScaledVector(w, Math.sin(tilt) * Math.sin(turn));
    stack.push({ pos: new THREE.Vector3(), dir, steps: Math.round(trunkSteps * (0.6 + 0.4 * rand())), depth: 0, pathM: 0 });
  }
  while (stack.length && beads.length < maxBeads) {
    const b = stack.pop()!;
    for (let s = 0; s < b.steps && beads.length < maxBeads; s++) {
      // A chain wanders from grain to grain but keeps heading on.
      b.dir.x += (rand() - 0.5) * 0.7;
      b.dir.y += (rand() - 0.5) * 0.7;
      b.dir.z += (rand() - 0.5) * 0.7;
      b.dir.addScaledVector(axis, 0.12).normalize();
      b.pos.addScaledVector(b.dir, grainM);
      b.pathM += grainM;
      beads.push({ offset: b.pos.clone(), pathM: b.pathM, depth: b.depth });
      if (b.depth < MAX_DEPTH && s > 2 && rand() < 0.07 + 0.05 * k) {
        // A fork: a side chain bears off at an angle and runs a shorter way.
        const side = b.dir.clone().cross(randomUnit(rand)).normalize();
        const angle = 0.5 + 0.5 * rand();
        const child = b.dir.clone().multiplyScalar(Math.cos(angle)).addScaledVector(side, Math.sin(angle));
        stack.push({ pos: b.pos.clone(), dir: child, steps: Math.round((b.steps - s) * (0.5 + 0.2 * rand())), depth: b.depth + 1, pathM: b.pathM });
      }
    }
  }
  return beads;
}

function randomUnit(rand: () => number): THREE.Vector3 {
  const z = 2 * rand() - 1;
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), z);
}
