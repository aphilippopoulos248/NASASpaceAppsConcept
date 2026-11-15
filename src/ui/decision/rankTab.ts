// The "Rank sites" tab of the compare panel (decision engine, D-17): a mission profile with its
// thresholds and weights, where the candidates come from, a ranked table with one pass / fail /
// unknown badge per criterion, the unknown and infeasible sites with their deciding reasons, and
// two picked rows compared.
//
// Driven only through registered actions (D-3): listMissionProfiles, getDecisionSettings,
// setDecisionSettings, findBestSites and compareSites (T-73), and selectSite, dropPin,
// saveScenario and openCompare for the buttons in a row. What it shows is the last answer of
// those tools, whoever asked (this tab or the assistant). A "summary" answer, the default for
// the assistant's replies (F-12), leaves out reasons and bases: the tab asks for the same in full.
// Every figure and sentence is the tools' own; view.ts only orders and words them.
import type { MissionProfile, PairComparison, ProfileOverrides, Ranking } from '../../analysis/decision/types';
import { getAction, onAction, type ActionOrigin } from '../../core/actions';
import { DECISION_CAPS, decisionRun, onDecisionRun } from '../../core/decisionActions';
import { store } from '../../core/store';
import type { SiteRef } from '../../core/types';
import { el } from '../dom';
import { nearbyPointCount } from '../compare/actions';
import { redrawKeepingFocus } from '../compare/focus';
import { coordsText, distanceText } from '../compare/format';
import { nextId, type TabKit } from '../compare/widgets';
import { fullReplay, readComparison, readProfiles, readRanking, readRankingExtras, readSettings, type DecisionSettings, type FullReplay } from './results';
import {
  candidatesFor,
  criteriaUi,
  direction,
  limitShort,
  noun,
  openStep,
  overridesParam,
  pairView,
  profileSettingsText,
  progressText,
  rankingView,
  requirementViews,
  sameProfile,
  siteArg,
  slotConditionsNote,
  slotSteps,
  sourceSentence,
  thresholdEdit,
  togglePick,
  weightEdit,
  withFullDetail,
  type Badge,
  type CriterionUi,
  type PairView,
  type RankingView,
  type RelaxationPrompt,
  type Section,
  type SiteRow,
  type SourceKind,
} from './view';
import './decision.css';

/** The decision tools this tab runs (T-73). Without them the tab says so and stays inert. */
const TOOLS = ['listMissionProfiles', 'getDecisionSettings', 'setDecisionSettings', 'findBestSites', 'compareSites'] as const;

const UNIT_SHOWN: Record<CriterionUi['unit'], string> = { '%': '%', h: 'h', deg: '°', m: 'm' };
const UNIT_WORD: Record<CriterionUi['unit'], string> = { '%': 'percent', h: 'hours', deg: 'degrees', m: 'metres' };
const UNIT_STEP: Record<CriterionUi['unit'], string> = { '%': '1', h: '1', deg: '0.5', m: '0.1' };
const EARTH_NOTE = "Earth figures are geometry with the terrain skyline (direct-to-Earth line of sight to Earth's centre), not a link budget.";

export interface RankTab {
  /** Draws the tab from the tools' last answers; reads the profiles and the setting the first time. */
  render(): void;
}

interface Field {
  wrap: HTMLElement;
  row: HTMLElement;
  input: HTMLInputElement;
  /** The typed number; null for an empty field; undefined for something that is not a number. */
  read(): number | null | undefined;
  /** Shows a value from the tools, unless the user is typing in the field. */
  show(v: number | null): void;
  mark(ok: boolean, error?: string): void;
}

/** A number field labelled by its own label plus `labelledBy` (the criterion's name), with the unit spoken in words. */
function field(label: string, unit: CriterionUi['unit'] | 'm' | 'sites' | '', labelledBy: readonly string[], opts: { min: number; max?: number; step: string; value?: number; placeholder?: string }): Field {
  const id = nextId('dec-f');
  const wrap = el('div', 'cmp-field');
  const lab = el('label', 'ly-label', label);
  lab.htmlFor = id;
  lab.id = `${id}-label`;
  const input = el('input', 'ly-input');
  input.id = id;
  input.type = 'number';
  input.inputMode = 'decimal';
  input.min = String(opts.min);
  if (opts.max !== undefined) input.max = String(opts.max);
  input.step = opts.step;
  if (opts.value !== undefined) input.value = String(opts.value);
  if (opts.placeholder) input.placeholder = opts.placeholder;
  const row = el('div', 'cmp-field-row');
  row.append(input);
  const names = [...labelledBy, lab.id];
  if (unit) {
    const shown = el('span', 'ly-unit', unit in UNIT_SHOWN ? UNIT_SHOWN[unit as CriterionUi['unit']] : unit);
    shown.setAttribute('aria-hidden', 'true');
    const word = el('span', 'ly-visually-hidden', unit in UNIT_WORD ? UNIT_WORD[unit as CriterionUi['unit']] : unit);
    word.id = `${id}-unit`;
    row.append(shown, word);
    names.push(word.id);
  }
  input.setAttribute('aria-labelledby', names.join(' '));
  wrap.append(lab, row);
  return {
    wrap,
    row,
    input,
    read() {
      const t = input.value.trim();
      if (t === '') return null;
      const v = Number(t);
      return Number.isFinite(v) ? v : undefined;
    },
    show(v) {
      if (document.activeElement === input) return;
      input.value = v === null ? '' : String(v);
    },
    mark(ok, error) {
      input.setAttribute('aria-invalid', String(!ok));
      input.title = ok ? '' : (error ?? '');
    },
  };
}

const hidden = (text: string) => el('span', 'ly-visually-hidden', text);
const sortedJson = (v: unknown): string => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const hasOverrides = (o: ProfileOverrides) => Object.keys(o).some((k) => k !== 'allowSafetyRelaxation');
const coords = (s: SiteRef) => (Number.isFinite(s.lat) && Number.isFinite(s.lon) ? coordsText(s.lat, s.lon) : '');

