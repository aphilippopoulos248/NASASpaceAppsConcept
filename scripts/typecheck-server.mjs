// Part of `npm run build`: type-checks the server side (server/**, vite.config.ts) with
// its own tsconfig, because the browser tsconfig only covers src/. Does nothing until a
// tsconfig.server.json exists at the repository root.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(join(ROOT, 'tsconfig.server.json'))) process.exit(0);

// Run TypeScript's own launcher with this Node: on Windows, Node refuses to spawn the .cmd shim
// without a shell (EINVAL), which made the build fail without a message.
const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const r = spawnSync(process.execPath, [tsc, '--noEmit', '-p', 'tsconfig.server.json'], { cwd: ROOT, stdio: 'inherit' });
if (r.error) console.error('[typecheck-server]', r.error.message);
process.exit(r.status ?? 1);
