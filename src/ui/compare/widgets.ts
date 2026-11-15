// Small building blocks shared by the tabs of the compare panel: slot badges, number fields
// that show action errors on themselves, a status line with the helper that runs an action
// from a control and reports what happened, and the rows of the A / B / B − A table.
import { runAction } from '../../core/actions';
import { button, el } from '../dom';
import type { CompareRow } from './model';

let uid = 0;
export const nextId = (stem: string) => `cmp-${stem}-${++uid}`;

/** The letter of a comparison slot in a small box. Decorative: the text beside it names the slot. */
export function badge(slot: 'A' | 'B'): HTMLElement {
  const b = el('span', 'cmp-badge', slot);
  b.setAttribute('aria-hidden', 'true');
  return b;
}

export type Outcome = { ok: boolean; error?: string };

export interface NumberField {
  wrap: HTMLElement;
  row: HTMLElement;
  input: HTMLInputElement;
  /** The typed number, or null when the field is empty or not a number. */
  read(): number | null;
  /** Shows a value from the app state, unless the user is typing in the field. */
  show(v: number | null): void;
}

/** A labelled number input with a unit. `commit` runs on change; a failure is shown on the field. */
export function numberField(label: string, unit: string, opts: { min: number; max: number; step: number; value?: number; placeholder?: string }, commit?: (v: number | null) => Promise<Outcome>): NumberField {
  const id = nextId('f');
  const wrap = el('div', 'cmp-field');
  const lab = el('label', 'ly-label', label);
  lab.htmlFor = id;
  const input = el('input', 'ly-input');
  input.id = id;
  input.type = 'number';
  input.inputMode = 'decimal';
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  if (opts.value !== undefined) input.value = String(opts.value);
  if (opts.placeholder) input.placeholder = opts.placeholder;
  const row = el('div', 'cmp-field-row');
  row.append(input, el('span', 'ly-unit', unit));
  wrap.append(lab, row);
  if (commit) {
    input.addEventListener('change', async () => {
      const empty = input.value.trim() === '';
      const v = Number(input.value);
      if (!empty && !Number.isFinite(v)) return;
      const r = await commit(empty ? null : v);
      input.setAttribute('aria-invalid', String(!r.ok));
      input.title = r.ok ? '' : (r.error ?? '');
    });
  }
  return {
    wrap,
    row,
    input,
    read: () => (input.value.trim() === '' || !Number.isFinite(Number(input.value)) ? null : Number(input.value)),
    show(v) {
      if (document.activeElement === input) return;
      input.value = v === null ? '' : String(v);
      input.removeAttribute('aria-invalid');
      input.title = '';
    },
  };
}

/** What a tab needs to run actions from its controls and say what happened. */
export interface TabKit {
  /** The tab's status line (a live region); the tab places it. */
  status: HTMLElement;
  /** Runs an action and writes `done` (or the error) into the status line. */
  act(name: string, params: unknown, done: string | ((result: any) => string)): Promise<{ ok: boolean; result?: any; error?: string }>;
  /** Runs an action without touching the status line (fields show their own errors). */
  run(name: string, params: unknown): Promise<Outcome>;
  /** Writes a problem into the status line. */
  complain(text: string): void;
  numberField: typeof numberField;
  button: typeof button;
}

export function createTabKit(): TabKit {
  const status = el('p', 'cmp-status');
  status.setAttribute('role', 'status');
  const say = (text: string, isError: boolean) => {
    status.textContent = text;
    status.classList.toggle('is-error', isError);
  };
  return {
    status,
    async act(name, params, done) {
      say('', false);
      const r = await runAction<any>(name, params);
      say(r.ok ? (typeof done === 'string' ? done : done(r.result)) : r.error, !r.ok);
      return r;
    },
    run: (name, params) => runAction(name, params),
    complain: (text) => say(text, true),
    numberField,
    button,
  };
}

const TONE_WORD: Record<CompareRow['tone'], string> = { better: ' (B better)', worse: ' (B worse)', same: '', none: '' };

/**
 * A group of rows in the A / B / B − A table: a title row, then one row per figure. Rows are
 * updated in place while their keys stay the same, so a running clock does not rebuild them.
 */
export function rowGroup(title: HTMLElement): { group: HTMLElement; set(rows: readonly CompareRow[]): void } {
  const group = el('div', 'cmp-group');
  group.setAttribute('role', 'rowgroup');
  const titleRow = el('div', 'cmp-row cmp-grouprow');
  titleRow.setAttribute('role', 'row');
  title.setAttribute('role', 'columnheader');
  title.setAttribute('aria-colspan', '4');
  title.classList.add('cmp-grouptitle');
  titleRow.append(title);
  group.append(titleRow);
  let keys = '';
  const cells = new Map<string, { a: HTMLElement; b: HTMLElement; delta: HTMLElement; text: Text; tone: HTMLElement }>();

  return {
    group,
    set(rows) {
      const next = rows.map((r) => r.key).join('|');
      if (next !== keys) {
        keys = next;
        cells.clear();
        while (group.lastChild !== titleRow) group.lastChild!.remove();
        for (const row of rows) {
          const tr = el('div', 'cmp-row');
          tr.setAttribute('role', 'row');
          const th = el('div', 'cmp-th', row.label);
          th.setAttribute('role', 'rowheader');
          if (row.hint) th.title = row.hint;
          const cell = (cls: string) => {
            const td = el('div', cls);
            td.setAttribute('role', 'cell');
            return td;
          };
          const a = cell('cmp-td ly-value'), b = cell('cmp-td ly-value'), delta = cell('cmp-td cmp-delta ly-value');
          const text = document.createTextNode('');
          const tone = el('span', 'ly-visually-hidden');
          delta.append(text, tone);
          tr.append(th, a, b, delta);
          group.append(tr);
          cells.set(row.key, { a, b, delta, text, tone });
        }
      }
      for (const row of rows) {
        const c = cells.get(row.key)!;
        c.a.textContent = row.a;
        c.b.textContent = row.b;
        c.delta.className = `cmp-td cmp-delta ly-value tone-${row.tone}`;
        c.text.data = row.delta;
        c.tone.textContent = row.delta ? TONE_WORD[row.tone] : '';
      }
    },
  };
}
