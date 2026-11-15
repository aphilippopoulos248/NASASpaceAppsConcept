// "Go to a landing site": a list of the catalogued landings the mission filters show, in the
// Filters panel. Choosing one runs selectSite, as clicking its marker does. It is the keyboard
// and screen-reader way to a landing (accessibility finding A-1): the markers on the globe
// answer only to the pointer.
import { runAction } from '../../core/actions';
import { matchesFilter, missionFilter, type MissionFilter } from '../../core/missionFilter';
import { store } from '../../core/store';
import { getLandings } from '../../data/catalog';
import type { Landing } from '../../data/landings';
import { el } from '../dom';

let uid = 0;

export interface PickerOption {
  value: string;
  text: string;
}

/** One option per landing the filters show, oldest first (the catalogue's order): "IM-2 Athena, 2025-03-06". */
export function pickerOptions(landings: readonly Landing[], filter: MissionFilter): PickerOption[] {
  return landings.filter((l) => matchesFilter(filter, l)).map((l) => ({ value: l.id, text: `${l.name}, ${l.date}` }));
}

/** The text of the first, empty choice: what the list is for, or why it is empty. */
export function pickerPrompt(shown: number, total: number): string {
  return shown ? `Choose one of ${shown} landing${shown === 1 ? '' : 's'}${shown < total ? ` (of ${total}, as filtered)` : ''}…` : 'No landing matches the mission filters';
}

export function mountLandingPicker(parent: HTMLElement): void {
  const id = `lp-${++uid}`;
  const field = el('div', 'ly-field lp');
  const label = el('label', 'ly-label', 'Go to a landing site');
  label.htmlFor = id;
  const select = el('select', 'ly-select');
  select.id = id;
  select.title = 'Choose a mission to see its details. Double-click the selected mission to enter surface view, or use Enter surface view on its card.';
  field.append(label, select);
  parent.append(field);

  select.addEventListener('change', () => {
    if (select.value) {
      void runAction('selectSite', { site: select.value });
      void runAction('showPanel', { panel: 'site-details', open: true });
    }
  });
  select.addEventListener('dblclick', () => {
    if (select.value) void runAction('selectSite', { site: select.value, surface: true });
  });

  /** Shows the selected site in the list when it is one of the listed landings. */
  const syncChoice = () => {
    const site = store.get().site;
    const listed = site?.kind === 'landing' && [...select.options].some((o) => o.value === site.id);
    select.value = listed ? site!.id : '';
  };

  const render = () => {
    const all = getLandings();
    const options = pickerOptions(all, missionFilter.get());
    select.replaceChildren(new Option(pickerPrompt(options.length, all.length), ''), ...options.map((o) => new Option(o.text, o.value)));
    select.disabled = options.length === 0;
    syncChoice();
  };

  missionFilter.subscribe(render);
  store.subscribe(['site'], syncChoice);
  render();
}
