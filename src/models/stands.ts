import * as THREE from 'three';
import type { MediumSpec } from '../data/media';
import { woodTexture } from './textures';

/**
 * Holders for each kind of target (#56): a lab cart for gel, water and other
 * short blocks, timber risers under masonry and sandbags, a chain hanger for
 * steel plates, a clamping frame for glass, wood and drywall, and a rubber mat
 * under a cinder block. All built in a layer's local frame: the body is
 * centred at x = t / 2, y = 0 is the shot line and the floor is at y = -shotY.
 */

/** Dark powder-coated steel for frames and the cart. */
export const standSteel = new THREE.MeshStandardMaterial({ color: 0x2f343b, roughness: 0.42, metalness: 0.75 });
const aluminium = new THREE.MeshStandardMaterial({ color: 0xaeb3ba, roughness: 0.32, metalness: 0.95 });
const rubber = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9 });
const clampOrange = new THREE.MeshStandardMaterial({ color: 0xd8641c, roughness: 0.5, metalness: 0.2 });
const chainSteel = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.35, metalness: 1 });
// Rough-sawn, weathered timber, darker than a fresh pine plank target.
const timber = new THREE.MeshStandardMaterial({ color: 0x7d6e5e, map: woodTexture('pine'), roughness: 0.9 });

/** Materials shared by every holder; disposing a target must leave these alone. */
export const SHARED_STAND_MATERIALS: ReadonlySet<THREE.Material> = new Set([
  standSteel,
  aluminium,
  rubber,
  clampOrange,
  chainSteel,
  timber,
]);

/** Builds the holder that suits the medium. */
export function createSupport(spec: MediumSpec, t: number, shotY: number): THREE.Group {
  const bottom = shotY - spec.heightM / 2;
  switch (spec.look) {
    case 'mildSteel':
    case 'ar500':
      return createHanger(spec, t, shotY);
    case 'glass':
      return createFrame(spec, t, shotY, aluminium, false);
    case 'pine':
    case 'oak':
    case 'drywall':
      return createFrame(spec, t, shotY, standSteel, true);
    case 'concrete':
    case 'sandbag':
      return bottom > 0.03 ? createRisers(spec, t, shotY, bottom) : createMat(spec, t, shotY);
    case 'cinderBlock':
      return createMat(spec, t, shotY);
    default:
      return bottom > 0.03 ? createCart(spec, t, shotY, bottom) : createMat(spec, t, shotY);
  }
}

function box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

/**
 * A small lab cart: a lipped aluminium tray on a square-tube frame with cross
 * rails and rubber feet, the target resting on the tray.
 */
function createCart(spec: MediumSpec, t: number, shotY: number, bottom: number): THREE.Group {
  const cart = new THREE.Group();
  cart.name = 'stand-cart';
  const floor = -shotY;
  const length = Math.max(t + 0.04, 0.14);
  const width = spec.widthM + 0.04;
  const trayY = -spec.heightM / 2 - 0.003;
  const cx = t / 2;
  cart.add(box(length, 0.006, width, aluminium, cx, trayY, 0));
  // A low lip round the tray edge.
  for (const sz of [-1, 1]) cart.add(box(length, 0.012, 0.004, aluminium, cx, trayY + 0.006, sz * (width / 2 - 0.002)));
  for (const sx of [-1, 1]) cart.add(box(0.004, 0.012, width, aluminium, cx + sx * (length / 2 - 0.002), trayY + 0.006, 0));

  const legH = bottom - 0.006 - 0.008;
  const legX = length / 2 - 0.012;
  const legZ = width / 2 - 0.012;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      cart.add(box(0.014, legH, 0.014, standSteel, cx + sx * legX, floor + 0.008 + legH / 2, sz * legZ));
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.012, 0.008, 16), rubber);
      foot.position.set(cx + sx * legX, floor + 0.004, sz * legZ);
      cart.add(foot);
    }
  }
  // Cross rails a third of the way up: along the shot line and across it.
  const railY = floor + 0.008 + legH * 0.3;
  for (const sz of [-1, 1]) cart.add(box(length - 0.024, 0.01, 0.01, standSteel, cx, railY, sz * legZ));
  for (const sx of [-1, 1]) cart.add(box(0.01, 0.01, width - 0.024, standSteel, cx + sx * legX, railY, 0));
  return cart;
}

/** Stacked timber blocks lifting a slab or sandbag up to the shot line. */
function createRisers(spec: MediumSpec, t: number, shotY: number, bottom: number): THREE.Group {
  const risers = new THREE.Group();
  risers.name = 'stand-risers';
  const floor = -shotY;
  const course = 0.045;
  const courses = Math.max(1, Math.round(bottom / course));
  const h = bottom / courses;
  const length = Math.max(t + 0.02, 0.1);
  const width = spec.widthM;
  for (let c = 0; c < courses; c++) {
    const y = floor + h * (c + 0.5);
    // Alternate courses cross each other, like a crib of timber.
    if (c % 2 === 0) {
      for (const sz of [-1, 0, 1]) risers.add(box(length, h * 0.98, 0.05, timber, t / 2, y, sz * (width / 2 - 0.03)));
    } else {
      for (const sx of [-1, 1]) risers.add(box(0.05, h * 0.98, width, timber, t / 2 + sx * (length / 2 - 0.03), y, 0));
    }
  }
  return risers;
}

