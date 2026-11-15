// The "A and B" tab: the two saved scenarios side by side with B minus A stated directly, the
// differences in words (the comparison the `compare` action reports), the user's requirements
// checked against each side, the data and assumptions behind the figures, and saved comparisons.
import type { SiteAnalysis } from '../../analysis/types';
import { analysis } from '../../core/analysisStore';
import { describeScenario, scenarioFromState } from '../../core/scenario';
import { store } from '../../core/store';
import { formatUtc, isoUtc } from '../../core/time';
import type { Scenario } from '../../core/types';
import { el } from '../dom';
import { basisOf, nowRows, requirementLines, SCIENCE, scenarioRows, splitAssumptions, windowRows, type CompareRow, type RequirementLine } from './model';
import { redrawKeepingFocus } from './focus';
import type { CompareStorage } from './storage';
import { badge, nextId, rowGroup, type TabKit } from './widgets';

type SlotName = 'A' | 'B';

/** One side of the comparison as the panel shows it: never a number without a finished analysis behind it. */
export interface Side {
  slot: SlotName;
  scenario: Scenario | null;
  value: SiteAnalysis | null;
  status: 'empty' | 'loading' | 'ready' | 'error';
  error?: string;
}

export function sideOf(slot: SlotName): Side {
  const scenario = analysis.wanted(slot);
  if (!scenario) return { slot, scenario: null, value: null, status: 'empty' };
  const st = analysis.get(slot);
  // A slot that still shows the scenario it held before is waiting for its analysis to start.
  if (st.state === 'idle' || st.state === 'loading' || st.scenario.id !== scenario.id) return { slot, scenario, value: null, status: 'loading' };
  if (st.state === 'error') return { slot, scenario, value: null, status: 'error', error: st.error };
  return { slot, scenario, value: st.value, status: 'ready' };
}

const list = (ul: HTMLElement, items: readonly string[]) => ul.replaceChildren(...items.map((t) => el('li', undefined, t)));

export interface AbTab {
  /** The slot buttons and the "B from A" controls: follows the scenario on screen and the slots. */
  renderSetup(): void;
  /** Everything that follows the two analyses and the requirements. */
  renderResult(): void;
  /** The rows at the shared clock. */
  renderNow(): void;
  renderSaved(): void;
  renderRequirementInputs(): void;
}

