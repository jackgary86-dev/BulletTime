// Runs the desktop smoke test (#206): builds the desktop bundle, then opens it in
// Electron with BULLETTIME_SMOKE=1 (see electron/smoke.cjs). The exit code is the result.
// Pass --skip-build to reuse an existing dist-desktop/. On Linux CI run it under xvfb:
//   xvfb-run -a npm run smoke
// Pass --ultra to also run every simulator at Ultra quality and check the setting is saved (#184); too heavy for
// software-rendered CI runners, so it is for a machine with a GPU.
import { execSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

if (!process.argv.includes('--skip-build')) execSync('npm run build:desktop', { stdio: 'inherit' });

const electron = createRequire(import.meta.url)('electron');
const args = ['.'];
// GitHub's Linux runners can't set up Chromium's sandbox.
if (process.platform === 'linux') args.push('--no-sandbox');
const result = spawnSync(electron, args, { stdio: 'inherit', env: { ...process.env, BULLETTIME_SMOKE: '1', ...(process.argv.includes('--ultra') ? { BULLETTIME_SMOKE_ULTRA: '1' } : {}) } });
process.exit(result.status ?? 1);
