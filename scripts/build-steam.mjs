// Builds the desktop app unpacked for a Steam depot (#111): release/steam/<windows|mac|linux>/,
// laid out exactly as players' Steam install folder will be. See steam/README.md.
import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const os = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform];
if (!os) throw new Error(`No Steam depot for ${process.platform}`);
const staging = 'release/steam-staging';
const target = join('release/steam', os);
rmSync(staging, { recursive: true, force: true });
rmSync(target, { recursive: true, force: true });
execSync(`npm run build:desktop && npx electron-builder --dir -c.directories.output=${staging}`, { stdio: 'inherit' });
// electron-builder names the folder by platform and arch (win-unpacked, mac-arm64, linux-unpacked).
const unpacked = readdirSync(staging).find((name) => /^(win|mac|linux)/.test(name));
if (!unpacked) throw new Error(`No unpacked app in ${staging}`);
mkdirSync('release/steam', { recursive: true });
renameSync(join(staging, unpacked), target);
rmSync(staging, { recursive: true, force: true });
console.log(`\n${target}: Steam depot content for ${os}. Upload with steam/app_build.vdf.`);
