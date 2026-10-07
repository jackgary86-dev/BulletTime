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
  renderer.setSize(...viewSize(canvas), false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Impact marks are cut off at the edge of their plate with per-material clipping planes (#318).
  renderer.localClippingEnabled = true;
  return renderer;
}

/**
 * The canvas's size on screen. It fills the window except in the phone layout, where it
 * takes only the top of the screen (#138).
 */
export function viewSize(canvas: HTMLCanvasElement): [number, number] {
  return [canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight];
}

/** Calls `onResize` with the canvas's new size whenever the window or the canvas changes size. */
export function watchResize(canvas: HTMLCanvasElement, onResize: (width: number, height: number) => void): void {
  const handler = () => onResize(...viewSize(canvas));
  window.addEventListener('resize', handler);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(handler).observe(canvas);
  handler();
}
