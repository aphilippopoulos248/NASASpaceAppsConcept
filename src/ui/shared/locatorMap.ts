// Locator ("viewfinder") map, lower right in both views: the whole Moon (equirectangular,
// east-positive longitude) with the globe's current view outline, or in the surface view the
// viewer's walking position and look direction. Click or drag turns the globe there; scroll zooms the map.
import { defineAction, registerActions, runAction } from '../../core/actions';
import { store } from '../../core/store';
import { wrapLon } from '../../core/types';
import type { SurfaceApi } from '../../scene/surface/actions';
import { el } from '../dom';
import { globeFovDeg, viewFootprint } from './footprint';
import { observerLocation, surfaceMapWindow } from './locatorPosition';
import './locatorMap.css';

const MAX_ZOOM = 16;

// Globe zoom 1 shows the whole Moon. Surface zoom has a separate, local walking scale.
// Presentation state of the one locator map, kept here rather than in AppState.
let globeZoom = 1;
let surfaceZoom = 4;

/** Zoom of the current map: whole Moon in globe view, local walking area in surface view. */
export function locatorZoom(): number {
  return store.get().view === 'surface' ? surfaceZoom : globeZoom;
}
const fmt = (lat: number, lon: number, digits = 2) => `${Math.abs(lat).toFixed(digits)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(digits)}° ${lon >= 0 ? 'E' : 'W'}`;

