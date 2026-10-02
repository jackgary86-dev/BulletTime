import * as THREE from 'three';

/**
 * Creates the WebGL renderer configured for a physically based, filmic look:
 * sRGB output, ACES tone mapping and soft shadows.
 */
export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}

/** Calls `onResize` with the new size whenever the window changes size. */
export function watchResize(onResize: (width: number, height: number) => void): void {
  const handler = () => onResize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', handler);
  handler();
}