/** A rubber mat for blocks that stand straight on the floor. */
function createMat(spec: MediumSpec, t: number, shotY: number): THREE.Group {
  const mat = new THREE.Group();
  mat.name = 'stand-mat';
  const gap = Math.max(0.002, shotY - spec.heightM / 2);
  mat.add(box(t + 0.12, gap, spec.widthM + 0.12, rubber, t / 2, -shotY + gap / 2, 0));
  return mat;
}

/**
 * Upright frame for thin panels: two posts on T-feet either side of the
 * panel, with clamps gripping its edges top and bottom.
 */
function createFrame(spec: MediumSpec, t: number, shotY: number, finish: THREE.Material, clamps: boolean): THREE.Group {
  const frame = new THREE.Group();
  frame.name = 'stand-frame';
  const floor = -shotY;
  const top = spec.heightM / 2;
  const postH = top - floor + 0.04;
  const post = 0.022;
  const postZ = spec.widthM / 2 + post / 2 + 0.002;
  for (const sz of [-1, 1]) {
    frame.add(box(post, postH, post, finish, t / 2, floor + postH / 2, sz * postZ));
    // T-foot along the shot line so the frame can't tip.
    frame.add(box(0.2, 0.012, 0.03, finish, t / 2, floor + 0.006, sz * postZ));
    frame.add(box(0.03, 0.03, 0.03, finish, t / 2, floor + 0.027, sz * postZ));
    for (const y of [top - 0.04, -spec.heightM / 2 + 0.04]) {
      // A channel bracket from the post round the panel edge.
      const grip = Math.max(t + 0.01, 0.014);
      frame.add(box(grip, 0.03, 0.03, clamps ? clampOrange : finish, t / 2, y, sz * (spec.widthM / 2 + 0.004)));
      if (clamps) frame.add(box(0.006, 0.006, 0.05, standSteel, t / 2 - grip / 2 - 0.003, y, sz * (spec.widthM / 2 + 0.01)));
    }
  }
  // A cap rail joining the posts above the panel.
  frame.add(box(post, post, postZ * 2 + post, finish, t / 2, floor + postH - post / 2, 0));
  return frame;
}

/** A steel target hanger: a gallows frame with two chains holding the plate. */
function createHanger(spec: MediumSpec, t: number, shotY: number): THREE.Group {
  const hanger = new THREE.Group();
  hanger.name = 'stand-hanger';
  const floor = -shotY;
  const plateTop = spec.heightM / 2;
  const beamY = plateTop + 0.12;
  const postZ = spec.widthM / 2 + 0.07;
  // Frame stands behind the plate so the chains hang straight down onto it.
  const fx = t + 0.05;
  for (const sz of [-1, 1]) {
    const h = beamY - floor;
    hanger.add(box(0.025, h, 0.025, standSteel, fx, floor + h / 2, sz * postZ));
    hanger.add(box(0.25, 0.015, 0.04, standSteel, fx, floor + 0.0075, sz * postZ));
  }
  hanger.add(box(0.03, 0.03, postZ * 2 + 0.05, standSteel, fx, beamY, 0));
  // Arms reaching forward from the beam to above the plate.
  for (const sz of [-1, 1]) {
    const armZ = sz * (spec.widthM / 2 - 0.03);
    const armLength = fx - t / 2;
    hanger.add(box(armLength + 0.015, 0.015, 0.015, standSteel, t / 2 + armLength / 2, beamY, armZ));
    hanger.add(createChain(new THREE.Vector3(t / 2, beamY - 0.008, armZ), plateTop + 0.004));
    // The bolt tab on the plate the chain hooks into.
    hanger.add(box(t + 0.004, 0.016, 0.02, chainSteel, t / 2, plateTop + 0.002, armZ));
  }
  return hanger;
}

/** A vertical chain of alternating oval links from `from` down to height `toY`. */
function createChain(from: THREE.Vector3, toY: number): THREE.Group {
  const chain = new THREE.Group();
  const pitch = 0.011;
  const link = new THREE.TorusGeometry(0.0055, 0.0016, 6, 14);
  link.scale(1, 1.5, 1);
  const count = Math.max(2, Math.floor((from.y - toY) / pitch));
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(link, chainSteel);
    mesh.rotation.y = i % 2 ? Math.PI / 2 : 0;
    mesh.position.set(from.x, from.y - pitch * (i + 0.5), from.z);
    chain.add(mesh);
  }
  return chain;
}
