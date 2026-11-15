// The compare panel: the launcher that opens it, the sheet with its tabs, and the keyboard
// handling. Open while store.comparing is true.
//
// Everything shown is read from the app store and the analysis store (the same comparison
// the `compare` action reports); every control runs a registered action (decision D-1), so
// the assistant can do whatever the panel can. Nothing here computes science: the rows and
// sentences come from model.ts, which only formats what the science core returned.
import { onAction, registerActions, runAction } from '../../core/actions';
import { analysis } from '../../core/analysisStore';
import { store } from '../../core/store';
import { button, el, isTypingTarget } from '../dom';
import { mountAbTab } from './abTab';
import { bindWorkingPair, createCompareActions } from './actions';
import { mountNearbyTab } from './nearbyTab';
import { mountWindowsTab } from './windowsTab';
import { COMPARE_TABS, createPanelStore, TAB_TITLE, type CompareTab } from './state';
import { createCompareStorage } from './storage';
import { badge, createTabKit, nextId } from './widgets';
import './compare.css';

/** Hands a finished file to the browser as a download. */
function browserDownload(filename: string, mimeType: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** localStorage, or null where the browser refuses it (private modes, blocked storage). */
function browserStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function mountComparePanel(region: HTMLElement): void {
  const panel = createPanelStore();
  const storage = createCompareStorage(browserStorage());
  // Before the analysis store starts (main.ts starts it after mounting), so a reload analyses the restored pair once.
  bindWorkingPair(store, storage);
  registerActions(createCompareActions({ store, analysis, panel, storage, download: browserDownload }));

  // ---------- launcher: the way in, on screen while the panel is closed ----------
  const launcher = button('', 'ly-btn cmp-launcher', async () => {
    await runAction('openCompare');
    sheet.focus();
  });
  launcher.setAttribute('aria-haspopup', 'dialog');
  const launchA = badge('A'), launchB = badge('B');
  launcher.append(el('span', undefined, 'Compare'), launchA, launchB);

  // ---------- sheet ----------
  const sheet = el('div', 'ly-panel cmp-sheet');
  const titleId = nextId('title');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-labelledby', titleId);
  sheet.tabIndex = -1;
  sheet.hidden = true;

  const head = el('header', 'cmp-head');
  const title = el('h2', 'ly-panel-title', 'Compare');
  title.id = titleId;
  const tablist = el('div', 'cmp-tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Sections of the comparison');
  tablist.hidden = COMPARE_TABS.length < 2;
  const close = button('×', 'ly-btn ly-btn--ghost ly-btn--icon cmp-close', () => void closePanel());
  close.setAttribute('aria-label', 'Close the comparison');
  close.title = 'Close (Esc). Scenarios A and B are kept.';
  head.append(title, tablist, close);

  const body = el('div', 'cmp-body');
  sheet.append(head, body);
  region.append(launcher, sheet);

  const tabButtons = new Map<CompareTab, HTMLButtonElement>();
  const tabPanels = new Map<CompareTab, HTMLElement>();
  for (const tab of COMPARE_TABS) {
    const b = button(TAB_TITLE[tab], 'ly-btn ly-btn--small cmp-tab', () => void runAction('openCompare', { tab }));
    b.id = nextId('tab');
    b.setAttribute('role', 'tab');
    const p = el('div', 'cmp-tabpanel');
    p.id = nextId('panel');
    p.setAttribute('role', 'tabpanel');
    p.setAttribute('aria-labelledby', b.id);
    b.setAttribute('aria-controls', p.id);
    tablist.append(b);
    body.append(p);
    tabButtons.set(tab, b);
    tabPanels.set(tab, p);
  }
  // Arrow keys move between tabs (roving tabindex), as in the ARIA tabs pattern.
  tablist.addEventListener('keydown', (e) => {
    const i = COMPARE_TABS.indexOf(panel.get().tab), last = COMPARE_TABS.length - 1;
    const to = e.key === 'ArrowRight' ? (i === last ? 0 : i + 1) : e.key === 'ArrowLeft' ? (i === 0 ? last : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1;
    if (to < 0) return;
    e.preventDefault();
    const tab = COMPARE_TABS[to];
    void runAction('openCompare', { tab }).then(() => tabButtons.get(tab)!.focus());
  });

  const isOpen = () => store.get().comparing;
  async function closePanel() {
    const hadFocus = sheet.contains(document.activeElement);
    await runAction('stopCompare');
    if (hadFocus) launcher.focus();
  }

  const ab = mountAbTab(tabPanels.get('compare')!, storage, createTabKit());
  const nearby = mountNearbyTab(tabPanels.get('nearby')!, panel, createTabKit());
  const windows = mountWindowsTab(tabPanels.get('windows')!, panel, createTabKit());

  // ---------- rendering ----------
  const renderLauncher = () => {
    const s = store.get();
    launchA.classList.toggle('is-filled', Boolean(s.compareA));
    launchB.classList.toggle('is-filled', Boolean(s.compareB));
    launcher.setAttribute('aria-label', `Compare scenarios. Slot A: ${s.compareA?.label ?? 'empty'}. Slot B: ${s.compareB?.label ?? 'empty'}.`);
    launcher.title = `A: ${s.compareA?.label ?? 'empty'}\nB: ${s.compareB?.label ?? 'empty'}`;
  };

  const renderOpen = () => {
    const s = store.get();
    sheet.hidden = !s.comparing;
    launcher.hidden = s.comparing;
    launcher.setAttribute('aria-expanded', String(s.comparing));
    region.classList.toggle('cmp-with-drawer', s.assistantOpen);
    const tab = panel.get().tab;
    for (const [name, b] of tabButtons) {
      b.setAttribute('aria-selected', String(name === tab));
      b.tabIndex = name === tab ? 0 : -1;
    }
    for (const [name, p] of tabPanels) p.hidden = name !== tab;
  };

  /** Draws the tab on screen from the stores. The other tabs are drawn when they are shown. */
  const renderTab = () => {
    if (!isOpen()) return;
    const tab = panel.get().tab;
    if (tab === 'compare') {
      ab.renderSetup();
      ab.renderRequirementInputs();
      ab.renderResult();
      ab.renderSaved();
    } else if (tab === 'nearby') nearby.render();
    else if (tab === 'windows') windows.render();
  };
  const showing = (tab: CompareTab) => isOpen() && panel.get().tab === tab;

  const renderAll = () => {
    renderLauncher();
    renderOpen();
    renderTab();
  };

  store.subscribe(['comparing', 'assistantOpen'], renderAll);
  panel.subscribe((_, changed) => {
    if (changed.has('tab')) {
      renderOpen();
      renderTab();
    }
    if (changed.has('savedRevision') && showing('compare')) ab.renderSaved();
    if ((changed.has('nearbyRadiusM') || changed.has('nearbySpacingM')) && showing('nearby')) nearby.render();
    if (changed.has('tableSlot') && showing('windows')) windows.render();
  });
  store.subscribe(['site', 'mastHeightM', 'windowStartMs', 'windowDurationH', 'delayH'], () => {
    if (showing('compare')) ab.renderSetup();
    else if (showing('nearby')) nearby.render();
    else if (showing('windows')) windows.render();
  });
  store.subscribe(['compareA', 'compareB'], () => {
    renderLauncher();
    if (showing('windows')) windows.render();
    if (!showing('compare')) return;
    ab.renderSetup();
    ab.renderResult();
    ab.renderSaved();
  });
  store.subscribe(['sunElMinDeg', 'sunElMaxDeg', 'maxEarthGapH', 'slopeLimitDeg'], () => {
    if (showing('nearby')) nearby.render();
    if (!showing('compare')) return;
    ab.renderRequirementInputs();
    ab.renderResult();
  });
  analysis.subscribe((slot) => {
    if ((slot === 'A' || slot === 'B') && showing('compare')) ab.renderResult();
    else if (slot === 'nearby' && showing('nearby')) nearby.render();
    else if (slot !== 'nearby' && showing('windows')) windows.render();
  });
  // One clock for both sides: follow it a few times a second while it runs, exactly when it stops.
  let lastNowMs = -Infinity;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  const renderNow = () => {
    lastNowMs = performance.now();
    if (showing('compare')) ab.renderNow();
  };
  store.subscribe(['timeMs'], () => {
    if (!showing('compare')) return;
    if (trailing) clearTimeout(trailing);
    if (performance.now() - lastNowMs > 250) renderNow();
    else trailing = setTimeout(renderNow, 260);
  });
  // `compare` means "show me the comparison": bring its tab forward when it has run.
  onAction((entry) => entry.ok && entry.name === 'compare' && panel.set({ tab: 'compare' }));

  // Keys pressed inside the sheet stay inside it (the globe and the site card listen on the window).
  sheet.addEventListener('keydown', (e) => e.stopPropagation());
  // Escape closes the topmost layer first: this panel, before the site card or the surface view react.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !isOpen() || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      const inside = target !== null && sheet.contains(target);
      // Another layer with its own Escape (the assistant drawer), or a field outside the sheet, keeps the key.
      if (!inside && target && (target.closest('#region-drawer') || isTypingTarget(target))) return;
      // Taken: the surface view and the site card leave an Escape that was handled alone.
      e.preventDefault();
      e.stopPropagation();
      void closePanel();
    },
    true,
  );

  renderAll();
}
