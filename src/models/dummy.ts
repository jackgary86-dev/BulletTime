import * as THREE from 'three';
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

/** One cross-section of a lofted body part: height, front and back (x) and half-width (z). */
interface Section {
  y: number;
  front: number;
  back: number;
  half: number;
}

/**
 * A smooth body part lofted through cross-sections: rounded-box (superellipse)
 * slices, eased between the given sections, closed at both ends. `roundness`
 * 2 is an ellipse; higher is squarer.
 */
function loft(sections: Section[], roundness: number, slices = 64, around = 56): THREE.BufferGeometry {
  const at = (y: number): Section => {
    let i = 1;
    while (i < sections.length - 1 && sections[i].y < y) i++;
    const a = sections[i - 1];
    const b = sections[i];
    const k = THREE.MathUtils.clamp((y - a.y) / (b.y - a.y), 0, 1);
    const e = k * k * (3 - 2 * k);
    return { y, front: a.front + (b.front - a.front) * e, back: a.back + (b.back - a.back) * e, half: a.half + (b.half - a.half) * e };
  };
  const y0 = sections[0].y;
  const y1 = sections[sections.length - 1].y;
  const positions: number[] = [];
  const index: number[] = [];
  const p = 2 / roundness;
  for (let j = 0; j <= slices; j++) {
    const s = at(y0 + ((y1 - y0) * j) / slices);
    const cx = (s.front + s.back) / 2;
    const rx = (s.back - s.front) / 2;
    for (let i = 0; i < around; i++) {
      const a = (i / around) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      positions.push(cx + rx * Math.sign(c) * Math.abs(c) ** p, s.y, s.half * Math.sign(sn) * Math.abs(sn) ** p);
    }
  }
  for (let j = 0; j < slices; j++) {
    for (let i = 0; i < around; i++) {
      const a = j * around + i;
      const b = j * around + ((i + 1) % around);
      index.push(a, a + around, b, b, a + around, b + around);
    }
  }
  // Fans close the bottom and top.
  for (const [ring, up] of [
    [0, false],
    [slices, true],
  ] as const) {
    const s = at(ring === 0 ? y0 : y1);
    const centre = positions.length / 3;
    positions.push((s.front + s.back) / 2, s.y, 0);
    for (let i = 0; i < around; i++) {
      const a = ring * around + i;
      const b = ring * around + ((i + 1) % around);
      if (up) index.push(a, b, centre);
      else index.push(b, a, centre);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The gel body (#67), sculpted like a clinical test dummy: a tapered torso
 * with a waist and sloping shoulders, a neck, and a head with a jaw and chin,
 * a nose bridge and ears. The front surface stays on x = 0 across the chest
 * and abdomen, and the head's on x = 0.01, where the regions' layers start.
 */
function buildShell(body: THREE.Group): void {
  const torso = new THREE.Mesh(
    loft(
      [
        { y: 0.19, front: 0.06, back: 0.18, half: 0.07 },
        { y: 0.205, front: 0.012, back: 0.228, half: 0.135 },
        { y: 0.235, front: 0, back: 0.24, half: 0.152 },
        { y: 0.3, front: 0, back: 0.24, half: 0.15 },
        { y: 0.39, front: 0, back: 0.238, half: 0.138 },
        { y: 0.49, front: 0, back: 0.24, half: 0.16 },
        { y: 0.555, front: 0.006, back: 0.236, half: 0.176 },
        { y: 0.6, front: 0.03, back: 0.222, half: 0.182 },
        { y: 0.625, front: 0.058, back: 0.195, half: 0.14 },
        { y: 0.64, front: 0.08, back: 0.165, half: 0.07 },
        { y: 0.646, front: 0.095, back: 0.145, half: 0.03 },
      ],
      2.8,
    ),
    gelMaterial(0.3),
  );
  const neck = new THREE.Mesh(
    loft(
      [
        { y: 0.6, front: 0.07, back: 0.165, half: 0.05 },
        { y: 0.64, front: 0.075, back: 0.158, half: 0.044 },
        { y: 0.7, front: 0.07, back: 0.16, half: 0.046 },
      ],
      2.2,
      12,
      40,
    ),
    gelMaterial(0.09),
  );
  const head = new THREE.Mesh(
    loft(
      [
        { y: 0.638, front: 0.035, back: 0.085, half: 0.02 },
        { y: 0.652, front: 0.018, back: 0.115, half: 0.05 },
        { y: 0.685, front: 0.012, back: 0.15, half: 0.066 },
        { y: 0.72, front: 0.006, back: 0.183, half: 0.077 },
        { y: 0.75, front: 0.01, back: 0.19, half: 0.08 },
        { y: 0.79, front: 0.014, back: 0.19, half: 0.079 },
        { y: 0.83, front: 0.034, back: 0.176, half: 0.068 },
        { y: 0.855, front: 0.068, back: 0.142, half: 0.044 },
        { y: 0.866, front: 0.098, back: 0.116, half: 0.01 },
      ],
      2.2,
    ),
    gelMaterial(0.16),
  );
  // Nose bridge: a narrow ridge running down from the brow, below the head's shot line.
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), gelMaterial(0.02));
  nose.scale.set(0.012, 0.03, 0.011);
  nose.rotation.z = -0.25;
  nose.position.set(0.008, 0.705, 0);
  body.add(torso, neck, head, nose);
  // Ears: flat, rounded flaps on either side, level with the nose.
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), gelMaterial(0.02));
    ear.scale.set(0.016, 0.03, 0.008);
    ear.rotation.z = 0.2;
    ear.position.set(0.112, 0.73, side * 0.079);
    body.add(ear);
  }
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

/**
 * A mannequin stand: a heavy round base on a rubber ring, a pole with a
 * height collar and clamp knob, and a saddle bracket cradling the pelvis.
 */
function buildStand(body: THREE.Group): void {
  const x = 0.12;
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9 });
  const saddleSteel = new THREE.MeshStandardMaterial({ color: 0x2f343b, roughness: 0.42, metalness: 0.75, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.006, 10, 64), rubber);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, 0.006, 0);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.128, 0.134, 0.016, 64), standSteel);
  base.position.set(x, 0.012, 0);
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.02, 32), standSteel);
  boss.position.set(x, 0.03, 0);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.15, 24), standSteel);
  pole.position.set(x, 0.115, 0);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.022, 24), standSteel);
  collar.position.set(x, 0.15, 0);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.03, 12), standSteel);
  knob.rotation.z = Math.PI / 2;
  knob.position.set(x - 0.03, 0.15, 0);
  const grip = new THREE.Mesh(new THREE.SphereGeometry(0.009, 16, 12), rubber);
  grip.position.set(x - 0.046, 0.15, 0);
  // Saddle: a curved plate the pelvis sits in.
  const saddle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.11, 32, 1, true, Math.PI * 1.25, Math.PI * 0.5), saddleSteel);
  saddle.rotation.z = Math.PI / 2;
  saddle.position.set(x, 0.27, 0);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 16), standSteel);
  post.position.set(x, 0.196, 0);
  body.add(ring, base, boss, pole, collar, knob, grip, saddle, post);
}
