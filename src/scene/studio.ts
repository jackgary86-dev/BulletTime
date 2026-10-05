import * as THREE from 'three';
import { TARGET_FOCUS } from './camera';
import { createLabEnvironment } from './labEnvironment';
import { createLabSet } from './labSet';
import { createRangeStudio } from './rangeSet';
import type { SiteId } from '../data/sites';
import { createSoftbox, type Softbox, type SoftboxSpec } from './softbox';

/** Background tone of the high-speed camera lab. */
const BACKGROUND = new THREE.Color(0x07080a);

/** "lab": dark, moody studio. "highspeed": the bright back-lit look of high-speed camera footage. */
export type LightingMode = 'lab' | 'highspeed';

export interface Studio {
  group: THREE.Group;
  /** The vertical measurement board behind the target. */
  labGrid: THREE.Mesh;
  /** Soft baked shadow under the target, for quality levels without shadows or occlusion (#55). */
  contactShadow: THREE.Mesh;
  /** Sizes the contact shadow to the target's footprint. */
  fitContactShadow(target: THREE.Object3D): void;
  setLightingMode(mode: LightingMode): void;
  /** Key light shadow resolution in texels (the quality setting, #16). */
  setShadowMapSize(size: number): void;
}

/** Bright, flat backdrop of the high-speed look. */
const HIGHSPEED_BACKGROUND = new THREE.Color(0xc9ccd0);

/**
 * Builds the high-speed camera lab: the lab room (#53), three softboxes (a
 * key above the camera and two coloured rim strips, #54) with a shadow-casting
 * spot inside the key, reflections baked from the room itself, and a
 * measurement grid board behind the target.
 */
export function createStudio(scene: THREE.Scene, renderer: THREE.WebGLRenderer, site: SiteId = 'lab'): Studio {
  // Shells, missiles and charges go outdoors to the proving ground (#231).
  if (site === 'range') return createRangeStudio(scene, renderer);
  scene.background = BACKGROUND;
  // Far enough that the lab walls read, close enough that the room falls into shadow.
  scene.fog = new THREE.Fog(BACKGROUND, 4, 14);

  // Metals, glass and gel reflect the lab and its softboxes.
  scene.environment = createLabEnvironment(renderer, SOFTBOXES);
  scene.environmentIntensity = LAB_ENVIRONMENT;

  const group = new THREE.Group();
  group.name = 'studio';
  scene.add(group);

  const lights = addLights(group);
  const lab = createLabSet();
  group.add(lab.group);

  const labGrid = createLabGrid();
  group.add(labGrid);
  const gridMaterial = labGrid.material as THREE.MeshStandardMaterial;
  const darkGrid = gridMaterial.map;
  const brightGrid = gridTexture(true);
  const floorMaterial = lab.floor.material;

  const setLightingMode = (mode: LightingMode) => {
    const bright = mode === 'highspeed';
    const background = bright ? HIGHSPEED_BACKGROUND : BACKGROUND;
    scene.background = background;
    (scene.fog as THREE.Fog).color.copy(background);
    scene.environmentIntensity = bright ? 0.7 : LAB_ENVIRONMENT;
    lights.fill.intensity = bright ? 0.6 : 0.2;
    // Against the bright backdrop the coloured rims would only muddy it.
    for (const box of lights.softboxes) box.setLevel(bright && box.spec.name !== 'key' ? 0.25 : 1);
    lights.back.intensity = bright ? 1.5 : 0;
    // The board becomes a light panel behind the target, lighting gel from behind like a photo backdrop.
    gridMaterial.map = bright ? brightGrid : darkGrid;
    gridMaterial.emissiveMap = bright ? brightGrid : null;
    gridMaterial.emissive.set(bright ? 0xffffff : 0x000000);
    gridMaterial.emissiveIntensity = bright ? 0.55 : 0;
    gridMaterial.needsUpdate = true;
    // The high-speed look is a bright seamless backdrop: the room goes, the floor brightens.
    lab.room.visible = !bright;
    floorMaterial.color.set(bright ? 0xe2e4e8 : 0x6a6a6a);
  };

  const setShadowMapSize = (size: number) => {
    const shadow = lights.key.shadow;
    if (shadow.mapSize.x === size) return;
    shadow.mapSize.set(size, size);
    // The map is reallocated at the new size on the next shadow render.
    shadow.map?.dispose();
    shadow.map = null;
  };

  const contactShadow = createContactShadow();
  group.add(contactShadow);
  const box = new THREE.Box3();
  const fitContactShadow = (target: THREE.Object3D) => {
    box.setFromObject(target);
    if (box.isEmpty()) return;
    // A little larger than the footprint, since the shadow fades out toward its edges.
    contactShadow.scale.set(box.max.x - box.min.x + 0.2, box.max.z - box.min.z + 0.2, 1);
    contactShadow.position.set((box.min.x + box.max.x) / 2, 0.002, (box.min.z + box.max.z) / 2);
  };

  return { group, labGrid, contactShadow, fitContactShadow, setLightingMode, setShadowMapSize };
}

/** How strongly the baked room lights the scene in the dark lab look. */
const LAB_ENVIRONMENT = 0.35;

