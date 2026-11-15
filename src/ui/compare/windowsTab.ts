// The "Window table" tab: every sunlit and dark spell, every passage of Earth in front of the
// Sun, and every spell with Earth's centre in view or hidden, for the scenario on screen or for
// slot A or B, with UTC start, end and duration. A spell that runs past an edge of the window is
// shown in full and says so; the part inside the window is beside it. Download as CSV or JSON.
// The rows come from windowTable.ts (also used by the exportResults action).
import type { SiteAnalysis } from '../../analysis/types';
import { analysis } from '../../core/analysisStore';
import { describeScenario } from '../../core/scenario';
import { store } from '../../core/store';
import { formatUtc } from '../../core/time';
import { el } from '../dom';
import { hoursText } from './format';
import { TABLE_SLOTS, type PanelStore, type TableSlot } from './state';
import { KIND_TEXT, spellRows, type RowGroup, type SpellRow } from './windowTable';
import type { TabKit } from './widgets';

const SLOT_TEXT: Record<TableSlot, string> = { current: 'On screen', A: 'A', B: 'B' };
const GROUP_TITLE: Record<RowGroup, string> = { sun: 'Sun', earth: "Earth's centre" };
const COLUMNS = ['State', 'Start (UTC)', 'End (UTC)', 'Duration', 'Inside the window', 'Note'] as const;

