import { describe, expect, it } from 'vitest';
import html from '../../docs/material-reference/index.html?raw';
import { CONCRETE_REFERENCE } from './concreteReference';

/**
 * The material reference sheet (docs/material-reference/index.html, #230) must load with no errors, and the
 * measured numbers it draws must be the ones in concreteReference.ts, so a visual and a test target never drift.
 * There is no browser in the test run, so the page script runs against a stand-in document that accepts any call.
 */
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

/** An object that is any function, any property and any number: enough for canvas and DOM calls that draw. */
function anything(): unknown {
  const target = function () {};
  const handler: ProxyHandler<object> = {
    get: (_t, key) => {
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'length') return 0;
      if (key === 'then') return undefined;
      return anything();
    },
    set: () => true,
    apply: () => anything(),
    construct: () => anything() as object,
  };
  return new Proxy(target, handler);
}

function runPage(): { TEST: Record<string, { vbl: number; pts: number[][]; fcc: number }>; FOOT: { name: string; spall: number[]; scab: number[] }[]; errors: unknown[] } {
  const errors: unknown[] = [];
  const document = {
    createElement: () => anything(),
    getElementById: () => anything(),
    querySelector: () => anything(),
    querySelectorAll: () => [],
    addEventListener: () => undefined,
    body: anything(),
  };
  const globals = {
    document,
    window: { addEventListener: () => undefined, devicePixelRatio: 1 },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => undefined,
    performance: { now: () => 0 },
    console: { error: (e: unknown) => errors.push(e), log: () => undefined, warn: () => undefined },
  };
  // The page script is a classic script with top-level consts; run it as a function body that hands back its data.
  const run = new Function(...Object.keys(globals), `${script}
;return { TEST, FOOT };`);
  const exposed = run(...Object.values(globals)) as object;
  return { ...(exposed as object), errors } as never;
}

describe('material reference sheet (#230)', () => {
  it('has a script to run', () => expect(script.length).toBeGreaterThan(1000));

  it('runs without throwing', () => {
    expect(() => runPage()).not.toThrow();
    expect(runPage().errors).toEqual([]);
  });

  it('draws the measured ballistic limits and test points of concreteReference.ts', () => {
    const { TEST } = runPage();
    for (const ref of CONCRETE_REFERENCE) {
      expect(TEST[ref.id].vbl, ref.id).toBe(ref.ballisticLimitMs);
      expect(TEST[ref.id].fcc, ref.id).toBe(ref.cubeStrengthMPa);
      expect(TEST[ref.id].pts, ref.id).toEqual(ref.test.map((p) => [...p]));
    }
  });

  it('draws the measured spall and scab footprints of concreteReference.ts', () => {
    const { FOOT } = runPage();
    CONCRETE_REFERENCE.forEach((ref, i) => {
      expect(FOOT[i].name.startsWith(ref.id), ref.id).toBe(true);
      expect(FOOT[i].spall, ref.id).toEqual([...ref.spallMm]);
      expect(FOOT[i].scab, ref.id).toEqual([...ref.scabMm]);
    });
  });

  it('has no external script, stylesheet or image to fail to load', () => {
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/<img[^>]+src=["']?(?!data:)/i);
  });
});