export function mountLocatorMap(region: HTMLElement, surface: Pick<SurfaceApi, 'site' | 'position'>, onFrame: (fn: () => void) => void): void {
  const box = el('div', 'ly-panel locator');
  const canvas = el('canvas', 'locator-canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-roledescription', 'locator map');
  const readout = el('div', 'ly-note ly-value locator-readout');
  readout.setAttribute('aria-live', 'off');
  const zoomRow = el('div', 'locator-zoom');
  const zoomOut = el('button', 'ly-btn ly-btn--small', '−');
  const zoomIn = el('button', 'ly-btn ly-btn--small', '+');
  zoomOut.type = zoomIn.type = 'button';
  zoomOut.setAttribute('aria-label', 'Zoom the map out');
  zoomIn.setAttribute('aria-label', 'Zoom the map in');
  zoomRow.append(zoomOut, zoomIn);
  box.append(canvas, readout, zoomRow);
  region.append(box);

  const img = new Image();
  img.src = `${import.meta.env.BASE_URL}textures/moon_color_2k.jpg`;
  img.onload = () => draw();

  let hover: { lat: number; lon: number } | null = null;

  registerActions([
    defineAction<{ zoom: number }, unknown>({
      name: 'setLocatorZoom',
      title: 'Zoom locator map',
      description: 'Zooms the locator map (1 to 16). In globe view, 1 shows the whole Moon. In surface view it shows a local walking map: 1 spans about 4 km, and the default 4 spans about 1 km. The yellow dot follows the viewer; the outlined marker is the landing site.',
      effect: 'command',
      params: { type: 'object', properties: { zoom: { type: 'number', description: 'Zoom factor, 1 to 16.', minimum: 1, maximum: MAX_ZOOM } }, required: ['zoom'] },
      run: ({ zoom: z }) => {
        if (store.get().view === 'surface') surfaceZoom = z;
        else globeZoom = z;
        draw();
        return { locatorZoom: locatorZoom() };
      },
    }),
  ]);

  const focus = () => {
    const s = store.get();
    if (s.view !== 'surface' || !s.site) return s.globeCenter;
    return surface.site?.id === s.site.id ? observerLocation(surface.site, surface.position) : s.site;
  };

  /** Visible lat/lon window of the map. */
  const viewWindow = () => {
    const zoom = locatorZoom();
    const s = store.get();
    if (s.view === 'surface' && s.site) return surfaceMapWindow(s.site, focus(), zoom);
    const w = 360 / zoom, h = 180 / zoom;
    const f = focus();
    const lon0 = zoom === 1 ? 0 : f.lon;
    const lat0 = zoom === 1 ? 0 : Math.max(-90 + h / 2, Math.min(90 - h / 2, f.lat));
    return { west: lon0 - w / 2, north: lat0 + h / 2, w, h };
  };

  const toXY = (lat: number, lon: number, W: number, H: number) => {
    const v = viewWindow();
    const dl = wrapLon(lon - (v.west + v.w / 2)) + v.w / 2;
    return { x: (dl / v.w) * W, y: ((v.north - lat) / v.h) * H };
  };
  const fromXY = (x: number, y: number, W: number, H: number) => {
    const v = viewWindow();
    return { lat: Math.max(-90, Math.min(90, v.north - (y / H) * v.h)), lon: wrapLon(v.west + (x / W) * v.w) };
  };

  function draw() {
    const zoom = locatorZoom();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#111';
    g.fillRect(0, 0, W, H);
    const v = viewWindow();
    if (img.complete && img.naturalWidth) {
      // The texture spans lon -180..180, lat 90..-90. Draw it (twice across the antimeridian if needed).
      const pxPerDeg = img.naturalWidth / 360;
      for (const shift of [-360, 0, 360]) {
        const west = v.west - shift;
        const sx = (west + 180) * pxPerDeg, sy = (90 - v.north) * pxPerDeg;
        const sw = v.w * pxPerDeg, sh = v.h * pxPerDeg;
        const cx0 = Math.max(0, sx), cx1 = Math.min(img.naturalWidth, sx + sw);
        if (cx1 <= cx0) continue;
        g.drawImage(img, cx0, sy, cx1 - cx0, sh, ((cx0 - sx) / sw) * W, 0, ((cx1 - cx0) / sw) * W, H);
      }
    }
    // Use a few local coordinate lines when walking, and a whole-Moon grid in globe view.
    const inSurface = store.get().view === 'surface';
    const step = inSurface ? 10 ** Math.ceil(Math.log10(v.h / 3)) : zoom >= 8 ? 5 : zoom >= 3 ? 10 : 30;
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.lineWidth = 1;
    g.fillStyle = 'rgba(238,241,246,0.7)';
    g.font = '9px "Inter Variable", system-ui, sans-serif';
    for (let lat = Math.ceil((v.north - v.h) / step) * step; lat < Math.min(90, v.north); lat += step) {
      const { y } = toXY(lat, 0, W, H);
      if (y < 0 || y > H) continue;
      g.beginPath();
      g.moveTo(0, y + 0.5);
      g.lineTo(W, y + 0.5);
      g.stroke();
      if (lat % (step * 2) === 0 || zoom > 1) g.fillText(`${Number(Math.abs(lat).toFixed(4))}°${lat > 0 ? 'N' : lat < 0 ? 'S' : ''}`, 2, y - 2);
    }
    const lonStep = inSurface ? Math.max(step, 10 ** Math.ceil(Math.log10(v.w / 4))) : step;
    for (let lon = Math.ceil(v.west / lonStep) * lonStep; lon < v.west + v.w; lon += lonStep) {
      const { x } = toXY(0, lon, W, H);
      if (x < 0 || x > W) continue;
      g.beginPath();
      g.moveTo(x + 0.5, 0);
      g.lineTo(x + 0.5, H);
      g.stroke();
      if (lon % (step * 3) === 0 || zoom > 1) g.fillText(`${Number(Math.abs(wrapLon(lon)).toFixed(4))}°${wrapLon(lon) > 0 ? 'E' : lon < 0 ? 'W' : ''}`, x + 2, H - 3);
    }

    const s = store.get();
    g.strokeStyle = '#ffd479';
    g.fillStyle = '#ffd479';
    g.lineWidth = 1.5;
    if (s.view === 'globe') {
      const fov = globeFovDeg(window.innerWidth, window.innerHeight);
      const ring = viewFootprint(s.globeCenter, window.innerWidth / window.innerHeight, fov, 24);
      // Unwrap longitudes along the ring; a total turn of 360° means the view contains a pole.
      const lons = [ring[0].lon];
      for (let i = 1; i < ring.length; i++) {
        let d = ring[i].lon - ring[i - 1].lon;
        d -= 360 * Math.round(d / 360);
        lons.push(lons[i - 1] + d);
      }
      let close = ring[0].lon - ring[ring.length - 1].lon;
      close -= 360 * Math.round(close / 360);
      const turn = lons[lons.length - 1] + close - lons[0];
      const pxPerDeg = W / v.w;
      const xOf = (lon: number) => (lon - v.west) * pxPerDeg;
      const yOf = (lat: number) => ((v.north - lat) / v.h) * H;
      const outline = new Path2D();
      const edge = new Path2D();
      ring.forEach((p, i) => (i ? edge.lineTo(xOf(lons[i]), yOf(p.lat)) : edge.moveTo(xOf(lons[i]), yOf(p.lat))));
      if (Math.abs(turn) > 180) {
        // Contains a pole: close the outline along the map's top (north) or bottom (south) edge.
        const poleLat = s.globeCenter.lat >= 0 ? 90 : -90;
        const first = lons[0], last = lons[lons.length - 1] + close;
        outline.moveTo(xOf(first), yOf(poleLat));
        ring.forEach((p, i) => outline.lineTo(xOf(lons[i]), yOf(p.lat)));
        outline.lineTo(xOf(last), yOf(ring[0].lat));
        edge.lineTo(xOf(last), yOf(ring[0].lat));
        outline.lineTo(xOf(last), yOf(poleLat));
        outline.closePath();
      } else {
        ring.forEach((p, i) => (i ? outline.lineTo(xOf(lons[i]), yOf(p.lat)) : outline.moveTo(xOf(lons[i]), yOf(p.lat))));
        outline.closePath();
        edge.closePath();
      }
      g.fillStyle = 'rgba(255,212,121,0.16)';
      // Draw at three 360° shifts so pieces across the map edge appear on the other side.
      for (const k of [-1, 0, 1]) {
        g.save();
        g.translate(k * 360 * pxPerDeg, 0);
        g.fill(outline);
        g.stroke(edge);
        g.restore();
      }
      g.fillStyle = '#ffd479';
      const c = toXY(s.globeCenter.lat, s.globeCenter.lon, W, H);
      g.beginPath();
      g.moveTo(c.x - 4, c.y);
      g.lineTo(c.x + 4, c.y);
      g.moveTo(c.x, c.y - 4);
      g.lineTo(c.x, c.y + 4);
      g.stroke();
    }
    if (s.site) {
      const f = s.view === 'surface' ? focus() : s.site;
      const p = toXY(f.lat, f.lon, W, H);
      if (s.view === 'surface') {
        const sitePoint = toXY(s.site.lat, s.site.lon, W, H);
        g.strokeStyle = '#ffd479';
        g.strokeRect(sitePoint.x - 4, sitePoint.y - 4, 8, 8);
        // Look direction: a wedge as wide as the horizontal field of view.
        const half = ((s.look.fovDeg * (window.innerWidth / window.innerHeight)) / 2) * (Math.PI / 180);
        const az = (s.look.azDeg * Math.PI) / 180;
        const r = 16;
        g.fillStyle = 'rgba(255,212,121,0.35)';
        g.beginPath();
        g.moveTo(p.x, p.y);
        // Azimuth is clockwise from north; on the map north is up and east is right.
        g.arc(p.x, p.y, r, az - Math.min(half, Math.PI) - Math.PI / 2, az + Math.min(half, Math.PI) - Math.PI / 2);
        g.closePath();
        g.fill();
        g.fillStyle = '#ffd479';
      }
      g.beginPath();
      g.arc(p.x, p.y, 3, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#000';
      g.lineWidth = 1;
      g.stroke();
    }

    const f = focus();
    const digits = s.view === 'surface' ? 5 : 2;
    readout.textContent = hover ? `Pointer ${fmt(hover.lat, hover.lon, digits)}` : `${s.view === 'surface' ? 'You' : 'Centre'} ${fmt(f.lat, f.lon, digits)}${zoom > 1 ? ` · ×${zoom}` : ''}`;
    readout.title = s.view === 'surface' ? 'Yellow dot: your position. Outlined square: landing site. Zoom in to see smaller movements.' : 'Centre of the globe view';
    canvas.setAttribute(
      'aria-label',
      `Locator map, ${s.view === 'surface' ? `you are at ${fmt(f.lat, f.lon, digits)}, looking ${Math.round(s.look.azDeg)}° from north. Yellow dot: your position; outlined square: landing site` : `view centred on ${fmt(f.lat, f.lon)}. Click or use arrow keys to turn the globe`}. Plus and minus zoom the map.`,
    );
    zoomOut.disabled = zoom <= 1;
    zoomIn.disabled = zoom >= MAX_ZOOM;
  }

  // ---- interaction ----
  const local = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return fromXY(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
  };
  let dragging = false;
  let lastSend = 0;
  const turnTo = (p: { lat: number; lon: number }) => {
    if (store.get().view !== 'globe') return; // in the surface view the map only shows where you are
    void runAction('setGlobeCamera', { lat: Math.max(-89, Math.min(89, p.lat)), lon: p.lon });
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    turnTo(local(e));
  });
  canvas.addEventListener('pointermove', (e) => {
    hover = local(e);
    if (dragging && performance.now() - lastSend > 60) {
      lastSend = performance.now();
      turnTo(hover);
    }
    draw();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (dragging) turnTo(local(e));
    dragging = false;
  });
  canvas.addEventListener('pointerleave', () => {
    hover = null;
    draw();
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const zoom = locatorZoom();
      const next = Math.max(1, Math.min(MAX_ZOOM, zoom * (e.deltaY < 0 ? 2 : 0.5)));
      if (next !== zoom) void runAction('setLocatorZoom', { zoom: next });
    },
    { passive: false },
  );
  zoomIn.addEventListener('click', () => void runAction('setLocatorZoom', { zoom: Math.min(MAX_ZOOM, locatorZoom() * 2) }));
  zoomOut.addEventListener('click', () => void runAction('setLocatorZoom', { zoom: Math.max(1, locatorZoom() / 2) }));
  canvas.addEventListener('keydown', (e) => {
    const c = store.get().globeCenter;
    const zoom = locatorZoom();
    const step = 10 / zoom;
    const moves: Record<string, [number, number]> = { ArrowUp: [step, 0], ArrowDown: [-step, 0], ArrowLeft: [0, -step], ArrowRight: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      turnTo({ lat: c.lat + moves[e.key][0], lon: wrapLon(c.lon + moves[e.key][1]) });
    } else if (e.key === '+' || e.key === '=') void runAction('setLocatorZoom', { zoom: Math.min(MAX_ZOOM, zoom * 2) });
    else if (e.key === '-') void runAction('setLocatorZoom', { zoom: Math.max(1, zoom / 2) });
  });

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      draw();
    });
  };
  store.subscribe(['globeCenter', 'site', 'view', 'look'], schedule);
  let previous = '';
  onFrame(() => {
    if (store.get().view !== 'surface') return;
    const p = focus();
    const next = `${p.lat},${p.lon}`;
    if (next !== previous) {
      previous = next;
      schedule();
    }
  });
  window.addEventListener('resize', schedule);
  new ResizeObserver(schedule).observe(canvas);
}
