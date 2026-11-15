// Keeps the floating parts of the surface HUD off each other and off the shell's own
// controls, whatever the window size. The key metrics (top left) end above whatever sits
// under them: the chart, the status strip on a narrow screen, or the time scrubber. The
// chart and the strip stand above the scrubber and the assistant's button where they would
// meet, and the chart never grows over the metrics' title row. Sizes are measured, not
// assumed, so the shell can move its regions without this breaking.
//
// The horizon band at the middle of the screen stays clear: entering a site, the view is level
// and a low Sun (a polar site) stands just above the screen's centre, its label just below it.
// Where the strip, in its place above the time scrubber, would reach up into that band (short
// windows, e.g. 1280x720), it docks at the top right instead: under the close and "Reset panels"
// buttons and wholly right of the screen's centre column, where a body the view faces is drawn.
export type HudPart = 'metrics' | 'chart' | 'strip';

const GAP = 12;
/** The horizon band the strip keeps out of: this far below the middle of the screen. */
const HORIZON_BAND_PX = 44;
/** Kept free either side of the screen's vertical centre line when the strip docks. */
const CENTRE_CLEAR_PX = 48;
/** Margin to the window's right edge when docked. */
const EDGE_PX = 24;
/** Room always left for the key metrics: their title row. */
const METRICS_MIN = 46;
const CHART_MIN = 150;

interface Span {
  left: number;
  right: number;
}
const overlap = (a: Span, b: Span) => a.left < b.right && a.right > b.left;

/** The pure part: given the boxes, how tall the metrics panel and the chart may be, and how far the chart must be raised. */
export function hudLimits(input: {
  viewportH: number;
  metrics: Span & { top: number };
  /** Bottom edge of the chart's region: where the chart's bottom rests when nothing is in its way. */
  floor: number;
  /** The chart as it is on screen (its height includes any limit already applied); null when hidden. */
  chart: (Span & { height: number }) | null;
  /** The status strip: `floor` is where its bottom rests when nothing is in its way, `height` its height on screen. */
  strip: (Span & { floor: number; height: number }) | null;
  /** What the shell keeps at the bottom of the screen and is on show: the time scrubber, the assistant's button. */
  below: (Span & { top: number })[];
  /** Where the strip may dock: the window's width, the top it may use (below the close button) and its usual width. */
  dock?: { viewportW: number; top: number; naturalWidth: number };
}): { metricsMaxH: number; chartMaxH: number; chartLift: number; stripLift: number; stripDock: { x: number; y: number; width: number } | null } {
  const { metrics, chart, strip, below, dock } = input;
  const floor = Math.min(input.floor, input.viewportH);
  // A part rests on its region's floor, or a gap above whatever of the shell shares its column.
  const liftOver = (part: Span, partFloor: number) => below.reduce((lift, b) => (overlap(part, b) ? Math.max(lift, Math.ceil(partFloor - (b.top - GAP))) : lift), 0);
  const chartLift = chart ? liftOver(chart, floor) : 0;
  const stripLift = strip ? liftOver(strip, strip.floor) : 0;
  // In its place the strip would reach into the horizon band: it docks at the top right instead.
  let stripDock: { x: number; y: number; width: number } | null = null;
  if (strip && dock && strip.floor - stripLift - strip.height < input.viewportH / 2 + HORIZON_BAND_PX) {
    const right = dock.viewportW - EDGE_PX, leftMost = dock.viewportW / 2 + CENTRE_CLEAR_PX;
    const width = Math.max(0, Math.floor(Math.min(dock.naturalWidth, right - leftMost)));
    stripDock = { x: Math.round(right - width), y: Math.round(dock.top), width };
  }
  const chartBottom = floor - chartLift;
  const chartMaxH = Math.max(CHART_MIN, Math.floor(chartBottom - (metrics.top + METRICS_MIN + GAP)));

  // The metrics end above whatever lies under them; a part beside them does not limit them.
  let under = floor;
  if (chart && overlap(chart, metrics)) under = Math.min(under, chartBottom - Math.min(chart.height, chartMaxH));
  if (strip && !stripDock && overlap(strip, metrics)) under = Math.min(under, strip.floor - stripLift - strip.height);
  for (const b of below) if (overlap(b, metrics)) under = Math.min(under, b.top);
  return { metricsMaxH: Math.max(METRICS_MIN, Math.floor(under - GAP - metrics.top)), chartMaxH, chartLift, stripLift, stripDock };
}

