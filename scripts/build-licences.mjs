// Writes public/licences/THIRD-PARTY-NOTICES.txt: the licence of every third-party package whose
// code or files are part of the built website, with the licence text taken from the installed
// package. Vite copies public/ into the build as it is, so the file ships at
// /licences/THIRD-PARTY-NOTICES.txt.
//
//   node scripts/build-licences.mjs           write the file
//   node scripts/build-licences.mjs --check   exit 1 if the file is missing or out of date
//
// Run it after adding, removing or upgrading a dependency. Which packages ship is read from the
// app's own source: every package imported by src/ (tests left out), with the packages those
// depend on, plus the two build tools whose own code the bundle contains. The server code
// (server/) is not part of the website files and is not listed.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const NOTICES_FILE = 'public/licences/THIRD-PARTY-NOTICES.txt';

/** The tools that build the bundle and put some of their own code into it. */
const BUILD_TOOLS = [
  { name: 'vite', why: 'Builds the website. Its module-preload helper is part of the main script.' },
  { name: 'rolldown', why: 'Bundles the scripts for Vite. Its module runtime helpers can be part of the scripts.' },
];

/** Parts of a licence file that are about something else than the package's own code. */
const TRIM = {
  // Vite's file goes on with the licences of the packages bundled into Vite itself, which are not in this website.
  vite: (text) => text.split(/^# Licenses of bundled dependencies/m)[0],
};

const SOURCE_EXT = /\.(ts|tsx|js|mjs|css)$/;
const SPECIFIERS = [
  /\b(?:import|export)\s[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /@import\s+(?:url\()?\s*['"]([^'"]+)['"]/g,
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (SOURCE_EXT.test(name) && !/\.test\.[a-z]+$/.test(name)) out.push(path);
  }
  return out;
}

/** "three/examples/jsm/x.js" -> "three"; "@scope/pkg/sub" -> "@scope/pkg"; null for relative, absolute and built-in specifiers. */
export function packageName(specifier) {
  if (/^(\.|\/|node:|virtual:|data:|https?:)/.test(specifier) || specifier.startsWith('\0')) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? (parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null) : parts[0];
}

/** The packages the app's source imports directly, sorted. */
export function importedPackages(root = ROOT) {
  const names = new Set();
  for (const file of walk(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const re of SPECIFIERS) {
      for (const m of text.matchAll(re)) {
        const name = packageName(m[1]);
        if (name) names.add(name);
      }
    }
  }
  return [...names].sort();
}

function packageDir(root, name, from) {
  // Node's lookup: the package's own node_modules first, then the project's.
  for (const base of [from && join(from, 'node_modules'), join(root, 'node_modules')]) {
    if (base && existsSync(join(base, name, 'package.json'))) return join(base, name);
  }
  throw new Error(`Package "${name}" is imported but not installed (run npm ci).`);
}

function licenceTexts(dir, name) {
  const files = readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying|notice)([._-].*)?$/i.test(f) && !/third[-_]?party/i.test(f))
    .sort();
  return files.map((file) => {
    let text = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');
    if (TRIM[name]) text = TRIM[name](text);
    return { file, text: text.trim() };
  });
}

/**
 * A package without a licence file may carry its licence in a comment at the top of its main
 * script (astronomy-engine does, marked @preserve). That comment is the licence text then.
 */
function headerLicence(dir, pkg) {
  const entry = [pkg.main, typeof pkg.exports?.['.']?.require === 'string' ? pkg.exports['.'].require : null, 'index.js'].find((f) => f && existsSync(join(dir, f)));
  if (!entry) return [];
  const head = readFileSync(join(dir, entry), 'utf8').slice(0, 20000);
  const m = /^\s*\/\*\*?([\s\S]*?)\*\//.exec(head);
  if (!m || !/@preserve|@license|licen[cs]e|copyright/i.test(m[1])) return [];
  const lines = m[1].replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/^\s*\* ?/, '').replace(/^ {4}/, '')).filter((l) => !/^\s*@preserve\s*$/.test(l));
  return [{ file: `${entry} (header comment)`, text: lines.join('\n').trim() }];
}

function describe(root, name, from, why) {
  const dir = packageDir(root, name, from);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const licence = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'not stated';
  const files = licenceTexts(dir, name);
  return { name, version: pkg.version, licence, home: pkg.homepage ?? repo ?? null, why, dir, deps: Object.keys(pkg.dependencies ?? {}), texts: files.length ? files : headerLicence(dir, pkg) };
}

/** Everything that ships, with the packages they depend on, in a stable order. */
export function shippedPackages(root = ROOT) {
  const seen = new Map();
  const add = (name, from, why) => {
    if (seen.has(name)) return;
    const p = describe(root, name, from, why);
    seen.set(name, p);
    for (const dep of p.deps) add(dep, p.dir, `Needed by ${name}.`);
  };
  for (const name of importedPackages(root)) add(name, null, 'Imported by the website\'s code.');
  const app = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  const tools = BUILD_TOOLS.map((t) => describe(root, t.name, null, t.why));
  return { app, tools };
}

const RULE = '='.repeat(78);
const THIN = '-'.repeat(78);

/** The notices file, from the installed packages. No dates, so the same packages give the same file. */
export function renderNotices(root = ROOT) {
  const { app, tools } = shippedPackages(root);
  const line = (p) => `  ${p.name} ${p.version} (${p.licence})`;
  const out = [
    'Third-party software in the Lunyx website',
    RULE,
    '',
    'The Lunyx website contains the software listed below, written by others. Each entry gives',
    'the package, the version that was installed when this file was made, its licence, and the',
    'licence text as the package itself ships it.',
    '',
    'This file is generated from the installed packages by scripts/build-licences.mjs; do not',
    'edit it by hand. The data the website shows (elevation models, images, ephemerides,',
    'catalogues) are credited where they are shown. In the source repository,',
    'docs/lunyx/SOURCES.md is the full register of every source with its licence and how it',
    'was checked, and docs/DATA_SOURCES.md describes the bundled data files.',
    '',
    'In the website\'s code and files:',
    ...app.map(line),
    '',
    'Build tools whose own code is part of the website\'s scripts:',
    ...tools.map(line),
    '',
  ];
  for (const p of [...app, ...tools]) {
    out.push(RULE, `${p.name} ${p.version}`, `Licence: ${p.licence}`);
    if (p.home) out.push(`Home: ${p.home.replace(/^git\+/, '')}`);
    out.push(p.why, THIN);
    if (!p.texts.length) out.push(`(The package ships no licence text; its package.json states: ${p.licence}.)`);
    for (const t of p.texts) out.push(...(p.texts.length > 1 || / \(header comment\)$/.test(t.file) ? [`[${t.file}]`] : []), t.text, '');
    out.push('');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const path = join(ROOT, NOTICES_FILE);
  const text = renderNotices();
  if (process.argv.includes('--check')) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (current !== text) {
      console.error(`${NOTICES_FILE} is ${current === null ? 'missing' : 'out of date'}: run node scripts/build-licences.mjs`);
      process.exit(1);
    }
    console.log(`${NOTICES_FILE} is up to date.`);
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    const { app, tools } = shippedPackages();
    console.log(`Wrote ${NOTICES_FILE}: ${app.map((p) => `${p.name} ${p.version}`).join(', ')}; build tools: ${tools.map((p) => `${p.name} ${p.version}`).join(', ')}.`);
  }
}
