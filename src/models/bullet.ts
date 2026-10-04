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

/**
 * A flat swept fin standing out from the body along +x, set `angle` round the axis.
 * `y0` is the root's trailing edge, `root` and `tip` the chords, `sweep` how far the
 * tip's trailing edge sits ahead of the root's; `span` runs from the body surface out.
 */
function fin(
  material: THREE.Material,
  bodyR: number,
  angle: number,
  y0: number,
  root: number,
  tip: number,
  span: number,
  sweep: number,
  thickness: number,
): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-bodyR * 0.1, y0);
  shape.lineTo(-bodyR * 0.1, y0 + root);
  shape.lineTo(span, y0 + sweep + tip);
  shape.lineTo(span, y0 + sweep);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geometry.translate(bodyR, 0, -thickness / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.y = angle;
  mesh.castShadow = true;
  return mesh;
}

/** `count` identical fins spaced evenly round the axis, the first at `offset`. */
function fins(count: number, offset: number, make: (angle: number) => THREE.Mesh): THREE.Mesh[] {
  return Array.from({ length: count }, (_, i) => make(offset + (i / count) * Math.PI * 2));
}

/** One missile airframe in the bullet frame (base at y = 0, nose at y = L); the airframe is the id's second part. */
function missileMeshes(airframe: string, r: number, L: number): THREE.Object3D[] {
  switch (airframe) {
    case 'light-rocket': {
      // A plain tube, a sharp ogive nose, a dark nozzle and four small tail fins.
      const noseStart = L * 0.76;
      const body: Profile = [
        [0, L * 0.05],
        [r * 0.9, L * 0.05],
        [r, L * 0.07],
        [r, noseStart],
        ...nose(r, noseStart, L, r * 0.02, false, 14),
        [0, L],
      ];
      const nozzle: Profile = [
        [r * 0.62, 0],
        [r * 0.7, L * 0.02],
        [r * 0.8, L * 0.05],
        [r * 0.7, L * 0.052],
      ];
      return [lathe(body, M.paintedSteel), lathe(nozzle, M.nozzle), ...fins(4, 0, (a) => fin(M.finPaint, r, a, L * 0.02, L * 0.14, L * 0.05, r * 1.1, L * 0.06, r * 0.07))];
    }

    case 'shoulder-rocket': {
      // A bulged warhead on a thinner motor tube, a flared nozzle and six small fins.
      const tubeR = r * 0.5;
      const bulge = L * 0.56;
      const body: Profile = [
        [0, L * 0.1],
        [tubeR * 0.9, L * 0.1],
        [tubeR, L * 0.12],
        [tubeR, bulge - L * 0.06],
        [r * 0.8, bulge - L * 0.02],
        [r, bulge + L * 0.04],
        [r, L * 0.8],
        ...nose(r, L * 0.8, L, r * 0.1, true, 10),
        [0, L],
      ];
      const nozzle: Profile = [
        [tubeR * 0.8, L * 0.1],
        [tubeR * 0.7, L * 0.06],
        [tubeR * 1.05, L * 0.01],
        [tubeR * 1.2, 0],
        [tubeR * 1.1, 0],
        [tubeR * 0.6, L * 0.05],
      ];
      return [lathe(body, M.paintedSteel), lathe(nozzle, M.nozzle), ...fins(6, 0, (a) => fin(M.finPaint, tubeR, a, L * 0.02, L * 0.16, L * 0.06, r * 0.95, L * 0.05, r * 0.06))];
    }

    case 'guided-at': {
      // A dome seeker, four forward canards and larger rear fins.
      const seekerStart = L * 0.9;
      const body: Profile = [
        [0, L * 0.01],
        [r * 0.92, L * 0.01],
        [r, L * 0.03],
        [r, L * 0.8],
        ...nose(r, L * 0.8, seekerStart, r * 0.6, true, 8),
        [0, seekerStart],
      ];
      const dome: Profile = [[r * 0.6, seekerStart], ...nose(r * 0.6, seekerStart, L, 0, true, 10), [0, L]];
      return [
        lathe(body, M.paintedSteel),
        lathe(dome, M.seeker),
        ...fins(4, Math.PI / 4, (a) => fin(M.finPaint, r, a, L * 0.7, L * 0.09, L * 0.05, r * 0.9, L * 0.03, r * 0.06)),
        ...fins(4, Math.PI / 4, (a) => fin(M.finPaint, r, a, 0, L * 0.16, L * 0.06, r * 1.6, L * 0.06, r * 0.07)),
      ];
    }

    case 'air-surface': {
      // A slender body, a pale nose cone and swept mid-body wings.
      const coneStart = L * 0.78;
      const slim = r * 0.9;
      const body: Profile = [
        [0, 0],
        [slim * 0.92, 0],
        [slim, L * 0.01],
        [slim, coneStart],
        [0, coneStart],
      ];
      const cone: Profile = [[slim, coneStart], ...nose(slim, coneStart, L, slim * 0.04, false, 14), [0, L]];
      return [lathe(body, M.paintedSteel), lathe(cone, M.paleCone), ...fins(4, Math.PI / 4, (a) => fin(M.finPaint, slim, a, L * 0.3, L * 0.2, L * 0.05, r * 1.9, L * 0.15, r * 0.06))];
    }

    default: {
      // Cruise-class: a pale lifting body, two swept wings, a tail fin and a belly intake.
      const body: Profile = [
        [0, 0],
        [r * 0.8, 0],
        [r, L * 0.02],
        [r, L * 0.78],
        ...nose(r, L * 0.78, L, r * 0.05, false, 14),
        [0, L],
      ];
      const lifting = lathe(body, M.paleBody);
      lifting.scale.z = 0.85;
      const intakeProfile: Profile = [
        [0, L * 0.3],
        [r * 0.32, L * 0.3],
        [r * 0.36, L * 0.32],
        [r * 0.3, L * 0.45],
        [0, L * 0.47],
      ];
      const intake = lathe(intakeProfile, M.nozzle);
      intake.position.z = -r * 0.9;
      return [
        lifting,
        intake,
        // Wings out along ±x, tail fin up along +z.
        ...fins(2, 0, (a) => fin(M.finPaint, r, a, L * 0.1, L * 0.2, L * 0.05, r * 3.4, L * 0.14, r * 0.07)),
        fin(M.finPaint, r * 0.85, -Math.PI / 2, 0, L * 0.12, L * 0.05, r * 1.5, L * 0.07, r * 0.07),
      ];
    }
  }
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

    case 'dart': {
      // A long dense rod with a pointed nose, a blunt tail and four small fins.
      const bodyTop = L * 0.9;
      const rod: Profile = [
        [0, 0],
        [r * 0.9, 0],
        [r, L * 0.02],
        [r, bodyTop],
        ...nose(r, bodyTop, L, r * 0.12, false, 6),
        [0, L],
      ];
      const meshes: THREE.Object3D[] = [lathe(rod, M.lead)];
      for (let i = 0; i < 4; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(r * 0.12, L * 0.18, r * 1.4), M.aluminium);
        fin.position.set(0, L * 0.09, 0);
        fin.rotation.y = (i * Math.PI) / 4 + Math.PI / 8;
        fin.castShadow = true;
        meshes.push(fin);
      }
      return meshes;
    }

    case 'missile':
      return missileMeshes(spec.id.split(':')[1], r, L);

    case 'charge': {
      // A squat painted drum with a lid and a short fuze lead.
      const drum: Profile = [
        [0, 0],
        [r, 0],
        [r, L * 0.88],
        [r * 0.92, L],
        [0, L],
      ];
      const lid: Profile = [
        [r * 1.01, L * 0.8],
        [r * 1.01, L * 0.9],
      ];
      return [lathe(drum, M.paintedSteel), lathe(lid, M.redPaint)];
    }
  }
}