/** The shell's regions at the bottom of the screen that the HUD must stand clear of. */
const SHELL_BELOW = ['region-scrubber', 'region-assistant'];
const parts = new Map<HudPart, HTMLElement>();
let queued = false;
/** The strip's width in its place, kept while it is docked (docked, it is narrower). */
let stripNaturalWidth = 0;
let observer: ResizeObserver | null = null;

function layout(): void {
  queued = false;
  const metrics = parts.get('metrics'), chart = parts.get('chart'), strip = parts.get('strip');
  if (!metrics) return;
  const moved = (el: HTMLElement | undefined) => Boolean(el?.classList.contains('sp-positioned'));
  const m = (moved(metrics) ? metrics.parentElement! : metrics).getBoundingClientRect();
  // Not on screen (globe view): nothing to lay out.
  if (m.width === 0) return;
  const box = (el: Element | null | undefined) => {
    const r = el?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? r : null;
  };
  const region = chart?.parentElement?.getBoundingClientRect();
  const stripRegion = strip?.parentElement?.getBoundingClientRect();
  const c = moved(chart) ? null : box(chart), s = moved(strip) ? null : box(strip);
  const docked = Boolean(strip?.classList.contains('sp-docked'));
  if (s && !docked) stripNaturalWidth = s.width;
  const closeBox = box(document.getElementById('region-close'));
  const below = SHELL_BELOW.map((id) => box(document.getElementById(id))).filter((r): r is DOMRect => r !== null);
  const limits = hudLimits({
    viewportH: window.innerHeight,
    metrics: { top: m.top, left: m.left, right: m.right },
    floor: region ? region.bottom : window.innerHeight - 108,
    chart: c && { left: c.left, right: c.right, height: c.height },
    strip: s && { left: s.left, right: s.right, height: s.height, floor: stripRegion ? stripRegion.bottom : s.bottom },
    below: below.map((r) => ({ left: r.left, right: r.right, top: r.top })),
    dock: { viewportW: window.innerWidth, top: closeBox ? closeBox.bottom + GAP : EDGE_PX, naturalWidth: stripNaturalWidth || (s ? s.width : 0) },
  });
  const set = (el: HTMLElement, prop: 'maxHeight' | 'marginBottom', px: number) => {
    const value = `${px}px`;
    if (el.style[prop] !== value) el.style[prop] = value;
  };
  if (!moved(metrics)) set(metrics, 'maxHeight', limits.metricsMaxH);
  if (chart && !moved(chart)) {
    set(chart, 'maxHeight', limits.chartMaxH);
    set(chart, 'marginBottom', limits.chartLift);
  }
  if (strip && !moved(strip)) set(strip, 'marginBottom', limits.stripLift);
  // Docking: a strip the user moved stays where it was put; a hidden one keeps its state until it shows again.
  if (strip && (moved(strip) || s)) {
    const dock = moved(strip) ? null : limits.stripDock;
    strip.classList.toggle('sp-docked', Boolean(dock));
    for (const [key, v] of [['--sp-dock-x', dock?.x], ['--sp-dock-y', dock?.y], ['--sp-dock-width', dock?.width]] as const) {
      if (v === undefined) strip.style.removeProperty(key);
      else if (strip.style.getPropertyValue(key) !== `${v}px`) strip.style.setProperty(key, `${v}px`);
    }
  }
}

/** Lays the HUD out again on the next frame. Call after anything that shows, hides or resizes a part. */
export function requestHudLayout(): void {
  if (queued || typeof requestAnimationFrame === 'undefined') return;
  queued = true;
  requestAnimationFrame(layout);
}

/** Makes a part known to the layout. Its size changes are followed from then on. */
export function hudLayoutPart(name: HudPart, el: HTMLElement): void {
  parts.set(name, el);
  if (typeof ResizeObserver !== 'undefined') {
    if (!observer) {
      observer = new ResizeObserver(requestHudLayout);
      for (const id of SHELL_BELOW) {
        const region = document.getElementById(id);
        if (region) observer.observe(region);
      }
    }
    observer.observe(el);
  }
  if (parts.size === 1 && typeof window !== 'undefined') window.addEventListener('resize', requestHudLayout);
  requestHudLayout();
}
