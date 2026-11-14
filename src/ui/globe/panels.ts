// Open/closed state of the globe view's two collapsible panels: the Filters sheet (it only
// collapses on narrow screens) and the details of the site card. Presentation state, kept
// here rather than in AppState; changed through the showPanel action like everything else.
import { defineAction, registerActions } from '../../core/actions';

export type PanelName = 'filters' | 'site-details';

const narrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches;

const open: Record<PanelName, boolean> = { filters: false, 'site-details': true };
const listeners = new Set<(panel: PanelName, open: boolean) => void>();
let registered = false;

export function isPanelOpen(panel: PanelName): boolean {
  // On wide screens the Filters panel is always on screen.
  return panel === 'filters' && !narrow() ? true : open[panel];
}

export function onPanelChange(fn: (panel: PanelName, open: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Registers the showPanel action (once) and sets the phone defaults: details folded away. */
export function initPanels(): void {
  if (registered) return;
  registered = true;
  open['site-details'] = !narrow();
  registerActions([
    defineAction<{ panel: PanelName; open: boolean }, unknown>({
      name: 'showPanel',
      title: 'Open or fold a panel',
      description:
        'Opens or folds away a panel of the globe view: "site-details" is the body of the selected site\'s card (facts, sky now, mission-window results; the title and its buttons always stay), "filters" is the Filters panel, which only folds on narrow (phone) screens.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          panel: { type: 'string', description: 'Which panel.', enum: ['filters', 'site-details'] },
          open: { type: 'boolean', description: 'true = open, false = folded away.' },
        },
        required: ['panel', 'open'],
      },
      run: ({ panel, open: want }) => {
        open[panel] = want;
        for (const fn of [...listeners]) fn(panel, isPanelOpen(panel));
        return { panel, open: isPanelOpen(panel), ...(panel === 'filters' && !narrow() && { note: 'On a screen this wide the Filters panel is always open.' }) };
      },
    }),
  ]);
}
