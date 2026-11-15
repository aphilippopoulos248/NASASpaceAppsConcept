// Builds an independent record of which state each lander belongs to, from GCAT, the General
// Catalog of Artificial Space Objects by Jonathan C. McDowell (https://planet4589.org/space/gcat/,
// licence CC BY 4.0). GCAT records, for every object, its owner organisation and the "responsible
// state": the country accountable for it under the Outer Space Treaty.
//
// Output: public/data/sources/gcat-landers.json. Values are copied from GCAT as they are; the only
// additions are the readable names of the codes, looked up in GCAT's own organisation table.
// public/data/landings.json is never modified; the two files are linked only by the ids below.
//
// (NASA's NSSDCA catalogue was tried first, but as of November 2026 it only returns US spacecraft.)
//
// Run with: npm run fetch-gcat
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data', 'sources', 'gcat-landers.json');
const CATALOG_URL = 'https://planet4589.org/space/gcat/tsv/cat/deepcat.tsv';
const ORGS_URL = 'https://planet4589.org/space/gcat/tsv/tables/orgs.tsv';

// Landing id (as in landings.json) -> GCAT JCAT id of the object that remains at the landing site:
// the lander, or for crewed and sample-return missions the descent stage left behind.
const JCAT = {
  'luna-9': 'D00100',
  'surveyor-1': 'D00110',
  'luna-13': 'D00140',
  'surveyor-3': 'D00150',
  'surveyor-5': 'D00180',
  'surveyor-6': 'D00182',
  'surveyor-7': 'D00190',
  'apollo-11': 'D00271', // LM 5 descent stage
  'apollo-12': 'D00300', // LM 6 descent stage
  'luna-16': 'D00334', // landing stage (KT)
  'luna-17': 'D00342',
  'apollo-14': 'D00356', // LM 8 descent stage
  'apollo-15': 'D00388', // LM 10 descent stage
  'luna-20': 'D00427', // landing stage (KT)
  'apollo-16': 'D00450', // LM 11 descent stage
  'apollo-17': 'D00465', // LM 12 descent stage
  'luna-21': 'D00482',
  'luna-23': 'D00522', // landing stage (KT)
  'luna-24': 'D00566', // landing stage (KT)
  'change-3': 'D00934',
  'change-4': 'D01017',
  'change-5': 'D01047', // lander
  'chandrayaan-3': 'D01126',
  slim: 'D01131',
  'im-1': 'D01149',
  'change-6': 'D01159', // lander
  'blue-ghost-1': 'D01178',
  'im-2': 'D01180',
};

async function tsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split('\n');
  const header = lines[0].replace(/^#/, '').split('\t').map((h) => h.trim());
  const updated = lines.find((l) => l.startsWith('# Updated'))?.replace('# ', '') ?? null;
  const rows = lines
    .slice(1)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => Object.fromEntries(l.split('\t').map((v, i) => [header[i], v.trim()])));
  return { rows, updated };
}

const catalog = await tsv(CATALOG_URL);
const orgs = await tsv(ORGS_URL);
const byJcat = new Map(catalog.rows.map((r) => [r.JCAT, r]));
const org = (code) => orgs.rows.find((o) => o.Code === code) ?? null;
// GCAT marks empty fields with "-".
const val = (v) => (v && v !== '-' ? v : null);
const englishName = (o) => val(o.EName) ?? val(o.Name) ?? val(o.ShortEName) ?? val(o.ShortName) ?? o.Code;
// Owner codes can be compound ("IKI/BABTS" is IKI with BABTS); name each part.
const orgName = (code) => {
  const whole = org(code);
  if (whole) return englishName(whole);
  const parts = code.split('/').map((c) => org(c)).filter(Boolean);
  return parts.length ? parts.map(englishName).join(' / ') : null;
};

const records = [];
for (const [landing, jcat] of Object.entries(JCAT)) {
  const r = byJcat.get(jcat);
  if (!r) throw new Error(`${landing}: ${jcat} not found in GCAT`);
  const stateOrg = org(r.State);
  records.push({
    landing,
    jcat,
    piece: r.Piece,
    name: r.Name,
    altName: r.PLName,
    owner: r.Owner,
    ownerName: orgName(r.Owner),
    state: r.State,
    stateName: stateOrg ? val(stateOrg.ShortEName) ?? val(stateOrg.ShortName) : null,
    stateFullName: stateOrg ? val(stateOrg.EName) ?? val(stateOrg.Name) : null,
    stateExisted: stateOrg ? { from: stateOrg.TStart, to: stateOrg.TStop } : null,
    launchDate: r.LDate,
    status: r.Status,
  });
  console.log(`${landing.padEnd(14)} ${jcat}  ${r.Name.padEnd(22)} owner ${r.Owner.padEnd(11)} state ${r.State.padEnd(3)} ${stateOrg?.ShortEName ?? ''}  ${orgName(r.Owner) ?? '?'}`);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  JSON.stringify(
    {
      source: 'GCAT: General Catalog of Artificial Space Objects, Jonathan C. McDowell',
      sourceUrl: 'https://planet4589.org/space/gcat/',
      files: [CATALOG_URL, ORGS_URL],
      catalogVersion: catalog.updated,
      licence: 'CC BY 4.0 (attribution required)',
      retrieved: new Date().toISOString(),
      note: '"state" is GCAT\'s responsible-state code for the object left at each landing site; "owner" is its owning organisation. Copied unchanged; names come from GCAT\'s organisation table.',
      records,
    },
    null,
    1,
  ) + '\n',
);
console.log(`wrote ${OUT}`);
