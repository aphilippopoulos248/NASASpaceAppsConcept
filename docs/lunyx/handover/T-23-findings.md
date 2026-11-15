# T-23: what exists for Diviner temperatures and ShadowCam imagery

Checked on 2026-11-14 from the archives themselves (directory listings, labels, readmes).
Nothing is built yet. Proposal at the end; it needs a yes from the coordinator.

## 1. Diviner polar temperatures

### 1a. PDS: Polar Cumulative Products (the measurements, binned)

https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_pcp/

- Bolometric brightness temperature from all Diviner nadir observations, 5 July 2009 to
  17 February 2019, binned at 240 m, poleward of 80 degrees, polar stereographic.
  Described in Williams et al. (2019), "Seasonal polar temperatures on the Moon",
  JGR Planets 124, 2505-2521.
- Season definition (label text): summer = subsolar latitude on that pole's side of the
  equator ("less than zero degrees" for the south), winter = the other half.
- Form: plain-text tables, one per bin, about 0.2 GB each, with columns x, y (polar
  stereographic, in lunar radii), longitude, latitude, temperature. Empty bins are omitted.

| Set | Tables | Size |
| --- | --- | --- |
| diurnal, by local time: 96 bins of 0.25 h, summer and winter, south | 192 | 35.9 GB |
| the same, north | 192 | 45.0 GB |
| diurnal, by subsolar longitude, summer and winter, south / north | 192 / 192 | 35.9 / 45.1 GB |
| seasonal, south only: 6 solar-longitude bins x 24 subsolar-longitude bins | 144 | 30.7 GB |

192.7 GB in total. There is **no ready-made "summer maximum" or "winter maximum" map** in the
archive: such a map is the maximum over the 96 local-time tables of one season (18 to 23 GB to
read per pole and season).

Terms: NASA PDS archive data (no licence file; public archive). Cite Williams et al. (2019).

### 1b. PDS: Polar Resource Product (a thermal model, not seasonal)

`data_derived_prp/dlre_prp_{south,north}.tab`, 605 MB each (116 MB zipped under `extras/prp/`).
A table of 2 880 000 triangles with: annual average temperature at 2 cm depth, annual maximum
surface temperature, and the depth at which water ice is stable (Paige et al. 2010). Model
output on a triangle mesh; data set LRO-L-DLRE-5-PRP-V2.0.

### 1c. Harvard Dataverse: ready-made polar maps, CC0 (recommended source)

Schorghofer, N., & Williams, J.-P., "Lunar polar maps derived from Diviner temperatures
organized by subsolar and ecliptic longitude", https://doi.org/10.7910/DVN/EGOOCL , version 3.0
(2024-03-24). **Licence: CC0 1.0.** Method: Schorghofer & Williams (2020), Planetary Science
Journal 1, 54, https://doi.org/10.3847/PSJ/abb6ff . Built from the products in 1a by one of
their authors.

- Grids of 2533 x 2533, 240 m, polar stereographic true at the pole, poleward of 80 degrees,
  netCDF (GMT), 25.7 MB each, float32, no value outside the 80-degree circle. Two files
  downloaded and their MD5 sums match the repository's.
- Per pole: `Tmax` ("Maximum temperature, after frequency-domain Fourier-filtering [K]"),
  `Tmean` ("Mean temperature, averaged over ecliptic and subsolar longitudes [K]"), unsmoothed
  variants, potential sublimation rates (`Emax`, `Emean`), ice-table depths (`zit-1`,
  `zit-100`), pumping differential, and the number of populated bins (`cc`).
- Variants: south from 96 local-time x 2 season bins (data July 2009 to February 2019) and
  from 24 x 6 bins (to March 2020); north 96 x 2 (to February 2019) and 96 x 2 (to January 2024).
- Measured in the south 96 x 2 files: Tmax 44.6 to 391.4 K, Tmean 30.3 to 191.2 K; 92 903 of the
  5 039 157 cells inside the 80-degree circle (1.8 %) have no value.
- These are **annual** maximum and mean, taken over the diurnal and seasonal bins. They are
  not separate summer and winter maps.
