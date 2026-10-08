import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Frame-time budget (#244): plays the heaviest shots in software WebGL at
 * Low quality and records the median and 90th-percentile frame time over
 * `FRAMES` frames (#288: 48 frames and the 90th percentile, so up to four
 * stalled frames on a runner, a GC pause or a late shader compile, cannot
 * decide the result; with 24 frames the 95th percentile was the second-worst
 * frame, and one stall doubled it). Software rendering is far slower than any GPU and runners
 * differ in speed, so each shot is measured against the idle lab in the same
 * run (its frame time divided by the idle lab's median) and against a fixed
 * script workload (#283). A shot fails when both ratios regress by more than
 * `MAX_REGRESSION` against tests/perf/baseline.json: the runner alone moves a
 * shot against one yardstick (more cores speed up the software rasteriser,
 * not the main thread), a real slowdown moves it against both.
 * `npm run perf:update` (PERF_UPDATE=1) records a new baseline on purpose.
 *
 * Low, not Medium: in software WebGL, Medium's full-screen ambient occlusion
 * and bloom take nearly the whole frame, so doubling the particles moved the
 * buckshot shot by under 5%. At Low the same change moved it from 1.6x to
 * 2.5x the idle lab when this was written (#244). By #288 it no longer did:
 * doubling Low's particle density and cap left the buckshot shot at about
 * 3.2 s a frame in software WebGL, so particles are no longer what limits it.
 */
const FRAMES = 48;
const MAX_REGRESSION = 0.25;
const BASELINE = 'tests/perf/baseline.json';
const RESULTS = 'test-results/perf/frames.json';

interface FrameStats {
  medianMs: number;
  p90Ms: number;
}

/**
 * A shot's 90th-percentile frame time against two yardsticks on the same
 * machine (#283): the idle lab's median frame (raster-bound) and a fixed
 * single-thread script workload (main-thread bound). Runners differ in how
 * many cores SwiftShader gets against how fast one thread is, so a shot can
 * move against one yardstick with the runner alone; a real slowdown moves it
 * against both.
 */
interface Relative extends FrameStats {
  p90Ratio: number;
  p90CpuRatio: number;
}

interface Baseline {
  p90Ratio: number;
  /** Missing in baselines recorded before #283: the raster ratio alone decides. */
  p90CpuRatio?: number;
}

const IDLE = 'idle-lab';
const results: Record<string, FrameStats> = {};
/** Median time of the fixed script workload, ms. */
let cpuMs = 0;

/**
 * Times a fixed single-thread workload in the page, like a particle step: a
 * few hundred thousand points advanced and bounced, in typed arrays. The
 * median of several runs, after a warm-up.
 */
async function measureCpu(page: Page): Promise<number> {
  return page.evaluate(() => {
    const n = 200_000;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) {
      pos[i] = (i % 97) / 97;
      vel[i] = ((i % 31) - 15) / 15;
    }
    const step = () => {
      for (let k = 0; k < 10; k++) {
        for (let i = 0; i < n * 3; i += 3) {
          vel[i + 1] -= 0.0098;
          pos[i] += vel[i] * 0.001;
          pos[i + 1] += vel[i + 1] * 0.001;
          pos[i + 2] += vel[i + 2] * 0.001 * Math.sin(pos[i]);
          if (pos[i + 1] < 0) vel[i + 1] = -vel[i + 1] * 0.5;
        }
      }
    };
    step();
    const times: number[] = [];
    for (let r = 0; r < 7; r++) {
      const t0 = performance.now();
      step();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return times[3];
  });
}

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
  return { medianMs: Math.round(at(0.5)), p90Ms: Math.round(at(0.9)) };
}

async function open(page: Page, query: string): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('bullettime.contentWarningAccepted', '1');
    localStorage.setItem('bullettime.quality', 'low');
  });
  // Every frame drawn, idle or not (#329), so the idle lab stays a raster yardstick.
  await page.goto(`./?${query}&alwaysdraw`);
  await page.waitForFunction(() => document.body.dataset.ready === 'true', undefined, { timeout: 300_000 });
}

// Runs first (one worker, file order): the machine's own yardstick.
test(IDLE, async ({ page }) => {
  await open(page, 'mode=bullet&still');
  results[IDLE] = await measure(page);
  cpuMs = await measureCpu(page);
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
    if (name !== IDLE) {
      relative[name] = {
        ...r,
        p90Ratio: Math.round((r.p90Ms / Math.max(1, idle.medianMs)) * 100) / 100,
        p90CpuRatio: Math.round((r.p90Ms / Math.max(1, cpuMs)) * 100) / 100,
      };
    }
  }
  mkdirSync('test-results/perf', { recursive: true });
  writeFileSync(RESULTS, `${JSON.stringify({ idle, cpuMs: Math.round(cpuMs), shots: relative }, null, 2)}\n`);
  console.log(
    `frame times: idle median ${idle.medianMs} ms, script yardstick ${Math.round(cpuMs)} ms; ${Object.entries(relative)
      .map(([n, r]) => `${n} p90 ${r.p90Ms} ms (${r.p90Ratio}x idle, ${r.p90CpuRatio}x script)`)
      .join('; ')}`,
  );
  if (process.env.PERF_UPDATE) {
    writeFileSync(BASELINE, `${JSON.stringify(Object.fromEntries(Object.entries(relative).map(([n, r]) => [n, { p90Ratio: r.p90Ratio, p90CpuRatio: r.p90CpuRatio }])), null, 2)}\n`);
    return;
  }
  expect(existsSync(BASELINE), `${BASELINE} is missing: run npm run perf:update`).toBe(true);
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, Baseline>;
  const limit = 1 + MAX_REGRESSION;
  // A regression must show against both yardsticks: the runner alone moves a shot against one of them (#283).
  const regressions = Object.entries(relative)
    .filter(([name, r]) => {
      const b = baseline[name];
      if (!b) return false;
      const raster = r.p90Ratio > b.p90Ratio * limit;
      const cpu = b.p90CpuRatio === undefined || r.p90CpuRatio > b.p90CpuRatio * limit;
      return raster && cpu;
    })
    .map(([name, r]) => `${name}: 90th percentile ${r.p90Ratio}x the idle lab and ${r.p90CpuRatio}x the script yardstick, against ${baseline[name].p90Ratio}x and ${baseline[name].p90CpuRatio}x`);
  expect(regressions, regressions.join('\n')).toEqual([]);
});
