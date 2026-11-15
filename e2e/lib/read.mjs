// Readers for what the panels show, as a person sees it, and comparisons of those values with
// the analysis the app itself published. Shared by the e2e tests and the QA walkthrough
// (e2e/qa/walkthrough.mjs), so both read the screen the same way.
//
// The comparisons return plain rows { what, shown, expected, pass }: a test asserts on them,
// the walkthrough records them.

/** First number in a text; the typographic minus is read as a minus, thousands commas dropped. */
export function firstNumber(text) {
  const m = /[-−]?\d+(?:\.\d+)?/.exec(String(text ?? '').replace(/,(?=\d{3})/g, ''));
  return m ? Number(m[0].replace('−', '-')) : NaN;
}

/** "18.2 h", "379.8 h (15.8 d)", "18.2 h or more", "none" -> hours. */
export const hoursOf = (text) => (/^none\b/.test(String(text ?? '').trim()) ? 0 : firstNumber(text));

export const close = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;

/** "2025-03-06 17:28 UTC" for a time in ms, as the app writes it (truncated to the minute). */
export const utcText = (ms) => `${new Date(ms).toISOString().slice(0, 10)} ${new Date(ms).toISOString().slice(11, 16)} UTC`;

/** The compare panel: open or not, the tabs, the A / B / B − A rows by label, the sentences and requirement lines. */
export function readCompare(page) {
  return page.evaluate(() => {
    const sheet = document.querySelector('.cmp-sheet');
    if (!sheet || sheet.hidden) return { open: false };
    const table = sheet.querySelector('[role="table"][aria-label^="Scenarios A and B"]');
    const rows = {};
    for (const tr of table?.querySelectorAll('.cmp-row:not(.cmp-headrow):not(.cmp-grouprow)') ?? []) {
      const [th, a, b, d] = [...tr.children];
      rows[th.textContent.trim()] = { a: a?.textContent.trim(), b: b?.textContent.trim(), delta: d?.firstChild?.textContent?.trim() ?? '', tone: [...(d?.classList ?? [])].find((c) => c.startsWith('tone-')) ?? null };
    }
    return {
      open: true,
      tabs: [...sheet.querySelectorAll('.cmp-tab')].map((t) => ({ text: t.textContent.trim(), selected: t.getAttribute('aria-selected') === 'true' })),
      heads: [...(table?.querySelectorAll('.cmp-headrow .cmp-side') ?? [])].map((h) => h.textContent.trim().replace(/\s+/g, ' ')),
      rows,
      state: sheet.querySelector('.cmp-state')?.textContent.trim() ?? '',
      highlights: [...sheet.querySelectorAll('.cmp-highlights li')].map((li) => li.textContent.trim()),
      flags: [...sheet.querySelectorAll('.cmp-flags li')].map((li) => li.textContent.trim()),
      status: [...sheet.querySelectorAll('.cmp-status')].map((s) => s.textContent.trim()).filter(Boolean),
    };
  });
}

/** The published comparison, reduced to what the table shows: { state, a, b } or { state, error }. */
export function publishedComparison(page) {
  return page.evaluate(() => {
    const c = window.lunyx.analysis.comparison();
    if (c.state !== 'ready') return { state: c.state, error: c.error ?? null };
    const side = (x) => JSON.parse(JSON.stringify({ metrics: x.metrics, slope: x.slope, horizon: { siteElevationM: x.horizon.siteElevationM }, scenario: { id: x.scenario.id, site: x.scenario.site, startMs: x.scenario.startMs, durationH: x.scenario.durationH, mastHeightM: x.scenario.mastHeightM } }));
    return { state: 'ready', a: side(c.a), b: side(c.b) };
  });
}

/** Waits until the comparison is ready (or failed) and returns it. */
export async function settledComparison(page, timeout = 300_000) {
  await page.waitForFunction(() => ['ready', 'error'].includes(window.lunyx.analysis.comparison().state), null, { polling: 200, timeout });
  return publishedComparison(page);
}

