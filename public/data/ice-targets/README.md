# Lunar south-pole water-ice science targets

`lemelin2021-psr.geojson`: 169 water ice-bearing permanently shaded regions (PSRs) of
the lunar south polar region, mapped as **areas** (polygons), with the authors' full attribute table.

**Source and credit (CC BY 4.0):**
Lemelin, M., Li, S., Mazarico, E., Siegler, M. A., Kring, D. A., & Paige, D. A. (2021).
*Database of water ice-bearing permanently shaded regions in the lunar south polar region* [Data set].
Zenodo. https://doi.org/10.5281/zenodo.4646092. Described in Lemelin et al. (2021),
*Planetary Science Journal* 2, 103, https://doi.org/10.3847/PSJ/abf3c5.
Licence: https://creativecommons.org/licenses/by/4.0/

**Modified by Lunyx:** reprojected from south-polar stereographic to lat/lon, outlines simplified
(30 m Douglas-Peucker), coordinates rounded to 1e-4°, and blank cells kept as null. The full list of
changes and caveats is in the file's `lunyx` block. Rebuild with `npm run build-ice-targets`.

Caveats:
- The outlines extend about 0.3 km beyond the listed PSR areas (our inference, not documented in the record).
- Wiechert J (FID 154) has a listed centre about 100 km from its polygon; it is flagged.
- Distances from `src/science/iceTargets.ts` are great-circle distances on a 1737.4 km sphere, not traverses.
