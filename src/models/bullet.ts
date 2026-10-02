import * as THREE from 'three';
import type { BulletSpec } from '../data/bullets';
import { BULLET_MATERIALS as M } from './materials';

/**
 * Procedural projectile models built from lathe profiles, one shape per bullet
 * family. All models are built in true scale (metres), so rounds keep their
 * real size relative to each other.
 *
 * The returned group's origin is the projectile's nose and it points along +x,
 * so a timeline nose position can be applied directly.
 */
export interface BulletModel {
  group: THREE.Group;
  /** Overall length in metres (nose to base). */
  length: number;
  /** Shows the bullet expanded to `diameter` (metres); it shortens as it mushrooms. */
  setDiameter(diameter: number): void;
}

const SEGMENTS = 48;
const MM = 0.001;

type Profile = [radius: number, height: number][];

/** A lathe section between two heights of a profile, in the given material. */
function lathe(profile: Profile, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.LatheGeometry(
      profile.map(([r, y]) => new THREE.Vector2(r, y)),
      SEGMENTS,
    ),
    material,
  );
  mesh.castShadow = true;
  return mesh;
}

/** The exposed lead core at the base of an open-base FMJ, inside the jacket's folded rim (the base seam). */
function openBase(radius: number): THREE.Mesh {
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), M.leadCore);
  disc.rotation.x = Math.PI / 2;
  disc.position.y = -0.00004;
  return disc;
}

/** Points of a nose curve from (r, y0) to (tipR, y1); `round` = elliptical, otherwise tangent ogive. */
function nose(r: number, y0: number, y1: number, tipR: number, round: boolean, steps = 14): Profile {
  const pts: Profile = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const k = round ? Math.sqrt(1 - t * t) : 1 - t * t;
    pts.push([tipR + (r - tipR) * k, y0 + (y1 - y0) * t]);
  }
  return pts;
}

