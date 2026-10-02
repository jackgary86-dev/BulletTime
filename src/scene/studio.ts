import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { TARGET_FOCUS } from './camera';

/** Background tone of the high-speed camera lab. */
const BACKGROUND = new THREE.Color(0x07080a);

export interface Studio {
  group: THREE.Group;
  /** The vertical measurement board behind the target. */
  labGrid: THREE.Mesh;
}

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

  addLights(group);
  group.add(createFloor());

  const labGrid = createLabGrid();
  group.add(labGrid);

  return { group, labGrid };
}

function addLights(group: THREE.Group): void {
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
  group.add(new THREE.HemisphereLight(0x9aa6b8, 0x0a0a0c, 0.2));
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
function createLabGrid(): THREE.Mesh {
  const widthM = 1.2;
  const heightM = 0.5;
  const pxPerCm = 16;
  const canvas = document.createElement('canvas');
  canvas.width = widthM * 100 * pxPerCm;
  canvas.height = heightM * 100 * pxPerCm;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for the lab grid texture');

  ctx.fillStyle = '#1b1e23';
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
  drawLines(1, 'rgba(160, 175, 195, 0.10)', 1);
  drawLines(5, 'rgba(160, 175, 195, 0.22)', 1.5);
  drawLines(10, 'rgba(200, 210, 225, 0.40)', 2.5);

  // Centimetre labels, with 0 at the target's front face (x = -0.2 m in world space).
  ctx.fillStyle = 'rgba(210, 220, 235, 0.65)';
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

  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(widthM, heightM),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, metalness: 0 }),
  );
  board.position.set(0, heightM / 2, -0.35);
  board.receiveShadow = true;
  board.name = 'lab-grid';
  return board;
}
