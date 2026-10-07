import { afterEach, describe, expect, it } from 'vitest';
import { initialQuality, QUALITY, qualityLevels, ultraAvailable } from './quality';

/** A page with a query string, a saved quality choice, and optionally the desktop app's marker. */
function page(search: string, saved: string | null = null, desktop = false): void {
  const g = globalThis as Record<string, unknown>;
  g.window = { location: { search }, innerWidth: 1600, innerHeight: 900, matchMedia: () => ({ matches: false }), ...(desktop ? { bulletTimeDesktop: {} } : {}) };
  g.localStorage = { getItem: () => saved, setItem: () => undefined };
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.window;
  delete g.localStorage;
});

describe('the Extreme quality tier', () => {
  it('sits above Ultra on everything Ultra sets, and is the only tier that flies particles on the GPU', () => {
    const { ultra, extreme } = QUALITY;
    expect(extreme.particleDensity).toBeGreaterThanOrEqual(ultra.particleDensity);
    expect(extreme.particleCap).toBeGreaterThanOrEqual(ultra.particleCap);
    expect(extreme.pixelRatio).toBeGreaterThanOrEqual(ultra.pixelRatio);
    expect(extreme.shadowMapSize).toBeGreaterThanOrEqual(ultra.shadowMapSize);
    expect(extreme.fineSimulation).toBe(true);
    expect(extreme.gpuParticles.all).toBeGreaterThan(1);
    for (const level of ['low', 'medium', 'high', 'ultra'] as const) expect(QUALITY[level].gpuParticles).toEqual({ all: 0, per: {} });
  });

  it('keeps the translucent cloud looks near their usual count, so the debris is what multiplies', () => {
    const { all, per } = QUALITY.extreme.gpuParticles;
    expect(per.vapour).toBeLessThanOrEqual(1);
    expect(per.dust).toBeLessThan(all);
  });

  it('is offered where Ultra is, after it, and nowhere else', () => {
    page('');
    expect(ultraAvailable()).toBe(false);
    expect(qualityLevels().map((l) => l.level)).toEqual(['low', 'medium', 'high']);
    page('?ultra');
    expect(qualityLevels().map((l) => l.level)).toEqual(['low', 'medium', 'high', 'ultra', 'extreme']);
    page('', null, true);
    expect(qualityLevels().map((l) => l.level)).toContain('extreme');
  });

  it('is remembered where it is offered, never picked for you, and ignored where it is not', () => {
    page('?ultra', 'extreme');
    expect(initialQuality()).toBe('extreme');
    page('?ultra', null);
    expect(initialQuality()).toBe('ultra');
    page('', null, true);
    expect(initialQuality()).toBe('ultra');
    page('', 'extreme');
    expect(initialQuality()).toBe('medium');
  });
});
