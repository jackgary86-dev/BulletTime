// BulletTime desktop app (#38): the same Vite build in an Electron window,
// tuned for performance: high-performance GPU, no GPU blocklist and no
// background throttling. Files are served from a privileged app:// scheme so
// ES modules, localStorage and relative URLs behave as they do on the web.
const { app, BrowserWindow, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', 'dist-desktop');
const SCHEME = 'app';
// Everything ships in the build; nothing loads from the network.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
].join('; ');

// CI smoke test (#206): runner machines have no GPU, so draw with the software renderer.
const SMOKE = process.env.BULLETTIME_SMOKE === '1';
if (SMOKE) {
  // A fresh profile, so the first-launch content warning is exercised every time.
  app.setPath('userData', require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'bullettime-smoke-')));
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
// Launched by Steam (#111): the Steam overlay can only hook a GPU that runs in the main
// process and draws without DirectComposition.
if (process.env.SteamAppId || process.env.SteamGameId) {
  app.commandLine.appendSwitch('in-process-gpu');
  app.commandLine.appendSwitch('disable-direct-composition');
}

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#07080a',
    title: 'BulletTime',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      // Keep simulating and rendering at full speed when the window is behind others.
      backgroundThrottling: false,
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  // Web links (three.js, licences hosted elsewhere) open in the player's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${SCHEME}://`)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${SCHEME}://`)) event.preventDefault();
  });
  // F11 toggles fullscreen; Escape leaves it.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'Escape' && win.isFullScreen()) {
      win.setFullScreen(false);
    }
  });
  if (SMOKE) {
    win.show();
    require('./smoke.cjs')(win, `${SCHEME}://bullettime`, app);
    return;
  }
  win.loadURL(`${SCHEME}://bullettime/index.html`);
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    // Never serve anything outside the build folder.
    if (!file.startsWith(ROOT + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString()).then((response) => {
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', CSP);
      return new Response(response.body, { status: response.status, headers });
    });
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
