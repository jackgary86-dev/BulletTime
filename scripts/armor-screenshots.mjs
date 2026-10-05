// Takes the Armor lab store and README screenshots (#173): one per projectile type, in the 2D section at a moment
// that shows its mechanism. Builds the site, serves it, drives the lab in headless Chromium and writes
// docs/screenshots/armor-<family>.jpg.
//   npm run screenshots:armor                 build, then all five
//   npm run screenshots:armor -- --skip-build reuse an existing dist/
import { execSync, spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const PORT = 4176;
const SHOTS = [
  { family: 'ap-shot', calibre: 105, material: 'rha', thickness: 150, obliquity: 0, overlay: 'temperature', at: 0.2 },
  { family: 'apfsds', calibre: 120, material: 'rha', thickness: 250, obliquity: 0, overlay: 'energy', at: 0.25 },
  { family: 'heat', calibre: 60, material: 'rha', thickness: 300, obliquity: 0, overlay: 'pressure', at: 0.4 },
  { family: 'hesh', calibre: 120, material: 'rha', thickness: 60, obliquity: 0, overlay: 'stress', at: 0.0105 },
  { family: 'he-frag', calibre: 105, material: 'mild-steel', thickness: 15, obliquity: 0, overlay: 'energy', at: 0.6 },
];

if (!process.argv.includes('--skip-build')) execSync('npm run build', { stdio: 'inherit' });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const base = `http://localhost:${PORT}/BulletTime/`;
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {
    // not up yet
  }
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('bullettime.contentWarningAccepted', '1'));
  await page.goto(`${base}?mode=armor&still`);
  await page.waitForFunction(() => document.body.dataset.ready === 'true', undefined, { timeout: 300_000 });
  const setRange = (sel, v) =>
    page.$eval(sel, (el, value) => {
      el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
  for (const s of SHOTS) {
    // selectOption fires the input and change events the lab listens for.
    await page.selectOption('#armor-family', s.family);
    await page.selectOption('#armor-arrangement', 'single');
    await page.selectOption('#armor-material', s.material);
    await setRange('#armor-thickness', s.thickness);
    await setRange('#armor-calibre', s.calibre);
    await setRange('#armor-obliquity', s.obliquity);
    await page.click(`.armor-overlays [data-overlay="${s.overlay}"]`);
    await page.click('.armor-fire');
    // Pause, then park the playhead.
    await page.click('.armor-play');
    await setRange('.armor-scrub', Math.round(s.at * 1000));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `docs/screenshots/armor-${s.family}.jpg`, type: 'jpeg', quality: 82 });
    console.log(`docs/screenshots/armor-${s.family}.jpg`);
  }
} finally {
  await browser.close();
  server.kill();
}
