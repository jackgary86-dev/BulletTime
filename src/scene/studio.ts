import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { TARGET_FOCUS } from './camera';

/** Background tone of the high-speed camera lab. */
const BACKGROUND = new THREE.Color(0x07080a);

/** "lab": dark, moody studio. "highspeed": the bright back-lit look of high-speed camera footage. */
export type LightingMode = 'lab' | 'highspeed';

export interface Studio {
  group: THREE.Group;
  /** The vertical measurement board behind the target. */
  labGrid: THREE.Mesh;
  setLightingMode(mode: LightingMode): void;
}

/** Bright, flat backdrop of the high-speed look. */
const HIGHSPEED_BACKGROUND = new THREE.Color(0xc9ccd0);

/**
 * Builds the high-speed camera lab: dark backdrop, key light with soft shadow,
 * two coloured rim lights, a dim environment for reflections, a floor that
 * catches shadows, and a measurement grid board behind the target.
 */
export function createStudio(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Studio {
  scene.background = BACKGROUND;
  scene.fog = new THREE.Fog(BACKGROUND, 3, 9);

  // Low-intensity image-based lighting so metals and gel have something to reflect.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.25;
  pmrem.dispose();

  const group = new THREE.Group();
  group.name = 'studio';
  scene.add(group);

  const lights = addLights(group);
  const floor = createFloor();
  group.add(floor);

  const labGrid = createLabGrid();
  group.add(labGrid);
  const gridMaterial = labGrid.material as THREE.MeshStandardMaterial;
  const darkGrid = gridMaterial.map;
  const brightGrid = gridTexture(true);
  const floorMaterial = floor.material as THREE.MeshStandardMaterial;

  const setLightingMode = (mode: LightingMode) => {
    const bright = mode === 'highspeed';
    const background = bright ? HIGHSPEED_BACKGROUND : BACKGROUND;
    scene.background = background;
    (scene.fog as THREE.Fog).color.copy(background);
    scene.environmentIntensity = bright ? 0.6 : 0.25;
    lights.fill.intensity = bright ? 0.6 : 0.2;
    lights.back.intensity = bright ? 1.5 : 0;
    // The board becomes a light panel behind the target, lighting gel from behind like a photo backdrop.
    gridMaterial.map = bright ? brightGrid : darkGrid;
    gridMaterial.emissiveMap = bright ? brightGrid : null;
    gridMaterial.emissive.set(bright ? 0xffffff : 0x000000);
    gridMaterial.emissiveIntensity = bright ? 0.55 : 0;
    gridMaterial.needsUpdate = true;
    floorMaterial.color.set(bright ? 0x8a8d92 : 0x0b0c0f);
  };

  return { group, labGrid, setLightingMode };
}

function addLights(group: THREE.Group): { fill: THREE.HemisphereLight; back: THREE.DirectionalLight } {
  // Key: a soft overhead spot that casts the floor shadow.
  const key = new THREE.SpotLight(0xfff4e6, 28, 6, Math.PI / 7, 0.6, 1.6);
  key.position.set(0.6, 2.2, 1.0);
  key.target.position.copy(TARGET_FOCUS);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 6;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 5;
  group.add(key, key.target);

  // Rim lights: cool from behind-left, warm from behind-right, to outline edges.
  const rimCool = new THREE.DirectionalLight(0x8fb8ff, 1.6);
  rimCool.position.set(-1.6, 0.9, -1.4);
  rimCool.target.position.copy(TARGET_FOCUS);
  group.add(rimCool, rimCool.target);

  const rimWarm = new THREE.DirectionalLight(0xffb070, 1.4);
  rimWarm.position.set(1.8, 0.6, -1.2);
  rimWarm.target.position.copy(TARGET_FOCUS);
  group.add(rimWarm, rimWarm.target);

  // Faint fill so shadowed faces never go fully black.
  const fill = new THREE.HemisphereLight(0x9aa6b8, 0x0a0a0c, 0.2);
  group.add(fill);

  // Back light for the high-speed look only: shines through the target toward the camera.
  const back = new THREE.DirectionalLight(0xffffff, 0);
  back.position.set(0, 0.6, -2);
  back.target.position.copy(TARGET_FOCUS);
  group.add(back, back.target);
  return { fill, back };
}

function createFloor(): THREE.Mesh {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(4, 64),
    new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.7, metalness: 0.0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'floor';
  return floor;
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
