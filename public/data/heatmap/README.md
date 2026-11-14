# Long-term average sunlight and Earth visibility at the lunar poles

Packaged from NASA PGDA product 69, "Lunar Polar Illumination" (E. Mazarico),
https://pgda.gsfc.nasa.gov/products/69 . `index.json` describes every file (source product,
extent, resolution, processing, size, checksum, recorded check values); the app reads the maps
through `src/science/polarAverages.ts`.

**These are multi-year averages, not the geometry of any date.** A value is the share of time,
over hourly steps spanning 18.6 years (one lunar nutation cycle; the files do not state the
calendar dates), in which *any part* of the Sun's disc (or of Earth's disc) is above the
terrain horizon. It is a fraction of time, not of energy, and for Earth it is geometric
visibility, not a radio link.

| File | Quantity | Cells | Coverage | Size |
| --- | --- | --- | --- | --- |
| `pgda69_south_illumination_120m.lxg` | average sunlight | 2529 x 2529, 120 m | complete to 85S, corners to 83S | 2.39 MB |
| `pgda69_south_illumination_960m.lxg` | average sunlight | 1605 x 1605, 960 m | complete to 65S, corners to 55.2S | 1.19 MB |
| `pgda69_south_earth_visibility_120m.lxg` | average Earth visibility | 2529 x 2529, 120 m | complete to 85S | 1.98 MB |
| `pgda69_south_earth_visibility_960m.lxg` | average Earth visibility | 1605 x 1605, 960 m | complete to 65S | 0.70 MB |
| `pgda69_north_illumination_120m.lxg` | average sunlight | 2529 x 2529, 120 m | complete to 85N | 2.77 MB |
| `pgda69_north_illumination_960m.lxg` | average sunlight | 1605 x 1605, 960 m | complete to 65N | 1.22 MB |
| `pgda69_north_earth_visibility_120m.lxg` | average Earth visibility | 2529 x 2529, 120 m | complete to 85N | 2.41 MB |
| `pgda69_north_earth_visibility_960m.lxg` | average Earth visibility | 1605 x 1605, 960 m | complete to 65N | 0.74 MB |

Layout: polar stereographic on a sphere of 1737.4 km, true scale at the pole, the pole at the
centre. Row 0 is the top row of the published image: for the south, longitude 0 points up; for
the north, down; 90E is to the right for both. One byte per cell: 0 = no source pixel of the
cell is ever lit (permanent shadow in the model), 1..100 = percent of time (mean of the cell;
any lit cell is stored as at least 1).

**Source:** `AVGVISIB_{65,85}{S,N}_{240,060}M_201608[_EARTH].IMG` with their PDS labels, from
https://imbrium.mit.edu/EXTRAS/ILLUMINATION/ (LOLA team). The 120 m layers are 2x2 means of the
60 m maps; the 960 m layers are 4x4 means of the 240 m maps. The 60 m and 240 m source maps
themselves, the 75-degree / 120 m maps, the permanent-shadow masks (`LPSR_*`) and the sky
visibility maps are not packaged.

**Caveats from the source:** these are "EXTRAS" products, which their README says "are not
supported by the PDS or the LOLA Science Team"; some maps show linear artefacts inherited from
the elevation models. Averaging dilutes small bright spots: the 60 m map peaks at 88.4 % on the
ridge between Shackleton and de Gerlache, its 120 m cell holds 81 %; the 240 m map peaks at
93.5 % at the same ridge, its 960 m cell holds 60 %. The two source maps do not agree pixel for
pixel either: they were computed from different elevation models.

**Credit:** Mazarico, E., Neumann, G. A., Smith, D. E., Zuber, M. T., & Torrence, M. H. (2011).
Illumination conditions of the lunar polar regions using LOLA topography. *Icarus*, 211,
1066-1081. https://doi.org/10.1016/j.icarus.2010.10.030 . NASA data; no licence file accompanies
the maps, and the product page points to NASA's media usage guidelines
(https://www.nasa.gov/nasa-brand-center/images-and-media/).

Rebuild with `npm run build-heatmap` (downloads about 535 MB into `scripts/.cache/heatmap/`).
