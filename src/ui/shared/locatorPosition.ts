import { MOON_RADIUS_M, wrapLon, type LatLon } from '../../core/types';
import { offsetPoint } from '../../terrain/geo';

/** The viewer's position uses the same east/north coordinates as the surface terrain. */
export function observerLocation(site: LatLon, position: { eastM: number; northM: number }): LatLon {
  return offsetPoint(site.lat, site.lon, position.eastM, position.northM);
}

/** A local surface map: the dot moves around the site, panning only near the edges. */
export function surfaceMapWindow(site: LatLon, observer: LatLon, zoom: number) {
  const h = (2000 / zoom / MOON_RADIUS_M) * (180 / Math.PI);
  const w = Math.min(360, 2 * h / Math.max(1e-6, Math.cos(site.lat * Math.PI / 180)));
  const follow = (delta: number, span: number) => delta - Math.max(-span * 0.3, Math.min(span * 0.3, delta));
  const lat = Math.max(-90 + h / 2, Math.min(90 - h / 2, site.lat + follow(observer.lat - site.lat, h)));
  const lon = site.lon + follow(wrapLon(observer.lon - site.lon), w);
  return { west: lon - w / 2, north: lat + h / 2, w, h };
}
