// Tiny DOM helpers shared by the UI modules.
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(label: string, className = 'ly-btn', onClick?: (e: MouseEvent) => void): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/** True when a key event comes from a text field or a control that uses the key itself. */
export function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && Boolean(t.closest('input, select, textarea, [contenteditable]'));
}