/** How a round's nose gives way as it expands or flattens (#71). */
interface DeformStyle {
  /** Where the deforming nose begins, as a fraction of the length from the base. */
  zone: number;
  /** Jacket petals peeling back (hollow points), or 0. */
  petals: number;
  /** How irregular the expanded rim is: lead smeared over the jacket. */
  smear: number;
  /** How much of the nose survives as a shortened stub at full deformation. */
  stub: number;
  /** Expansion ratio at which the shape is fully deformed. */
  fullRatio: number;
}

function deformStyle(spec: BulletSpec): DeformStyle {
  const full = spec.expansionRatio ?? 1.8;
  switch (spec.shape) {
    case 'hollowPoint':
      return { zone: 0.45, petals: 6, smear: 0.04, stub: 0.3, fullRatio: full };
    case 'softPoint':
      return { zone: 0.5, petals: 0, smear: 0.12, stub: 0.32, fullRatio: full };
    case 'truncatedCone':
      return { zone: 0.5, petals: 0, smear: 0.1, stub: 0.35, fullRatio: full };
    default:
      // FMJ and solids: the nose flattens against hard media.
      return { zone: 0.62, petals: 0, smear: 0.05, stub: 0.45, fullRatio: Math.max(1.3, full) };
  }
}

/**
 * Moves one vertex of the bullet's lathe frame (axis +y, base at 0) toward its
 * deformed shape: the nose from `zone` up folds into a flat-faced mushroom of
 * radius `ratio · r`, its rim flaring back (petals for hollow points, a ragged
 * lead-smeared lip for soft points), blended in by `k`.
 */
