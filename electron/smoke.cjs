// Desktop smoke test (#206): `npm run smoke` opens the built app, clicks through the
// content warning, checks the launcher offers all four simulators, then loads each
// simulator and fires one shot. Exits 0 on success and 1 on any failure or timeout, so
// CI can run it on every platform (under xvfb on Linux). Enabled with BULLETTIME_SMOKE=1.
const MODES = ['bullet', 'artillery', 'missile', 'explosion'];
// Four simulators, each waited on until its start-up has finished (shader warm-up included).
const TIMEOUT_MS = process.env.BULLETTIME_SMOKE_ULTRA === '1' ? 900_000 : 360_000;

/** Runs `fn` in the page until it returns a truthy value, or fails after `ms`. */
async function waitFor(win, label, expression, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await win.webContents.executeJavaScript(expression).catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const seen = await win.webContents.executeJavaScript(`[...document.querySelectorAll('button')].map((b) => b.textContent.trim().slice(0, 20)).join(' | ')`).catch(() => '?');
  throw new Error(`Timed out waiting for ${label} (buttons on screen: ${seen})`);
}

const buttonByText = (text) => `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;

/** The warning shows once per profile; the smoke run starts with a fresh one, so the first visit must see it. */
async function passContentWarning(win, expected) {
  if (expected) await waitFor(win, 'the content warning', `!!${buttonByText('Continue')}`);
  await win.webContents.executeJavaScript(`${buttonByText('Continue')}?.click()`);
}

async function run(win, base) {
  // 1. The launcher: four simulator cards.
  // A fresh profile would open on the first-launch shot (#241); ?launcher asks for the launcher.
  await win.loadURL(`${base}/index.html?launcher`);
  await passContentWarning(win, true);
  const cards = await waitFor(
    win,
    'the launcher',
    `(() => { const t = [...document.querySelectorAll('button')].map((b) => b.textContent.trim().split('\\n')[0].replace(/^\\d+\\.\\s*/, '').trim()); return ['Bullet', 'Artillery', 'Missile', 'Explosion'].every((m) => t.includes(m)) ? t : null; })()`,
  );
  console.log(`smoke: launcher offers ${cards.join(', ')}`);

  // 2. Each simulator loads and fires a shot.
  for (const mode of MODES) {
    await win.loadURL(`${base}/index.html?mode=${mode}`);
    await passContentWarning(win, false);
    // The Fire button is mounted before the lab is built and does nothing until then, so wait for
    // the app's own ready flag (set once start-up has finished, #243), not just for the button.
    await waitFor(win, `${mode} to be ready`, `!!${buttonByText('Fire')} && !!document.querySelector('canvas') && document.body.dataset.ready === 'true'`, 90_000);
    // Give the first frame a moment, then fire.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await win.webContents.executeJavaScript(`${buttonByText('Fire')}.click()`);
    await waitFor(win, `${mode} to report a shot`, `!/No shots yet/.test(document.body.innerText)`);
    console.log(`smoke: ${mode} fired`);
  }

  // 3. Ultra quality and saved settings (#184), only with BULLETTIME_SMOKE_ULTRA=1: Ultra renders at four times
  // the pixels, which the software renderer on CI runners cannot do in time. The first lab picks Ultra in the
  // menu; every later lab must come up already on Ultra, which is the saved setting read back from storage.
  if (process.env.BULLETTIME_SMOKE_ULTRA === '1') {
    const quality = `document.querySelector('#quality-select')`;
    for (const [i, mode] of MODES.entries()) {
      await win.loadURL(`${base}/index.html?mode=${mode}`);
      await waitFor(win, `${mode} to be ready at Ultra`, `!!${buttonByText('Fire')} && !!document.querySelector('canvas') && document.body.dataset.ready === 'true'`, 180_000);
      if (i === 0) {
        const offered = await win.webContents.executeJavaScript(`[...${quality}.options].some((o) => o.value === 'ultra')`);
        if (!offered) throw new Error('the desktop app does not offer Ultra quality');
        await win.webContents.executeJavaScript(`(() => { const s = ${quality}; s.value = 'ultra'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      } else {
        const saved = await win.webContents.executeJavaScript(`${quality}.value`);
        if (saved !== 'ultra') throw new Error(`${mode} did not start on the saved Ultra quality (it shows "${saved}")`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await win.webContents.executeJavaScript(`${buttonByText('Fire')}.click()`);
      await waitFor(win, `${mode} to report a shot at Ultra`, `!/No shots yet/.test(document.body.innerText)`, 120_000);
      console.log(`smoke: ${mode} fired at Ultra${i === 0 ? '' : ' (saved setting)'}`);
    }
  }
}

/**
 * SwiftShader (the Linux CI renderer) fails glValidateProgram on programs that compiled and
 * linked fine, while the shader warm-up is still binding them; three.js logs that as
 * "VALIDATE_STATUS false" with an empty info log. A real shader error always carries a log.
 */
function benignShaderWarning(message) {
  return /VALIDATE_STATUS false/.test(message) && /Program Info Log:\s*$/.test(message);
}

module.exports = function smoke(win, base, app) {
  const errors = [];
  // Offline operation (#184): every request must stay inside the app. Anything aimed at the network is
  // refused here, so the run proves the app works with no connection, and is reported as a failure.
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const external = /^(https?|wss?|ftp):/i.test(details.url);
    if (external) errors.push(`network request: ${details.url}`);
    callback({ cancel: external });
  });
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error' && !benignShaderWarning(event.message)) errors.push(event.message);
  });
  const finish = (code, message) => {
    if (message) console.error(`smoke: ${message}`);
    app.exit(code);
  };
  const timer = setTimeout(() => finish(1, 'timed out'), TIMEOUT_MS);
  run(win, base)
    .then(() => {
      clearTimeout(timer);
      if (errors.length) return finish(1, `console errors:\n${errors.join('\n')}`);
      console.log('smoke: ok');
      finish(0);
    })
    .catch((e) => {
      clearTimeout(timer);
      finish(1, e.message + (errors.length ? `\nconsole errors:\n${errors.join('\n')}` : ''));
    });
};
