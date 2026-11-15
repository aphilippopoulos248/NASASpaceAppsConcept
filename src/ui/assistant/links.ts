// Keep chat text literal; only turn public HTTP(S) URLs into anchors. No HTML parsing.
export function linkParts(text: string): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = [];
  let at = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"\uE000-\uF8FF]+/g)) {
    let url = match[0].replace(/[.,;:!?]+$/, '');
    while (url.endsWith(')') && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)) url = url.slice(0, -1);
    try {
      const parsed = new URL(url);
      if (parsed.username || parsed.password) continue;
    } catch { continue; }
    const start = match.index!;
    if (start > at) parts.push({ text: text.slice(at, start) });
    parts.push({ text: url, href: url });
    at = start + url.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

export function renderLinkedText(target: HTMLElement, text: string): void {
  target.replaceChildren(...linkParts(text).map((part) => {
    if (!part.href) return document.createTextNode(part.text);
    const a = document.createElement('a');
    a.textContent = part.text;
    a.href = part.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }));
}