export function mountWindowsTab(root: HTMLElement, panel: PanelStore, kit: TabKit): { render(): void } {
  const { act, button, status } = kit;

  // ---------- whose window ----------
  const pick = el('div', 'ly-seg cmp-slotpick');
  pick.setAttribute('role', 'group');
  pick.setAttribute('aria-label', 'Whose mission window the table shows');
  const pickButtons = new Map<TableSlot, HTMLButtonElement>();
  for (const slot of TABLE_SLOTS) {
    const b = button(SLOT_TEXT[slot], 'ly-btn ly-btn--small', () => void kit.run('openCompare', { tab: 'windows', table: slot }));
    b.setAttribute('aria-label', slot === 'current' ? 'The scenario on screen' : `Scenario ${slot}`);
    pick.append(b);
    pickButtons.set(slot, b);
  }
  const which = el('p', 'cmp-onscreen');
  const state = el('p', 'cmp-state');
  state.setAttribute('role', 'status');

  // ---------- export ----------
  const exportRow = el('div', 'cmp-buttons cmp-export');
  exportRow.setAttribute('role', 'group');
  exportRow.setAttribute('aria-label', 'Download');
  const scopeId = `cmp-scope-${Math.random().toString(36).slice(2, 8)}`;
  const scopeLabel = el('label', 'ly-label', 'Download');
  scopeLabel.htmlFor = scopeId;
  const scope = el('select', 'ly-select cmp-scope');
  scope.id = scopeId;
  const thisTable = new Option('this table', 'table');
  const both = new Option('A and B together', 'AB');
  scope.append(thisTable, both);
  const download = (format: 'csv' | 'json') => {
    const slot = scope.value === 'AB' ? 'AB' : panel.get().tableSlot;
    void act('exportResults', { format, slot }, (r) => `Downloaded ${r.filename} (${(r.bytes / 1024).toFixed(1)} kB, ${r.spells} spells).`);
  };
  const csv = button('CSV', 'ly-btn ly-btn--small', () => download('csv'));
  csv.setAttribute('aria-label', 'Download as CSV');
  const json = button('JSON', 'ly-btn ly-btn--small', () => download('json'));
  json.setAttribute('aria-label', 'Download as JSON');
  exportRow.append(scopeLabel, scope, csv, json);
  const exportNote = el('p', 'ly-note', 'CSV: one row per spell, the scenario on every row. JSON: the scenario, metrics, events with which instant each is, every spell, the requirements, data sources, assumptions and warnings. Times UTC to the second, longitudes east-positive.');

  const head = el('div', 'cmp-tablehead');
  head.append(pick, exportRow);

  const tables = el('div', 'cmp-spells');
  const legend = el(
    'p',
    'ly-note',
    "Sunlit: some of the Sun's disc above the terrain skyline and not wholly behind Earth. Earth's centre in view: geometric line of sight to the centre of Earth's disc, not a radio link. A spell that runs past an edge of the mission window is given in full, followed with the in-app model up to 60 days beyond the edge; its part inside the window is beside it.",
  );
  root.append(head, exportNote, status, which, state, tables, legend);

  const cell = (role: string, className: string, label: string, content: string) => {
    const c = el('div', className, content);
    c.setAttribute('role', role);
    c.dataset.label = label;
    return c;
  };

  const startText = (r: SpellRow) => (!r.startFound ? `before ${formatUtc(r.startMs)} (no start found)` : `${formatUtc(r.startMs)}${r.runsPastStart ? ', before the window' : ''}`);
  const endText = (r: SpellRow) => (!r.endFound ? `after ${formatUtc(r.endMs)} (no end found)` : `${formatUtc(r.endMs)}${r.runsPastEnd ? ', after the window' : ''}`);
  const insideText = (r: SpellRow) => (r.runsPastStart || r.runsPastEnd ? `${hoursText(r.windowHours)}, ${formatUtc(r.windowStartMs).replace(' UTC', '')} to ${formatUtc(r.windowEndMs)}` : 'all of it');

  const groupTable = (group: RowGroup, rows: SpellRow[]) => {
    const section = el('section', 'cmp-spellgroup');
    const title = el('h3', 'ly-section-title', `${GROUP_TITLE[group]}: ${rows.length} spell${rows.length === 1 ? '' : 's'}`);
    const table = el('div', 'cmp-stable');
    table.setAttribute('role', 'table');
    table.setAttribute('aria-label', `${GROUP_TITLE[group]} spells in the mission window`);
    const headRow = el('div', 'cmp-srow cmp-shead');
    headRow.setAttribute('role', 'row');
    headRow.append(...COLUMNS.map((c) => cell('columnheader', 'cmp-std', c, c)));
    table.append(headRow);
    for (const r of rows) {
      const tr = el('div', `cmp-srow is-${r.kind}`);
      tr.setAttribute('role', 'row');
      tr.append(
        cell('rowheader', 'cmp-std cmp-sstate', COLUMNS[0], KIND_TEXT[r.kind]),
        cell('cell', 'cmp-std ly-value', COLUMNS[1], startText(r)),
        cell('cell', 'cmp-std ly-value', COLUMNS[2], endText(r)),
        cell('cell', 'cmp-std ly-value', COLUMNS[3], `${r.startFound && r.endFound ? '' : 'at least '}${hoursText(r.hours)}`),
        cell('cell', 'cmp-std ly-value', COLUMNS[4], insideText(r)),
        cell('cell', 'cmp-std cmp-snote', COLUMNS[5], r.note),
      );
      table.append(tr);
    }
    section.append(title, table);
    return section;
  };

  let drawn: SiteAnalysis | null = null;
  const render = () => {
    const slot = panel.get().tableSlot;
    const s = store.get();
    for (const [k, b] of pickButtons) {
      b.setAttribute('aria-pressed', String(k === slot));
      b.disabled = k === 'A' ? !s.compareA : k === 'B' ? !s.compareB : false;
    }
    both.disabled = !s.compareA || !s.compareB;
    if (both.disabled && scope.value === 'AB') scope.value = 'table';

    const want = analysis.wanted(slot);
    const st = analysis.get(slot);
    const whose = slot === 'current' ? 'The scenario on screen' : `Scenario ${slot}`;
    which.replaceChildren(el('span', 'ly-label', `${whose}: `), document.createTextNode(want ? describeScenario(want) : 'none'));
    let value: SiteAnalysis | null = null;
    if (!want) state.textContent = slot === 'current' ? 'No site is selected. Select a landing site or drop a pin.' : `Slot ${slot} is empty. Save a scenario there on the "A and B" tab.`;
    else if (st.state === 'idle' || st.state === 'loading' || st.scenario.id !== want.id) state.textContent = 'Analysing the skyline, sunlight and Earth visibility…';
    else if (st.state === 'error') state.textContent = `Not available: ${st.error}`;
    else {
      state.textContent = '';
      value = st.value;
    }
    state.classList.toggle('is-error', st.state === 'error' && Boolean(want) && st.scenario.id === want?.id);
    csv.disabled = json.disabled = !value && scope.value !== 'AB';
    if (value === drawn) return;
    drawn = value;
    if (!value) {
      tables.replaceChildren();
      return;
    }
    const rows = spellRows(value);
    tables.replaceChildren(groupTable('sun', rows.filter((r) => r.group === 'sun')), groupTable('earth', rows.filter((r) => r.group === 'earth')));
  };
  scope.addEventListener('change', () => render());

  return { render };
}