export function mountRankTab(root: HTMLElement, kit: TabKit): RankTab {
  const defs = criteriaUi();
  const { act, run } = kit;

  // ---------- what the tab holds: the tools' last answers, and what the user is doing ----------
  let profiles: MissionProfile[] | null = null;
  let settings: DecisionSettings | null = null;
  let loadError = '';
  /** The profiles and the setting are read once, when the tab is first shown; later answers arrive through onAction. */
  let loadTried = false;
  let refreshDue = false;
  let ranking: { value: Ranking; view: RankingView; origin: ActionOrigin; source: string } | null = null;
  let comparison: { value: PairComparison; view: PairView } | null = null;
  let picks: string[] = [];
  let source: SourceKind = 'catalogue';
  let running: { what: string } | null = null;
  let comparingPair = false;
  /** A summary answer someone else got (the assistant), waiting to be asked again in full while the tab is shown; the newest wins. */
  let replay: (FullReplay & { origin: ActionOrigin }) | null = null;
  /** The replay running now: its answer is drawn as the original asker's. */
  let replaying: { params: Record<string, unknown>; origin: ActionOrigin } | null = null;
  let prompt: { p: RelaxationPrompt; overrides: ProfileOverrides; card: Card } | null = null;

  const showing = () => store.get().comparing && !root.hidden;
  const available = () => TOOLS.every((t) => getAction(t));
  /** The preset the setting is based on ('' = the first one). */
  const baseOf = (s: DecisionSettings | null): MissionProfile | null => {
    if (!profiles || !s) return null;
    const id = s.profileId || profiles[0].id;
    return profiles.find((p) => p.id === id) ?? profiles.find((p) => p.id === s.profile.id) ?? null;
  };

  // ---------- mission profile: picker, thresholds and weights ----------
  const profileTitle = el('h3', 'ly-section-title', 'Mission profile');
  profileTitle.id = nextId('dec-h');
  const profileSection = el('section', 'dec-section');
  profileSection.setAttribute('aria-labelledby', profileTitle.id);
  const select = el('select', 'ly-select dec-select');
  select.id = nextId('dec-profile');
  const selectLabel = el('label', 'ly-label', 'Profile');
  selectLabel.htmlFor = select.id;
  const selectField = el('div', 'cmp-field');
  selectField.append(selectLabel, select);
  select.addEventListener('change', () => void chooseProfile(select.value));
  const reset = kit.button("Use the profile's values", 'ly-btn ly-btn--small', () => void resetOverrides());
  reset.title = 'Drop every change to the thresholds and weights of this profile';
  const pickRow = el('div', 'dec-pickrow');
  const profileWords = el('div', 'dec-profilewords');
  const profileText = el('p', 'dec-profiletext');
  const profileSettings = el('p', 'ly-note');
  profileWords.append(profileText, profileSettings);
  pickRow.append(selectField, reset, profileWords);

  interface Card {
    def: CriterionUi;
    box: HTMLElement;
    threshold: Field;
    weight: Field;
    share: HTMLElement;
    relaxed: HTMLElement;
  }
  const cards: Card[] = defs.map((def) => {
    const box = el('div', `dec-req${def.safety ? ' is-safety' : ''}`);
    box.setAttribute('role', 'group');
    const head = el('div', 'dec-reqhead');
    const name = el('span', 'dec-reqname', def.label);
    name.id = nextId('dec-rq');
    box.setAttribute('aria-labelledby', name.id);
    head.append(name);
    if (def.safety) {
      const tag = el('span', 'dec-safety', 'Safety');
      tag.title = 'A safety limit: loosening it beyond the profile asks for a confirmation, and every result made with it lists the relaxation.';
      head.append(tag);
    }
    if (def.definition) head.title = def.definition;
    const threshold = field(direction(def), def.unit, [name.id], { min: 0, max: def.unit === '%' ? 100 : undefined, step: UNIT_STEP[def.unit], placeholder: 'none' });
    const weight = field('Weight', '', [name.id], { min: 0, step: 'any' });
    const share = el('span', 'ly-note dec-share');
    weight.row.append(share);
    const relaxed = el('span', 'dec-relaxed');
    relaxed.hidden = true;
    box.append(head, threshold.wrap, weight.wrap, relaxed);
    const card: Card = { def, box, threshold, weight, share, relaxed };
    threshold.input.addEventListener('change', () => void editThreshold(card));
    weight.input.addEventListener('change', () => void editWeight(card));
    return card;
  });
  const reqGrid = el('div', 'dec-reqs');
  reqGrid.setAttribute('role', 'group');
  reqGrid.setAttribute('aria-label', 'Thresholds and weights');
  reqGrid.append(...cards.map((c) => c.box));

  const promptBox = el('div', 'dec-prompt');
  promptBox.setAttribute('role', 'group');
  const promptText = el('p', 'dec-prompttext');
  promptText.id = nextId('dec-prompt');
  promptBox.setAttribute('aria-labelledby', promptText.id);
  const promptYes = kit.button('', 'ly-btn ly-btn--small dec-relax', () => void confirmRelaxation());
  const promptNo = kit.button('', 'ly-btn ly-btn--small', () => cancelRelaxation());
  const promptButtons = el('div', 'cmp-buttons');
  promptButtons.append(promptYes, promptNo);
  promptBox.append(promptText, promptButtons);
  promptBox.hidden = true;

  const settingsState = el('p', 'cmp-state');
  settingsState.setAttribute('role', 'status');
  const reqNote = el('p', 'ly-note', 'An empty threshold is no requirement. Weights are relative: each one\'s share of the total is beside it. Thresholds decide which sites are feasible; weights only order the feasible ones.');
  const sources = el('details', 'cmp-more');
  const sourcesList = el('ul', 'cmp-assumelist');
  sources.append(el('summary', undefined, 'Where these numbers come from'), sourcesList);
  profileSection.append(profileTitle, pickRow, reqGrid, promptBox, settingsState, reqNote, sources);

  // ---------- candidates and the run ----------
  const sourceTitle = el('h3', 'ly-section-title', 'Candidates');
  sourceTitle.id = nextId('dec-h');
  const sourceSection = el('section', 'dec-section');
  sourceSection.setAttribute('aria-labelledby', sourceTitle.id);
  const fieldset = el('fieldset', 'dec-sources');
  const legend = el('legend', 'ly-visually-hidden', 'Which sites to rank');
  fieldset.append(legend);
  const radioName = nextId('dec-src');
  const radios = new Map<SourceKind, { input: HTMLInputElement; text: HTMLElement }>();
  for (const kind of ['catalogue', 'nearby', 'sites'] as const) {
    const label = el('label', 'ly-check');
    const input = el('input');
    input.type = 'radio';
    input.name = radioName;
    input.value = kind;
    input.checked = kind === source;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      source = kind;
      renderSource();
    });
    const text = el('span');
    label.append(input, text);
    fieldset.append(label);
    radios.set(kind, { input, text });
  }
  const radius = field('Radius', 'm', [], { min: 100, max: 10_000, step: '100', value: 2000 });
  const spacing = field('Spacing', 'm', [], { min: 50, max: 10_000, step: '10', value: 300 });
  const nearbyFields = el('div', 'dec-nearby');
  nearbyFields.setAttribute('role', 'group');
  nearbyFields.setAttribute('aria-label', 'Grid around the site on screen');
  nearbyFields.append(radius.wrap, spacing.wrap);
  const limit = field('List the best', 'sites', [], { min: 1, max: 50, step: '1', value: 10 });
  const runButton = kit.button('Rank sites', 'ly-btn ly-btn--small ly-btn--primary', () => void rankSites());
  const runWrap = el('div', 'cmp-field');
  runWrap.append(runButton);
  const sourceRow = el('div', 'dec-sourcerow');
  sourceRow.append(fieldset, nearbyFields, limit.wrap, runWrap);
  for (const f of [radius, spacing, limit]) {
    f.input.addEventListener('keydown', (e) => e.key === 'Enter' && runButton.click());
    f.input.addEventListener('input', () => renderSource());
  }
  const sourceNote = el('p', 'ly-note');
  const progress = el('div', 'cmp-progress');
  progress.setAttribute('role', 'status');
  const bar = el('progress');
  bar.setAttribute('aria-label', 'Ranking progress');
  const progressWords = el('span');
  progress.append(bar, progressWords);
  progress.hidden = true;
  sourceSection.append(sourceTitle, sourceRow, sourceNote, kit.status, progress);

  // ---------- the ranking ----------
  const resultTitle = el('h3', 'ly-section-title', 'Ranking');
  resultTitle.id = nextId('dec-h');
  const results = el('section', 'dec-section dec-results');
  results.setAttribute('aria-labelledby', resultTitle.id);
  const summary = el('p', 'dec-summary');
  summary.setAttribute('role', 'status');
  const relaxList = el('ul', 'dec-relaxations');
  const stale = el('p', 'cmp-stale');
  const rankedBox = el('div', 'dec-tablebox');
  const notListed = el('p', 'ly-note');
  const legendLine = el('p', 'ly-note');
  const weightsLine = el('p', 'ly-note');
  const utilityNote = el('p', 'ly-note dec-utilitynote');
  const whyTitle = el('h3', 'ly-section-title', 'The ranking in words');
  const whyList = el('ul', 'cmp-highlights');

  const compareTitle = el('h3', 'ly-section-title', 'Two sites compared');
  compareTitle.id = nextId('dec-h');
  const compareSection = el('section', 'dec-compare');
  compareSection.setAttribute('aria-labelledby', compareTitle.id);
  const compareHead = el('p', 'dec-comparehead');
  compareHead.setAttribute('role', 'status');
  const compareBox = el('div', 'dec-tablebox');
  const compareWords = el('ul', 'cmp-highlights');
  compareSection.append(compareTitle, compareHead, compareBox, compareWords);
  compareSection.hidden = true;

  const otherSection = (title: string) => {
    const h = el('h3', 'ly-section-title', title);
    h.id = nextId('dec-h');
    const s = el('section', 'dec-other');
    s.setAttribute('aria-labelledby', h.id);
    const note = el('p', 'ly-note');
    const box = el('div', 'dec-tablebox');
    s.append(h, note, box);
    return { section: s, title: h, note, box };
  };
  const unknownPart = otherSection('Unknown');
  const infeasiblePart = otherSection('Infeasible');

  const basisMore = el('details', 'cmp-more');
  const basisList = el('dl', 'cmp-basislist');
  const provenanceList = el('ul', 'cmp-assumelist');
  basisMore.append(el('summary', undefined, 'What the figures rest on'), basisList, provenanceList);

  results.append(resultTitle, summary, relaxList, stale, rankedBox, notListed, legendLine, weightsLine, utilityNote, compareSection, whyTitle, whyList, unknownPart.section, infeasiblePart.section, basisMore);
  results.hidden = true;

  // The reason behind a badge, on hover or focus. One for the tab; aria-hidden, since each badge
  // carries its reason as its own description.
  const tip = el('div', 'ly-tooltip dec-tip');
  tip.setAttribute('aria-hidden', 'true');
  tip.hidden = true;

  root.append(profileSection, sourceSection, results, tip);

  // ---------- the tools' answers, whoever asked ----------
  onAction((entry) => {
    if (!entry.ok) return;
    if (entry.name === 'listMissionProfiles') {
      const p = readProfiles(entry.result);
      if (!p) return;
      profiles = p;
    } else if (entry.name === 'getDecisionSettings' || entry.name === 'setDecisionSettings') {
      const s = readSettings(entry.result);
      if (!s) return;
      settings = s;
    } else if (entry.name === 'findBestSites') {
      const r = readRanking(entry.result);
      if (!r) return queueReplay(entry);
      const x = readRankingExtras(entry.result);
      const origin = replaying && entry.params === replaying.params ? replaying.origin : entry.origin;
      ranking = { value: r, view: rankingView(defs, r), origin, source: sourceSentence(x.source, x.cap, x.dropped) };
      picks = [];
      comparison = null;
    } else if (entry.name === 'compareSites') {
      const c = readComparison(entry.result);
      if (!c) return queueReplay(entry);
      comparison = { value: c, view: pairView(defs, c) };
      // The pair on screen is the pair compared, when both are rows of the ranking.
      const ids = [c.a.site.id, c.b.site.id];
      if (ranking && ids.every((id) => rowById(id))) picks = ids;
    } else return;
    if (showing()) render();
  });

  /** A summary answer (F-12) is asked for again in full, now if the tab is shown, else when it is next shown. */
  function queueReplay(entry: { name: string; ok: boolean; params: unknown; result?: unknown; origin: ActionOrigin }) {
    const req = fullReplay(entry, (n) => getAction(n)?.params);
    if (!req) return;
    replay = { ...req, origin: entry.origin };
    if (showing()) void runReplay();
  }

  async function runReplay() {
    if (!replay || replaying) return;
    const job = replay;
    replay = null;
    replaying = { params: job.params, origin: job.origin };
    const ranks = job.name === 'findBestSites';
    if (ranks) running = { what: "the assistant's candidates" };
    if (showing()) render();
    const r = await run(job.name, job.params);
    replaying = null;
    if (ranks) running = null;
    if (!r.ok) kit.complain(`The ${ranks ? 'ranking' : 'comparison'} the assistant asked for could not be drawn here in full: ${r.error ?? 'no reason given'}`);
    if (replay) void runReplay();
    if (showing()) render();
  }

  // The setting is shared with the assistant: follow it when something else changes it.
  store.subscribe(['decisionProfileId', 'decisionOverrides'], () => {
    refreshDue = true;
    setTimeout(refreshSettings, 0);
  });
  store.subscribe(['site', 'compareA', 'compareB'], () => {
    if (!showing()) return;
    renderSource();
    markSiteOnScreen();
  });
  // Progress of any run of the tools (this tab's or the assistant's).
  onDecisionRun(() => {
    if (showing()) renderProgress();
  });

  async function refreshSettings() {
    if (!refreshDue || !showing() || !available()) return;
    refreshDue = false;
    const s = store.get();
    // Already in hand (setDecisionSettings answers with the setting itself).
    const sameId = s.decisionProfileId === '' ? settings?.isDefault : settings?.profileId === s.decisionProfileId;
    if (settings && sameId && sortedJson(settings.overrides) === sortedJson(s.decisionOverrides)) return;
    await run('getDecisionSettings', {});
  }

  async function load() {
    if (loadTried || !available()) return;
    loadTried = true;
    loadError = '';
    const [p, s] = await Promise.all([run('listMissionProfiles', {}), run('getDecisionSettings', {})]);
    loadError = [p, s].map((o) => (o.ok ? '' : (o.error ?? ''))).filter(Boolean).join(' ');
    if (showing()) render();
  }

  // ---------- editing the setting ----------
  const saySettings = (text: string, isError: boolean) => {
    settingsState.textContent = text;
    settingsState.classList.toggle('is-error', isError);
  };

  async function chooseProfile(id: string) {
    const r = await run('setDecisionSettings', { profileId: id });
    if (r.ok) saySettings(`Profile: ${settings?.profile.name ?? id}, with its own thresholds and weights.`, false);
    else {
      select.value = baseOf(settings)?.id ?? '';
      saySettings(r.error ?? 'The profile could not be chosen.', true);
    }
    renderSettings();
  }

  async function resetOverrides() {
    const r = await run('setDecisionSettings', { reset: true });
    saySettings(r.ok ? "The profile's own thresholds and weights are in force again." : (r.error ?? 'The change was refused.'), !r.ok);
    renderSettings();
  }

  /** Sends the whole set of overrides (they replace the stored ones) and says what is in force now, or why not. */
  async function applyOverrides(overrides: ProfileOverrides, f: Field, def: CriterionUi, what: 'threshold' | 'weight') {
    const r = await run('setDecisionSettings', { overrides: overridesParam(overrides) });
    f.mark(r.ok, r.error);
    if (!r.ok) saySettings(r.error ?? 'The change was refused.', true);
    else if (settings) {
      const now = what === 'threshold' ? limitShort(def, settings.profile.thresholds[def.id]) : `weight ${settings.profile.weights[def.id]}`;
      saySettings(`${def.label}: ${now}.${ranking ? ' Rank again to use it.' : ''}`, false);
    }
    renderSettings();
  }

  async function editThreshold(card: Card) {
    const base = baseOf(settings);
    const v = card.threshold.read();
    if (!settings || !base || v === undefined) return;
    const out = thresholdEdit(defs, base, settings.overrides, card.def.id, v);
    if (out.kind === 'none') return card.threshold.mark(true);
    if (out.kind === 'confirm') {
      prompt = { p: out.prompt, overrides: out.overrides, card };
      renderPrompt();
      promptNo.focus();
      return;
    }
    if (prompt?.card === card) prompt = null;
    await applyOverrides(out.overrides, card.threshold, card.def, 'threshold');
  }

  async function editWeight(card: Card) {
    const base = baseOf(settings);
    const v = card.weight.read();
    if (!settings || !base) return;
    if (v === null || v === undefined || v < 0) {
      card.weight.mark(false, 'Give a weight of 0 or more.');
      saySettings(`Give the ${noun(card.def)} weight as a number of 0 or more.`, true);
      return;
    }
    const out = weightEdit(base, settings.overrides, card.def.id, v);
    if (out.kind === 'none') return card.weight.mark(true);
    await applyOverrides(out.overrides, card.weight, card.def, 'weight');
  }

  async function confirmRelaxation() {
    if (!prompt) return;
    const { overrides, card } = prompt;
    prompt = null;
    renderPrompt();
    card.threshold.input.focus();
    await applyOverrides(overrides, card.threshold, card.def, 'threshold');
  }

  function cancelRelaxation() {
    if (!prompt) return;
    const { card } = prompt;
    prompt = null;
    renderPrompt();
    card.threshold.input.value = settings && settings.profile.thresholds[card.def.id] !== null ? String(settings.profile.thresholds[card.def.id]) : '';
    card.threshold.mark(true);
    card.threshold.input.focus();
  }

  // ---------- running the tools ----------
  async function rankSites() {
    const s = store.get();
    const choice = candidatesFor(source, s, { radiusM: radius.read() ?? null, spacingM: spacing.read() ?? null });
    if (!choice.ok) return kit.complain(choice.why);
    const n = limit.read();
    if (n === null || n === undefined || !Number.isInteger(n) || n < 1) return kit.complain('Give how many sites to list as a whole number of 1 or more.');
    running = { what: choice.what };
    renderSource();
    renderProgress();
    await act('findBestSites', withFullDetail({ candidates: choice.candidates, limit: n }, getAction('findBestSites')?.params), () => '');
    running = null;
    if (showing()) render();
  }

  const rowById = (id: string): SiteRow | undefined => {
    const v = ranking?.view;
    return v ? [...v.ranked, ...v.unknown, ...v.infeasible].find((r) => r.id === id) : undefined;
  };

  async function pick(id: string, on: boolean) {
    picks = togglePick(picks, id, on);
    syncPicks();
    if (picks.length !== 2) {
      if (comparison && !picks.every((p) => p === comparison!.view.a.id || p === comparison!.view.b.id)) comparison = null;
      renderComparison();
      return;
    }
    const [a, b] = picks.map(rowById);
    if (!a || !b) return;
    comparingPair = true;
    renderComparison();
    await act('compareSites', withFullDetail({ siteA: siteArg(a.site), siteB: siteArg(b.site) }, getAction('compareSites')?.params), () => '');
    comparingPair = false;
    renderComparison();
  }

  async function toSlot(r: SiteRow, slot: 'A' | 'B') {
    const [selectStep, saveStep] = slotSteps(r.site, slot);
    const first = await run(selectStep.name, selectStep.params);
    if (!first.ok) return kit.complain(first.error ?? `${r.name} could not be made the site on screen.`);
    const other = slot === 'A' ? store.get().compareB : store.get().compareA;
    const note = ranking ? slotConditionsNote(ranking.value.profile, store.get()) : null;
    const saved = await act(saveStep.name, saveStep.params, () => `${r.name} is scenario ${slot}.${other ? '' : ` Choose another site as ${slot === 'A' ? 'B' : 'A'} to compare them.`}${note ? ` ${note}` : ''}`);
    // The pair is complete: show it, as "Compare as B" does in the nearby list, from the top of the panel.
    if (saved.ok && other && (await run('openCompare', { tab: 'compare' })).ok) root.closest('.cmp-body')?.scrollTo({ top: 0 });
  }

  // ---------- drawing ----------
  function renderSettings() {
    const ready = available() && profiles !== null && settings !== null;
    for (const c of cards) {
      c.threshold.input.disabled = !ready;
      c.weight.input.disabled = !ready;
    }
    select.disabled = !ready;
    if (!available()) {
      settingsState.classList.remove('is-error');
      settingsState.textContent = 'The decision tools are not part of this build, so nothing can be ranked here.';
      reset.disabled = true;
      return;
    }
    if (!ready) {
      settingsState.classList.toggle('is-error', Boolean(loadError));
      settingsState.textContent = loadError ? `The mission profiles are not available: ${loadError}` : 'Reading the mission profiles…';
      reset.disabled = true;
      return;
    }
    const s = settings!;
    if (s.refused.length) saySettings(`The stored changes are refused by this profile: ${s.refused.join(' ')}`, true);
    else if (settingsState.textContent === 'Reading the mission profiles…') saySettings('', false);
    const base = baseOf(s);
    const ids = profiles!.map((p) => `${p.id}\t${p.name}`).join('\n');
    if (select.dataset.ids !== ids) {
      select.dataset.ids = ids;
      select.replaceChildren(...profiles!.map((p) => {
        const o = el('option', undefined, p.name);
        o.value = p.id;
        return o;
      }));
    }
    if (document.activeElement !== select) select.value = base?.id ?? profiles![0].id;
    profileText.textContent = base?.description ?? s.profile.description;
    profileSettings.textContent = profileSettingsText(s.profile);
    sourcesList.replaceChildren(...(base ?? s.profile).sources.map((t) => el('li', undefined, t)));
    reset.disabled = !hasOverrides(s.overrides);
    for (const [i, v] of requirementViews(defs, s.profile, base, s.relaxations).entries()) {
      const c = cards[i];
      if (prompt?.card !== c) c.threshold.show(v.threshold);
      c.weight.show(v.weight);
      c.share.textContent = `${Math.round(v.share * 100)} % of the total`;
      c.box.classList.toggle('is-changed', v.changed);
      c.box.classList.toggle('is-relaxed', v.relaxed !== null);
      c.relaxed.hidden = v.relaxedText === null;
      c.relaxed.textContent = v.relaxedText ?? '';
      // A refused value keeps its reason as the tooltip; otherwise the tooltip gives the profile's own value when it differs.
      if (c.threshold.input.getAttribute('aria-invalid') !== 'true') c.threshold.input.title = v.threshold !== v.baseThreshold ? `The profile's value: ${limitShort(c.def, v.baseThreshold)}` : '';
    }
    renderPrompt();
  }

  function renderPrompt() {
    promptBox.hidden = prompt === null;
    if (!prompt) return;
    promptText.textContent = prompt.p.text;
    promptYes.textContent = prompt.p.confirm;
    promptNo.textContent = prompt.p.cancel;
  }

  function renderSource() {
    const s = store.get();
    radios.get('catalogue')!.text.textContent = 'The catalogued landings';
    radios.get('nearby')!.text.textContent = s.site ? `Around the site on screen: ${s.site.name}` : 'Around the site on screen (none is selected)';
    const saved = [s.compareA?.site, s.compareB?.site].filter((x): x is SiteRef => Boolean(x));
    const names = [...new Set(saved.map((x) => x.name))];
    radios.get('sites')!.text.textContent = names.length ? `The sites in A and B: ${names.join(', ')}` : 'The sites in A and B (both are empty)';
    nearbyFields.hidden = source !== 'nearby';
    const r = radius.read() ?? null, sp = spacing.read() ?? null;
    const choice = candidatesFor(source, s, { radiusM: r, spacingM: sp });
    let note = choice.ok ? `Ranks ${choice.what} under the profile above: each one is measured over the profile's window, then checked against every threshold.` : choice.why;
    if (choice.ok && source === 'nearby' && r !== null && sp !== null) {
      const n = nearbyPointCount(r, sp);
      note = `Scans a ${sp} m grid within ${distanceText(r)} of ${s.site!.name} (${n.toLocaleString('en-US')} points, the site itself included) with the nearby scan's faster settings and the profile's slope limit as a pre-filter; the best ${DECISION_CAPS.nearby} by the scan's own score, and the site itself, are then measured fully.`;
    }
    if (choice.ok && source === 'catalogue') note = `Ranks the catalogued landings (at most ${DECISION_CAPS.catalogue}) under the profile above: each one is measured over the profile's window, then checked against every threshold. This takes a while: one full analysis per site.`;
    if (choice.ok && source === 'sites') note = `Ranks ${choice.what} under the profile above (at most ${DECISION_CAPS.sites} sites).`;
    sourceNote.textContent = note;
    runButton.disabled = !available() || running !== null || !choice.ok || settings === null;
    runButton.textContent = running ? 'Ranking…' : 'Rank sites';
  }

  function renderProgress() {
    const p = decisionRun();
    progress.hidden = running === null && !p.running;
    if (progress.hidden) return;
    if (p.running && p.total > 0) {
      bar.max = p.total;
      bar.value = Math.min(p.done, p.total);
    } else bar.removeAttribute('value');
    progressWords.textContent = progressText(p, running?.what ?? 'the candidates');
  }

  /** The tables are drawn again only for a new ranking; picks and the site on screen are updated in place. */
  let drawn: Ranking | null = null;

  function renderResult() {
    results.hidden = ranking === null;
    if (!ranking) {
      drawn = null;
      return;
    }
    const { view: v, value } = ranking;
    summary.textContent = `Ranked under the profile "${v.profileName}": ${v.countsText} ${v.paretoCount} on the Pareto front.${ranking.source ? ` ${ranking.source}` : ''}${ranking.origin === 'assistant' ? ' The assistant asked for this ranking (drawn here in full).' : ''}`;
    relaxList.replaceChildren(...v.relaxations.map((t) => el('li', undefined, t)));
    stale.textContent = settings && !sameProfile(value.profile, settings.profile) ? 'The profile above has changed since this ranking was made: rank again to use it.' : '';
    if (drawn !== value) {
      drawn = value;
      const ranked = v.ranked.length ? tableOf(v.ranked, 'ranked', value.profile) : el('p', 'cmp-state', 'No candidate meets every requirement, so none is ranked. The unknown and infeasible sites below say what stopped each one.');
      redrawKeepingFocus(rankedBox, [ranked], () => runButton);
      for (const [part, rows, section, title, note] of [
        [unknownPart, v.unknown, 'unknown', `Unknown: ${v.unknown.length}`, 'Not enough data to decide: no requirement fails, but at least one value could not be measured. Unknown is never counted as a pass.'],
        [infeasiblePart, v.infeasible, 'infeasible', `Infeasible: ${v.infeasible.length}`, 'At least one requirement fails. The failing ones are listed for each site; the sites that fail the fewest come first.'],
      ] as const) {
        part.section.hidden = rows.length === 0;
        part.title.textContent = title;
        part.note.textContent = note;
        redrawKeepingFocus(part.box, rows.length ? [tableOf(rows, section, value.profile)] : [], () => runButton);
      }
    }
    notListed.textContent = v.notListed ? `${v.notListed} more feasible site${v.notListed === 1 ? ' is' : 's are'} ranked but not listed: raise "List the best" to see ${v.notListed === 1 ? 'it' : 'them'}.` : '';
    const saysEarth = v.explanation.some((t) => /link budget/i.test(t));
    legendLine.textContent = `◆ marks the Pareto front: no other feasible site is at least as good on every criterion and better on one. ✓ pass, ✗ fail, ? unknown (a value that could not be measured; it decides feasibility only where the profile sets a threshold): hover over or focus a badge (arrow keys move between them) for its reason.${saysEarth ? '' : ` ${EARTH_NOTE}`}`;
    weightsLine.textContent = v.weightsText;
    utilityNote.textContent = v.note;
    whyTitle.hidden = v.explanation.length === 0;
    whyList.replaceChildren(...v.explanation.map((t) => el('li', undefined, t)));
    basisList.replaceChildren(...v.basis.flatMap((b) => [el('dt', undefined, b.labels.join(', ')), el('dd', undefined, b.text)]));
    provenanceList.replaceChildren(...v.provenance.map((t) => el('li', undefined, t)));
    basisMore.hidden = v.basis.length === 0 && v.provenance.length === 0;
    syncPicks();
    markSiteOnScreen();
    renderComparison();
  }

  function renderComparison() {
    const shown = comparison !== null || comparingPair;
    compareSection.hidden = !shown;
    if (!shown) return;
    if (comparingPair && !comparison) {
      const [a, b] = picks.map(rowById);
      compareHead.textContent = `Comparing ${a?.name ?? 'A'} and ${b?.name ?? 'B'}…`;
      compareBox.replaceChildren();
      compareWords.replaceChildren();
      return;
    }
    const v = comparison!.view;
    compareTitle.textContent = `Two sites compared: ${v.a.name} (A) and ${v.b.name} (B)`;
    compareHead.textContent = comparingPair ? `Comparing the new pair… (below: ${v.a.name} and ${v.b.name})` : v.headline;
    compareBox.replaceChildren(pairTable(v));
    compareWords.replaceChildren(...v.sentences.map((t) => el('li', undefined, t)));
  }

  function syncPicks() {
    for (const box of root.querySelectorAll<HTMLInputElement>('.dec-pickbox')) box.checked = picks.includes(box.dataset.site ?? '');
  }

  function markSiteOnScreen() {
    const id = store.get().site?.id;
    for (const tr of root.querySelectorAll<HTMLElement>('tr[data-site]')) {
      if (tr.dataset.site === id) tr.setAttribute('aria-current', 'true');
      else tr.removeAttribute('aria-current');
    }
  }

  // ---------- tables ----------
  function tableOf(rows: readonly SiteRow[], section: Section, profile: MissionProfile): HTMLTableElement {
    const table = el('table', `dec-table dec-table--${section === 'ranked' ? 'ranked' : 'other'}`);
    table.append(el('caption', 'ly-visually-hidden', section === 'ranked' ? 'Feasible sites, best first' : section === 'unknown' ? 'Sites that cannot be decided, with the values that are missing' : 'Infeasible sites, with the requirements they fail'));
    const colgroup = el('colgroup');
    const cols = section === 'ranked' ? ['pick', 'rank', 'site', 'utility', 'pareto', ...defs.map(() => 'crit'), 'choose'] : ['pick', 'site', 'why', ...defs.map(() => 'crit'), 'choose'];
    colgroup.append(...cols.map((c) => el('col', `dec-col-${c}`)));
    const head = el('tr');
    const th = (content: string | Node, cls: string, title?: string) => {
      const c = el('th', cls);
      c.scope = 'col';
      c.append(content);
      if (title) c.title = title;
      return c;
    };
    head.append(th('Pick', 'dec-c-pick', 'Pick two rows to compare them'));
    if (section === 'ranked') {
      const rank = el('span');
      rank.append(el('span', undefined, '#'), hidden(' Rank'));
      head.append(th(rank, 'dec-c-rank'), th('Site', 'dec-c-site'), th('Utility', 'dec-c-utility', 'Weighted utility 0 to 1 under the profile\'s weights; not a probability'), th('Pareto', 'dec-c-pareto', 'On the Pareto front of the feasible sites'));
    } else head.append(th('Site', 'dec-c-site'), th(section === 'unknown' ? 'What is missing' : 'What fails', 'dec-c-why'));
    const relaxed = new Set(ranking?.value.relaxations.map((r) => r.criterion));
    for (const d of defs) {
      const c = el('th', 'dec-c-crit');
      c.scope = 'col';
      c.append(el('span', 'dec-colname', d.label), el('span', `dec-collimit${relaxed.has(d.id) ? ' is-relaxed' : ''}`, `${limitShort(d, profile.thresholds[d.id])}${relaxed.has(d.id) ? ' (relaxed)' : ''}`));
      if (d.safety) c.append(el('span', 'dec-safety', 'Safety'));
      if (d.definition) c.title = d.definition;
      head.append(c);
    }
    head.append(th('Choose', 'dec-c-choose'));
    const thead = el('thead');
    thead.append(head);
    const tbody = el('tbody');
    for (const r of rows) tbody.append(rowOf(r, section));
    table.append(colgroup, thead, tbody);
    roveBadges(table);
    return table;
  }

  function rowOf(r: SiteRow, section: Section): HTMLTableRowElement {
    const tr = el('tr');
    tr.dataset.site = r.id;
    const td = (cls: string, content?: string | Node) => {
      const c = el('td', cls);
      if (content !== undefined) c.append(content);
      return c;
    };
    const box = el('input', 'dec-pickbox');
    box.type = 'checkbox';
    box.dataset.site = r.id;
    box.dataset.focusKey = `pick:${r.id}`;
    box.checked = picks.includes(r.id);
    box.setAttribute('aria-label', `Pick ${r.name} for the comparison of two sites`);
    box.addEventListener('change', () => void pick(r.id, box.checked));
    tr.append(td('dec-c-pick', box));
    if (section === 'ranked') tr.append(td('dec-c-rank ly-value', r.rank === null ? '—' : String(r.rank)));
    const name = el('th', 'dec-c-site');
    name.scope = 'row';
    name.append(el('span', 'dec-sitename', r.name));
    const where = coords(r.site);
    if (where) name.append(el('span', 'dec-where ly-note ly-value', where));
    tr.append(name);
    if (section === 'ranked') {
      tr.append(td('dec-c-utility ly-value', r.utilityText));
      const pareto = td('dec-c-pareto');
      if (r.pareto) {
        const mark = el('span', 'dec-pareto', '◆');
        mark.setAttribute('aria-hidden', 'true');
        pareto.append(mark, hidden('On the Pareto front'));
      } else pareto.append(hidden('Not on the Pareto front'));
      tr.append(pareto);
    } else {
      const why = el('ul', 'dec-deciding');
      why.append(...r.deciding.map((t) => el('li', undefined, t)));
      tr.append(td('dec-c-why', r.deciding.length ? why : '—'));
    }
    for (const d of defs) tr.append(badgeCell(r.badges.find((b) => b.id === d.id) ?? null));
    tr.append(td('dec-c-choose', actionsOf(r)));
    return tr;
  }

  function badgeCell(b: Badge | null): HTMLTableCellElement {
    const c = el('td', 'dec-c-crit');
    if (!b) {
      c.append(el('span', 'ly-unavailable', '—'));
      return c;
    }
    const s = el('span', `dec-badge is-${b.verdict}`);
    s.tabIndex = -1;
    const reason = el('span', undefined, [b.reason, b.scoreText ? `${b.scoreText}.` : ''].filter(Boolean).join(' '));
    reason.id = nextId('dec-why');
    reason.hidden = true;
    s.setAttribute('aria-describedby', reason.id);
    const mark = el('span', 'dec-mark', b.mark);
    mark.setAttribute('aria-hidden', 'true');
    // No break inside a value ("≥ 236.3 h"): a narrow column moves the mark above it instead.
    s.append(mark, el('span', 'dec-val', b.value.replace(/ /g, '\u00a0')), hidden(` ${b.label}: ${b.verdict}`));
    s.addEventListener('mouseenter', () => showTip(s, b));
    s.addEventListener('mouseleave', () => document.activeElement !== s && hideTip());
    s.addEventListener('focus', () => showTip(s, b));
    s.addEventListener('blur', hideTip);
    c.append(s, reason);
    return c;
  }

  function actionsOf(r: SiteRow): HTMLElement {
    const box = el('div', 'dec-actions');
    if (!Number.isFinite(r.site.lat) || !Number.isFinite(r.site.lon)) return box;
    const open = openStep(r.site);
    const go = kit.button(open.label, 'ly-btn ly-btn--small', () => void act(open.name, open.params, () => `${r.name} is the site on screen.`));
    go.setAttribute('aria-label', open.label === 'Open' ? `Open ${r.name}: select it and fly the globe there` : `Pin ${r.name} as the site on screen`);
    go.dataset.focusKey = `open:${r.id}`;
    const slot = (s: 'A' | 'B') => {
      const b = kit.button(`As ${s}`, 'ly-btn ly-btn--small', () => void toSlot(r, s));
      b.setAttribute('aria-label', `Compare ${r.name} as scenario ${s}`);
      b.title = `Make ${r.name} the site on screen and save it as scenario ${s}; with the other slot filled, the A and B tab opens`;
      b.dataset.focusKey = `slot-${s.toLowerCase()}:${r.id}`;
      return b;
    };
    box.append(go, slot('A'), slot('B'));
    return box;
  }

  function pairTable(v: PairView): HTMLTableElement {
    const table = el('table', 'dec-table dec-pairtable');
    table.append(el('caption', 'ly-visually-hidden', `${v.a.name} (A) against ${v.b.name} (B), criterion by criterion`));
    const head = el('tr');
    for (const [text, cls] of [['Criterion', 'dec-p-crit'], [`A: ${v.a.name}`, 'dec-p-side'], [`B: ${v.b.name}`, 'dec-p-side'], ['Better', 'dec-p-better'], ['In words', 'dec-p-note']] as const) {
      const c = el('th', cls, text);
      c.scope = 'col';
      head.append(c);
    }
    const thead = el('thead');
    thead.append(head);
    const tbody = el('tbody');
    for (const r of v.rows) {
      const tr = el('tr');
      const name = el('th', 'dec-p-crit', r.label);
      name.scope = 'row';
      const cell = (cls: string, text: string) => el('td', cls, text);
      tr.append(name, cell('ly-value', r.a), cell('ly-value', r.b), cell(`dec-better is-${r.better}`, r.betterText), cell('dec-p-note', r.note));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    return table;
  }

  /** Arrow keys move between the badges of a table (one tab stop for all of them), as in a grid. */
  function roveBadges(table: HTMLTableElement) {
    const first = table.querySelector<HTMLElement>('.dec-badge');
    if (first) first.tabIndex = 0;
    const grid = () => [...table.tBodies[0].rows].map((tr) => [...tr.querySelectorAll<HTMLElement>('.dec-badge')]).filter((row) => row.length);
    table.addEventListener('keydown', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement) || !t.classList.contains('dec-badge')) return;
      const g = grid();
      let r = g.findIndex((row) => row.includes(t));
      if (r < 0) return;
      let c = g[r].indexOf(t);
      if (e.key === 'ArrowRight') c++;
      else if (e.key === 'ArrowLeft') c--;
      else if (e.key === 'ArrowDown') r++;
      else if (e.key === 'ArrowUp') r--;
      else if (e.key === 'Home') c = 0;
      else if (e.key === 'End') c = Infinity;
      else return;
      e.preventDefault();
      r = Math.min(Math.max(r, 0), g.length - 1);
      c = Math.min(Math.max(c, 0), g[r].length - 1);
      g[r][c].focus();
    });
    table.addEventListener('focusin', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement) || !t.classList.contains('dec-badge')) return;
      for (const b of table.querySelectorAll<HTMLElement>('.dec-badge')) b.tabIndex = b === t ? 0 : -1;
    });
  }

  function showTip(anchor: HTMLElement, b: Badge) {
    tip.replaceChildren(el('strong', undefined, `${b.label}: ${b.verdict}`), el('span', undefined, b.reason));
    if (b.scoreText) tip.append(el('span', 'dec-tipscore', `${b.scoreText}.`));
    tip.hidden = false;
    // The tip is placed in the box it is positioned against (the sheet), so it is not clipped by the scrolling body.
    const host = (tip.offsetParent as HTMLElement | null) ?? document.body;
    const h = host.getBoundingClientRect(), a = anchor.getBoundingClientRect();
    const w = tip.offsetWidth, ht = tip.offsetHeight;
    const below = a.bottom - h.top + 6;
    const top = below + ht > h.height - 4 ? a.top - h.top - ht - 6 : below;
    const left = Math.min(Math.max(a.left - h.left, 4), h.width - w - 4);
    tip.style.top = `${Math.max(top, 4)}px`;
    tip.style.left = `${left}px`;
  }

  function hideTip() {
    tip.hidden = true;
  }

  function render() {
    if (!showing()) return;
    if (!loadTried) void load();
    if (replay && !replaying) void runReplay();
    else if (refreshDue) void refreshSettings();
    renderSettings();
    renderSource();
    renderProgress();
    renderResult();
  }

  return { render };
}
