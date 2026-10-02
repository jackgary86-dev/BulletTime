import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DUMMY_REGIONS, getRegion, regionLayers, type DummyRegion, type DummyRegionId } from '../data/dummy';
import { stackOffsets } from '../data/stacks';
import { addOrganicInserts, BONE_COLOR, GEL_BODY_NAME, layerGroupName, standSteel, TARGET_FRONT_X } from './targets';

/**
 * The clinical ballistic test dummy (#25): a translucent lab-gel head, neck
 * and torso on a stand, with synthetic bone and organ simulants inside. It is
 * a test instrument, not a person: no face, no skin tone, just simple shapes.
 *
 * The skull and organs are drawn as a cutaway (only the half away from the
 * side camera), so the wound channel and temporary cavity along the shot line
 * stay visible. The region being shot also gets one invisible proxy block per
 * gel layer, which the cavity and blood-pack effects deform and read.
 *
 * The group sits like any target: front face of the region at its origin, on
 * the region's shot line.
 */
export function createDummy(regionId: DummyRegionId): THREE.Group {
  const region = getRegion(regionId);
  const group = new THREE.Group();
  group.name = `target:dummy-${region.id}`;
  group.position.set(TARGET_FRONT_X, region.shotY, 0);

  // Everything anatomical is built in the dummy's own frame (x depth from the chest front, y up from the floor).
  const body = new THREE.Group();
  body.name = 'dummy-body';
  body.position.set(-region.frontX, -region.shotY, 0);
  group.add(body);
  buildShell(body);
  buildSkeleton(body);
  buildOrgans(body);
  buildStand(body);

  // The packs of the other regions are scenery; the shot region's packs belong to its proxy blocks.
  for (const other of DUMMY_REGIONS) {
    if (other.id === region.id) continue;
    const offsets = stackOffsets(regionLayers(other));
    other.layers.forEach((l, i) => {
      if (!l.organic) return;
      const holder = new THREE.Group();
      holder.position.set(other.frontX + offsets[i] + l.thickness / 2, other.shotY, 0);
      addOrganicInserts(holder, l.organic, l.thickness);
      body.add(holder);
    });
  }
  addProxies(group, region);

  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh && !obj.userData.proxy) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return group;
}

/** One layer group per stack layer; gel layers get an invisible block the gel effects can use. */
function addProxies(group: THREE.Group, region: DummyRegion): void {
  const layers = regionLayers(region);
  const offsets = stackOffsets(layers);
  const hidden = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  layers.forEach((l, i) => {
    const layer = new THREE.Group();
    layer.name = layerGroupName(i);
    layer.position.x = offsets[i];
    if (l.medium.behaviour === 'gel') {
      const { h, w } = region.section;
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(l.thickness, h, w, Math.max(1, Math.ceil(l.thickness / 0.005)), 12, 12), hidden);
      proxy.name = GEL_BODY_NAME;
      proxy.position.x = l.thickness / 2;
      proxy.userData.proxy = true;
      const organic = region.layers[i].organic;
      if (organic) addOrganicInserts(proxy, organic, l.thickness);
      layer.add(proxy);
    }
    group.add(layer);
  });
}

function gelMaterial(thickness: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xd9cdb6,
    roughness: 0.12,
    transmission: 0.95,
    // Barely any refraction: a thick, curved shell at gel's real index turns the organs into a kaleidoscope.
    thickness: thickness * 0.15,
    ior: 1.04,
    attenuationColor: new THREE.Color(0xe8b878),
    attenuationDistance: 0.6,
    specularIntensity: 0.35,
    clearcoat: 0.25,
    clearcoatRoughness: 0.15,
  });
}

/** The gel body: head, neck and torso, plain rounded shapes. */
function buildShell(body: THREE.Group): void {
  const torso = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.4, 0.34, 5, 0.05), gelMaterial(0.3));
  torso.position.set(0.12, 0.4, 0);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 32), gelMaterial(0.09));
  neck.position.set(0.11, 0.63, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), gelMaterial(0.16));
  head.scale.set(0.09, 0.115, 0.08);
  head.position.set(0.1, 0.75, 0);
  body.add(torso, neck, head);
}

/**
 * Half an ellipsoid on the far side of the shot line (z ≤ 0), with a flat
 * cross-section face just behind the line, like a cutaway anatomy model.
 */
function cutaway(
  radii: [number, number, number],
  centre: [number, number, number],
  color: THREE.ColorRepresentation,
  faceColor: THREE.ColorRepresentation,
): THREE.Group {
  const part = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 40, 24, Math.PI, Math.PI),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, side: THREE.DoubleSide }),
  );
  shell.scale.set(...radii);
  const face = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ color: faceColor, roughness: 0.7 }));
  // Just behind the shot line, so the wound channel drawn on the line doesn't fight with it.
  face.scale.set(radii[0], radii[1], 1);
  face.position.z = -0.004;
  part.add(shell, face);
  part.position.set(...centre);
  return part;
}

function buildSkeleton(body: THREE.Group): void {
  const bone = new THREE.MeshStandardMaterial({ color: BONE_COLOR, roughness: 0.55 });

  // Skull: a cutaway shell around the brain.
  const skull = cutaway([0.087, 0.11, 0.076], [0.1, 0.752, 0], BONE_COLOR, 0xc9bb9c);
  skull.children[1].visible = false; // the brain supplies the section face
  body.add(skull);

  // Sternum in front, ribs curving back to the spine (far half only).
  const sternum = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.16, 0.035), bone);
  sternum.position.set(0.02, 0.49, 0);
  body.add(sternum);
  for (let i = 0; i < 6; i++) {
    const rib = new THREE.TorusGeometry(1, 0.06, 8, 40, Math.PI);
    rib.rotateX(-Math.PI / 2);
    rib.scale(0.1, 0.1, 0.15);
    const mesh = new THREE.Mesh(rib, bone);
    mesh.position.set(0.12, 0.42 + i * 0.03, 0);
    body.add(mesh);
  }

  // Spine: vertebrae up the back, from the pelvis through the neck.
  for (let y = 0.225; y < 0.69; y += 0.028) {
    const neck = y > 0.6;
    const r = neck ? 0.012 : 0.017;
    const v = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, 0.022, 20), bone);
    v.position.set(neck ? 0.13 : 0.2, y, 0);
    body.add(v);
  }
}

function buildOrgans(body: THREE.Group): void {
  // Brain simulant inside the skull, lung simulant across the chest, organ simulant in the abdomen.
  body.add(cutaway([0.077, 0.1, 0.068], [0.1, 0.752, 0], 0xa8605e, 0xb87470));
  body.add(cutaway([0.05, 0.095, 0.14], [0.075, 0.5, 0], 0xb8604c, 0xc4735e));
  body.add(cutaway([0.065, 0.075, 0.15], [0.095, 0.3, 0], 0x8f4218, 0xa0522a));
}

/** A lab stand: base plate and a pole up into the pelvis. */
function buildStand(body: THREE.Group): void {
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.012, 0.26), standSteel);
  base.position.set(0.12, 0.006, 0);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.21, 20), standSteel);
  pole.position.set(0.12, 0.105, 0);
  body.add(base, pole);
}
