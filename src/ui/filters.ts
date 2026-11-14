import { Landing, programColor } from '../data/landings';

export type TypeFilter = 'all' | 'crewed' | 'robotic';

export interface FilterState {
  programs: Set<string>;
  countries: Set<string>;
  type: TypeFilter;
  fromYear: number;
  toYear: number;
}

const year = (l: Landing) => Number(l.date.slice(0, 4));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Builds the filter panel and the year timeline, and calls `onChange` with a
 * predicate whenever the visible set changes.
 */
export class Filters {
  private readonly state: FilterState;
  private readonly minYear: number;
  private readonly maxYear: number;
  private readonly allPrograms: string[];
  private readonly allCountries: string[];
  private readonly sync: (() => void)[] = [];

  constructor(
    private readonly landings: Landing[],
    panel: HTMLElement,
    timeline: HTMLElement,
    private readonly onChange: (matches: (l: Landing) => boolean) => void,
  ) {
    this.allPrograms = [...new Set(landings.map((l) => l.program))];
    this.allCountries = [...new Set(landings.map((l) => l.country))];
    this.minYear = Math.min(...landings.map(year));
    this.maxYear = Math.max(...landings.map(year));
    this.state = {
      programs: new Set(this.allPrograms),
      countries: new Set(this.allCountries),
      type: 'all',
      fromYear: this.minYear,
      toYear: this.maxYear,
    };
    this.buildPanel(panel);
    this.buildTimeline(timeline);
    this.emit();
  }

  matches = (l: Landing): boolean => {
    const s = this.state;
    const y = year(l);
    return (
      s.programs.has(l.program) &&
      s.countries.has(l.country) &&
      (s.type === 'all' || (s.type === 'crewed') === l.crewed) &&
      y >= s.fromYear &&
      y <= s.toYear
    );
  };

  private emit() {
    for (const fn of this.sync) fn();
    this.onChange(this.matches);
  }

  private reset() {
    const s = this.state;
    s.programs = new Set(this.allPrograms);
    s.countries = new Set(this.allCountries);
    s.type = 'all';
    s.fromYear = this.minYear;
    s.toYear = this.maxYear;
    this.emit();
  }

  private isDefault(): boolean {
    const s = this.state;
    return (
      s.programs.size === this.allPrograms.length &&
      s.countries.size === this.allCountries.length &&
      s.type === 'all' &&
      s.fromYear === this.minYear &&
      s.toYear === this.maxYear
    );
  }

  private buildPanel(panel: HTMLElement) {
    const s = this.state;
    const toggle = (set: Set<string>, key: string) => {
      if (set.has(key)) set.delete(key);
      else set.add(key);
      this.emit();
    };

    // Programs
    panel.append(el('h3', undefined, 'Program'));
    for (const program of this.allPrograms) {
      const btn = el('button', 'filter-row');
      btn.type = 'button';
      const sw = el('span', 'swatch');
      sw.style.background = programColor(program);
      const n = this.landings.filter((l) => l.program === program).length;
      btn.append(sw, el('span', 'label', program), el('span', 'count', String(n)));
      btn.addEventListener('click', () => toggle(s.programs, program));
      this.sync.push(() => btn.setAttribute('aria-pressed', String(s.programs.has(program))));
      panel.append(btn);
    }

    // Countries
    panel.append(el('h3', undefined, 'Country'));
    const chips = el('div', 'chips');
    for (const country of this.allCountries) {
      const chip = el('button', 'chip', country);
      chip.type = 'button';
      chip.addEventListener('click', () => toggle(s.countries, country));
      this.sync.push(() => chip.setAttribute('aria-pressed', String(s.countries.has(country))));
      chips.append(chip);
    }
    panel.append(chips);

    // Crewed / robotic
    panel.append(el('h3', undefined, 'Type'));
    const seg = el('div', 'segmented');
    for (const [value, label] of [['all', 'All'], ['crewed', 'Crewed'], ['robotic', 'Robotic']] as const) {
      const b = el('button', undefined, label);
      b.type = 'button';
      b.addEventListener('click', () => {
        s.type = value;
        this.emit();
      });
      this.sync.push(() => b.setAttribute('aria-pressed', String(s.type === value)));
      seg.append(b);
    }
    panel.append(seg);

    const foot = el('div', 'filter-foot');
    foot.append(el('span', undefined, 'Double ring = crewed'));
    const reset = el('button', 'reset', 'Reset');
    reset.type = 'button';
    reset.addEventListener('click', () => this.reset());
    this.sync.push(() => (reset.disabled = this.isDefault()));
    foot.append(reset);
    panel.append(foot);
  }

  private buildTimeline(root: HTMLElement) {
    const s = this.state;
    const span = this.maxYear - this.minYear;
    const pct = (y: number) => ((y - this.minYear) / span) * 100;

    const head = el('div', 'tl-head');
    const range = el('span', 'tl-range');
    const count = el('span', 'tl-count');
    head.append(range, count);

    const track = el('div', 'tl-track');
    const fill = el('div', 'tl-fill');
    track.append(el('div', 'tl-rail'), fill);

    // One tick per landing, positioned by exact date.
    const ticks: { node: HTMLElement; landing: Landing }[] = [];
    for (const l of this.landings) {
      const d = new Date(`${l.date}T00:00:00Z`);
      const frac = d.getUTCFullYear() + d.getUTCMonth() / 12;
      const tick = el('span', 'tl-tick');
      tick.style.left = `${pct(frac)}%`;
      tick.style.background = programColor(l.program);
      track.append(tick);
      ticks.push({ node: tick, landing: l });
    }

    const makeRange = (label: string, value: number) => {
      const input = el('input');
      input.type = 'range';
      input.min = String(this.minYear);
      input.max = String(this.maxYear);
      input.step = '1';
      input.value = String(value);
      input.setAttribute('aria-label', label);
      return input;
    };
    const from = makeRange('From year', s.fromYear);
    const to = makeRange('To year', s.toYear);
    from.addEventListener('input', () => {
      s.fromYear = Math.min(Number(from.value), s.toYear);
      this.emit();
    });
    to.addEventListener('input', () => {
      s.toYear = Math.max(Number(to.value), s.fromYear);
      this.emit();
    });
    track.append(from, to);

    const axis = el('div', 'tl-axis');
    for (let y = Math.ceil(this.minYear / 10) * 10; y <= this.maxYear; y += 10) {
      const lab = el('span', undefined, String(y));
      lab.style.left = `${pct(y)}%`;
      axis.append(lab);
    }

    root.append(head, track, axis);

    this.sync.push(() => {
      from.value = String(s.fromYear);
      to.value = String(s.toYear);
      // When both thumbs sit together at the right end, keep "from" on top so it can be dragged back.
      from.style.zIndex = s.fromYear > this.minYear + span / 2 ? '3' : '2';
      fill.style.left = `${pct(s.fromYear)}%`;
      fill.style.right = `${100 - pct(s.toYear)}%`;
      range.textContent = s.fromYear === s.toYear ? String(s.fromYear) : `${s.fromYear} – ${s.toYear}`;
      let shown = 0;
      for (const t of ticks) {
        const on = this.matches(t.landing);
        t.node.classList.toggle('off', !on);
        if (on) shown++;
      }
      count.textContent = `${shown} of ${this.landings.length} landings`;
    });
  }
}
