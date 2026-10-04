/**
 * Quality levels (#16). Medium is tuned to hold 60 fps on a mid-range laptop
 * through the heaviest shots; low is for tablets and integrated graphics;
 * high is for a strong GPU and screenshots. Ultra (#38) is the desktop app's
 * default, also reachable on the web with `?ultra`: finer physics, more
 * particles and full-resolution rendering.
 */
export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  /** Highest device pixel ratio the canvas renders at. */
  pixelRatio: number;
  /** Multiplies every particle burst's count. */
  particleDensity: number;
  /** Fraction of each particle look's instance capacity that may be used. */
  particleCap: number;
  bloom: boolean;
  /** Screen-space ambient occlusion (#55); without it a soft baked shadow sits under the target. */
  ambientOcclusion: boolean;
  depthOfField: boolean;
  /** Key light shadow map size in texels, or 0 for no shadows. */
  shadowMapSize: number;
  /** Resolution of the render behind transmissive gel, water and glass, as a fraction of the canvas. */
  transmissionScale: number;
  /** Integrate shots at the Ultra resolution (0.25 µs steps) instead of 1 µs. */
  fineSimulation: boolean;
  /** Layers of a missile's exhaust plume (#247): 1 is the core and flame, 2 adds the outer plume, 3 the halo. */
  plumeLayers: 1 | 2 | 3;
  /** Whether a missile's motor lights the ground and smoke (#247). */
  motorLight: boolean;
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  low: { pixelRatio: 1, particleDensity: 0.35, particleCap: 0.35, bloom: false, ambientOcclusion: false, depthOfField: false, shadowMapSize: 0, transmissionScale: 0.5, fineSimulation: false, plumeLayers: 1, motorLight: false },
  medium: { pixelRatio: 1.5, particleDensity: 0.7, particleCap: 0.7, bloom: true, ambientOcclusion: true, depthOfField: false, shadowMapSize: 1024, transmissionScale: 0.75, fineSimulation: false, plumeLayers: 2, motorLight: true },
  high: { pixelRatio: 2, particleDensity: 1, particleCap: 1, bloom: true, ambientOcclusion: true, depthOfField: true, shadowMapSize: 2048, transmissionScale: 1, fineSimulation: false, plumeLayers: 3, motorLight: true },
  // Full device pixel ratio, 4K shadows, 1.6× particles with doubled caps, and 0.25 µs physics.
  ultra: { pixelRatio: 4, particleDensity: 1.6, particleCap: 2, bloom: true, ambientOcclusion: true, depthOfField: true, shadowMapSize: 4096, transmissionScale: 1, fineSimulation: true, plumeLayers: 3, motorLight: true },
};

export const QUALITY_LEVELS: { level: QualityLevel; label: string }[] = [
  { level: 'low', label: 'Low' },
  { level: 'medium', label: 'Medium' },
  { level: 'high', label: 'High' },
];

/** Whether Ultra is offered: always in the desktop app, on the web only with `?ultra`. */
export function ultraAvailable(): boolean {
  return isDesktopApp() || new URLSearchParams(window.location.search).has('ultra');
}

/** The Electron desktop app (#38) marks itself from its preload script. */
export function isDesktopApp(): boolean {
  return !!(window as { bulletTimeDesktop?: unknown }).bulletTimeDesktop;
}

/** The levels to show in the Quality menu. */
export function qualityLevels(): { level: QualityLevel; label: string }[] {
  return ultraAvailable() ? [...QUALITY_LEVELS, { level: 'ultra', label: 'Ultra' }] : QUALITY_LEVELS;
}

const STORAGE_KEY = 'bullettime.quality';

/**
 * The saved choice, or a guess: Ultra in the desktop app or with `?ultra`,
 * low on touch-first or small screens, medium otherwise.
 */
export function initialQuality(): QualityLevel {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'low' || saved === 'medium' || saved === 'high') return saved;
    if (saved === 'ultra' && ultraAvailable()) return saved;
  } catch {
    // Storage can be blocked; fall through to the guess.
  }
  if (ultraAvailable()) return 'ultra';
  const touch = window.matchMedia?.('(pointer: coarse)').matches;
  return touch || Math.min(window.innerWidth, window.innerHeight) < 600 ? 'low' : 'medium';
}

export function saveQuality(level: QualityLevel): void {
  try {
    localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // Not remembered this time; the app still works.
  }
}
