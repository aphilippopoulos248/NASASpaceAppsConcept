# Annual maximum and annual mean surface temperature at the lunar poles (LRO Diviner)

Four maps, poleward of 80 degrees, in 240 m cells: for each pole the **annual maximum** and the
**annual mean** surface (bolometric) temperature in kelvin. `index.json` describes every file
(source file and checksum, extent, processing, statistics, recorded check values); the app reads
the maps through `src/science/polarTemperatures.ts`.

**Annual values only.** Separate summer and winter maps are not included: none are published as
maps (the seasonal measurements are about 190 GB of tables in the NASA PDS). These are also not
the temperature at any particular date.

| File | Quantity | Range | Empty cells inside 80 deg | Size |
| --- | --- | --- | --- | --- |
| `diviner_south_annual_max_240m.lxg` | annual maximum, south | 45 to 391 K | 1.84 % | 3.24 MB |
| `diviner_south_annual_mean_240m.lxg` | annual mean, south | 30 to 191 K | 1.84 % | 2.36 MB |
| `diviner_north_annual_max_240m.lxg` | annual maximum, north | 50 to 329 K | 0.01 % | 2.55 MB |
| `diviner_north_annual_mean_240m.lxg` | annual mean, north | 38 to 193 K | 0.01 % | 1.40 MB |

Layout: 2533 x 2533 cells of 240.04 m, polar stereographic on a sphere of 1737.4 km, true scale
at the pole, the pole at the centre. Row 0 is the top: for the south, longitude 0 points up;
for the north, down; 90E is to the right for both. One 16-bit integer per cell: kelvin, rounded
to 1 K; -32768 where there is no value (the corners of the square beyond 80 degrees, and cells
the authors left empty). Nothing is interpolated.

**Source (CC0 1.0):** Schorghofer, N., & Williams, J.-P. (2024). *Lunar polar maps derived from
Diviner temperatures organized by subsolar and ecliptic longitude* (version 3.0) [Data set].
Harvard Dataverse. https://doi.org/10.7910/DVN/EGOOCL . Files `polar_south_96x2/polar_south_80_{Tmax,Tmean}.grd`
(measurements July 2009 to February 2019) and `polar_north_96x2_2024/polar_north_80_{Tmax,Tmean}.grd`
(July 2009 to January 2024). The authors describe them as "Maximum temperature, after
frequency-domain Fourier-filtering [K]" and "Mean temperature, averaged over ecliptic and
subsolar longitudes [K]".

Method: Schorghofer, N., & Williams, J.-P. (2020). Mapping of ice storage processes on the Moon
with time-dependent temperatures. *Planetary Science Journal*, 1, 54.
https://doi.org/10.3847/PSJ/abb6ff . Underlying measurements: Williams, J.-P., et al. (2019).
Seasonal polar temperatures on the Moon. *JGR Planets*, 124, 2505-2521.

**Changes made by Lunyx:** rows reordered so that row 0 is the top; temperatures rounded to 1 K;
stored in the LXG container (`src/terrain/lxg.ts`). Not packaged from the same data set: the
unsmoothed variants, sublimation rates, ice-table depths, the 24 x 6 south variant and the
earlier north variant.

Rebuild with `node --experimental-strip-types --no-warnings scripts/build-diviner.mjs`
(downloads 103 MB into `scripts/.cache/diviner/` and checks the published MD5 sums).
