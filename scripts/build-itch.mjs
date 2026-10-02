// Builds the itch.io HTML5 upload (#110): a relative-path build in dist-itch/,
// zipped to release/bullettime-web-<version>.zip with index.html at the root.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { zipDirectory } from './zip.mjs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
rmSync('dist-itch', { recursive: true, force: true });
// itch.io serves the game from an unknown sub-path inside an iframe, so every URL must be relative.
execSync('npx tsc --noEmit && npx vite build --outDir dist-itch', {
  stdio: 'inherit',
  env: { ...process.env, VITE_BASE: './' },
});
mkdirSync('release', { recursive: true });
const out = `release/bullettime-web-${version}.zip`;
const count = zipDirectory('dist-itch', out);
console.log(`\n${out}: ${count} files, index.html at the root. Upload it to itch.io as an HTML game.`);