function deformVertex(v: THREE.Vector3, r: number, L: number, ratio: number, k: number, style: DeformStyle): void {
  const y0 = L * style.zone;
  if (v.y <= y0 || k <= 0) return;
  const rad = Math.hypot(v.x, v.z);
  const theta = Math.atan2(v.z, v.x);
  const h = Math.min(1, (v.y - y0) / (L - y0));
  const R = r * ratio;
  const yFace = y0 + (L - y0) * style.stub;
  let tr: number;
  let ty: number;
  if (h < 0.4) {
    // The flaring rim: out to the full radius, curling back toward the base at its lip.
    const f = h / 0.4;
    tr = r + (R - r) * f ** 0.7;
    ty = y0 + (yFace - y0) * f - (L - y0) * 0.18 * f * f * (style.petals ? 1 : 0.4);
    if (style.petals) {
      // Petals with tears between them.
      const c = Math.cos(theta * style.petals);
      tr *= 1 + 0.1 * f * c;
      if (c < -0.6) tr *= 1 - 0.18 * f;
    }
  } else {
    // The flattened face, slightly domed.
    const f = (h - 0.4) / 0.6;
    tr = R * (1 - f);
    ty = yFace + (L - y0) * 0.015 * f;
  }
  // Lead smeared irregularly over the lip.
  tr *= 1 + style.smear * Math.sin(theta * 5 + 1.3) * Math.sin(theta * 3 - 0.4) * Math.min(1, h * 2.5);
  const nr = rad + (tr - rad) * k;
  const ny = v.y + (ty - v.y) * k;
  const scale = rad > 1e-9 ? nr / rad : 0;
  v.set(v.x * scale, ny, v.z * scale);
}

export function createBulletModel(spec: BulletSpec): BulletModel {
  const isShot = spec.shape === 'buckshot';
  // A stack of three layers of pellets is three diameters long.
  const length = isShot ? spec.caliberMm * 3 * MM : spec.lengthMm * MM;
  const r = (spec.caliberMm / 2) * MM;
  const style = deformStyle(spec);

  // Lathe axis is +y; rotate so the projectile points along +x with the nose at the origin.
  const body = new THREE.Group();
  const meshes = buildMeshes(spec);
  body.add(...meshes);
  body.rotation.z = -Math.PI / 2;
  body.position.x = -length;

  const group = new THREE.Group();
  group.name = `bullet:${spec.id}`;
  group.add(body);

  const baseDiameter = spec.caliberMm * MM;
  // The undeformed vertices of every lathe part, in the body frame, to deform from.
  const parts = meshes
    .filter((m): m is THREE.Mesh => m instanceof THREE.Mesh && m.geometry instanceof THREE.LatheGeometry)
    .map((mesh) => ({ mesh, rest: Float32Array.from(mesh.geometry.getAttribute('position').array as Float32Array) }));
  // Small add-ons on the nose (skive slits) disappear once the petals tear open along them.
  const noseBits = meshes.filter((m) => m instanceof THREE.Mesh && !(m.geometry instanceof THREE.LatheGeometry) && m.position.y > length * style.zone);
  let shownRatio = 1;
  const v = new THREE.Vector3();

  return {
    group,
    length,
    setDiameter(diameter) {
      const ratio = Math.max(1, diameter / baseDiameter);
      if (Math.abs(ratio - shownRatio) < 1e-4 || isShot) return;
      shownRatio = ratio;
      const k = Math.min(1, (ratio - 1) / Math.max(1e-3, style.fullRatio - 1));
      let top = 0;
      for (const { mesh, rest } of parts) {
        const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          v.fromArray(rest, i * 3);
          deformVertex(v, r, length, ratio, k, style);
          pos.setXYZ(i, v.x, v.y, v.z);
          top = Math.max(top, v.y);
        }
        pos.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
        mesh.geometry.computeBoundingSphere();
      }
      for (const bit of noseBits) bit.visible = k < 0.05;
      // Keep the nose at the group origin as the bullet shortens.
      body.position.x = -(top || length);
    },
  };
}

/** Frees the GPU geometry owned by a model (materials are shared and kept). */
export function disposeBulletModel(model: BulletModel): void {
  model.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.geometry.dispose();
  });
}