export function mountAbTab(root: HTMLElement, storage: CompareStorage, kit: TabKit): AbTab {
  const { act, button, numberField, status } = kit;

  // ---------- set-up: fill the slots ----------
  const setup = el('section', 'cmp-setup');
  setup.setAttribute('aria-label', 'Scenarios to compare');
  const onScreen = el('p', 'cmp-onscreen');
  const saveA = button('Save as A', 'ly-btn ly-btn--small', () => void act('saveScenario', { slot: 'A' }, (r) => `Saved the scenario on screen as A: ${r.scenario.label}.`));
  const saveB = button('Save as B', 'ly-btn ly-btn--small', () => void act('saveScenario', { slot: 'B' }, (r) => `Saved the scenario on screen as B: ${r.scenario.label}.`));
  saveA.setAttribute('aria-label', 'Save the scenario on screen as A');
  saveB.setAttribute('aria-label', 'Save the scenario on screen as B');
  const swap = button('Swap A and B', 'ly-btn ly-btn--small', () => void act('swapComparison', {}, 'Swapped A and B.'));
  const clear = button('Empty A and B', 'ly-btn ly-btn--small', () => void act('clearComparison', {}, 'Slots A and B are empty. Saved comparisons are kept.'));
  const slotButtons = el('div', 'cmp-buttons');
  slotButtons.append(saveA, saveB, swap, clear);

  const delay = numberField('B arrives later than A by', 'h', { min: 1, max: 720, step: 1, value: 24 });
  const delayGo = button('Compare arrivals', 'ly-btn ly-btn--small', () => {
    const h = delay.read();
    if (h === null) return kit.complain('Give the delay in hours.');
    void act('compareDelayedArrival', { delayH: h }, (r) => `B is A arriving ${h} h later: planned ${formatUtc(Date.parse(r.plannedArrivalUtc))}, revised ${formatUtc(Date.parse(r.revisedArrivalUtc))}.`);
  });
  const mast = numberField('B has a mast of', 'm', { min: 0, max: 100, step: 0.5, value: 10 });
  const mastGo = button('Compare masts', 'ly-btn ly-btn--small', () => {
    const m = mast.read();
    if (m === null) return kit.complain('Give the mast height in metres.');
    void act('compareMastHeights', { heightBM: m }, (r) => `B is A with a ${r.mastHeightBM} m mast instead of ${r.mastHeightAM} m, at the same site and over the same window.`);
  });
  for (const [field, go] of [[delay, delayGo], [mast, mastGo]] as const) {
    field.input.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
    field.row.append(go);
  }
  const whatIf = el('div', 'cmp-whatif');
  whatIf.setAttribute('role', 'group');
  whatIf.setAttribute('aria-label', 'Make B from A with one change');
  const whatIfNote = el('p', 'ly-note');
  whatIfNote.id = nextId('note');
  whatIf.setAttribute('aria-describedby', whatIfNote.id);
  whatIf.append(delay.wrap, mast.wrap);
  const controls = el('div', 'cmp-controls');
  controls.append(slotButtons, whatIf);
  setup.append(onScreen, controls, whatIfNote, status);

  // ---------- the table: figure | A | B | B − A ----------
  const table = el('div', 'cmp-table');
  table.setAttribute('role', 'table');
  table.setAttribute('aria-label', 'Scenarios A and B and the difference B minus A');
  const headRow = el('div', 'cmp-row cmp-headrow');
  headRow.setAttribute('role', 'row');
  const columnHead = (cls: string) => {
    const h = el('div', `cmp-colhead ${cls}`);
    h.setAttribute('role', 'columnheader');
    return h;
  };
  const corner = columnHead('cmp-corner');
  corner.append(el('span', 'ly-visually-hidden', 'Figure'));
  const headA = columnHead('cmp-side'), headB = columnHead('cmp-side'), headD = columnHead('cmp-deltahead');
  headD.textContent = 'B − A';
  headD.title = 'The value for B minus the value for A';
  const headGroup = el('div', 'cmp-group cmp-headgroup');
  headGroup.setAttribute('role', 'rowgroup');
  headRow.append(corner, headA, headB, headD);
  headGroup.append(headRow);

  const scenarioGroup = rowGroup(el('div', undefined, 'Scenario'));
  const windowGroup = rowGroup(el('div', undefined, 'Over the mission window'));
  const nowTitle = el('div');
  const nowLabel = el('span');
  const clockButtons = el('span', 'cmp-clockbuttons');
  const toArrival = (slot: SlotName) => {
    const b = button(`Clock to ${slot}'s arrival`, 'ly-btn ly-btn--small', () => {
      const sc = analysis.wanted(slot);
      if (sc) void act('setTime', { utc: isoUtc(sc.startMs) }, `The clock is at ${slot}'s arrival, ${formatUtc(sc.startMs)}.`);
    });
    b.title = `Set the shared clock to the start of ${slot}'s mission window`;
    return b;
  };
  const clockA = toArrival('A'), clockB = toArrival('B');
  clockButtons.append(clockA, clockB);
  nowTitle.append(nowLabel, clockButtons);
  const nowGroup = rowGroup(nowTitle);
  table.append(headGroup, scenarioGroup.group, windowGroup.group, nowGroup.group);

  const legend = el(
    'p',
    'ly-note cmp-legend',
    'B − A is the value for B minus the value for A. Green: B is better on that line (more sunlight or Earth in view, shorter darkness or Earth gap, gentler slope); amber: B is worse. Earth in view is geometric line of sight to Earth\'s centre, not a radio link. A dash means there is no value. The time slider below drives the one clock both sides are read at.',
  );
  const meanings = el('details', 'cmp-more');
  const meaningList = el('dl', 'cmp-meanings');
  meanings.append(el('summary', undefined, 'What each line means'), meaningList);
  const tableColumn = el('div', 'cmp-tablecol');
  tableColumn.append(table, legend, meanings);

  // ---------- differences and requirements, in words ----------
  const words = el('div', 'cmp-wordscol');
  const state = el('p', 'cmp-state');
  state.setAttribute('role', 'status');
  const highlights = el('ul', 'cmp-highlights');
  const NEEDS_NUMBER = { ok: false, error: 'Give a number.' };
  const bandMin = numberField('Sun elevation from', '°', { min: -90, max: 90, step: 0.5 }, async (v) => (v === null ? NEEDS_NUMBER : kit.run('setSunBand', { minDeg: v, maxDeg: store.get().sunElMaxDeg })));
  const bandMax = numberField('to', '°', { min: -90, max: 90, step: 0.5 }, async (v) => (v === null ? NEEDS_NUMBER : kit.run('setSunBand', { minDeg: store.get().sunElMinDeg, maxDeg: v })));
  const maxGap = numberField('Earth gap at most', 'h', { min: 0, max: 8760, step: 1, placeholder: 'none' }, (v) => kit.run('setMaxEarthGap', v === null ? {} : { hours: v }));
  const slopeLimit = numberField('Slope at most', '°', { min: 0, max: 45, step: 0.5 }, async (v) => (v === null ? NEEDS_NUMBER : kit.run('setSlopeLimit', { degrees: v })));
  const reqInputs = el('div', 'cmp-req');
  reqInputs.setAttribute('role', 'group');
  reqInputs.setAttribute('aria-label', 'Requirements the two scenarios are checked against');
  reqInputs.append(bandMin.wrap, bandMax.wrap, maxGap.wrap, slopeLimit.wrap);
  const reqNote = el('p', 'ly-note', 'The Sun\'s elevation is above the local horizontal, over the whole window; 0° to 90° (the default) means no band is set. An empty Earth-gap field means no limit. The same requirements as in Filters.');
  const flags = el('ul', 'cmp-flags');
  words.append(el('h3', 'ly-section-title', 'B against A, in words'), state, highlights, el('h3', 'ly-section-title', 'Requirements'), reqInputs, reqNote, flags);

  const main = el('div', 'cmp-main');
  main.append(tableColumn, words);

  // ---------- where the numbers come from ----------
  const basis = el('div', 'cmp-basis');
  const assumptions = el('div', 'cmp-assumptions');

  // ---------- saved comparisons ----------
  const saveForm = el('form', 'cmp-saveform');
  const nameId = nextId('name');
  const nameLabel = el('label', 'ly-label', 'Name');
  nameLabel.htmlFor = nameId;
  const nameInput = el('input', 'ly-input');
  nameInput.id = nameId;
  nameInput.type = 'text';
  nameInput.maxLength = 80;
  nameInput.autocomplete = 'off';
  const saveBtn = button('Save this comparison', 'ly-btn ly-btn--small');
  saveBtn.type = 'submit';
  saveForm.append(nameLabel, nameInput, saveBtn);
  const savedStatus = el('p', 'cmp-status');
  savedStatus.setAttribute('role', 'status');
  /** Like kit.act, but the outcome is written next to the saved comparisons, where the control is. */
  const actSaved = async (name: string, params: unknown, done: (result: any) => string) => {
    savedStatus.textContent = '';
    const r = await kit.run(name, params);
    savedStatus.classList.toggle('is-error', !r.ok);
    savedStatus.textContent = r.ok ? done((r as { result?: unknown }).result) : (r.error ?? '');
    return r;
  };
  saveForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    void actSaved('saveComparison', name ? { name } : {}, (r) => `${r.replaced ? 'Replaced' : 'Saved'} "${r.saved.name}".${r.droppedOldest ? ` The oldest saved comparison, "${r.droppedOldest}", made room for it.` : ''}${r.note ? ` ${r.note}` : ''}`).then((r) => {
      if (r.ok) nameInput.value = '';
    });
  });
  const savedList = el('ul', 'cmp-saved');
  const savedNote = el('p', 'ly-note');

  root.append(
    setup,
    main,
    el('h3', 'ly-section-title', 'Data behind each side'),
    basis,
    el('h3', 'ly-section-title', 'Assumptions'),
    assumptions,
    el('h3', 'ly-section-title', 'Saved comparisons'),
    saveForm,
    savedStatus,
    savedList,
    savedNote,
  );

  // ====================================================================== rendering
  const renderSetup = () => {
    const s = store.get();
    const current = scenarioFromState(s);
    onScreen.replaceChildren(el('span', 'ly-label', 'On screen: '), document.createTextNode(current ? describeScenario(current) : 'no site is selected. Select a landing site or drop a pin to have a scenario to save.'));
    saveA.disabled = saveB.disabled = !current;
    swap.disabled = clear.disabled = !s.compareA && !s.compareB;
    delayGo.disabled = mastGo.disabled = !(s.compareA ?? current);
    whatIfNote.textContent = s.compareA
      ? `The two fields each make B a copy of A (${s.compareA.label}) with that one change. The scenario on screen is not changed.`
      : current
        ? 'Slot A is empty: the two fields each save the scenario on screen as A and make B a copy with that one change.'
        : 'Select a site first: the two fields each make B a copy of A with one change.';
  };

  const renderRequirementInputs = () => {
    const s = store.get();
    bandMin.show(s.sunElMinDeg);
    bandMax.show(s.sunElMaxDeg);
    maxGap.show(s.maxEarthGapH);
    slopeLimit.show(s.slopeLimitDeg);
  };

  const sideHead = (cell: HTMLElement, side: Side) => {
    const top = el('div', 'cmp-sidetop');
    top.append(badge(side.slot), el('span', 'ly-visually-hidden', `${side.slot}: `), el('span', 'cmp-sidename', side.scenario ? side.scenario.label : 'empty'));
    cell.replaceChildren(top);
    cell.classList.toggle('is-empty', side.status === 'empty');
    const note =
      side.status === 'empty'
        ? `Nothing is saved in slot ${side.slot}.`
        : side.status === 'loading'
          ? 'Analysing the skyline, sunlight and Earth visibility…'
          : side.status === 'error'
            ? `Not available: ${side.error}`
            : '';
    if (note) cell.append(el('div', `cmp-sidenote${side.status === 'error' ? ' is-error' : ''}`, note));
  };

  const basisColumn = (side: Side): HTMLElement => {
    const col = el('section', 'cmp-basiscol');
    const h = el('h4', 'cmp-basishead');
    h.append(badge(side.slot), el('span', undefined, side.scenario ? `${side.slot}: ${side.scenario.label}` : `${side.slot}: empty`));
    col.append(h);
    if (!side.value) {
      col.append(el('p', 'ly-unavailable', side.status === 'empty' ? 'Nothing is saved in this slot.' : side.status === 'loading' ? 'Analysing…' : `Not available: ${side.error}`));
      return col;
    }
    const b = basisOf(side.value);
    const dl = el('dl', 'cmp-basislist');
    const add = (term: string, node: HTMLElement | string) => {
      const dd = el('dd');
      dd.append(node);
      dl.append(el('dt', undefined, term), dd);
    };
    add('Coordinates', b.coords);
    add('Observer', b.observer);
    add('Sun and Earth positions', b.ephemeris);
    const sources = el('ul', 'cmp-sources');
    list(sources, b.elevationData.length ? b.elevationData : ['No elevation data covers this site: there is no skyline and no slope.']);
    add('Elevation data', sources);
    col.append(dl, el('h5', 'cmp-warnhead', b.warnings.length ? `Warnings (${b.warnings.length})` : 'Warnings'));
    if (b.warnings.length) {
      const ul = el('ul', 'cmp-warnings');
      list(ul, b.warnings);
      col.append(ul);
    } else col.append(el('p', 'ly-note', 'None reported for this analysis.'));
    return col;
  };

  let meaningKeys = '';
  const renderMeanings = (rows: readonly CompareRow[]) => {
    const all = [...scenarioRows(null, null), ...rows, ...nowRows(null, null, 0)].filter((r) => r.hint);
    const keys = all.map((r) => r.key).join('|');
    if (keys === meaningKeys) return;
    meaningKeys = keys;
    meaningList.replaceChildren(...all.flatMap((r) => [el('dt', undefined, r.label), el('dd', undefined, r.hint)]));
  };

  const renderNow = () => {
    const t = store.get().timeMs;
    nowLabel.textContent = `At the shared clock, ${formatUtc(t)}`;
    nowGroup.set(nowRows(sideOf('A').value, sideOf('B').value, t));
  };

  const renderResult = () => {
    const a = sideOf('A'), b = sideOf('B');
    const s = store.get();

    // The differences in words: the comparison the `compare` action reports, read from the same place.
    const c = analysis.comparison();
    state.classList.toggle('is-error', c.state === 'error');
    if (c.state === 'ready') {
      state.textContent = '';
      list(highlights, c.diff.highlights);
    } else {
      highlights.replaceChildren();
      state.textContent =
        c.state === 'idle'
          ? `Slot ${c.missing.join(' and slot ')} ${c.missing.length > 1 ? 'are' : 'is'} empty. Save a scenario there, or use one of the two "B from A" fields above.`
          : c.state === 'loading'
            ? 'Analysing A and B…'
            : `The comparison is not available. ${c.error}`;
    }

    // Requirements in words, what is not met first.
    const lines: RequirementLine[] = [];
    for (const side of [a, b]) if (side.value) lines.push(...requirementLines(side.slot, side.value, s, SCIENCE.blockageAt(side.value, 'sun', s.timeMs).bodyElDeg));
    const order = { breached: 0, unknown: 1, met: 2, info: 3 } as const;
    lines.sort((x, y) => order[x.status] - order[y.status]);
    const mark = { breached: 'Not met: ', unknown: 'Unknown: ', met: 'Met: ', info: 'No requirement: ' } as const;
    flags.replaceChildren(
      ...lines.map((l) => {
        const li = el('li', `is-${l.status}`);
        li.append(el('strong', undefined, mark[l.status]), document.createTextNode(l.text));
        return li;
      }),
    );
    if (!lines.length) flags.append(el('li', 'ly-unavailable', 'The requirements are checked when an analysis is ready.'));

    sideHead(headA, a);
    sideHead(headB, b);
    scenarioGroup.set(scenarioRows(a.scenario, b.scenario));
    const rows = windowRows(a.value, b.value);
    windowGroup.set(rows);
    clockA.disabled = !a.scenario;
    clockB.disabled = !b.scenario;

    basis.replaceChildren(basisColumn(a), basisColumn(b));
    assumptions.replaceChildren();
    const section = (heading: string, items: readonly string[]) => {
      if (!items.length) return;
      const ul = el('ul', 'cmp-assumelist');
      list(ul, items);
      assumptions.append(el('h4', 'cmp-assumehead', heading), ul);
    };
    if (a.value && b.value) {
      const split = splitAssumptions(a.value.provenance.assumptions, b.value.provenance.assumptions);
      section('The same for A and B', split.shared);
      section('Only A', split.onlyA);
      section('Only B', split.onlyB);
    } else if (a.value || b.value) section(a.value ? 'A' : 'B', (a.value ?? b.value)!.provenance.assumptions);
    else assumptions.append(el('p', 'ly-unavailable', 'Shown when an analysis is ready.'));

    renderNow();
    renderMeanings(rows);
  };

  const renderSaved = () => {
    const all = storage.list();
    // Load and Delete redraw this list under the button just used: the focus stays in the list (Q-4).
    redrawKeepingFocus(
      savedList,
      all.map((c) => {
        const li = el('li', 'cmp-saveditem');
        const text = el('div', 'cmp-savedtext');
        text.append(el('div', 'cmp-savedname', c.name), el('div', 'ly-note', `A: ${describeScenario(c.a)}`), el('div', 'ly-note', `B: ${describeScenario(c.b)}`));
        if (c.savedUtc) text.append(el('div', 'ly-note', `Saved ${formatUtc(Date.parse(c.savedUtc))}`));
        const load = button('Load', 'ly-btn ly-btn--small', () => void actSaved('loadComparison', { name: c.name }, (r) => `Loaded "${r.loaded}" exactly as saved${r.restored.clockUtc ? `, with the clock at ${formatUtc(Date.parse(r.restored.clockUtc))}` : ''}${r.restored.requirements ? ' and its requirements' : ''}.`));
        load.setAttribute('aria-label', `Load the saved comparison ${c.name}`);
        load.dataset.focusKey = `load:${c.name}`;
        const del = button('Delete', 'ly-btn ly-btn--small', () => void actSaved('deleteComparison', { name: c.name }, () => `Deleted "${c.name}".`));
        del.setAttribute('aria-label', `Delete the saved comparison ${c.name}`);
        del.dataset.focusKey = `delete:${c.name}`;
        const buttons = el('div', 'cmp-saveditembuttons');
        buttons.append(load, del);
        li.append(text, buttons);
        return li;
      }),
      // The last saved comparison was deleted: the name field of "Save this comparison" is next to the empty list.
      () => nameInput,
    );
    const s = store.get();
    saveBtn.disabled = !s.compareA || !s.compareB;
    nameInput.placeholder = s.compareA && s.compareB ? `${s.compareA.label} vs ${s.compareB.label}`.slice(0, 80) : 'Needs both A and B';
    savedNote.textContent = storage.persistent
      ? `${all.length ? '' : 'None saved yet. '}A saved comparison keeps both scenarios, the clock and the requirements, in this browser only (localStorage). The pair in A and B is also kept when the page is reloaded.`
      : 'This browser gives the page no storage: saved comparisons last only until the page is closed.';
  };

  return { renderSetup, renderResult, renderNow, renderSaved, renderRequirementInputs };
}
