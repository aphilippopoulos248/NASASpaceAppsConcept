// Mission filters: program, country, crewed/robotic and the year range. Reads the mission
// filter store and changes it only through the setFilters action.
import { runAction } from '../core/actions';
import { isDefaultFilter, landingYear, matchesFilter, MissionFilter, missionFilter, MissionType } from '../core/missionFilter';
import { Landing, programColor } from '../data/landings';
import { button, el } from './dom';
import './filters.css';

export function mountMissionFilters(root: HTMLElement, landings: readonly Landing[]): void {
  const programs = [...new Set(landings.map((l) => l.program))];
  const countries = [...new Set(landings.map((l) => l.country))];
  const minYear = Math.min(...landings.map(landingYear));
  const maxYear = Math.max(...landings.map(landingYear));
  const sync: ((f: MissionFilter) => void)[] = [];
  const shown = (list: readonly string[] | null, key: string) => list === null || list.includes(key);
  const toggled = (current: readonly string[] | null, all: string[], key: string) => {
    const set = new Set(current ?? all);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    return all.filter((k) => set.has(k));
  };

  // Programs
  root.append(el('h3', 'ly-section-title', 'Program'));
  const progList = el('div', 'mf-programs');
  for (const program of programs) {
    const n = landings.filter((l) => l.program === program).length;
    const b = button('', 'mf-row');
    const sw = el('span', 'ly-swatch');
    sw.style.background = programColor(program);
    b.append(sw, el('span', 'mf-label', program), el('span', 'ly-value mf-count', String(n)));
    b.setAttribute('aria-label', `${program}, ${n} landings`);
    b.addEventListener('click', () => void runAction('setFilters', { programs: toggled(missionFilter.get().programs, programs, program) }));
    sync.push((f) => b.setAttribute('aria-pressed', String(shown(f.programs, program))));
    progList.append(b);
  }
  root.append(progList);

  // Countries
  root.append(el('h3', 'ly-section-title', 'Country'));
  const chips = el('div', 'ly-chips');
  for (const country of countries) {
    const chip = button(country, 'ly-btn ly-btn--small', () => void runAction('setFilters', { countries: toggled(missionFilter.get().countries, countries, country) }));
    sync.push((f) => chip.setAttribute('aria-pressed', String(shown(f.countries, country))));
    chips.append(chip);
  }
  root.append(chips);

  // Crewed / robotic
  root.append(el('h3', 'ly-section-title', 'Type'));
  const seg = el('div', 'ly-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Mission type');
  for (const [value, label] of [['all', 'All'], ['crewed', 'Crewed'], ['robotic', 'Robotic']] as [MissionType, string][]) {
    const b = button(label, 'ly-btn ly-btn--small', () => void runAction('setFilters', { type: value }));
    sync.push((f) => b.setAttribute('aria-pressed', String(f.type === value)));
    seg.append(b);
  }
  root.append(seg);

  // Years: dual-thumb range with one tick per landing.
  root.append(el('h3', 'ly-section-title', 'Years'));
  const head = el('div', 'mf-years-head');
  const range = el('span', 'ly-value mf-range');
  const count = el('span', 'ly-label ly-value');
  head.append(range, count);
  const track = el('div', 'mf-track');
  const fill = el('div', 'mf-fill');
  track.append(el('div', 'mf-rail'), fill);
  const span = maxYear - minYear || 1;
  const pct = (y: number) => ((y - minYear) / span) * 100;
  const ticks: { node: HTMLElement; landing: Landing }[] = [];
  for (const l of landings) {
    const d = new Date(`${l.date}T00:00:00Z`);
    const tick = el('span', 'mf-tick');
    tick.style.left = `${pct(d.getUTCFullYear() + d.getUTCMonth() / 12)}%`;
    tick.style.background = programColor(l.program);
    track.append(tick);
    ticks.push({ node: tick, landing: l });
  }
  const makeRange = (label: string) => {
    const input = el('input');
    input.type = 'range';
    input.min = String(minYear);
    input.max = String(maxYear);
    input.step = '1';
    input.setAttribute('aria-label', label);
    return input;
  };
  const from = makeRange('From year');
  const to = makeRange('To year');
  from.addEventListener('input', () => {
    const t = missionFilter.get().toYear ?? maxYear;
    void runAction('setFilters', { fromYear: Math.min(Number(from.value), t) });
  });
  to.addEventListener('input', () => {
    const f = missionFilter.get().fromYear ?? minYear;
    void runAction('setFilters', { toYear: Math.max(Number(to.value), f) });
  });
  track.append(from, to);
  const axis = el('div', 'mf-axis');
  for (let y = Math.ceil(minYear / 10) * 10; y <= maxYear; y += 10) {
    const lab = el('span', 'ly-value', String(y));
    lab.style.left = `${pct(y)}%`;
    axis.append(lab);
  }
  root.append(head, track, axis);

  const foot = el('div', 'mf-foot');
  foot.append(el('span', 'ly-note', 'Double ring = crewed'));
  const reset = button('Reset', 'ly-btn ly-btn--small', () => void runAction('setFilters', { reset: true }));
  foot.append(reset);
  root.append(foot);

  sync.push((f) => {
    const a = f.fromYear ?? minYear, b = f.toYear ?? maxYear;
    from.value = String(a);
    to.value = String(b);
    // When both thumbs sit together at the right end, keep "from" on top so it can be dragged back.
    from.style.zIndex = a > minYear + span / 2 ? '3' : '2';
    fill.style.left = `${pct(a)}%`;
    fill.style.right = `${100 - pct(b)}%`;
    range.textContent = a === b ? String(a) : `${a} – ${b}`;
    let n = 0;
    for (const t of ticks) {
      const on = matchesFilter(f, t.landing);
      t.node.classList.toggle('off', !on);
      if (on) n++;
    }
    count.textContent = `${n} of ${landings.length} landings`;
    reset.disabled = isDefaultFilter(f, landings);
  });
  const apply = (f: MissionFilter) => sync.forEach((fn) => fn(f));
  missionFilter.subscribe(apply);
  apply(missionFilter.get());
}
