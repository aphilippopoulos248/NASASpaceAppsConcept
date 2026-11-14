# Bundled lunar elevation grids

Heights in metres above a sphere of radius 1737.4 km (the LOLA reference), Mean Earth / Polar Axis
frame, east-positive longitude. `index.json` lists every file with its extent, resolution, source
product, processing, size, checksum and limits; the app reads it through `src/terrain/api.ts`.

| File | What | Resolution | Coverage |
| --- | --- | --- | --- |
| `lola_global_16ppd.lxg` | LOLA LDEM_16, whole Moon | 16 px/deg, 1895 m; heights to 1 m | everywhere |
| `lola_global_4ppd.lxg` | LOLA LDEM_4, whole Moon (quick overview for drawing) | 4 px/deg, 7581 m | everywhere |
| `lola_south_80s_160m.lxg` | 2x2 means of LDEM_80S_80M | 160 m; heights to 1 m | square around the south pole, complete south of 80.01S |
| `lola_south_85s_80m.lxg` | 2x2 means of LDEM_85S_40M | 80 m; heights to 1 m | complete south of 85.01S |
| `lola_south_875s_40m.lxg` | 2x2 means of LDEM_875S_20M | 40 m; heights to 0.5 m | complete south of 87.51S |

Not bundled: any north-polar layer (the north pole has the 1895 m grid only), and anything finer
than 1895 m north of the 80S square other than the landing-site windows in `public/terrain/`.

**Source and credit:** NASA Lunar Reconnaissance Orbiter, Lunar Orbiter Laser Altimeter (LOLA)
gridded data records, data set LRO-L-LOLA-4-GDR-V1.0, NASA Planetary Data System Geosciences Node,
https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/ .
Smith, D. E., et al. (2017). Summary of the results from the Lunar Orbiter Laser Altimeter after
seven years in lunar orbit. *Icarus*, 283, 70-91. https://doi.org/10.1016/j.icarus.2016.06.006

**Changes made by Lunyx:** the whole-Moon grids were only rearranged to start at 180W (and the
16 px/deg heights rounded from 0.5 m to 1 m steps); the polar layers are 2x2 block means of the
source grids, in the source projection (polar stereographic, true scale at the pole). The file
format (`.lxg`, a gzip-compressed lossless int16 container) is described in `src/terrain/lxg.ts`.
Rebuild with `npm run build-dem` (downloads about 410 MB into `scripts/.cache/dem/`).
