/**
 * Mounts the minimal heads-up overlay: the app title and a hint about camera
 * controls. The controls panel, scrubber and results panel are added later.
 */
export function mountOverlay(root: HTMLElement): void {
  root.innerHTML = `
    <header class="brand">
      <h1>BulletTime</h1>
      <p>Slow-motion bullet impact simulator</p>
    </header>
    <p class="hint">Drag to orbit · scroll to zoom · right-drag to pan</p>
  `;
}