/** The compare table's figures against the two published analyses and their difference. */
export function compareRowsAgainst(view, pub) {
  // Each figure with the labels it has had (the T-31 wording rule renamed "Earth in view").
  const lines = [
    [['Sunlight'], (x) => x.metrics.illuminationPct, firstNumber, 0.051],
    [['Any Sun above the skyline'], (x) => x.metrics.sunAnyPct, firstNumber, 0.051],
    [['Longest darkness in the window'], (x) => x.metrics.longestDarknessH, hoursOf, 0.051],
    [["Earth's centre in view", 'Earth in view'], (x) => x.metrics.earthVisiblePct, firstNumber, 0.051],
    [['Longest Earth gap in the window'], (x) => x.metrics.longestEarthGapH, hoursOf, 0.051],
    [['Ground slope', 'Slope'], (x) => x.slope.slopeDeg, firstNumber, 0.051],
    [['Site elevation'], (x) => x.horizon.siteElevationM, firstNumber, 0.51],
  ];
  const out = [];
  for (const [labels, value, parse, tol] of lines) {
    const label = labels.find((l) => view.rows?.[l]) ?? labels[0];
    const row = view.rows?.[label];
    if (!row) {
      out.push({ what: `compare table: row "${labels.join('" or "')}"`, shown: 'missing', expected: 'a row', pass: false });
      continue;
    }
    const va = value(pub.a), vb = value(pub.b), d = vb - va;
    out.push({ what: `compare table: ${label}, A`, shown: row.a, expected: va, pass: close(parse(row.a), va, tol) });
    out.push({ what: `compare table: ${label}, B`, shown: row.b, expected: vb, pass: close(parse(row.b), vb, tol) });
    out.push({ what: `compare table: ${label}, B − A`, shown: row.delta, expected: Math.round(d * 10) / 10, pass: row.delta === '' ? !Number.isFinite(d) : close(firstNumber(row.delta), d, tol + 0.05) });
  }
  return out;
}

/** A requirement line without its status word ("Met: ", "Not met: ", "No requirement: "). */
const lineBody = (f) => f.replace(/^(?:Met|Not met|No requirement|Unknown|Cannot check)\s*:\s*/i, '');

/** The requirement lines of the compare panel against the limits and the two analyses (slope and Earth gap). */
export function requirementLinesAgainst(view, pub, limits) {
  const out = [];
  const flags = (view.flags ?? []).map(lineBody);
  for (const [slot, x] of [['A', pub.a], ['B', pub.b]]) {
    const slopeLine = flags.find((f) => f.startsWith(`${slot}: the slope`));
    const slope = x.slope.slopeDeg;
    const over = Number.isFinite(slope) && slope > limits.slopeLimitDeg;
    out.push({ what: `requirements: ${slot} slope against the ${limits.slopeLimitDeg}° limit`, shown: slopeLine ?? 'no line', expected: `${slope.toFixed(1)}° ${over ? 'over' : 'within'}`, pass: Boolean(slopeLine && (over ? /is over the/.test(slopeLine) : /is within the/.test(slopeLine))) });
    if (limits.maxEarthGapH !== null && limits.maxEarthGapH !== undefined) {
      const gapLine = flags.find((f) => f.startsWith(`${slot}: the longest Earth gap`));
      const gapOver = x.metrics.longestEarthGapH > limits.maxEarthGapH;
      out.push({ what: `requirements: ${slot} Earth gap against the ${limits.maxEarthGapH} h limit`, shown: gapLine ?? 'no line', expected: `${x.metrics.longestEarthGapH.toFixed(1)} h ${gapOver ? 'over' : 'within'}`, pass: Boolean(gapLine && (gapOver ? /is over the/.test(gapLine) : /is within the/.test(gapLine))) });
    }
  }
  return out;
}

