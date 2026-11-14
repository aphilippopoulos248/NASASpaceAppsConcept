// Part of `npm run build`: type-checks the server side (server/**, vite.config.ts) with
// its own tsconfig, because the browser tsconfig only covers src/. Does nothing until a
// tsconfig.server.json exists at the repository root.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(join(ROOT, 'tsconfig.server.json'))) process.exit(0);

const tsc = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
const r = spawnSync(tsc, ['--noEmit', '-p', 'tsconfig.server.json'], { cwd: ROOT, stdio: 'inherit' });
process.exit(r.status ?? 1);
