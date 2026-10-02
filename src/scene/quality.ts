/**
 * Quality levels (#16). Medium is tuned to hold 60 fps on a mid-range laptop
 * through the heaviest shots; low is for tablets and integrated graphics;
 * high is for a strong GPU and screenshots.
 */
export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualitySettings {
  /** Highest device pixel ratio the canvas renders at. */
  pixelRatio: number;
  /** Multiplies every particle burst's count. */
  particleDensity: number;
  /** Fraction of each particle look's instance capacity that may be used. */
  particleCap: number;
  bloom: boolean;
  depthOfField: boolean;
  /** Key light shadow map size in texels, or 0 for no shadows. */
  shadowMapSize: number;
  /** Resolution of the render behind transmissive gel, water and glass, as a fraction of the canvas. */
  transmissionScale: number;
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  low: { pixelRatio: 1, particleDensity: 0.35, particleCap: 0.35, bloom: false, depthOfField: false, shadowMapSize: 0, transmissionScale: 0.5 },
  medium: { pixelRatio: 1.5, particleDensity: 0.7, particleCap: 0.7, bloom: true, depthOfField: false, shadowMapSize: 1024, transmissionScale: 0.75 },
  high: { pixelRatio: 2, particleDensity: 1, particleCap: 1, bloom: true, depthOfField: true, shadowMapSize: 2048, transmissionScale: 1 },
};

export const QUALITY_LEVELS: { level: QualityLevel; label: string }[] = [
  { level: 'low', label: 'Low' },
  { level: 'medium', label: 'Medium' },
  { level: 'high', label: 'High' },
];

const STORAGE_KEY = 'bullettime.quality';

/** The saved choice, or a guess: low on touch-first or small screens, medium otherwise. */
export function initialQuality(): QualityLevel {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'low' || saved === 'medium' || saved === 'high') return saved;
  } catch {
    // Storage can be blocked; fall through to the guess.
  }
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
