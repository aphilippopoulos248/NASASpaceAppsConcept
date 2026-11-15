// Presentation phase for the lunar intro overlay. Kept off AppState.view / ViewMode so
// SceneHost, deep links and body[data-view] keep meaning only globe | surface.
import type { DeepLink } from '../../core/deepLink';

export type PresentationPhase = 'intro' | 'app';

/** True when a deep link already names a place or surface destination. */
export function isDestinationDeepLink(link: DeepLink): boolean {
  return Boolean(link.site || link.preset || link.view === 'surface');
}

/**
 * Whether to show the intro overlay after load.
 * Skipped for reduced motion (also the e2e default), destination deep links, and ?skipIntro=1.
 */
export function shouldShowIntro(link: DeepLink, opts: { reducedMotion: boolean; search?: string } = { reducedMotion: false }): boolean {
  if (opts.reducedMotion) return false;
  if (isDestinationDeepLink(link)) return false;
  const q = new URLSearchParams(opts.search ?? '');
  if (q.get('skipIntro') === '1') return false;
  return true;
}

export function readPhase(body: HTMLElement = document.body): PresentationPhase {
  return body.dataset.phase === 'intro' ? 'intro' : 'app';
}

/** Applies the presentation phase on body and returns it. */
export function setPhase(phase: PresentationPhase, body: HTMLElement = document.body): PresentationPhase {
  body.dataset.phase = phase;
  return phase;
}
