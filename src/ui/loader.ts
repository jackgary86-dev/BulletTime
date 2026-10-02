/**
 * Drives the loading screen in index.html (#77): a progress bar and status
 * line while the lab is built and its shaders compile, then a fade into the
 * scene. The screen itself is static markup, so it shows before any script runs.
 */
export interface Loader {
  /** Moves the bar to `fraction` (0–1) and says what is happening. */
  progress(fraction: number, status: string): Promise<void>;
  /** Fades the screen out and removes it. */
  finish(): void;
  /** Leaves the screen up with an error message. */
  fail(message: string): void;
}

/** Fade-out length; matches the transition in index.html. */
const FADE_MS = 700;

export function attachLoader(): Loader {
  const root = document.querySelector<HTMLElement>('#loader');
  const bar = root?.querySelector<HTMLElement>('.loader-bar span');
  const status = root?.querySelector<HTMLElement>('.loader-status');
  return {
    async progress(fraction, text) {
      if (bar) bar.style.width = `${Math.round(Math.max(0.04, Math.min(1, fraction)) * 100)}%`;
      if (status) status.textContent = text;
      // Two frames: one to apply the change, one for the browser to paint it before the next heavy step.
      await nextFrame();
      await nextFrame();
    },
    finish() {
      if (!root) return;
      root.classList.add('done');
      window.setTimeout(() => root.remove(), FADE_MS);
    },
    fail(message) {
      if (!root) return;
      root.classList.add('failed');
      if (status) status.textContent = message;
    },
  };
}

/** The next animation frame, or a short timeout in a background tab, where frames don't run. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
    window.setTimeout(resolve, 100);
  });
}
