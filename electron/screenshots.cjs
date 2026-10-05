// Store screenshots (#207): `npm run screenshots:steam` opens the built app at 1920x1080 and
// captures the seven scenes listed in steam/store-page.md into steam/screenshots/.
// Enabled with BULLETTIME_SHOTS=<output folder>; BULLETTIME_SHOTS_ONLY=a,b limits the scenes.
const fs = require('node:fs');
const path = require('node:path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One entry per screenshot. `t` is how far through the shot's timeline to scrub (0 to 1) once it
 * has been fired at the `slow` rate; the scenes are tuned by eye, so adjust `t` when the physics changes.
 */
const SCENES = [
  { name: '1-launcher', launcher: true },
  { name: '2-gel-9mm-hollow-point', mode: 'bullet', round: '9mm-jhp', medium: 'gel10', slow: '1/10,000', t: 0.22 },
  { name: '3-155mm-he-concrete', mode: 'artillery', round: '155mm-he', medium: 'reinforced-concrete', slow: '1/1,000', t: 0.3 },
  { name: '4-missile-shaped-armour', mode: 'missile', medium: 'rha', slow: '1/10,000', t: 0.35 },
  { name: '5-demolition-block-plywood', mode: 'explosion', round: 'charge-block', medium: 'plywood', slow: '1/1,000', t: 0.33 },
  { name: '6-compare', mode: 'bullet', compare: true, round: '9mm-jhp', roundB: '556-m193', medium: 'gel10', slow: '1/10,000', t: 0.3 },
  { name: '7-missile-plume', mode: 'missile', medium: 'rha', slow: '1/1,000', t: 0.006 },
];

async function js(win, code) {
  return win.webContents.executeJavaScript(code);
}

async function waitFor(win, label, expression, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await js(win, expression).catch(() => null)) return;
    await sleep(250);
  }
  const seen = await js(win, `location.href + ' :: ' + [...document.querySelectorAll('button')].map((b) => b.textContent.trim().slice(0, 14)).join(' | ')`).catch(() => '?');
  throw new Error(`Timed out waiting for ${label} (${seen})`);
}

const button = (text) => `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;

/** Sets a <select> or range by id (or aria-label) and fires the events the UI listens for. */
const setControl = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(value))});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

async function openMode(win, base, mode) {
  // Without a mode, ask for the launcher: a fresh profile would otherwise open on the first-launch shot (#241).
  await win.loadURL(mode ? `${base}/index.html?mode=${mode}` : `${base}/index.html?launcher`);
  await waitFor(win, 'the page', `!!${button('Continue')} || !!${button('Fire')} || !!document.querySelector('.launcher')`);
  await js(win, `${button('Continue')}?.click()`);
}

async function capture(win, scene, outDir) {
  // Leave the last scene's WebGL page before loading the next; going straight across crashes the GPU process.
  await win.loadURL('about:blank');
  await sleep(1500);
  if (scene.launcher) {
    await openMode(win, scene.base);
    await waitFor(win, 'the launcher', `/explosion/i.test(document.body.innerText) && !${button('Fire')}`);
  } else {
    await openMode(win, scene.base, scene.mode);
    await waitFor(win, 'the lab', `!!${button('Fire')} && !!document.querySelector('canvas') && !document.querySelector('#loader')`, 90_000);
    await sleep(1500);
    if (scene.round) await js(win, setControl('#bullet-select', scene.round));
    if (scene.medium) await js(win, setControl('select[aria-label="Layer material"]', scene.medium));
    await sleep(500);
    if (scene.compare) {
      await js(win, `${button('Compare')}.click()`);
      await sleep(800);
      if (scene.roundB) await js(win, setControl('select[aria-label="Shot B round"]', scene.roundB));
      await sleep(500);
    }
    await js(win, `${button('Fire')}.click()`);
    await sleep(4000);
    await js(win, `${button('Side')}.click()`);
    await js(win, `${button(scene.slow)}.click()`);
    await sleep(300);
    await js(win, `(() => { const r = document.querySelector('input[aria-label="Shot timeline"]'); const v = String(+r.max * ${scene.t});
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(r, v);
      r.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  }
  win.setContentSize(1920, 1080);
  await sleep(1500);
  const image = await win.webContents.capturePage();
  const file = path.join(outDir, `${scene.name}.png`);
  fs.writeFileSync(file, image.toPNG());
  const { width, height } = image.getSize();
  console.log(`screenshots: ${scene.name} ${width}x${height}`);
}

module.exports = function screenshots(win, base, app, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const only = (process.env.BULLETTIME_SHOTS_ONLY || '').split(',').filter(Boolean);
  win.setContentSize(1920, 1080);
  (async () => {
    for (const scene of SCENES) {
      if (only.length && !only.some((o) => scene.name.startsWith(o))) continue;
      await capture(win, { ...scene, base }, outDir);
    }
  })()
    .then(() => app.exit(0))
    .catch((e) => {
      console.error(`screenshots: ${e && e.stack || e}`);
      app.exit(1);
    });
};
