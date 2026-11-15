// Intro / main-menu overlay over the live globe. Presentation phase only — does not touch ViewMode.
import { button, el } from '../dom';
import { readPhase, setPhase, type PresentationPhase } from './phase';
import './intro.css';

export interface IntroHandle {
  root: HTMLElement;
  enter: HTMLButtonElement;
  /** Resolves when the user enters (or when already in app). */
  done: Promise<void>;
  /** Crossfade to the app HUD without restarting the scene. */
  dismiss: () => Promise<void>;
  /** Tear down listeners and DOM. */
  dispose: () => void;
}

export interface MountIntroOptions {
  /** Called once as the overlay begins leaving (before the crossfade finishes). */
  onEnter?: () => void;
  reducedMotion?: boolean;
}

const LEAVE_MS = 420;

export function mountIntro(region: HTMLElement, opts: MountIntroOptions = {}): IntroHandle {
  const reduced = opts.reducedMotion ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = el('div', 'intro');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'intro-brand');

  const atmosphere = el('div', 'intro-atmosphere');
  atmosphere.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 7; i++) atmosphere.append(el('span', 'intro-debris'));
  for (let i = 0; i < 6; i++) atmosphere.append(el('span', 'intro-flyby'));
  for (let i = 0; i < 2; i++) atmosphere.append(el('span', 'intro-reverse-star'));

  const panel = el('div', 'intro-panel');
  const eyebrow = el('p', 'intro-eyebrow', 'Lunar landing site navigator');
  const brand = el('h1', 'intro-brand', 'LUNYX');
  brand.id = 'intro-brand';
  const copy = el('p', 'intro-copy', 'Pick a place and a date on the Moon, then drop to the surface and see the real skyline.');
  const enter = button('Enter the Moon', 'ly-btn ly-btn--primary intro-enter');
  enter.type = 'button';
  const credit = el('p', 'intro-credit', 'NASA Space Apps 2026');
  panel.append(eyebrow, brand, copy, enter, credit);
  root.append(atmosphere, panel);
  region.append(root);

  let settled = readPhase() !== 'intro';
  let leaveTimer: number | null = null;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
    if (settled) resolve();
  });

  const syncChrome = (phase: PresentationPhase) => {
    const shell = document.getElementById('shell');
    const scene = document.getElementById('scene') as HTMLCanvasElement | null;
    if (shell) {
      shell.toggleAttribute('inert', phase === 'intro');
      shell.setAttribute('aria-hidden', phase === 'intro' ? 'true' : 'false');
    }
    if (scene) {
      if (phase === 'intro') {
        scene.tabIndex = -1;
        scene.setAttribute('aria-hidden', 'true');
        scene.style.pointerEvents = 'none';
      } else {
        scene.tabIndex = 0;
        scene.removeAttribute('aria-hidden');
        scene.style.pointerEvents = '';
      }
    }
    root.hidden = phase !== 'intro' && !root.classList.contains('is-leaving');
    root.toggleAttribute('inert', phase !== 'intro');
    document.body.classList.toggle('intro-ready', phase === 'intro');
  };

  const dismiss = (): Promise<void> => {
    if (settled) return done;
    settled = true;
    opts.onEnter?.();
    root.classList.add('is-leaving');
    root.toggleAttribute('inert', true);
    setPhase('app');
    syncChrome('app');
    const finish = () => {
      if (leaveTimer !== null) {
        window.clearTimeout(leaveTimer);
        leaveTimer = null;
      }
      root.hidden = true;
      root.classList.remove('is-leaving');
      document.body.classList.remove('intro-ready');
      resolveDone();
    };
    if (reduced) {
      finish();
      return done;
    }
    leaveTimer = window.setTimeout(finish, LEAVE_MS);
    return done;
  };

  const onClick = () => void dismiss();
  enter.addEventListener('click', onClick);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || readPhase() !== 'intro' || settled) return;
    e.preventDefault();
    void dismiss();
  };
  window.addEventListener('keydown', onKey);

  // Reveal or hide according to the phase already on the body (main.ts decides show vs skip).
  syncChrome(readPhase());
  if (readPhase() === 'intro') {
    // Focus after the current paint so the loading overlay can finish fading first.
    requestAnimationFrame(() => {
      if (readPhase() === 'intro' && !root.hidden) enter.focus({ preventScroll: true });
    });
  }

  return {
    root,
    enter,
    done,
    dismiss,
    dispose: () => {
      enter.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
      if (leaveTimer !== null) window.clearTimeout(leaveTimer);
      root.remove();
      document.body.classList.remove('intro-ready');
    },
  };
}