/** The key softbox hangs above and in front of the target; the rims stand either side, behind it. */
const SOFTBOXES: SoftboxSpec[] = [
  {
    name: 'key',
    position: new THREE.Vector3(0.45, 1.5, 1.25),
    target: TARGET_FOCUS,
    width: 0.9,
    height: 0.6,
    color: 0xfff1e0,
    intensity: 7,
    reflection: 5,
  },
  {
    name: 'rim-cool',
    position: new THREE.Vector3(-1.5, 0.65, -0.55),
    target: TARGET_FOCUS,
    width: 0.25,
    height: 1.1,
    color: 0xc8d6ee,
    intensity: 9,
    reflection: 4,
  },
  {
    name: 'rim-warm',
    position: new THREE.Vector3(1.6, 0.6, -0.45),
    target: TARGET_FOCUS,
    width: 0.25,
    height: 1.1,
    color: 0xffbf85,
    intensity: 8,
    reflection: 4,
  },
];

interface StudioLights {
  key: THREE.SpotLight;
  softboxes: Softbox[];
  fill: THREE.HemisphereLight;
  back: THREE.DirectionalLight;
}

function addLights(group: THREE.Group): StudioLights {
  const softboxes = SOFTBOXES.map(createSoftbox);
  for (const box of softboxes) group.add(box.group);

  // Area lights cast no shadows, so a spot inside the key softbox casts the floor shadow.
  const keySpec = SOFTBOXES[0];
  const key = new THREE.SpotLight(0xfff1e0, 16, 6, Math.PI / 6, 0.8, 1.6);
  key.position.copy(keySpec.position);
  key.target.position.copy(keySpec.target);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 6;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 5;
  group.add(key, key.target);

  // Faint fill so shadowed faces never go fully black.
  const fill = new THREE.HemisphereLight(0x9aa6b8, 0x0a0a0c, 0.2);
  group.add(fill);

  // Back light for the high-speed look only: shines through the target toward the camera.
  const back = new THREE.DirectionalLight(0xffffff, 0);
  back.position.set(0, 0.6, -2);
  back.target.position.copy(TARGET_FOCUS);
  group.add(back, back.target);
  return { key, softboxes, fill, back };
}

/** A unit square on the floor with a soft dark falloff, scaled to fit the target. */
function createContactShadow(): THREE.Mesh {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for the contact shadow');
  ctx.filter = 'blur(14px)';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
  ctx.fillRect(size * 0.22, size * 0.22, size * 0.56, size * 0.56);
  const texture = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.name = 'contact-shadow';
  mesh.visible = false;
  return mesh;
}

/**
 * A matte board with a 1 cm / 5 cm / 10 cm grid and centimetre labels along the
 * bottom edge, standing behind the target so penetration depth is readable.
 */
const GRID_WIDTH_M = 1.2;
const GRID_HEIGHT_M = 0.5;

function createLabGrid(): THREE.Mesh {
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID_WIDTH_M, GRID_HEIGHT_M),
    new THREE.MeshStandardMaterial({ map: gridTexture(false), roughness: 0.95, metalness: 0 }),
  );
  board.position.set(0, GRID_HEIGHT_M / 2, -0.35);
  board.receiveShadow = true;
  board.name = 'lab-grid';
  return board;
}

/** The grid as a canvas texture: light lines on a dark board, or dark lines on a lit panel. */
function gridTexture(bright: boolean): THREE.Texture {
  const widthM = GRID_WIDTH_M;
  const heightM = GRID_HEIGHT_M;
  const pxPerCm = 16;
  const canvas = document.createElement('canvas');
  canvas.width = widthM * 100 * pxPerCm;
  canvas.height = heightM * 100 * pxPerCm;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for the lab grid texture');

  ctx.fillStyle = bright ? '#eef0f2' : '#1b1e23';
  const ink = bright ? '40, 46, 56' : '160, 175, 195';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const drawLines = (stepCm: number, style: string, lineWidth: number) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    for (let x = 0; x <= canvas.width; x += stepCm * pxPerCm) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, canvas.height);
    }
    for (let y = canvas.height; y >= 0; y -= stepCm * pxPerCm) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(canvas.width, y + 0.5);
    }
    ctx.stroke();
  };
  drawLines(1, `rgba(${ink}, ${bright ? 0.18 : 0.1})`, 1);
  drawLines(5, `rgba(${ink}, ${bright ? 0.35 : 0.22})`, 1.5);
  drawLines(10, bright ? `rgba(${ink}, 0.6)` : 'rgba(200, 210, 225, 0.40)', 2.5);

  // Centimetre labels, with 0 at the target's front face (x = -0.2 m in world space).
  ctx.fillStyle = bright ? 'rgba(30, 34, 40, 0.8)' : 'rgba(210, 220, 235, 0.65)';
  ctx.font = `${pxPerCm * 1.6}px ui-monospace, Menlo, monospace`;
  ctx.textBaseline = 'bottom';
  const zeroCm = (widthM / 2 - 0.2) * 100;
  for (let cm = 0; cm <= widthM * 100; cm += 10) {
    const label = `${Math.round(cm - zeroCm)}`;
    ctx.fillText(label, cm * pxPerCm + 4, canvas.height - 4);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