/** Builds the meshes for one bullet in its local frame: base at y = 0, nose at y = L, axis +y. */
function buildMeshes(spec: BulletSpec): THREE.Object3D[] {
  const r = (spec.caliberMm / 2) * MM;
  const L = spec.lengthMm * MM;

  switch (spec.shape) {
    case 'roundNose': {
      const isLead = spec.type.toLowerCase().includes('lead');
      const material = isLead ? M.lead : M.copper;
      const profile: Profile = [
        [0, 0],
        [r * 0.92, 0],
        [r, L * 0.04],
        [r, L * 0.5],
        ...nose(r, L * 0.5, L, r * 0.18, true),
        [0, L],
      ];
      return isLead ? [lathe(profile, material)] : [lathe(profile, material), openBase(r * 0.72)];
    }

    case 'truncatedCone': {
      // Jacket to the shoulder, exposed lead cone and flat meplat above.
      const shoulder = L * 0.62;
      const jacket: Profile = [
        [0, 0],
        [r * 0.93, 0],
        [r, L * 0.04],
        // Crimp cannelure.
        [r, L * 0.4],
        [r * 0.965, L * 0.42],
        [r, L * 0.44],
        [r, shoulder],
        [r * 0.97, shoulder + L * 0.02],
        [0, shoulder + L * 0.02],
      ];
      const tip: Profile = [
        [r * 0.97, shoulder],
        [r * 0.62, L * 0.97],
        [r * 0.56, L],
        [0, L],
      ];
      return [lathe(jacket, M.gildingMetal), lathe(tip, M.lead)];
    }

    case 'hollowPoint': {
      // The jacket up to its mouth, then the lead-lined cavity down into the core.
      const jacket: Profile = [
        [0, 0],
        [r * 0.92, 0],
        [r, L * 0.04],
        [r, L * 0.55],
        [r * 0.93, L * 0.72],
        [r * 0.76, L * 0.88],
        [r * 0.6, L],
        [r * 0.5, L],
      ];
      const cavity: Profile = [
        [r * 0.5, L],
        [r * 0.42, L * 0.97],
        [r * 0.3, L * 0.86],
        [0, L * 0.82],
      ];
      const meshes: THREE.Object3D[] = [lathe(jacket, M.copper), lathe(cavity, M.leadCore)];
      // Skive lines: six notches cut down the jacket from the mouth, where the petals will tear.
      const skive = new THREE.BoxGeometry(r * 0.03, L * 0.14, r * 0.08);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const notch = new THREE.Mesh(skive, M.skive);
        const rr = r * 0.66;
        notch.position.set(Math.cos(a) * rr, L * 0.93, Math.sin(a) * rr);
        notch.rotation.y = -a;
        // Lean in with the ogive.
        notch.rotateZ(0.6);
        meshes.push(notch);
      }
      return meshes;
    }

    case 'softPoint':
    case 'spitzer':
    case 'boatTail': {
      const boatTail = spec.shape !== 'spitzer';
      const bearingEnd = L * (spec.shape === 'softPoint' ? 0.45 : 0.42);
      const tipStart = spec.shape === 'softPoint' ? L * 0.84 : L;
      const body: Profile = [
        [0, 0],
        [boatTail ? r * 0.78 : r * 0.94, 0],
        ...(boatTail ? ([[r, L * 0.13]] as Profile) : ([[r, L * 0.03]] as Profile)),
        // Cannelure groove.
        [r, bearingEnd - L * 0.06],
        [r * 0.97, bearingEnd - L * 0.05],
        [r, bearingEnd - L * 0.04],
        [r, bearingEnd],
        ...nose(r, bearingEnd, L, r * 0.05, false).filter(([, y]) => y < tipStart - 1e-9),
      ];
      const meshes: THREE.Object3D[] = [];
      if (spec.shape === 'softPoint') {
        // The jacket ends where the exposed lead tip begins, on the same ogive curve.
        const t = (tipStart - bearingEnd) / (L - bearingEnd);
        const tipR = r * 0.05 + (r - r * 0.05) * (1 - t * t);
        body.push([tipR, tipStart], [0, tipStart]);
        const tip: Profile = [
          [tipR, tipStart],
          ...nose(tipR, tipStart, L, r * 0.12, true, 8),
          [0, L],
        ];
        meshes.push(lathe(tip, M.lead));
      } else {
        body.push([0, L]);
        // Military ball: the jacket is drawn from the nose, leaving lead showing at the base.
        meshes.push(openBase(r * (boatTail ? 0.6 : 0.75)));
      }
      meshes.unshift(lathe(body, M.gildingMetal));
      return meshes;
    }

    case 'fosterSlug': {
      // Hollow base, rifled ribs on the side, domed nose. All soft lead.
      const ribs: Profile = [];
      const ribStart = L * 0.08;
      const ribEnd = L * 0.6;
      const ribCount = 6;
      for (let i = 0; i <= ribCount * 2; i++) {
        const y = ribStart + ((ribEnd - ribStart) * i) / (ribCount * 2);
        ribs.push([i % 2 === 0 ? r : r * 0.94, y]);
      }
      const profile: Profile = [
        [0, L * 0.42],
        [r * 0.55, L * 0.3],
        [r * 0.66, L * 0.02],
        [r * 0.7, 0],
        [r * 0.97, 0],
        ...ribs,
        ...nose(r, ribEnd, L, r * 0.25, true),
        [0, L],
      ];
      return [lathe(profile, M.lead)];
    }

    case 'buckshot': {
      // Nine pellets stacked three layers of three, as they sit in the shell.
      const count = spec.pellets ?? 9;
      const geometry = new THREE.SphereGeometry(r, 24, 16);
      const meshes: THREE.Object3D[] = [];
      const ringRadius = r / Math.sin(Math.PI / 3); // three touching spheres
      for (let i = 0; i < count; i++) {
        const layer = Math.floor(i / 3);
        const angle = ((i % 3) / 3) * Math.PI * 2 + layer * (Math.PI / 3);
        const pellet = new THREE.Mesh(geometry, M.lead);
        pellet.position.set(Math.cos(angle) * ringRadius, r + layer * r * 2, Math.sin(angle) * ringRadius);
        pellet.castShadow = true;
        meshes.push(pellet);
      }
      // The shot cup: a thin plastic sleeve slit into petals round the lower layers, on a cushion wad.
      const cupR = ringRadius + r * 1.04;
      const petals = 4;
      for (let i = 0; i < petals; i++) {
        const petal = new THREE.Mesh(
          new THREE.CylinderGeometry(cupR, cupR, r * 3, 16, 1, true, (i / petals) * Math.PI * 2 + 0.25, (Math.PI * 2) / petals - 0.5),
          M.wad,
        );
        petal.position.y = r * 1.5;
        meshes.push(petal);
      }
      const base = new THREE.Mesh(new THREE.CylinderGeometry(cupR, cupR, r * 0.25, 32), M.wad);
      base.position.y = -r * 0.12;
      const cushion = new THREE.Mesh(new THREE.CylinderGeometry(cupR * 0.9, cupR * 0.9, r * 1.6, 32), M.wad);
      cushion.position.y = -r * 1.05;
      meshes.push(base, cushion);
      return meshes;
    }

    case 'cannonShell': {
      // Painted steel body with a copper rotating band and a pointed aluminium fuze.
      const bandLo = L * 0.08;
      const bandHi = L * 0.15;
      const bodyTop = L * 0.62;
      const body: Profile = [
        [0, 0],
        [r * 0.9, 0],
        [r * 0.97, L * 0.02],
        [r * 0.97, bodyTop - L * 0.08],
        ...nose(r * 0.97, bodyTop - L * 0.08, bodyTop, r * 0.78, false, 6),
        [0, bodyTop],
      ];
      const band: Profile = [
        [r * 0.965, bandLo],
        [r * 1.02, bandLo + L * 0.005],
        [r * 1.02, bandHi - L * 0.005],
        [r * 0.965, bandHi],
      ];
      const yellow: Profile = [
        [r * 0.975, L * 0.36],
        [r * 0.975, L * 0.4],
      ];
      const red: Profile = [
        [r * 0.975, L * 0.42],
        [r * 0.975, L * 0.45],
      ];
      const fuze: Profile = [
        [0, bodyTop],
        [r * 0.78, bodyTop],
        ...nose(r * 0.78, bodyTop, L, r * 0.06, false),
        [0, L],
      ];
      return [
        lathe(body, M.paintedSteel),
        lathe(band, M.copper),
        lathe(yellow, M.yellowPaint),
        lathe(red, M.redPaint),
        lathe(fuze, M.aluminium),
      ];
    }
  }
}

export function createBulletModel(spec: BulletSpec): BulletModel {
  const isShot = spec.shape === 'buckshot';
  // A stack of three layers of pellets is three diameters long.
  const length = isShot ? spec.caliberMm * 3 * MM : spec.lengthMm * MM;

  // Lathe axis is +y; rotate so the projectile points along +x with the nose at the origin.
  const body = new THREE.Group();
  body.add(...buildMeshes(spec));
  body.rotation.z = -Math.PI / 2;
  body.position.x = -length;

  const group = new THREE.Group();
  group.name = `bullet:${spec.id}`;
  group.add(body);

  const baseDiameter = spec.caliberMm * MM;

  return {
    group,
    length,
    setDiameter(diameter) {
      const ratio = diameter / baseDiameter;
      // Lathe x/z are radial, y is the length; expansion trades length for width.
      const shorten = 1 / Math.sqrt(ratio);
      body.scale.set(ratio, shorten, ratio);
      body.position.x = -length * shorten;
    },
  };
}

/** Frees the GPU geometry owned by a model (materials are shared and kept). */
export function disposeBulletModel(model: BulletModel): void {
  model.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.geometry.dispose();
  });
}
