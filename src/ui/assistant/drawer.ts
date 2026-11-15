// The assistant in the app shell: the discreet button lower right and the drawer that
// slides out from the right edge. The drawer shows the conversation and, under each reply,
// the actions that reply ran (taken from the action log), so the user sees what was done.
//
// All behaviour lives in src/assistant/: this file is the view. The assistant acts only
// through the action registry (`toolDefinitions()` / `runAction`), like every other control.
import { DeterministicEngine } from '../../assistant/deterministic/engine';
import { accuracyNote, isLanguageModel, replyLabel } from '../../assistant/labels';
import { escapeClosesDrawer } from './escape';
import { DETERMINISTIC_LABEL } from '../../assistant/protocol';
import { AssistantSession, type ChatMessage } from '../../assistant/session';
import { httpTransport } from '../../assistant/transport';
import { createDictation, type Dictation } from '../../assistant/voice';
import { defineAction, getAction, registerActions, runAction, type ActionLogEntry } from '../../core/actions';
import { store } from '../../core/store';
import { button, el } from '../dom';
import './drawer.css';

const DRAWER_ID = 'assistant-drawer';
const INPUT_ID = 'assistant-input';

const ICON_CHAT = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11.5a7.5 7.5 0 0 1-11.1 6.6L4 19.5l1.5-4.3A7.5 7.5 0 1 1 20 11.5Z"/><path d="M9 10.5h6M9 13.5h3.5"/></svg>`;
const ICON_MIC = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg>`;

const SUGGESTIONS = ['Go to IM-2 and enter the surface', 'Compare with a 24 h delay', 'Find a flatter nearby site with a shorter blackout', 'help'];

let shared: AssistantSession | null = null;
let clearWhenIdle = false;

/** The one conversation of this page. */
function session(): AssistantSession {
  if (shared) return shared;
  const s = new AssistantSession({ transport: httpTransport(), responder: new DeterministicEngine() });
  shared = s;
  s.subscribe(() => {
    if (clearWhenIdle && !s.busy) {
      clearWhenIdle = false;
      s.clear();
    }
  });
  registerActions([
    defineAction<{ open: boolean }, unknown>({
      name: 'setAssistantOpen',
      title: 'Open or close the assistant',
      description: 'Opens or closes the assistant drawer (the chat panel that slides out on the right). Use it only when the user asks to open, close or hide the assistant.',
      effect: 'command',
      params: { type: 'object', properties: { open: { type: 'boolean', description: 'true opens the drawer, false closes it.' } }, required: ['open'] },
      run: ({ open }) => {
        store.set({ assistantOpen: open });
        return { assistantOpen: store.get().assistantOpen };
      },
    }),
    defineAction({
      name: 'clearConversation',
      title: 'Clear the conversation',
      description: 'Clears the assistant conversation: what the drawer shows and what the assistant remembers of it. Nothing in the navigator itself changes. Use it only when the user asks to start over or to clear the chat.',
      effect: 'command',
      params: { type: 'object', properties: {} },
      run: () => {
        // During a turn the conversation is cleared once that turn has finished.
        if (s.busy) clearWhenIdle = true;
        else s.clear();
        return { cleared: true };
      },
    }),
  ]);
  // For the browser tests and for debugging in the console.
  (window as unknown as { lunyxAssistant?: unknown }).lunyxAssistant = { session: s };
  return s;
}

export function mountAssistantButton(region: HTMLElement): void {
  session();
  const b = button('', 'ly-btn ly-btn--icon assistant-btn', () => void runAction('setAssistantOpen', { open: !store.get().assistantOpen }));
  b.id = 'assistant-button';
  b.innerHTML = ICON_CHAT;
  b.setAttribute('aria-controls', DRAWER_ID);
  const sync = () => {
    const open = store.get().assistantOpen;
    b.setAttribute('aria-expanded', String(open));
    const label = open ? 'Close the assistant' : 'Open the assistant: ask a question or tell it what to show';
    b.setAttribute('aria-label', label);
    b.title = open ? 'Close the assistant' : 'Assistant';
  };
  store.subscribe(['assistantOpen'], sync);
  sync();
  region.append(b);
}

interface MessageView {
  root: HTMLElement;
  source: HTMLElement;
  text: HTMLElement;
  actions: HTMLOListElement;
  note: HTMLElement;
  pending: HTMLElement;
  shownActions: number;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function paramsSummary(params: unknown): string {
  if (typeof params !== 'object' || params === null) return '';
  const parts = Object.entries(params as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return clip(parts.join(', '), 80);
}

function actionItem(entry: ActionLogEntry): HTMLLIElement {
  const li = el('li', `am-action${entry.ok ? '' : ' is-failed'}`);
  const details = el('details');
  const summary = el('summary');
  const mark = el('span', 'am-mark', entry.ok ? '✓' : '✕');
  mark.setAttribute('aria-hidden', 'true');
  const state = el('span', 'ly-visually-hidden', entry.ok ? 'Done: ' : 'Failed: ');
  const title = el('span', 'am-action-title', getAction(entry.name)?.title ?? entry.name);
  summary.append(mark, state, title);
  const brief = paramsSummary(entry.params);
  if (brief) summary.append(el('span', 'am-action-params', brief));
  const body = el('pre', 'am-action-body');
  const result = entry.ok ? JSON.stringify(entry.result ?? null, null, 1) : (entry.error ?? 'Failed');
  body.textContent = `${entry.name}(${JSON.stringify(entry.params ?? {})})\n${entry.ok ? '→ ' : '✕ '}${clip(result ?? 'null', 2400)}`;
  details.append(summary, body);
  if (!entry.ok) {
    const why = el('p', 'am-action-error', entry.error ?? 'Failed');
    li.append(details, why);
  } else {
    li.append(details);
  }
  return li;
}

export function mountAssistantDrawer(region: HTMLElement): void {
  const s = session();
  const drawer = el('div', 'assistant-drawer');
  drawer.id = DRAWER_ID;

  // ---- header ----
  const head = el('header', 'ad-head');
  const title = el('h2', 'ly-panel-title', 'Assistant');
  const fresh = button('New chat', 'ly-btn ly-btn--small ly-btn--ghost', () => void runAction('clearConversation'));
  fresh.setAttribute('aria-label', 'Start a new conversation');
  const close = button('Close ×', 'ly-btn ad-close', () => void runAction('setAssistantOpen', { open: false }));
  close.setAttribute('aria-label', 'Close the assistant');
  close.title = 'Close the assistant (Esc)';
  head.append(title, fresh, close);

  const mode = el('p', 'ad-mode');
  mode.setAttribute('role', 'status');

  // ---- conversation ----
  const log = el('div', 'ad-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-label', 'Conversation with the assistant');
  log.setAttribute('aria-live', 'polite');
  log.tabIndex = 0;
  const empty = el('div', 'ad-empty');
  empty.append(
    el('p', undefined, 'Ask about the site on screen, or tell me what to show. I use the same controls you do, and list what I did under each reply.'),
    el('p', 'ly-note', 'Numbers come from the app itself. Earth visibility is geometric line of sight, not a link guarantee.'),
  );
  const chips = el('div', 'ly-chips ad-suggestions');
  for (const text of SUGGESTIONS) {
    chips.append(
      button(text, 'ly-btn ly-btn--small', () => {
        if (!s.busy) void s.send(text);
      }),
    );
  }
  empty.append(chips);
  log.append(empty);

  // ---- composer ----
  const form = el('form', 'ad-form');
  const label = el('label', 'ly-visually-hidden', 'Message to the assistant');
  label.htmlFor = INPUT_ID;
  const input = el('textarea', 'ly-input ad-input');
  input.id = INPUT_ID;
  input.rows = 1;
  input.maxLength = 8000;
  input.placeholder = 'Ask, or say what to show…';
  input.setAttribute('enterkeyhint', 'send');
  const row = el('div', 'ad-form-row');
  const hint = el('span', 'ly-note ad-hint', 'Enter to send · Shift+Enter for a new line');
  const send = button('Send', 'ly-btn ly-btn--primary ad-send');
  send.type = 'submit';
  const stop = button('Stop', 'ly-btn ad-stop', () => s.stop());
  stop.setAttribute('aria-label', 'Stop the assistant');
  stop.hidden = true;
  const voiceNote = el('p', 'ly-note ad-voice-note');
  voiceNote.setAttribute('role', 'status');
  // Always on screen, under the message box (NASA's guidelines for AI applications: where the
  // answers come from, and that NASA is not responsible for their accuracy). See labels.ts.
  const disclaimer = el('p', 'ly-note ad-disclaimer');
  disclaimer.id = 'assistant-disclaimer';

  const grow = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
  };

  // Optional dictation: the button exists only where the browser can recognise speech.
  let dictation: Dictation | null = null;
  let beforeDictation = '';
  const mic = button('', 'ly-btn ly-btn--icon ad-mic', () => {
    if (!dictation) return;
    if (dictation.listening) dictation.stop();
    else {
      beforeDictation = input.value.trim();
      voiceNote.textContent = '';
      dictation.start();
    }
  });
  mic.innerHTML = ICON_MIC;
  mic.setAttribute('aria-label', 'Dictate a message');
  mic.setAttribute('aria-pressed', 'false');
  mic.title = 'Dictate (uses your browser’s speech recognition)';
  dictation = createDictation(
    {
      onText: (finalText, interim) => {
        input.value = [beforeDictation, finalText, interim].filter(Boolean).join(' ');
        grow();
      },
      onState: (listening) => {
        mic.setAttribute('aria-pressed', String(listening));
        mic.classList.toggle('is-listening', listening);
        voiceNote.textContent = listening ? 'Listening… press the microphone again to stop, then review and send.' : voiceNote.textContent === 'Listening… press the microphone again to stop, then review and send.' ? '' : voiceNote.textContent;
        if (!listening) input.focus();
      },
      onError: (message) => {
        voiceNote.textContent = message;
      },
    },
    navigator.language || 'en-US',
  );
  mic.hidden = !dictation;

  row.append(mic, hint, stop, send);
  form.append(label, input, row, voiceNote, disclaimer);

  const submit = () => {
    const text = input.value.trim();
    if (!text || s.busy) return;
    if (dictation?.listening) dictation.stop();
    input.value = '';
    grow();
    void s.send(text);
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });

  drawer.append(head, mode, log, form);
  region.append(drawer);

  // The drawer remains open when a user returns focus to the scene. Catch Escape before
  // the scene shortcuts in that case too, so closing chat does not leave surface view.
  // Escape goes to the layer that holds focus (F-10, escape.ts): focus in another panel, such
  // as the compare sheet, leaves Escape to that panel.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (!escapeClosesDrawer(store.get().assistantOpen, document.activeElement, { drawer, scene: document.getElementById('scene'), body: document.body, root: document.documentElement })) return;
    e.stopPropagation();
    e.preventDefault();
    void runAction('setAssistantOpen', { open: false });
  }, true);

  // ---- rendering ----
  const views = new Map<number, MessageView>();

  const makeView = (m: ChatMessage): MessageView => {
    const root = el('article', `am am--${m.role}`);
    const source = el('p', 'am-source');
    const text = el('div', 'am-text');
    const actions = el('ol', 'am-actions');
    actions.setAttribute('aria-label', 'Actions taken');
    const note = el('p', 'am-note');
    const pending = el('p', 'am-pending', 'Working…');
    if (m.role === 'user') {
      root.append(el('span', 'ly-visually-hidden', 'You: '), text);
    } else if (m.role === 'notice') {
      root.append(text);
    } else {
      root.append(el('span', 'ly-visually-hidden', 'Assistant: '), source, text, actions, note, pending);
    }
    log.append(root);
    return { root, source, text, actions, note, pending, shownActions: 0 };
  };

  const render = () => {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
    const live = new Set(s.messages.map((m) => m.id));
    for (const [id, v] of views) {
      if (!live.has(id)) {
        v.root.remove();
        views.delete(id);
      }
    }
    for (const m of s.messages) {
      let v = views.get(m.id);
      if (!v) views.set(m.id, (v = makeView(m)));
      if (v.text.textContent !== m.text) v.text.textContent = m.text;
      v.text.hidden = !m.text;
      if (m.role !== 'assistant') continue;
      // Every reply says who wrote it: "AI-generated · <model>", deterministic mode, or the scripted test model.
      const who = replyLabel(m.source);
      if (v.source.textContent !== who) v.source.textContent = who;
      v.source.hidden = !who;
      v.root.classList.toggle('is-deterministic', m.source?.kind === 'deterministic');
      v.root.classList.toggle('is-ai-generated', m.source?.kind === 'model' && isLanguageModel(m.source));
      v.root.classList.toggle('is-failed', Boolean(m.failed));
      for (; v.shownActions < m.actions.length; v.shownActions++) v.actions.append(actionItem(m.actions[v.shownActions]));
      v.actions.hidden = m.actions.length === 0;
      if (v.note.textContent !== (m.note ?? '')) v.note.textContent = m.note ?? '';
      v.note.hidden = !m.note;
      v.pending.hidden = !m.pending;
      v.root.setAttribute('aria-busy', String(m.pending));
    }
    empty.hidden = s.messages.length > 0;
    fresh.disabled = s.messages.length === 0;

    const status = s.mode;
    const note = accuracyNote(status.kind === 'model' ? status.model : null);
    if (disclaimer.textContent !== note) disclaimer.textContent = note;
    mode.className = `ad-mode ad-mode--${status.kind}`;
    if (status.kind === 'model') {
      mode.textContent = `Language model: ${status.model.label}`;
      mode.title = '';
    } else if (status.kind === 'deterministic') {
      mode.textContent = `${DETERMINISTIC_LABEL}. ${status.reason} Type "help" to see what it understands.`;
      mode.title = status.reason;
    } else {
      mode.textContent = 'Checking for a language model…';
      mode.title = '';
    }

    send.hidden = s.busy;
    stop.hidden = !s.busy;
    if (nearBottom) log.scrollTop = log.scrollHeight;
  };
  s.subscribe(render);
  render();

  // ---- open / close ----
  let wasOpen = false;
  const sync = () => {
    const open = store.get().assistantOpen;
    drawer.classList.toggle('is-open', open);
    drawer.toggleAttribute('inert', !open);
    drawer.setAttribute('aria-hidden', String(!open));
    if (open && !wasOpen) {
      void s.refreshStatus();
      // After the slide-in has started, so the browser does not scroll the page to the field.
      requestAnimationFrame(() => {
        if (store.get().assistantOpen) input.focus({ preventScroll: true });
      });
    } else if (!open && wasOpen) {
      if (dictation?.listening) dictation.stop();
      if (drawer.contains(document.activeElement)) document.getElementById('assistant-button')?.focus();
    }
    wasOpen = open;
  };
  store.subscribe(['assistantOpen'], sync);
  sync();
}
