// UTC only. Every time shown to the user says "UTC"; every time accepted from the user
// or the assistant is read as UTC.

/** Parses "2025-03-06T17:28Z", "2025-03-06 17:28", "2025-03-06" (midnight) as UTC. Throws on anything else. */
export function parseUtc(text: string): number {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(?:Z|UTC|\+00:?00)?\s*$/i.exec(text);
  if (!m) throw new Error(`Not a UTC date/time: "${text}". Use YYYY-MM-DD or YYYY-MM-DDTHH:MMZ.`);
  const [y, mo, d, h, mi, s] = m.slice(1).map((v) => (v === undefined ? 0 : Number(v)));
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) {
    throw new Error(`Not a valid calendar date/time: "${text}".`);
  }
  return ms;
}

/** "2025-03-06 17:28 UTC" (or with seconds). */
export function formatUtc(ms: number, seconds = false): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, seconds ? 19 : 16)} UTC`;
}

/** ISO 8601 with Z, to the minute: the form used in links, exports and assistant tool results. */
export function isoUtc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16)}Z`;
}

/** "3 d 04 h", "5 h 12 min", "8 min": for countdowns and durations. Input in hours. */
export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours)) return 'n/a';
  const totalMin = Math.round(Math.abs(hours) * 60);
  const d = Math.floor(totalMin / 1440), h = Math.floor((totalMin % 1440) / 60), min = totalMin % 60;
  if (d > 0) return `${d} d ${String(h).padStart(2, '0')} h`;
  if (h > 0) return `${h} h ${String(min).padStart(2, '0')} min`;
  return `${min} min`;
}
