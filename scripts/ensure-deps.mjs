// Runs before `npm run build` (npm "prebuild" hook). Makes the build work from a clean
// checkout or after the lockfile changed: if any direct dependency is missing or is not
// the version the lockfile pins, it runs `npm ci`. Otherwise it does nothing (a few ms).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

function stale() {
  const pkg = read('package.json');
  const lock = read('package-lock.json');
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    const wanted = lock.packages?.[`node_modules/${name}`]?.version;
    const manifest = join('node_modules', name, 'package.json');
    if (!existsSync(join(ROOT, manifest))) return `${name} is not installed`;
    const have = read(manifest).version;
    if (wanted && have !== wanted) return `${name} is ${have}, lockfile pins ${wanted}`;
  }
  return null;
}

const reason = stale();
if (reason) {
  console.log(`[ensure-deps] ${reason}: running npm ci`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['ci', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('[ensure-deps] npm ci failed');
    process.exit(r.status ?? 1);
  }
}
