// Takes the Steam store screenshots (#207): builds the desktop bundle, then opens it in Electron
// with BULLETTIME_SHOTS set (see electron/screenshots.cjs). Output: steam/screenshots/*.png.
//   npm run screenshots:steam                  all six scenes
//   npm run screenshots:steam -- --only 2,3    just scenes starting with 2 and 3
// Pass --skip-build to reuse an existing dist-desktop/.
// Each scene gets its own Electron process: going from one heavy WebGL page to the next in
// the same process sometimes crashes the GPU process.
import { execSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

if (!process.argv.includes('--skip-build')) execSync('npm run build:desktop', { stdio: 'inherit' });

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : ['1', '2', '3', '4', '5', '6'];
const electron = createRequire(import.meta.url)('electron');
let failed = 0;
for (const scene of only) {
  // A failed scene gets one retry, since a GPU crash is occasional rather than systematic.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = spawnSync(electron, ['.', '--force-device-scale-factor=1'], {
      stdio: 'inherit',
      env: { ...process.env, BULLETTIME_SHOTS: 'steam/screenshots', BULLETTIME_SHOTS_ONLY: scene },
    });
    if (result.status === 0) break;
    if (attempt === 2) failed++;
  }
}
process.exit(failed ? 1 : 0);
