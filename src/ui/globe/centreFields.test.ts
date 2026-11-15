import { describe, expect, it } from 'vitest';
import { committedPoint, fieldText, fieldValue, pinPoint, viewPoint, type Written } from './centreFields';

/**
 * The Centre-of-view fields as the panel drives them: they show viewPoint(), a commit flies to
 * committedPoint(), the button pins pinPoint(viewPoint()). `camera` stands for the store's
 * globeCenter, which moves while the camera flies; `asked` for GlobeLive.viewTarget.
 */
function panel(start: { lat: number; lon: number }) {
  let camera = { ...start };
  let asked: { lat: number; lon: number } | null = null;
  const fields = { lat: { text: '', written: null as Written | null }, lon: { text: '', written: null as Written | null } };
  const sync = (focused?: 'lat' | 'lon') => {
    const p = viewPoint(camera, asked);
    for (const k of ['lat', 'lon'] as const) {
      if (k === focused) continue; // a field is not overwritten while it has the focus
      fields[k].written = { text: fieldText(p[k]), value: p[k] };
      fields[k].text = fields[k].written.text;
    }
  };
  const flights: { lat: number; lon: number }[] = [];
  const commit = (which: 'lat' | 'lon') => {
    const v = fieldValue(fields[which].text, fields[which].written);
    if (v === null) return;
    const other = which === 'lat' ? fields.lon : fields.lat;
    asked = committedPoint(which, v, other.text, other.written, viewPoint(camera, asked));
    flights.push(asked);
  };
  sync();
  return {
    fields,
    flights,
    type: (which: 'lat' | 'lon', text: string) => (fields[which].text = text),
    commit,
    sync,
    /** The camera moves on its own (mid-flight frames). */
    cameraAt: (lat: number, lon: number) => (camera = { lat, lon }),
    turnedByHand: (lat: number, lon: number) => {
      camera = { lat, lon };
      asked = null;
    },
    pin: () => pinPoint(viewPoint(camera, asked)),
  };
}

describe('Centre of view', () => {
  it('Q-1: latitude, Tab, longitude, Enter flies to the point typed, whatever the camera does meanwhile', () => {
    const p = panel({ lat: 8.37, lon: -0.06 });
    p.type('lat', '-84.79');
    p.commit('lat'); // Tab: the change is committed as the field loses the focus
    p.cameraAt(-20.6, 3.1); // the flight starts
    p.sync('lon'); // focusout: the panel re-syncs the fields it does not have the focus in
    expect(p.fields.lat.text).toBe('-84.79'); // was refilled with "-20.60" before
    p.type('lon', '29.2');
    p.cameraAt(-57.4, 18.9);
    p.sync('lon');
    p.commit('lon'); // Enter
    expect(p.flights.at(-1)).toEqual({ lat: -84.79, lon: 29.2 });
  });

  it('Q-2: "Drop pin at centre" straight after typing pins the point typed, not the camera on its way', () => {
    const p = panel({ lat: 8.37, lon: -0.06 });
    p.type('lat', '-84.79');
    p.commit('lat');
    p.type('lon', '29.2');
    p.commit('lon'); // the button takes the focus, so the field commits first
    p.cameraAt(-55.92681, -0.06);
    expect(p.pin()).toEqual({ lat: -84.79, lon: 29.2 });
  });

  it("keeps a site's exact coordinates when only the other field is edited", () => {
    // The view was sent to IM-2 by selecting it: the fields show -84.79 / 29.20.
    const p = panel({ lat: 0, lon: 0 });
    p.turnedByHand(0, 0);
    p.cameraAt(-84.7906, 29.19567);
    p.sync();
    expect([p.fields.lat.text, p.fields.lon.text]).toEqual(['-84.79', '29.20']);
    p.type('lon', '30');
    p.commit('lon');
    expect(p.flights.at(-1)).toEqual({ lat: -84.7906, lon: 30 });
  });

  it('follows the camera again once the globe is turned by hand', () => {
    const p = panel({ lat: 8.37, lon: -0.06 });
    p.type('lat', '-89.95');
    p.commit('lat');
    p.cameraAt(-89.9, -0.06); // the view stops 0.1 degree short of the pole...
    p.sync();
    expect(p.fields.lat.text).toBe('-89.95'); // ...the field keeps what was asked for
    expect(p.pin()).toEqual({ lat: -89.95, lon: -0.06 });
    p.turnedByHand(-60, 10);
    p.sync();
    expect([p.fields.lat.text, p.fields.lon.text]).toEqual(['-60.00', '10.00']);
    expect(p.pin()).toEqual({ lat: -60, lon: 10 });
  });

  it('reads what is typed, ignores what is not a number', () => {
    expect(fieldValue(' -84.79 ', null)).toBe(-84.79);
    expect(fieldValue('', null)).toBeNull();
    expect(fieldValue('north', null)).toBeNull();
    expect(fieldValue('-84.79', { text: '-84.79', value: -84.7906 })).toBe(-84.7906);
    expect(fieldValue('-84.8', { text: '-84.79', value: -84.7906 })).toBe(-84.8);
    // With the other field empty, the other coordinate comes from where the view is.
    expect(committedPoint('lon', 29.2, '', null, { lat: -84.79, lon: 0 })).toEqual({ lat: -84.79, lon: 29.2 });
    expect(pinPoint({ lat: -84.790004, lon: 29.199996 })).toEqual({ lat: -84.79, lon: 29.2 });
  });
});
