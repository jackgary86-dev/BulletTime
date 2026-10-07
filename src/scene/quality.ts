/**
 * Quality levels (#16). Medium is tuned to hold 60 fps on a mid-range laptop
 * through the heaviest shots; low is for tablets and integrated graphics;
 * high is for a strong GPU and screenshots. Ultra (#38) is the desktop app's
 * default, also reachable on the web with `?ultra`: finer physics, more
 * particles and full-resolution rendering. Extreme is Ultra with the debris flown on the GPU, for far more of it
 * (see gpuParticles.ts): offered wherever Ultra is, never chosen for you.
 */
export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra' | 'extreme';

/**
 * How many times the usual count and cap each particle look gets when it is flown on the GPU: `all` for every look,
 * `per` for the ones that differ (0 keeps a look on the CPU path). All 0 means nothing runs on the GPU.
 */
export interface GpuParticleSettings {
  all: number;
  per: Readonly<Record<string, number>>;
}

const NO_GPU_PARTICLES: GpuParticleSettings = { all: 0, per: {} };

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
  /** Whether the hot air behind a missile's motor refracts the scene (#247). */
  heatHaze: boolean;
  /** Particle looks flown in the vertex shader, with how many more of each (see GpuParticleSettings). */
  gpuParticles: GpuParticleSettings;
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  low: { pixelRatio: 1, particleDensity: 0.35, particleCap: 0.35, bloom: false, ambientOcclusion: false, depthOfField: false, shadowMapSize: 0, transmissionScale: 0.5, fineSimulation: false, plumeLayers: 1, motorLight: false, heatHaze: false, gpuParticles: NO_GPU_PARTICLES },
  medium: { pixelRatio: 1.5, particleDensity: 0.7, particleCap: 0.7, bloom: true, ambientOcclusion: true, depthOfField: false, shadowMapSize: 1024, transmissionScale: 0.75, fineSimulation: false, plumeLayers: 2, motorLight: true, heatHaze: true, gpuParticles: NO_GPU_PARTICLES },
  high: { pixelRatio: 2, particleDensity: 1, particleCap: 1, bloom: true, ambientOcclusion: true, depthOfField: true, shadowMapSize: 2048, transmissionScale: 1, fineSimulation: false, plumeLayers: 3, motorLight: true, heatHaze: true, gpuParticles: NO_GPU_PARTICLES },
  // Full device pixel ratio, 4K shadows, 1.6× particles with doubled caps, and 0.25 µs physics.
  ultra: { pixelRatio: 4, particleDensity: 1.6, particleCap: 2, bloom: true, ambientOcclusion: true, depthOfField: true, shadowMapSize: 4096, transmissionScale: 1, fineSimulation: true, plumeLayers: 3, motorLight: true, heatHaze: true, gpuParticles: NO_GPU_PARTICLES },
  // Ultra with ten times the debris, flown on the GPU. Dust and vapour are big translucent cards that pile up on each
  // other, so they stay near their usual count (more would only whiten the trail and slow the draw).
  extreme: { pixelRatio: 4, particleDensity: 1.6, particleCap: 2, bloom: true, ambientOcclusion: true, depthOfField: true, shadowMapSize: 4096, transmissionScale: 1, fineSimulation: true, plumeLayers: 3, motorLight: true, heatHaze: true, gpuParticles: { all: 10, per: { dust: 2, vapour: 1 } } },
};

export const QUALITY_LEVELS: { level: QualityLevel; label: string }[] = [
  { level: 'low', label: 'Low' },
  { level: 'medium', label: 'Medium' },
  { level: 'high', label: 'High' },
];

/** Whether Ultra (and Extreme) is offered: always in the desktop app, on the web only with `?ultra`. */
export function ultraAvailable(): boolean {
  return isDesktopApp() || new URLSearchParams(window.location.search).has('ultra');
}

/** The Electron desktop app (#38) marks itself from its preload script. */
export function isDesktopApp(): boolean {
  return !!(window as { bulletTimeDesktop?: unknown }).bulletTimeDesktop;
}

/** The levels to show in the Quality menu. */
export function qualityLevels(): { level: QualityLevel; label: string }[] {
  return ultraAvailable() ? [...QUALITY_LEVELS, { level: 'ultra', label: 'Ultra' }, { level: 'extreme', label: 'Extreme' }] : QUALITY_LEVELS;
}

const STORAGE_KEY = 'bullettime.quality';

/**
 * The saved choice, or a guess (never Extreme): Ultra in the desktop app or with `?ultra`,
 * low on touch-first or small screens, medium otherwise.
 */
export function initialQuality(): QualityLevel {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'low' || saved === 'medium' || saved === 'high') return saved;
    if ((saved === 'ultra' || saved === 'extreme') && ultraAvailable()) return saved;
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
