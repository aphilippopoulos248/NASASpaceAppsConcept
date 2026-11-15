// Registered actions for the surface view's movable panels (decisions D-1 and D-3): the
// grips, the Fold buttons and "Reset panels" run these, and the assistant gets the same
// tools. The layout rules are in panelLayout.ts.
import { ActionError, defineAction, type ActionDef } from '../../core/actions';
import { drawn } from './hudActions';
import { PANEL_IDS, SURFACE_PANELS, titleOf, type PanelId, type PanelLayout } from './panelLayout';

export interface PanelActionContext {
  layout: PanelLayout;
  /** True while the surface view is shown: panels move and fold there only. */
  isSurface: () => boolean;
}

const PANEL_LIST = SURFACE_PANELS.map((p) => `"${p.id}" (${p.title})`).join(', ');

export function createPanelActions(ctx: PanelActionContext): ActionDef<any, any>[] {
  const { layout } = ctx;
  return [
    defineAction<{ panel: PanelId; folded?: boolean; xPx?: number; yPx?: number }, unknown>({
      name: 'setSurfacePanel',
      title: 'Move or fold a surface panel',
      description:
        `Moves and/or folds one of the surface view's panels, as dragging its grip or pressing its Fold button does. \`panel\`: ${PANEL_LIST}. ` +
        '`folded`: true folds it to its title row, false opens it again. `xPx`, `yPx`: where its top left corner goes, in CSS pixels from the top left of the window; either may be left out, and the panel is kept inside the window. ' +
        'Works in the surface view, on a panel that is on screen (open the comparison or the assistant first). Returns the panel\'s state: shown, folded, moved, and its box in pixels.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          panel: { type: 'string', description: 'Which panel.', enum: [...PANEL_IDS] },
          folded: { type: 'boolean', description: 'true = folded to its title row, false = open.' },
          xPx: { type: 'number', description: 'Left edge, CSS px from the left of the window.', minimum: -100000, maximum: 100000 },
          yPx: { type: 'number', description: 'Top edge, CSS px from the top of the window.', minimum: -100000, maximum: 100000 },
        },
        required: ['panel'],
      },
      run: async ({ panel, folded, xPx, yPx }) => {
        if (folded === undefined && xPx === undefined && yPx === undefined) throw new ActionError('Give `folded`, or `xPx` and/or `yPx`.');
        if (!ctx.isSurface()) throw new ActionError('The panels move and fold in the surface view only: enter it first (enterSurface).');
        if (!layout.has(panel)) throw new ActionError(`The ${titleOf(panel)} panel is not on this page.`);
        if (!layout.state(panel).shown) {
          const how =
            panel === 'compare' ? ' Open the comparison first.'
            : panel === 'assistant' ? ' Open the assistant first.'
            : panel === 'surface-controls' ? ' It gives way while the skyline chart is expanded: shrink the chart first (setChart with expanded false).'
            : '';
          throw new ActionError(`The ${titleOf(panel)} panel is not on screen.${how}`);
        }
        if (folded !== undefined) layout.fold(panel, folded);
        if (xPx !== undefined || yPx !== undefined) layout.move(panel, { x: xPx, y: yPx });
        await drawn();
        return layout.state(panel);
      },
    }),
    defineAction({
      name: 'resetSurfacePanels',
      title: 'Reset the surface panels',
      description: 'Puts every surface panel back in its place and opens the folded ones, as the "Reset panels" button does. Returns the state of each panel.',
      effect: 'command',
      params: { type: 'object', properties: {} },
      run: async () => {
        layout.reset();
        await drawn();
        return { panels: layout.states() };
      },
    }),
    defineAction({
      name: 'getSurfacePanels',
      title: 'Surface panels',
      description: `Lists the surface view's panels (${PANEL_LIST}) with their state: on screen or not, folded, moved away from their place, and their box in CSS pixels.`,
      effect: 'query',
      params: { type: 'object', properties: {} },
      run: () => ({ surfaceView: ctx.isSurface(), panels: layout.states() }),
    }),
  ];
}
