# T-14: what PGDA product 69 actually contains

Checked on 2026-11-14 from https://pgda.gsfc.nasa.gov/products/69 ("Lunar Polar Illumination",
E. Mazarico), `README_ILLUMINATION_2016.TXT` and the PDS labels beside the IMG files at
http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/ . Nothing is built yet; this is the factual
basis for the rasters and their labels.

| Product id | Quantity | Grid | Complete to | Corners reach | Size |
| --- | --- | --- | --- | --- | --- |
| `AVGVISIB_65{S,N}_240M_201608` | average solar illumination | 6420 x 6420, 240 m | 65 deg | 55.2 deg | 82 MB |
| `AVGVISIB_75{S,N}_120M_201608` | average solar illumination | 7624 x 7624, 120 m | 75 deg | | 116 MB |
| `AVGVISIB_85{S,N}_060M_201608` | average solar illumination | 5058 x 5058, 60 m | 85 deg | 82.9 deg | 51 MB |
| the same six with `_EARTH` | average Earth visibility | same | same | same | same |

Also on the page, not needed for T-14: permanent-shadow masks (`LPSR_*`) and sky visibility
(`SKYV_65{S,N}_240M`).

- Format: int16, value = DN x 0.00004, so 0..1 (DN 25000 = 1; 0 = permanent shadow). Polar
  stereographic, true scale at the pole, sphere of 1737.4 km, pole at the centre: the same
  layout as the LOLA polar DEMs that `src/terrain` already reads.
- Meaning (label text): the fraction of time steps in which the pixel was lit "by any fraction
  of the solar disc". It is a fraction of time with any sunlight, not a fraction of the disc
  or of the energy. Earth visibility is the same with Earth's disc; the page calls it
  "very slightly optimistic for radio link studies".
- Averaging period: "hourly timesteps spanning 18.6 years" (one lunar nutation cycle), stated
  on the PGDA page. Neither the labels nor the README give the calendar dates of that span.
  The 2009-2013 dates in the labels are the span of the LOLA data behind the DEM.
- Terrain behind each map: the LOLA DEM of the same extent and resolution (e.g. LDEM_85S_060M).
- Status: README says these are EXTRAS products, "not supported by the PDS or the LOLA Science
  Team", and that "some maps show linear artifacts" inherited from the DEMs.
- Citation requested: Mazarico, E., et al. (2011), Illumination conditions of the lunar polar
  regions using LOLA topography, Icarus 211, 1066-1081, doi:10.1016/j.icarus.2010.10.030.
- Access: the IMG files and labels at imbrium.mit.edu work, and so do the plain GeoTIFFs at
  pgda.gsfc.nasa.gov/data/MoonIllumination/. The page's "COG" links are dead (they return the
  directory listing page).

Difference from the task description: none that changes the plan. The north pole is available
in the same form as the south.
