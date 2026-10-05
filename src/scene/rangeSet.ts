import * as THREE from 'three';
import { canvas, normalMapFromHeight, toTexture } from '../models/textures';
import { seededRandom } from '../sim/random';
import type { LightingMode, Studio } from './studio';

/**
 * The outdoor proving ground (#231) where shells, missiles and charges are
 * tested: a gravel range with a concrete pad under the target, an earth berm
 * behind it, a tree line on the horizon and an open sky, lit by the sun. It
 * fills the same `Studio` slot as the indoor lab, so the lane treats both alike.
 */

const SKY_TOP = new THREE.Color(0x5d86b8);
const SKY_HORIZON = new THREE.Color(0xc9d6e2);
const GROUND_FAR = new THREE.Color(0x6d6658);
/** The overcast look of the bright lighting mode: a flat, pale sky. */
const OVERCAST = new THREE.Color(0xd4d8dc);

/** Height of the survey pole beside the target, m. */
const POLE_HEIGHT_M = 4;

export function createRangeStudio(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Studio {
  const sky = skyTexture();
  scene.background = sky;
  scene.fog = new THREE.Fog(SKY_HORIZON, 40, 220);
  scene.environment = createSkyEnvironment(renderer);
  scene.environmentIntensity = 0.8;

  const group = new THREE.Group();
  group.name = 'studio';
  scene.add(group);

  // Low afternoon sun from behind the camera's shoulder, so faces read and shadows fall back and away.
  const sun = new THREE.DirectionalLight(0xfff0dc, 3.2);
  sun.position.set(14, 22, 18);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -9;
  cam.right = cam.top = 9;
  cam.near = 5;
  cam.far = 70;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  group.add(sun, sun.target);

  const fill = new THREE.HemisphereLight(0xbcd3ee, 0x5a5040, 0.9);
  group.add(fill);

  group.add(createGround(), createPad(), createBerm(), createTreeLine());

  const labGrid = createHeightPole();
  group.add(labGrid);

  const contactShadow = createContactShadow();
  group.add(contactShadow);
  const box = new THREE.Box3();
  const fitContactShadow = (target: THREE.Object3D) => {
    box.setFromObject(target);
    if (box.isEmpty()) return;
    contactShadow.scale.set(box.max.x - box.min.x + 0.6, box.max.z - box.min.z + 0.6, 1);
    contactShadow.position.set((box.min.x + box.max.x) / 2, 0.012, (box.min.z + box.max.z) / 2);
  };

  const setLightingMode = (mode: LightingMode) => {
    const bright = mode === 'highspeed';
    // The bright look is an overcast day: soft, even light and a pale sky, so high-speed detail reads.
    scene.background = bright ? OVERCAST : sky;
    (scene.fog as THREE.Fog).color.copy(bright ? OVERCAST : SKY_HORIZON);
    sun.intensity = bright ? 1.4 : 3.2;
    fill.intensity = bright ? 2.2 : 0.9;
    scene.environmentIntensity = bright ? 1.2 : 0.8;
  };

  const setShadowMapSize = (size: number) => {
    if (sun.shadow.mapSize.x === size) return;
    sun.shadow.mapSize.set(size, size);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  };

  return { group, labGrid, contactShadow, fitContactShadow, setLightingMode, setShadowMapSize };
}

/** A vertical gradient as an equirectangular sky: blue overhead, hazy at the horizon, earth below. */
function skyTexture(): THREE.Texture {
  const [c, ctx] = canvas(4, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, `#${SKY_TOP.getHexString()}`);
  g.addColorStop(0.47, `#${SKY_HORIZON.getHexString()}`);
  g.addColorStop(0.5, `#${SKY_HORIZON.getHexString()}`);
  g.addColorStop(0.53, `#${GROUND_FAR.getHexString()}`);
  g.addColorStop(1, '#3d382f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

/** The sky and ground baked into a prefiltered map, so steel and glass reflect the open range. */
function createSkyEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide }),
  );
  scene.add(dome);
  // The sun as a bright disc, so polished faces catch a highlight.
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(3, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0dc).multiplyScalar(12) }));
  sunDisc.position.set(14, 22, 18).setLength(45);
  sunDisc.lookAt(0, 0, 0);
  scene.add(sunDisc);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.03, 0.1, 100);
  const texture = target.texture;
  texture.addEventListener('dispose', () => target.dispose());
  pmrem.dispose();
  dome.geometry.dispose();
  (dome.material as THREE.MeshBasicMaterial).map?.dispose();
  (dome.material as THREE.Material).dispose();
  sunDisc.geometry.dispose();
  (sunDisc.material as THREE.Material).dispose();
  return texture;
}

