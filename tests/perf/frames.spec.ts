import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Frame-time budget (#244): plays the heaviest shots in software WebGL at
 * Low quality and records the median and 95th-percentile frame time over
 * `FRAMES` frames. Software rendering is far slower than any GPU and runners
 * differ in speed, so each shot is measured against the idle lab in the same
 * run (its frame time divided by the idle lab's median), and that ratio may
 * not regress by more than `MAX_REGRESSION` against tests/perf/baseline.json.
 * `npm run perf:update` (PERF_UPDATE=1) records a new baseline on purpose.
 *
 * Low, not Medium: in software WebGL, Medium's full-screen ambient occlusion
 * and bloom take nearly the whole frame, so doubling the particles moved the
 * buckshot shot by under 5%. At Low the same change moves it from 1.6x to
 * 2.5x the idle lab, and fails.
 */
const FRAMES = 24;
const MAX_REGRESSION = 0.25;
const BASELINE = 'tests/perf/baseline.json';
const RESULTS = 'test-results/perf/frames.json';

interface FrameStats {
  medianMs: number;
  p95Ms: number;
}

/** A shot's 95th-percentile frame time, in multiples of the idle lab's median frame on the same machine. */
interface Relative extends FrameStats {
  p95Ratio: number;
}

const IDLE = 'idle-lab';
const results: Record<string, FrameStats> = {};

/** Times `FRAMES` animation frames in the page. */
async function measure(page: Page): Promise<FrameStats> {
  const deltas = await page.evaluate(
    (frames) =>
      new Promise<number[]>((resolve) => {
        const out: number[] = [];
        let last = performance.now();
        const tick = (now: number) => {
          out.push(now - last);
          last = now;
          if (out.length >= frames) resolve(out);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    FRAMES + 1,
  );
  const sorted = deltas.slice(1).sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { medianMs: Math.round(at(0.5)), p95Ms: Math.round(at(0.95)) };
}

async function open(page: Page, query: string): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('bullettime.contentWarningAccepted', '1');
    localStorage.setItem('bullettime.quality', 'low');
  });
  await page.goto(`./?${query}`);
  await page.waitForFunction(() => document.body.dataset.ready === 'true', undefined, { timeout: 300_000 });
}

// Runs first (one worker, file order): the machine's own yardstick.
test(IDLE, async ({ page }) => {
  await open(page, 'mode=bullet&still');
  results[IDLE] = await measure(page);
});

/** Simulator shots: parked just before first contact by a replay link, then played through the impact. */
const SHOTS: { name: string; query: string }[] = [
  { name: 'bullet-12ga-00buck-gel', query: 'mode=bullet&bullet=12ga-00buck&medium=gel10&at=0us' },
  { name: 'explosion-default', query: 'mode=explosion&at=0us' },
];

for (const shot of SHOTS) {
  test(shot.name, async ({ page }) => {
    await open(page, `${shot.query}&still`);
    await page.click('.scrubber .play');
    results[shot.name] = await measure(page);
  });
}

test('armor-four-plate-stack-3d', async ({ page }) => {
  await open(page, 'mode=armor&still');
  for (let i = 0; i < 3; i++) await page.click('.armor-add-plate');
  await page.click('.armor-fire');
  await page.click('.armor-view [data-view="3d"]');
  results['armor-four-plate-stack-3d'] = await measure(page);
});

test.afterAll(() => {
  const idle = results[IDLE];
  expect(idle, 'the idle lab was not measured').toBeTruthy();
  const relative: Record<string, Relative> = {};
  for (const [name, r] of Object.entries(results)) {
    if (name !== IDLE) relative[name] = { ...r, p95Ratio: Math.round((r.p95Ms / Math.max(1, idle.medianMs)) * 100) / 100 };
  }
  mkdirSync('test-results/perf', { recursive: true });
  writeFileSync(RESULTS, `${JSON.stringify({ idle, shots: relative }, null, 2)}\n`);
  console.log(`frame times: idle median ${idle.medianMs} ms; ${Object.entries(relative).map(([n, r]) => `${n} p95 ${r.p95Ms} ms (${r.p95Ratio}x idle)`).join('; ')}`);
  if (process.env.PERF_UPDATE) {
    writeFileSync(BASELINE, `${JSON.stringify(Object.fromEntries(Object.entries(relative).map(([n, r]) => [n, { p95Ratio: r.p95Ratio }])), null, 2)}\n`);
    return;
  }
  expect(existsSync(BASELINE), `${BASELINE} is missing: run npm run perf:update`).toBe(true);
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, { p95Ratio: number }>;
  const regressions = Object.entries(relative)
    .filter(([name, r]) => baseline[name] && r.p95Ratio > baseline[name].p95Ratio * (1 + MAX_REGRESSION))
    .map(([name, r]) => `${name}: 95th percentile ${r.p95Ratio}x the idle lab, against ${baseline[name].p95Ratio}x`);
  expect(regressions, regressions.join('\n')).toEqual([]);
});