/** The "Nearby sites" tab: its summary line and the ranked rows by column. */
export function readNearby(page) {
  return page.evaluate(() => {
    const table = document.querySelector('[role="table"][aria-label="Ranked nearby alternatives"]');
    if (!table) return null;
    const rows = [...table.querySelectorAll('.cmp-nrow:not(.cmp-nhead)')].map((tr) => Object.fromEntries([...tr.children].map((c) => [c.dataset.label, c.textContent.trim().replace(/\s+/g, ' ')])));
    return { summary: document.querySelector('.cmp-nearbysummary')?.textContent.trim() ?? '', rows };
  });
}

/** The published scan: every candidate with the figures the list shows, best score first, rejected ones last. */
export function publishedNearby(page) {
  return page.evaluate(() => {
    const n = window.lunyx.analysis.nearby();
    if (n.state !== 'ready') return { state: n.state, error: n.error ?? null };
    const rows = n.value.map((c) => ({ id: c.site.id, reference: Boolean(c.isReference), lat: c.site.lat, lon: c.site.lon, rejected: c.rejected, slopeDeg: c.slope.slopeDeg, illuminationPct: c.metrics?.illuminationPct ?? NaN, longestDarknessH: c.metrics?.longestDarknessH ?? NaN, earthVisiblePct: c.metrics?.earthVisiblePct ?? NaN, longestEarthGapH: c.metrics?.longestEarthGapH ?? NaN, score: c.score }));
    return { state: 'ready', options: JSON.parse(JSON.stringify(n.options ?? null)), rows };
  });
}

/** The first ranked row of the list against the best-scoring alternative of the scan. */
export function nearbyRank1Against(view, scan) {
  const ranked = scan.rows.filter((c) => !c.reference && !c.rejected && Number.isFinite(c.score)).sort((a, b) => b.score - a.score);
  const shown = view?.rows.find((r) => r.Rank === '1');
  const best = ranked[0];
  if (!shown || !best) return [{ what: 'nearby list: a rank 1 row and a ranked alternative', shown: JSON.stringify(view?.rows?.slice(0, 2) ?? null), expected: 'both', pass: false }];
  return [
    { what: 'nearby list: rank 1 score = best scan score', shown: shown.Score, expected: best.score, pass: close(firstNumber(shown.Score), best.score, 0.051) },
    { what: 'nearby list: rank 1 sunlight', shown: shown.Sunlight, expected: best.illuminationPct, pass: close(firstNumber(shown.Sunlight), best.illuminationPct, 0.051) },
    { what: "nearby list: rank 1 Earth's centre in view", shown: shown["Earth's centre in view"], expected: best.earthVisiblePct, pass: close(firstNumber(shown["Earth's centre in view"]), best.earthVisiblePct, 0.051) },
    { what: 'nearby list: rank 1 longest darkness', shown: shown['Longest darkness'], expected: best.longestDarknessH, pass: close(hoursOf(shown['Longest darkness']), best.longestDarknessH, 0.051) },
    { what: 'nearby list: rank 1 slope', shown: shown.Slope, expected: best.slopeDeg, pass: close(firstNumber(shown.Slope), best.slopeDeg, 0.051) },
  ];
}

/** The surface "Key metrics" panel. */
export function readKeyMetrics(page) {
  return page.evaluate(() => {
    const p = document.querySelector('.km');
    if (!p) return null;
    const now = {};
    for (const tr of p.querySelectorAll('.km-now tbody tr:not(.km-state)')) {
      if (tr.hidden) continue;
      const [az, el, clear] = [...tr.querySelectorAll('td')].map((td) => td.textContent.trim());
      now[tr.querySelector('th')?.textContent.trim()] = { az, el, clear };
    }
    return {
      open: !p.querySelector('.km-body')?.hidden,
      site: p.querySelector('.km-site')?.textContent.trim(),
      headings: [...p.querySelectorAll('.km-body h3')].filter((h) => !h.hidden).map((h) => h.textContent.trim()),
      now,
      states: [...p.querySelectorAll('.km-now tr.km-state')].filter((t) => !t.hidden).map((t) => t.textContent.trim().replace(/\s+/g, ' ')),
      counts: [...p.querySelectorAll('.km-count li')].map((li) => ({ label: li.querySelector('.km-count-label')?.textContent.trim(), when: li.querySelector('.km-count-in')?.textContent.trim(), at: li.querySelector('.km-count-at')?.textContent.trim(), disabled: Boolean(li.querySelector('button')?.disabled) })),
      win: Object.fromEntries([...p.querySelectorAll('.km-win dt')].map((dt) => [dt.textContent.trim(), dt.nextElementSibling?.textContent.trim()])),
      flags: [...p.querySelectorAll('.km-flags li')].map((li) => li.textContent.trim()),
    };
  });
}

