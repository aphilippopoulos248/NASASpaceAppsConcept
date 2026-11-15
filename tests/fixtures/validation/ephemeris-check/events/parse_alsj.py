#!/usr/bin/env python3
"""Turns the Apollo Lunar Surface Journal table (alsj_scotti_altaz.txt) into rows: alsj_rows.json."""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
MONTHS = {m: i + 1 for i, m in enumerate('Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split())}
rows = []
mission = None
year = month = day = None
with open(os.path.join(HERE, 'alsj_scotti_altaz.txt')) as fh:
    for line in fh:
        m = re.match(r'^(Apollo \d+)\s+\(\s*([+-][\d.]+),\s*([+-][\d.]+)\)', line)
        if m:
            mission = {'name': m.group(1), 'lon': float(m.group(2)), 'lat': float(m.group(3))}
            continue
        t = re.search(r'(\d\d):(\d\d):(\d\d)((?:\s+[+-]?\d+\.\d+){8})\s*$', line)
        if not (mission and t):
            continue
        head = line[:t.start()].split()
        # Date tokens are right-aligned before the time: [year] [month] [day]; missing ones carry over.
        label = []
        for tok in head:
            if re.fullmatch(r'19\d\d', tok):
                year = int(tok)
            elif tok in MONTHS:
                month = MONTHS[tok]
            elif re.fullmatch(r'\d\d', tok):
                day = int(tok)
            else:
                label.append(tok)
        v = [float(x) for x in t.group(4).split()]
        rows.append({
            'id': '%s %s' % (mission['name'], ' '.join(label)), 'lat': mission['lat'], 'lon': mission['lon'], 'elevationM': 0,
            'utc': '%04d-%02d-%02dT%s:%s:%sZ' % (year, month, day, t.group(1), t.group(2), t.group(3)),
            'published': {'subEarthLon': v[0], 'subEarthLat': v[1], 'earthAlt': v[2], 'earthAz': v[3], 'subSolarLon': v[4], 'subSolarLat': v[5], 'sunAlt': v[6], 'sunAz': v[7]},
        })
with open(os.path.join(HERE, 'alsj_rows.json'), 'w') as fh:
    json.dump(rows, fh, indent=1)
    fh.write('\n')
print(len(rows), 'rows;', rows[0]['id'], rows[0]['utc'], '...', rows[-1]['id'], rows[-1]['utc'])