- One oddity to carry in the notes: the south 96 x 2 files carry the internal title
  "polar_south_80_24x6".

Packaging cost measured on the two south files: at the native 240 m with temperatures rounded
to 1 K, Tmax is 3.35 MB and Tmean 2.40 MB in the app's LXG container (0.5 K: 3.85 and 2.99 MB).
Both poles, both quantities: about 12 MB.

## 2. ShadowCam

https://pds.shadowcam.im-ldi.com/ (PDS4 bundle "KPLO ShadowCam Data Archive", ShadowCam SOC,
doi:10.17189/y89z-kt98; quarterly releases, latest listed: September 2026). Browsing portal:
https://data.im-ldi.com/ .

- **Controlled mosaics** (`derived/cmosaic/`): 26 mosaics of 14 permanently shadowed sites.
  South (20): Amundsen, Cabeus B, Faustini (11 lightings), Idel'son L, Kocher, Kuhn,
  Shackleton (2), Shoemaker, Wiechert J. North (6): Hermite A (2), Hinshelwood, Lovelace E,
  Sylvester N, an unnamed PSR in Rozhdestvenskiy.
  Each is polar stereographic, about 2 m/px at full resolution (hundreds of MB to over 2 GB
  per file), with 5 m and 20 m versions as ISIS cubes and Cloud-Optimized GeoTIFFs. The 20 m
  GeoTIFF of Shackleton (summer, 11 am) is 4.56 MB: 1246 x 1246 px, 32-bit float values (up to
  0.82 in this file), 24.9 km across.
  Each mosaic's readme states its images, dates, season, local time, pixel scale and the
  reference DEM, and says shadowed ground is seen by light reflected from nearby terrain while
  sunlit ground is saturated.
- **Footprints** (`derived/vector/`): GeoCSV tables of the controlled-mosaic outlines for each
  pole (18 MB for the south, WKT polygons in polar stereographic metres) with a `product_link`
  per mosaic. Also outlines of observations, DTMs and uncontrolled mosaics.
- Also there: uncontrolled mosaics, collar mosaics, DTMs, and LROC NAC controlled mosaics of
  Malapert, Haworth, Nobile and the Amundsen rim.
- None of the 28 catalogued landing sites is at one of these 14 sites (not yet checked against
  the outlines); the mosaics matter for custom pins.

Terms: I found **no licence or usage statement** in the bundle label, the archive SIS
(`document/archsis.pdf`) or the mosaic readmes. It is a NASA PDS archive; the instrument site
credits its images "NASA/KARI/ASU". The readmes ask that the controlled mosaics be cited as
Grieser et al. (2025), LPSC 56, abstract 2523; the footprint tables point to Collins et al.
(2026), Remote Sensing 18(3), 525.

## 3. Proposal

1. **Diviner, package:** `Tmax` and `Tmean` for both poles from the CC0 Dataverse set (south
   96 x 2, north 96 x 2 to January 2024), at the native 240 m, rounded to 1 K, gaps kept as
   "no data": about 12 MB. A sampler `polarTemperatureAt(lat, lon)` returning both values with
   a sentence that states "annual maximum / mean bolometric temperature measured by Diviner,
   240 m cell, 2009 to 2019 (south) / 2024 (north), poleward of 80 degrees" and the citation.
   Labelled as annual, not seasonal.
2. **Diviner, not proposed:** separate summer and winter maxima. They exist only as the
   192.7 GB of tables in 1a; one map costs 18 to 23 GB of reading. Say if it is wanted.
3. **ShadowCam, package:** a small index of the 26 controlled mosaics (site, outline, season,
   local time, pixel scale, dates, link to the PDS product and its 20 m GeoTIFF), a few tens of
   kB, with `shadowCamMosaicsAt(lat, lon)` so a pin inside an outline gets a credited link out.
4. **ShadowCam, optional:** bundle the 20 m Shackleton mosaic as an 8-bit image (under 1 MB)
   for a UI owner who wants to draw it. Only on request: it needs a place on screen.

Not proposed: a temperature overlay mode on the globe (it would add a value to `OverlayMode`
in the core contract); the data and texture would be ready if @globe and the coordinator want it.