/**
 * Key metrics against getAnalysis (`a`): Sun and Earth now (azimuth to 0.1°, elevation and
 * clearance to 0.01°), the four countdowns (label of the instant and its UTC minute) and the
 * mission-window figures.
 */
export function keyMetricsAgainst(km, a) {
  const out = [];
  for (const [row, body] of [['Sun', 'sun'], ['Earth', 'earth']]) {
    const r = km?.now?.[row];
    const n = a.now[body];
    out.push({ what: `key metrics: ${row} azimuth`, shown: r?.az, expected: n.azDeg, pass: close(firstNumber(r?.az), n.azDeg, 0.06) });
    out.push({ what: `key metrics: ${row} elevation`, shown: r?.el, expected: n.elDeg, pass: close(firstNumber(r?.el), n.elDeg, 0.011) });
    out.push({ what: `key metrics: ${row} above the skyline`, shown: r?.clear, expected: n.clearanceDeg, pass: close(firstNumber(r?.clear), n.clearanceDeg, 0.011) });
  }
  for (const [k, type] of ['sunset', 'sunrise', 'earthset', 'earthrise'].entries()) {
    const c = km?.counts?.[k], e = a.nextEvents?.[type];
    if (!e) out.push({ what: `key metrics: countdown ${type}, none ahead`, shown: `${c?.when} (${c?.disabled ? 'disabled' : 'enabled'})`, expected: 'disabled', pass: c?.disabled === true });
    else out.push({ what: `key metrics: countdown ${type}`, shown: c?.at, expected: `${e.label} · ${utcText(Date.parse(e.timeUtc))}`, pass: c?.at === `${e.label} · ${utcText(Date.parse(e.timeUtc))}` });
  }
  const m = a.metrics;
  const tolH = (h) => (h < 0.05 ? 0.05 : 0.051);
  out.push({ what: 'key metrics: Sunlight', shown: km?.win?.Sunlight, expected: m.illuminationPct, pass: close(firstNumber(km?.win?.Sunlight), m.illuminationPct, 0.051) });
  out.push({ what: 'key metrics: Longest darkness', shown: km?.win?.['Longest darkness'], expected: m.longestDarknessH, pass: close(hoursOf(km?.win?.['Longest darkness']), m.longestDarknessH, tolH(m.longestDarknessH)) });
  out.push({ what: "key metrics: Earth's centre in sight", shown: km?.win?.["Earth's centre in sight"], expected: m.earthVisiblePct, pass: close(firstNumber(km?.win?.["Earth's centre in sight"]), m.earthVisiblePct, 0.051) });
  out.push({ what: 'key metrics: Longest Earth gap', shown: km?.win?.['Longest Earth gap'], expected: m.longestEarthGapH, pass: close(hoursOf(km?.win?.['Longest Earth gap']), m.longestEarthGapH, tolH(m.longestEarthGapH)) });
  out.push({ what: 'key metrics: Slope', shown: km?.win?.Slope, expected: a.slope.slopeDeg, pass: close(firstNumber(km?.win?.Slope), a.slope.slopeDeg, 0.051) });
  return out;
}

/** Turns failed comparison rows into one readable message (for assert.ok). */
export function failures(rows) {
  const bad = rows.filter((r) => !r.pass);
  return bad.length ? bad.map((r) => `${r.what}: screen ${JSON.stringify(r.shown)}, analysis ${JSON.stringify(r.expected)}`).join('\n') : '';
}
