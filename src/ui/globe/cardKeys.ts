// Keyboard shortcuts of the site card in the globe view: Escape closes the card (clearSite),
// the left and right arrows step through the landings on show.
//
// The card is not the only thing listening for keys on the window. The surface view's Escape
// leaves the surface, and it sets the view back to "globe" before this handler runs: the card
// then saw "globe view, a site selected, Escape" and deselected the site as well. One press
// must do one thing, so the card acts only when
//   - nobody has claimed the press already (`defaultPrevented`), and
//   - the globe was the view at the moment the key went down, whatever handlers did since.
// No DOM types beyond the event: the rule is tested without a browser (cardKeys.test.ts).
import type { ViewMode } from '../../core/types';

export type CardKeyCommand = 'clearSite' | 'next' | 'previous';

export interface KeyPress {
  key: string;
  target: unknown;
  defaultPrevented: boolean;
  preventDefault(): void;
}

/** The part of `window` this needs. */
export interface KeySource {
  addEventListener(type: 'keydown', listener: (e: KeyPress) => void, capture?: boolean): void;
}

export interface CardKeyDeps {
  view(): ViewMode;
  hasSite(): boolean;
  /** True when the press belongs to a text field. */
  isTyping(target: unknown): boolean;
  act(command: CardKeyCommand): void;
}

const COMMANDS: Record<string, CardKeyCommand> = { Escape: 'clearSite', ArrowRight: 'next', ArrowLeft: 'previous' };

export function bindCardKeys(source: KeySource, deps: CardKeyDeps): void {
  let viewAtKeydown: ViewMode = deps.view();
  // Capture phase on the window: this runs before any other handler of the same press.
  source.addEventListener('keydown', () => (viewAtKeydown = deps.view()), true);
  source.addEventListener('keydown', (e) => {
    const command = COMMANDS[e.key];
    if (!command || e.defaultPrevented) return;
    if (viewAtKeydown !== 'globe' || deps.view() !== 'globe' || !deps.hasSite() || deps.isTyping(e.target)) return;
    // Claimed: a later handler that checks defaultPrevented leaves this press alone.
    e.preventDefault();
    deps.act(command);
  });
}