/** Packed gravel: speckled stones over dusty earth, tiled across the range. */
function gravelMaps(): { map: THREE.Texture; normalMap: THREE.Texture } {
  const size = 256;
  const [c, ctx] = canvas(size, size);
  const [h, hctx] = canvas(size, size);
  ctx.fillStyle = '#857b6a';
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#404040';
  hctx.fillRect(0, 0, size, size);
  const rand = seededRandom(2310);
  for (let i = 0; i < 2600; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 0.8 + rand() * 2.6;
    const tone = 90 + Math.floor(rand() * 90);
    ctx.fillStyle = `rgb(${tone + 10}, ${tone + 4}, ${tone - 8})`;
    hctx.fillStyle = `rgb(${120 + tone / 2}, ${120 + tone / 2}, ${120 + tone / 2})`;
    for (const [dx, dy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      ctx.beginPath();
      ctx.ellipse(x + dx, y + dy, r, r * (0.6 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
      hctx.beginPath();
      hctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
      hctx.fill();
    }
  }
  return { map: toTexture(c), normalMap: toTexture(normalMapFromHeight(h, 2.5), false) };
}

function createGround(): THREE.Mesh {
  const { map, normalMap } = gravelMaps();
  const repeat = 120;
  map.repeat.set(repeat, repeat);
  normalMap.repeat.set(repeat, repeat);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.97, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'range-ground';
  return ground;
}

/** A cast concrete pad under the target stand and the firing line. */
function createPad(): THREE.Mesh {
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(16, 0.08, 9),
    new THREE.MeshStandardMaterial({ color: 0x8c8981, roughness: 0.9, metalness: 0 }),
  );
  // Its top sits just above the gravel, so things resting on the ground stand on it.
  pad.position.set(-3, -0.035, 0);
  pad.receiveShadow = true;
  pad.name = 'range-pad';
  return pad;
}

/** The earth berm behind the target that stops whatever gets through. */
function createBerm(): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-9, 0);
  shape.quadraticCurveTo(-4, 5.5, 0, 5.5);
  shape.quadraticCurveTo(4, 5.5, 9, 0);
  shape.lineTo(-9, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 44, bevelEnabled: false, curveSegments: 12 });
  geometry.translate(0, 0, -22);
  const berm = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x6e624d, roughness: 1, metalness: 0 }));
  // Its cross-section lies along the shot line; it runs across the range, well behind the target.
  berm.position.set(30, 0, 0);
  berm.castShadow = berm.receiveShadow = true;
  berm.name = 'range-berm';
  return berm;
}

/** A dark band of trees on the far side, as instanced cones. */
function createTreeLine(): THREE.InstancedMesh {
  const count = 90;
  const trees = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2.2, 9, 7),
    new THREE.MeshStandardMaterial({ color: 0x2f3d2a, roughness: 1, metalness: 0 }),
    count,
  );
  const rand = seededRandom(231);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const k = 0.7 + rand() * 0.8;
    // A band across the far side of the range, behind the target as the camera sees it.
    p.set(-130 + (i / count) * 260 + rand() * 2, 4.5 * k, -(70 + rand() * 30));
    s.set(k, k, k);
    m.compose(p, q, s);
    trees.setMatrixAt(i, m);
  }
  trees.name = 'range-trees';
  return trees;
}

/** A red and white survey pole beside the target, in half-metre bands, for scale. */
function createHeightPole(): THREE.Mesh {
  const [c, ctx] = canvas(8, 64);
  const bands = POLE_HEIGHT_M * 2;
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = i % 2 ? '#f2f0ea' : '#c0392b';
    ctx.fillRect(0, (i * 64) / bands, 8, 64 / bands);
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, POLE_HEIGHT_M, 10),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6, metalness: 0 }),
  );
  pole.position.set(3.5, POLE_HEIGHT_M / 2, -6);
  pole.castShadow = pole.receiveShadow = true;
  pole.name = 'lab-grid';
  return pole;
}

function createContactShadow(): THREE.Mesh {
  const size = 128;
  const [c, ctx] = canvas(size, size);
  ctx.filter = 'blur(14px)';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fillRect(size * 0.22, size * 0.22, size * 0.56, size * 0.56);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.name = 'contact-shadow';
  mesh.visible = false;
  return mesh;
}
