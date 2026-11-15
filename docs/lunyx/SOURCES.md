# Lunyx: sources, credits and licences

Every dataset Lunyx ships or fetches, every software dependency, and what the team still has
to settle before the project is published. Prepared for the NASA Space Apps 2026 submission
(task T-3 of the hub project "Lunyx Navigator and Submission"; requirements in
`docs/lunyx/SUBMISSION-DOCS-BRIEF.md`, section 1).

- **State described:** the tree at `2bf9ff6`: `am/lunyx-experience/integration` at `350f928`
  merged with `am/lunyx/integration` at `b6f7392` (T-22 mission presets, T-37 licence notices
  and the DOI fix, T-38 a source for every landing, T-39 the flags, T-40 the notices header,
  T-46 to T-48 and T-50, all four of the science project's deliveries), plus this task's
  documents. Since the published `cc736f8`, `public/` gained `public/data/sources/` (S18 to
  S20), `public/data/presets.json` (S21) and `public/licences/` (section 6); `package.json`
  gained the scripts `fetch-gcat`, `fetch-site-areas` and `build-licences`; the lockfile is
  unchanged.
- **Checked:** 2026-11-15 (UTC). Every licence, citation and credit line below was read at the
  source named next to it on that day, not copied from a handover note. Where the source says
  nothing, the entry says so and the item is on the open list in
  [AI-USE.md, section 8](AI-USE.md#8-open-list-for-the-operator).
- **AI use** (who wrote the code and scripts, the asset-by-asset inventory, the in-app
  assistant) is in [AI-USE.md](AI-USE.md). What has been validated against what is in
  [STATUS.md, section 4](STATUS.md) and [validation.md](validation.md).
- Written by an AI agent (Claude) for the team; nothing in it has been reviewed by NASA or by
  any data provider.

## 1. What the rules ask for

The Space Apps Participant Terms and Conditions (https://www.spaceappschallenge.org/legal/,
read 2026-11-15) say, under "Use of third-party materials":

> Any licenses applicable to your Solution Materials must be identified in the documentation
> that you submit with your Solution. NASA will not accept or post any Solutions that do not
> include appropriate license documentation for your Solution Materials. You must cite every
> source that is used in the creation of your project, even if it is open source or freely
> available.

and, under "Intellectual property rights in solutions", that original content is "freely
available without restriction or is licensed as open source as defined by the Open Source
Initiative", and "If you do not specify a specific OSI compliant license, NASA will distribute
your original content under an Apache 2.0 license." The repository has no `LICENSE` file
(open list item L1).

NASA's Images and Media Usage Guidelines
(https://www.nasa.gov/nasa-brand-center/images-and-media/, the page PGDA and NASA SVS point
to) say:

> NASA content – images, audio, video, and media files used in the rendition of
> 3-dimensional models, such as texture maps and polygon data in any format – generally are
> not subject to copyright in the United States. You may use this material for educational or
> informational purposes, including photo collections, textbooks, public exhibits, computer
> graphical simulations and Internet Web pages.

and "NASA should be acknowledged as the source of the material." The same page says the NASA
Insignia, Logotype and identifiers are not in the public domain; Lunyx uses none of them
(see [AI-USE.md, section 6](AI-USE.md#6-nasa-branding-check)).

## 2. How the entries were checked

| Check | Result |
| --- | --- |
| Product page, licence or usage statement and requested citation, read at the source | Done for every dataset in section 3, for R1 to R3 in section 4, and for the Horizons, ALSJ and DSN rows of section 5; the quotes and dates are in each row. Where a page states no licence, the row says "not stated". Not reviewed: the terms of service of the Claude API, TypeSafe and the browsers' speech services (R4 to R6, which apply to whoever configures them), the NAIF kernels and the press pages quoted in the test fixtures (test references, not shipped) |
| Bundled files against the SHA-256 that their build scripts recorded in `index.json` (`public/data/dem`, `heatmap`, `science/diviner`, `science/shadowcam`) | 18 of 18 files match |
| Source checksums recorded by the build scripts against the publishers' current ones | Zenodo record 4646092: 2 of 2 MD5 match. Harvard Dataverse DVN/EGOOCL v3.0: 4 of 4 MD5 match |
| Bundled values against the original archives | Not repeated here. The independent validation (T-26) compared 30 080 samples of the bundled `.lxg` grids with the PDS originals: equal within rounding (`tests/fixtures/validation/ephemeris-check/`, STATUS.md section 4). The site windows (S3, S4: `public/terrain/*.bin`) were not compared with their PDS sources; the 3 m and 60 m windows were compared with each other (they step by several metres at the 3 m model's edge) and with LRO LOLA laser shots at 17 of the 19 sites (the science project's T-32 verification) |
| Embedded image metadata (EXIF, XMP, C2PA, PNG text) of all 155 images in the repository | None carries EXIF, XMP or C2PA metadata. The only embedded data: ICC colour profiles in 24 JPEG screenshots, and creation and modification times in the text chunks of three PNG screenshots (AI-USE.md section 2.4) |
| Licences of npm packages | Read from each installed `node_modules/<package>/package.json` after `npm ci` at `cc736f8` (same lockfile as `bc5fb8e`); 93 packages installed |

## 3. Datasets bundled in `public/`

Sizes are of the files in the repository. "Public domain" is written only where the source
says so.

| # | Dataset | Files | Size | Licence or terms, as stated at the source | Credit shown or recorded |
| --- | --- | --- | --- | --- | --- |
| S1 | LOLA whole-Moon elevation grids | `public/data/dem/lola_global_{16ppd,4ppd}.lxg` | 17.10 MB | Not stated by the archive; the PDS Geosciences Node says "All our archives are online and available to the public to download free of charge." | NASA LRO LOLA, PDS Geosciences Node |
| S2 | LOLA south-polar elevation grids | `public/data/dem/lola_south_{80s_160m,85s_80m,875s_40m}.lxg` | 21.93 MB | As S1 | As S1 |
| S3 | Elevation windows around the 28 catalogued sites (SLDEM2015, LOLA polar) | `public/terrain/<site>.bin` (28), `public/terrain/index.json` | 3.74 MB | As S1 | SLDEM2015 / LOLA, PDS Geosciences Node |
| S4 | LROC NAC elevation models and orthophotos, 19 sites | `public/terrain/<site>_fine.bin` (19), `<site>_ortho.webp` (19) | 33.15 MB | LROC: "Data products available through the LROC Data Node of the PDS or through NASA PDS interfaces are in the public domain" | NASA/GSFC/Arizona State University |
| S5 | Photo-derived fine relief (made in this repository from S4) | `public/terrain/<site>_detail.webp` (19) | 16.88 MB | Derived here from S4 | As S4 |
| S6 | Globe colour maps (NASA SVS CGI Moon Kit, 2019 colour map) | `public/textures/moon_color_{2k,4k,8k}.jpg` | 5.71 MB | NASA SVS: "All of our content is in the public domain (unless otherwise noted)" | "NASA's Scientific Visualization Studio" |
| S7 | Globe relief maps (normal maps computed here from LOLA) | `public/textures/moon_normal_4k.jpg`, `moon_normal_8k.webp` | 17.69 MB | Sources as S6 and S1 | NASA SVS; NASA LRO LOLA |
| S8 | Earth (NASA Blue Marble) | `public/textures/earth_2k.jpg` | 0.20 MB | As S6 | "NASA/Goddard Space Flight Center Scientific Visualization Studio"; data courtesy Reto Stockli (NASA/GSFC) and NASA's Earth Observatory |
| S9 | Close-up surface textures ("moon-surface" asset pack) | `public/textures/surface_detail_{normal,tone}.jpg` | 1.82 MB | **Not established**: origin and licence of the pack are not recorded (open list L2) | None |
| S10 | JPL Horizons Sun and Earth tables, two mission windows | `public/data/horizons/{blue-ghost-1-2025-03,im-2-2025-03,index}.json` | 0.32 MB | Not stated on the Horizons pages read (open list L5) | Citation requested by the Horizons manual, see S10 |
| S11 | JPL Horizons sub-Earth and sub-solar points at the 28 landings | `public/data/horizons-check.json` | 5.7 kB | As S10 | As S10 |
| S12 | NASA PGDA product 69, long-term average sunlight and Earth visibility | `public/data/heatmap/*.lxg` (8), `index.json` | 13.44 MB | Not stated; the product page links NASA's "Reproduction Guidelines" (the media guidelines above) | Mazarico et al. 2011 |
| S13 | Ice-bearing permanently shaded regions (Lemelin et al. 2021) | `public/data/ice-targets/lemelin2021-psr.geojson` | 0.24 MB | **CC BY 4.0** (Zenodo record) | Shown in the Filters panel: "Lemelin et al. 2021 (Zenodo 4646092), CC BY 4.0" |
| S14 | Diviner annual maximum and annual mean temperature (Schorghofer and Williams) | `public/data/science/diviner/*.lxg` (4), `index.json` | 9.55 MB | **CC0 1.0** (Harvard Dataverse record) | Site card, "Surface temperature (Diviner, annual)", under "Source and limits": the citation and "Licence: CC0 1.0 …"; also in every result's basis text |
| S15 | ShadowCam controlled-mosaic index (links and footprints, no imagery) | `public/data/science/shadowcam/{index.json,shadowcam_coverage.lxg}` | 0.13 MB | Not stated: the bundle label carries citation information only (checked again 2026-11-15) | Site card, ShadowCam links, under "Credit and terms": the index's credit note and citations; links only |
| S16 | Catalogue of the 28 landings | `public/data/landings.json` | 17.0 kB | Facts with a cited source per row since T-38: LROC positions (S19) and published touchdown times | `sources` field of each row |
| S17 | List of LROC NAC products near each site | `scripts/nac-dtm-candidates.json` | 12.1 kB | Built from the PDS archive's file listing (as S4) | — |
| S18 | Who owns the hardware at each landing (GCAT) | `public/data/sources/gcat-landers.json` | 13.1 kB | **CC BY 4.0** (GCAT's copyright notice) | Site card: "source: GCAT" with a link and the catalogue id; surface view: "(GCAT)" |
| S19 | LROC catalogue of hardware positions on the Moon | `public/data/sources/lroc-anthropogenic-objects.csv` | 21.0 kB | As S4 (public domain as a PDS product) | Recorded in `site-areas.json`; not shown on screen |
| S20 | Explored area at each site (made in this repository from S19 and traverse maps) | `public/data/sources/site-areas.json` | 34.3 kB | Derived here | Sources listed in the file |
| S21 | The three "Missions to replay" (written here: site, window, clock, view) | `public/data/presets.json` | 3.9 kB | Written here; its times come from S16 and its windows lie inside the S10 tables | `sources` field of each preset |

The `README.md` next to each data folder (`public/data/dem/`, `heatmap/`, `ice-targets/`,
`science/diviner/`, `science/shadowcam/`) carries the same credits for anyone who opens the
data alone.

### S1, S2. LOLA elevation grids

- **Products** (from `public/data/dem/index.json`, which the build script wrote): LDEM_16 (PDS
  product version V3.1, created 2019-03-15), LDEM_4 (V3.0, 2017-09-15), LDEM_80S_80M,
  LDEM_85S_40M and LDEM_875S_20M (V2.0, 2017-06-15), data set `LRO-L-LOLA-4-GDR-V1.0`.
- **URL:** https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/
  (`cylindrical/img/`, `polar/img/`).
- **Citation:** the data set's DOI record (DataCite, resolved 2026-11-15): Neumann, G. A. (2011).
  *LRO MOON LASER ALTIMETER 4 GDR V1.0* [Dataset]. NASA Planetary Data System.
  https://doi.org/10.17189/1520642. The PDS catalogue (`catalog/gdr_ds.cat`, data set release
  date 2015-12-15) gives an older form: "Neumann, G.A., 2009 Lunar Orbiter Laser Altimeter Raw
  Data Set, LRO-L-LOLA-4-GDR-V1.0, NASA Planetary Data System, 2010." The bundled index also
  cites Smith, D. E., et al. (2017), *Icarus* 283, 70-91, https://doi.org/10.1016/j.icarus.2016.06.006.
- **Terms:** the product labels state none. The PDS Geosciences Node's site links its
  "Copyright/Image Use Policy" to the JPL Image Use Policy (https://www.jpl.nasa.gov/jpl-image-use-policy/),
  which says "Unless otherwise noted, images and video on JPL public web sites (public sites
  ending with a jpl.nasa.gov address) may be used for any purpose without prior permission" and
  asks for the credit line "Courtesy NASA/JPL-Caltech."; it says nothing specific about PDS data.
- **What Lunyx did** (`scripts/build-dem.mjs`): whole-Moon grids rearranged to start at 180°W
  (LDEM_16 heights rounded from 0.5 m to 1 m steps, no resampling); polar layers are 2 × 2
  block means of the source grids in the source projection; stored losslessly in the LXG
  container (`src/terrain/lxg.ts`).
- **Not bundled:** any north-polar layer; the source's finer grids.

### S3. Elevation windows around the catalogued sites

- **Products:** SLDEM2015 at 512 px/deg (`data/sldem2015/tiles/float_img/`, latitudes 60°S to
  60°N) and the LOLA polar grids `ldem_60s_60m`, `ldem_80s_20m` (`data/lola_gdr/polar/img/`),
  same archive as S1. Which product each site uses is recorded per site in
  `public/terrain/index.json`.
- **Citation (SLDEM2015):** Barker, M. K., Mazarico, E., Neumann, G. A., Zuber, M. T., Haruyama,
  J., & Smith, D. E. (2016). A new lunar digital elevation model from the Lunar Orbiter Laser
  Altimeter and SELENE Terrain Camera. *Icarus*, 273, 346-355.
  https://doi.org/10.1016/j.icarus.2015.07.039 (the app carries the same citation, without the
  DOI, in `src/terrain/api.ts`). SLDEM2015 combines LOLA with
  JAXA SELENE (Kaguya) Terrain Camera data; it is distributed by the NASA PDS.
- **What Lunyx did** (`scripts/fetch-terrain.mjs`): read only the rows around each site by HTTP
  range requests and resampled two 129 × 129 grids per site (60 m, 7.7 km across; 480 m, 61 km
  across), heights in metres above the 1737.4 km sphere.

### S4. LROC NAC elevation models and orthophotos

- **Products:** LROC NAC digital terrain models and orthophotos, PDS4 bundle
  `lro-l-lroc-5-rdr`, release `LROLRC_2001`, `DATA/SDP/NAC_DTM/`, read from the PDS Imaging Node store
  (https://pds.mcp.nasa.gov/data/store/img/lunar_reconnaissance_orbiter/pds4/lroc/lro-l-lroc-5-rdr/LROLRC_2001/DATA/SDP/NAC_DTM/).
  The product used for each site, its resolution and the orthophoto time are recorded in
  `public/terrain/index.json` (2 m to 5 m elevation, 0.5 m to 1.6 m imagery).
- **Terms**, from https://lroc.im-ldi.com/about/terms (read 2026-11-15): "Data products
  available through the LROC Data Node of the PDS or through NASA PDS interfaces are in the
  public domain". The same page says images on the LROC *website* (featured images and other
  non-PDS products) are copyrighted; Lunyx uses none of those. The page lists pds.nasa.gov and
  pds-imaging.jpl.nasa.gov among the PDS interfaces; the files were read from pds.mcp.nasa.gov,
  the PDS Imaging Node's data store (my reading: a NASA PDS interface).
- **Credit and citation** (same page): "credit LROC images with the text tag NASA/GSFC/Arizona
  State University"; for research use cite Robinson, M.S., et al. (2010), LROC Instrument
  Overview, *Space Science Reviews* 150, 81-124, https://doi.org/10.1007/s11214-010-9634-2, and
  for the elevation models Henriksen, M.R., et al. (2017), Extracting accurate and precise
  topography from LROC narrow angle camera stereo observations, *Icarus* 283, 122-137,
  https://doi.org/10.1016/j.icarus.2016.05.012 (both DOIs resolved 2026-11-15).
- **What Lunyx did** (`scripts/fetch-apollo-terrain.mjs`): read the rows around each landing
  point; resampled heights to a 513 × 513 grid at 3 m and the orthophoto to 0.5 m on the same
  1.5 km square; WebP encoding.

### S5. Photo-derived fine relief

Made in this repository by `scripts/derive-detail.mjs` from the S4 orthophotos
(photoclinometry: brightness along the Sun's direction read as slope, with the Sun position
computed from each photo's time), calibrated against the S4 elevation model and discarded where
the two disagree. Only the fine part (under about 20 m) is kept. Not measured heights:
material changes read as relief, and shadowed ground gets none. The agreement value per site is
in `public/terrain/index.json`.

### S6, S7, S8. Globe colour, relief and Earth textures

- **Colour (S6):** NASA SVS "CGI Moon Kit", https://svs.gsfc.nasa.gov/4720 (released
  2019-09-06, page updated 2026-01-09), file `lroc_color_poles_8k.tif` (the 2019 colour map,
  not the December 2025 one), resized to 2k/4k/8k JPEGs by `scripts/fetch-textures.mjs`. The page
  says the maps "were adapted from the Hapke Normalized WAC Mosaic" of the LROC team and "This
  image is optimized for aesthetics, not science." Credit requested: "NASA's Scientific
  Visualization Studio". Usage (https://svs.gsfc.nasa.gov/help/): "All of our content is in the
  public domain (unless otherwise noted)".
- **Relief (S7):** `moon_normal_4k.jpg` is a normal map computed by `scripts/fetch-textures.mjs`
  from the same kit's `ldem_16_uint.tif` (LOLA); `moon_normal_8k.webp` from LOLA `LDEM_64.IMG`
  read from the LOLA archive mirror https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/ (S1's
  data set). Relief is exaggerated four times for shading at globe scale. Drawing only; no
  number in the app is read from these maps.
- **Earth (S8):** NASA SVS "Blue Marble - A Seamless Image Mosaic of the Earth",
  https://svs.gsfc.nasa.gov/2915 (released 2004-02-16), file `bluemarble-2048.png`, re-encoded
  as JPEG. Credit requested: "NASA/Goddard Space Flight Center Scientific Visualization Studio.
  The Blue Marble Next Generation data is courtesy of Reto Stockli (NASA/GSFC) and NASA's Earth
  Observatory." The image has no clouds; the surface view says so.

### S9. Close-up surface textures

`public/textures/surface_detail_normal.jpg` (2048 px) and `surface_detail_tone.jpg` (1024 px)
were added from GitHub `main` (commits `418760e`, `2ab7daa`) together with
`scripts/make-surface-detail.mjs`. The script does **not** generate them: it takes a folder
holding `NormalMap.jpeg` and `Diffuse.jpeg` from what its header calls the "moon-surface" asset
pack, resizes them, cross-fades each with a copy of itself shifted by half its size so that it
tiles, renormalises the normals and centres the tone at mid-grey. So the textures are derived
from a third-party source that is not in the repository. The teammate's own data-sources note
(`docs/DATA_SOURCES.md`, from GitHub `main`, in the tree since `0cc5553`) describes the pack as
"Blender-made crater terrain", "Artist-made, not lunar data", and says "Origin and licence
unknown — confirm before publishing." Neither image carries any embedded metadata. The app uses
them only for shading inside its labelled "generated detail" and switches them off with it
(`src/scene/surface/materials.ts`, `src/scene/surface.ts`). **Origin, licence and whether
any AI tool made them are not established (open list L2).**

### S10, S11. JPL Horizons tables

- **S10** (`scripts/build-horizons-bundle.mjs`): airless topocentric Sun and Earth azimuth and
  elevation every 10 minutes for Blue Ghost Mission 1 (2025-03-01 to 04-01) and IM-2 Athena
  (2025-03-05 to 04-05), queried as recorded in each file (`CENTER='coord@301'`,
  `COORD_TYPE='GEODETIC'`, `QUANTITIES='4,20'`, `APPARENT='AIRLESS'`, "DE441", fetched
  2026-11-14). Values as Horizons returned them. The planetary and lunar ephemeris behind them:
  Park, R. S., Folkner, W. M., Williams, J. G., & Boggs, D. H. (2021). The JPL Planetary and Lunar
  Ephemerides DE440 and DE441. *The Astronomical Journal*, 161(3), 105.
  https://doi.org/10.3847/1538-3881/abd414.
- **S11** (`scripts/fetch-horizons.mjs`): Horizons sub-Earth and sub-solar points (quantities 14
  and 15, geocentric observer) at the 28 catalogued landing times, used by
  `npm run check-ephemeris`.
- **Citation**, from the Horizons manual (https://ssd.jpl.nasa.gov/horizons/manual.html,
  "References for the Horizons system"): "Giorgini, JD and JPL Solar System Dynamics Group,
  NASA/JPL Horizons On-Line Ephemeris System, < https://ssd.jpl.nasa.gov/horizons/ >, data
  retrieved 2026-Nov-14." The manual, the API documentation and the Horizons page state no
  licence or usage terms (open list L5).

### S12. NASA PGDA product 69, long-term averages

- **Product page:** https://pgda.gsfc.nasa.gov/products/69, "Lunar Polar Illumination" (NASA
  official and curator: Erwan Mazarico). Files `AVGVISIB_{65,85}{S,N}_{240,060}M_201608[_EARTH].IMG`
  from https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/ (PDS label version V1.05, created
  2016-09-15, as recorded in `public/data/heatmap/index.json`).
- **Citation**, from the product page: "Please cite the Mazarico et al. (2011) reference below
  when using the LOLA illumination maps available on the PDS": Mazarico, E., et al. (2011),
  Illumination conditions of the lunar polar regions using LOLA topography, *Icarus* 211,
  1066-1081, doi:10.1016/j.icarus.2010.10.030.
- **Terms:** none stated; the page footer links "Reproduction Guidelines", which redirects to
  NASA's images and media guidelines (section 1).
- **Caveat at the source** (`README_ILLUMINATION_2016.TXT`): "As with all EXTRAs products, these
  files are not supported by the PDS or the LOLA Science Team." Some maps show linear artefacts
  from the elevation models.
- **What Lunyx did** (`scripts/build-heatmap.mjs`): 2 × 2 means of the 60 m maps (to 120 m) and
  4 × 4 means of the 240 m maps (to 960 m), one byte per cell. Used only for the long-term
  average overlay, never mixed with dated results (decision D-5).

### S13. Ice-bearing permanently shaded regions

- **Record:** Lemelin, M., Li, S., Mazarico, E., Siegler, M. A., Kring, D. A., & Paige, D. A.
  (2021). *Database of water ice-bearing permanently shaded regions in the lunar south polar
  region* [Data set]. Zenodo. https://doi.org/10.5281/zenodo.4646092 (version 1, published
  2021-03-29). Paper: Lemelin, M., et al. (2021). Framework for Coordinated Efforts in the
  Exploration of Volatiles in the South Polar Region of the Moon. *The Planetary Science
  Journal*, 2(3), 103. https://doi.org/10.3847/PSJ/abf3c5 (checked at Crossref 2026-11-15).
  Until T-37 (`27b0f30`) the repository's own files cited `10.3847/PSJ/abf3c3`, which doi.org
  does not know (HTTP 404); `public/data/ice-targets/README.md`, the GeoJSON's `lunyx` block and
  `scripts/build-ice-targets.py` now cite `abf3c5`.
- **Licence:** `cc-by-4.0` in the Zenodo record's metadata (read through the Zenodo API,
  2026-11-15). Attribution is shown in the app's Filters panel next to the layer.
- **What Lunyx did** (`scripts/build-ice-targets.py`): polygons from the shapefile and
  attributes from the spreadsheet, reprojected from south-polar stereographic to latitude and
  longitude, outlines simplified (Douglas-Peucker, 30 m), coordinates rounded to 1e-4°. The full
  list of changes is in the file's `lunyx` block, as CC BY asks.

### S14. Diviner annual temperature maps

- **Record:** Schorghofer, N., & Williams, J.-P. (2024). *Lunar polar maps derived from Diviner
  temperatures organized by subsolar and ecliptic longitude* (version 3.0) [Data set]. Harvard
  Dataverse. https://doi.org/10.7910/DVN/EGOOCL (version 3.0 released 2024-03-24). Method paper:
  *Planetary Science Journal* 1, 54 (2020), https://doi.org/10.3847/PSJ/abb6ff. Underlying
  measurements: Williams, J.-P., et al. (2019). Seasonal Polar Temperatures on the Moon. *JGR
  Planets*, 124(10), 2505-2521. https://doi.org/10.1029/2019JE006028.
- **Licence:** "CC0 1.0" (SPDX `CC0-1.0`) in the Dataverse record (read through its API,
  2026-11-15).
- **What it is:** four maps poleward of 80°: **annual maximum** and **annual mean** surface
  temperature for each pole (files `polar_south_80_{Tmax,Tmean}.grd` and
  `polar_north_80_{Tmax,Tmean}.grd`). Not seasonal temperatures and not the temperature on any
  date; separate summer and winter maps are not published as maps. The app labels them as
  annual values.
- **What Lunyx did** (`scripts/build-diviner.mjs`): rows reordered, kelvin rounded to 1 K, LXG
  container.

### S15. ShadowCam controlled-mosaic index

- **Archive:** KPLO ShadowCam Data Archive (PDS4 bundle), ShadowCam SOC,
  https://pds.shadowcam.im-ldi.com/, DOI 10.17189/y89z-kt98. The bundle label
  (`bundle_kplo-shadowcam.xml`, dated 2026-10-02 in the listing) holds citation information
  (author "ShadowCam SOC", 2026, the DOI) and no licence, rights or usage element. The DOI
  registry's citation gives 2024: "ShadowCam SOC. (2024). KPLO ShadowCam Data Archive. NASA
  Planetary Data System. https://doi.org/10.17189/Y89Z-KT98".
- **What Lunyx ships:** an index of the 26 controlled mosaics (site, season, dates, pixel
  scale, links) and a 200 m coverage grid rasterised from the archive's published footprints
  (`scripts/build-shadowcam-index.mjs`). **No ShadowCam imagery is bundled or displayed**; the
  app links to the products. Citations recorded in the index: Grieser et al. (2025), LPSC 56,
  abstract #2523; Collins et al. (2026), *Remote Sensing* 18(3), 525,
  https://doi.org/10.3390/rs18030525.
- Imagery stays as credited links unless the team obtains permission (operator requirement,
  brief section 1).

### S18. GCAT hardware ownership

- **Source:** GCAT, the General Catalog of Artificial Space Objects, by Jonathan C. McDowell,
  https://planet4589.org/space/gcat/ (read 2026-11-15): "Licence: CC-BY-4.0 Creative
  Commons/Attribution"; "This data may be freely reproduced as long as you cite it. A minimal
  citation is "Data from J. McDowell, planet4589.org"." Files read by
  `scripts/fetch-gcat-landers.mjs`: `tsv/cat/deepcat.tsv` and `tsv/tables/orgs.tsv`; catalogue
  version recorded in the file: "Updated 2026 Nov 13 0021:56", retrieved 2026-11-14.
- **What Lunyx did:** one record per landing (GCAT id, designation, object name, owner, the
  responsible state and its dates), values copied unchanged, plus readable names from GCAT's own
  organisation table. The app shows USSR hardware as belonging to Russia, its successor state, with
  the note "launched by the USSR"; the file itself keeps "USSR" (`src/data/ownership.ts`).
- **Credit on screen:** "source: GCAT" with a link and the object's catalogue id on the site
  card. CC BY 4.0 asks for the creator, the licence and an indication of changes; they are given
  here and in the README.

### S19, S20. Hardware positions and explored areas

- **S19:** `ANTHROPOGENIC_OBJECTS_180.csv` from the LROC PDS release `LROLRC_2001`,
  `EXTRAS/SHAPEFILE/ANTHROPOGENIC_OBJECTS/` on the PDS Imaging Node store. The bundled copy is
  byte-identical to the archive's current file (compared 2026-11-15). Citation: Wagner, R. V.,
  Nelson, D. M., Plescia, J. B., Robinson, M. S., Speyerer, E. J., & Mazarico, E. (2017).
  Coordinates of anthropogenic features on the Moon. *Icarus*, 283, 92-103.
  https://doi.org/10.1016/j.icarus.2016.05.011 (resolved 2026-11-15). Terms as S4.
- **S20:** `scripts/fetch-site-areas.mjs` draws, for each landing, the convex hull of every known
  point (lander, rovers' final positions, instruments, traverse paths) widened by 30 m. Inputs:
  S19; the LROC traverse files of Apollo 11, 12 and 14 in the same archive (`EXTRAS/SHAPEFILE/APOLLO_11`
  and so on; the folders exist, listed 2026-11-15), cited by the teammate as Gonzales et al. (2019),
  LPSC 50, abstract 3089 (not checked here); and the map layers of the Apollo Analyst's Notebook,
  NASA PDS Geosciences Node (https://an.rsl.wustl.edu/apollo/; its page states no licence or
  terms), whose rover traverses the teammate attributes to NASA TN D-7469 (not checked here). On
  the globe each area is drawn up to ten times larger than true size from orbit and true to size
  close to the ground (`AREA_DISPLAY_SCALE` in `src/scene/siteAreas.ts`); the site card gives the
  true size and says so.

### S16. Landing catalogue

`public/data/landings.json`: 28 successful soft landings, 1966 to 2025, with name, programme,
country, date, touchdown time (UTC), latitude, longitude, region, a one-sentence summary and an
`approx` flag. It arrived in the teammate's first commit (`4ab3892`, "Co-Authored-By: Claude Fable
5.2") without any source. The original team's task T-38 (`ab228cf`, 2026-11-15) added a
`sources.position` and a `sources.time` to every row:

- **Positions:** 26 are the lander's measured position in LROC's catalogue of anthropogenic
  objects (S19; Wagner et al. 2017), with the catalogue's method and uncertainty; for Apollo, the
  descent stage. Luna 9 and Luna 13 have not been found in LRO images and keep the NSSDCA
  positions, marked approximate (uncertain by kilometres). The move to LROC's positions shifted
  IM-2 by 22 m, Blue Ghost 1 by 8 m and Chang'e 4 by 417 m (`docs/lunyx/validation.md`).
- **Times:** NSSDCA pages, Siddiqi, *Beyond Earth* (NASA SP-2018-4041, 2018), CNSA/Xinhua, ISRO,
  JAXA, NASA, Firefly and LROC, quoted per row. Three times are listed in the row's `unsourced`
  field because no checked source confirms them to the minute shown: Luna 23's time of day,
  Chandrayaan-3's minute and IM-2's minute.
- **Checked here (2026-11-15):** all 26 LROC-sourced positions equal the bundled LROC table to
  within 0.00005°; the NSSDCA entries cited for Luna 9 (18:44:52 UT; 7.08 N, 295.63 E) and
  Surveyor 1 (06:17:36 UT) read the same at the source. The other cited times were not re-read.
- `public/data/horizons-check.json` (S11) was refreshed for the one corrected time (Luna 17).
- **Not established:** who wrote the one-sentence summaries, and whether the AI model supplied
  any of the original values before T-38 replaced them (open list L3).

## 4. Fetched at run time (not stored in the repository)

| # | What | Service | When | Terms and credit |
| --- | --- | --- | --- | --- |
| R1 | Close-up imagery around a selected site: `LRO_WAC_Mosaic_Global_303ppd_v02` and `Kaguya_TCortho_Mosaic_Global_4096ppd` | NASA Moon Trek WMTS tiles under `https://trek.nasa.gov/tiles/Moon/EQ/<layer>/` (`src/scene/sitePatch.ts`; for example https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/WMTSCapabilities.xml) | Online only, latitudes up to 80° | Moon Trek's FGDC metadata for each layer (https://trek.nasa.gov/moon/TrekWS/rest/cat/metadata/fgdc/html?label=<layer>, read 2026-11-15). WAC (Arizona State University, "LRO WAC Mosaic v2", 2013): "Access_Constraints: None", "Use_Constraints: None", credit "The LROC Team". Kaguya TC (JAXA, "Kaguya TC Ortho Mosaic", edition 2, 2014): "the copyrights therein are the property of Japan Aerospace Exploration Agency (JAXA) and institutes to collaborate with the Selenological and Engineering Explorer (SELENE) project of JAXA", "The data can be allowed to use for scientific and educational utilization.", credit "The Kaguya Team". The site card shows "Close-up imagery: LROC WAC (NASA/GSFC/ASU) · Kaguya TC (JAXA/SELENE), via NASA Moon Trek". Whether a public submission fits JAXA's terms: open list L6 |
| R2 | 60 m and 480 m elevation windows for pins outside the bundled coverage | `/api/terrain` reading SLDEM2015 and LOLA from the PDS Geosciences Node by range request (`server/api/terrain.ts`, `src/terrain/windowBuilder.ts`) | On request, needs network | As S1 and S3; each result names its product and carries the SLDEM2015 citation |
| R3 | Reference ephemerides | `/api/horizons`, a proxy to https://ssd.jpl.nasa.gov/api/horizons.api | On request | As S10 |
| R4 | Language model for the assistant | Claude API (Anthropic), from the server only | Only when the server has a key | See AI-USE.md section 3 |
| R5 | Optional request router | Jev, TypeSafe AI (https://api.typesafe.ai/v1/systemone), from the server only | Only with `LUNYX_LLM_ROUTER=jev` and a key | See AI-USE.md section 3 |
| R6 | Voice dictation | The browser's own speech recognition (Web Speech API) | Only when the user presses the microphone button, where the browser offers it | The browser vendor's service; Lunyx receives only the text |

Outbound links (no data taken): LROC QuickMap and NASA Moon Trek for each site
(`src/data/landings.ts`), the ShadowCam archive products, and the DOIs above. The challenge's
own resource list names Quickmap, Moon Trek and the Horizons System as NASA resources
(https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/?tab=resources,
read 2026-11-15); Lunyx uses Moon Trek (R1) and Horizons (S10, S11, R3) and links to QuickMap.

## 5. Reference data used to check the app (`tests/fixtures/`, `src/analysis/__fixtures__/`)

These files are not part of the app; they hold the independent checks recorded in
`docs/lunyx/validation.md`.

| Source | Files | Notes |
| --- | --- | --- |
| JPL Horizons API outputs (airless topocentric Sun and Earth, sub-points, DSN stations as observers) | `tests/fixtures/horizons/ephemeris-check/raw/*.txt`, `tests/fixtures/validation/ephemeris-check/horizons/raw/*.txt.gz`, `src/analysis/__fixtures__/horizons-{topo,dsn}-check.json` | Citation as S10. Retrieval logs are in `raw/retrieval-log.json` |
| NAIF SPICE kernels `naif0012.tls`, `pck00011.tpc`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf`, `de440s.bsp` | Not committed; their SHA-256 are in `tests/fixtures/horizons/ephemeris-check/spice-crosscheck.json` | Used through `spiceypy` for the offline cross-check |
| Published mission facts: Firefly Aerospace, KUT Radio, FOX 7 Austin, The News Minute (quoting ISRO), ISRO's Chandrayaan-3 page, Interesting Engineering | `tests/fixtures/validation/ephemeris-check/events/sources.json` | Short quotations with URL and publisher, for the event-time checks. Copyright of the excerpts stays with the publishers |
| Apollo Lunar Surface Journal: Sun and Earth altitude and azimuth at the Apollo landings (J. Scotti), https://www.nasa.gov/wp-content/uploads/static/history/alsj/Scotti_AltAz.txt | `tests/fixtures/validation/ephemeris-check/events/alsj_scotti_altaz.txt`, `alsj_rows.json` | A copy of the table, hosted by NASA; no terms found for it (open list L7) |
| DSN station geometry: DSN Telecommunications Link Design Handbook, document 810-005, module 301 "Coverage and Geometry", Rev. N, issue date 2022-04-15, https://deepspace.jpl.nasa.gov/dsndocs/810-005/301/301N.pdf | Constants in `src/analysis/dsn.ts` | Document retrieved 2026-11-15 to confirm title and revision |

## 6. Software dependencies

Read from the installed packages (`node_modules/*/package.json`) after `npm ci` with the
committed lockfile. 93 packages are installed on this Linux machine. 70 more lockfile entries
are optional packages that npm does not install here (builds of `sharp`, `rolldown` and
`lightningcss` for other operating systems and CPUs, and WebAssembly fallbacks); their lockfile
entries record MIT (21), Apache-2.0 (29), LGPL-3.0-or-later (8), "Apache-2.0 AND
LGPL-3.0-or-later" (3) and MPL-2.0 (9). All 70 are development dependencies (build and test
tools).

**In the browser bundle** (`dist/`, served to every user):

| Package | Version | Licence | Copyright line in the package |
| --- | --- | --- | --- |
| `three` | 0.187.0 | MIT | "Copyright © 2010-2026 three.js authors" (`LICENSE`) |
| `astronomy-engine` | 2.1.19 | MIT | "Copyright (c) 2019-2023 Don Cross" (licence text in the source header; the package has no `LICENSE` file) |
| `@fontsource-variable/inter` (Inter) | 5.3.0 | SIL Open Font License 1.1 | "Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)" |
| `@fontsource-variable/space-grotesk` (Space Grotesk) | 5.3.0 | SIL Open Font License 1.1 | "Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk)" |

Notices in the built app, checked on `npm run build` of `57adcef`, `c12fc06` and the tree of `bc5fb8e`: the worker bundle keeps
astronomy-engine's MIT header; the main bundle (`dist/assets/index-*.js`) contains no licence
comment, so three.js's MIT notice is not shipped with it; ten WOFF2 font files are shipped and
no copy of the OFL text is. MIT asks that the copyright and permission notice be included in
copies; OFL 1.1 asks that each copy of the font software contain its copyright notice and
licence. Since T-37 (`27b0f30`) the site ships `/licences/THIRD-PARTY-NOTICES.txt`
(`public/licences/`, 16.4 kB), written by `scripts/build-licences.mjs` (`npm run
build-licences`) from the installed packages: three, astronomy-engine, Inter, Space Grotesk,
Vite and Rolldown (whose module-preload helper is part of the scripts), each with its licence
text as the package ships it; `src/licences.test.ts` fails when the file is stale. That covers
both conditions (open list L8, now resolved). Since T-40 (`bbd2294`) the file's header names
this register, `docs/lunyx/SOURCES.md`, as the full list of sources with their licences and
checks, and `docs/DATA_SOURCES.md` as the description of the bundled data files.

**On the server only** (the Vite dev or preview server that runs `/api/*`): `@anthropic-ai/sdk`
1.8.0 (Apache-2.0; it also ships `LICENSE-MIT`, which says the project moved from MIT to Apache
2.0 in version 1.0.0) and the packages it pulls in: `@babel/runtime` (MIT), `@opentelemetry/api`
(Apache-2.0), `@stablelib/base64` (MIT), `fast-sha256` (Unlicense), `json-schema-to-ts` (MIT),
`standardwebhooks` (MIT), `ts-algebra` (MIT).

**Build, data scripts and tests only** (not distributed): 81 packages, licences MIT (most),
Apache-2.0 (among them `typescript`, `playwright`, `sharp`), MPL-2.0 (`lightningcss` and its
two platform builds, used by Vite), LGPL-3.0-or-later (`@img/sharp-libvips-linux-x64` and
`-linuxmusl-x64`, the libvips binaries of `sharp`; `@img/sharp-wasm32` is "Apache-2.0 AND
LGPL-3.0-or-later AND MIT"), ISC, BSD-3-Clause, 0BSD, CC0-1.0, "MIT AND Zlib" (`pako`) and
"MIT AND BSD-3-Clause" (`zstddec`). Playwright downloads its own Chromium for the browser tests. The Python data script
`scripts/build-ice-targets.py` uses the standard library only; the SPICE cross-check uses
`spiceypy`, installed outside the repository.

<details>
<summary>All 93 installed packages, with version, licence and role</summary>

| Package | Version | Licence (from its package.json) | Used for | Direct or transitive |
| --- | --- | --- | --- | --- |
| `@anthropic-ai/sdk` | 1.8.0 | Apache-2.0 | runtime | direct |
| `@babel/runtime` | 7.29.14 | MIT | runtime | transitive |
| `@fontsource-variable/inter` | 5.3.0 | OFL-1.1 | runtime | direct |
| `@fontsource-variable/space-grotesk` | 5.3.0 | OFL-1.1 | runtime | direct |
| `@opentelemetry/api` | 1.10.0 | Apache-2.0 | runtime | transitive |
| `@stablelib/base64` | 1.0.1 | MIT | runtime | transitive |
| `astronomy-engine` | 2.1.19 | MIT | runtime | direct |
| `fast-sha256` | 1.3.0 | Unlicense | runtime | transitive |
| `json-schema-to-ts` | 3.1.1 | MIT | runtime | transitive |
| `standardwebhooks` | 1.1.1 | MIT | runtime | transitive |
| `three` | 0.187.0 | MIT | runtime | direct |
| `ts-algebra` | 2.0.0 | MIT | runtime | transitive |
| `@babel/helper-string-parser` | 7.29.14 | MIT | build/test only | transitive |
| `@babel/helper-validator-identifier` | 7.29.7 | MIT | build/test only | transitive |
| `@babel/parser` | 7.29.14 | MIT | build/test only | transitive |
| `@babel/types` | 7.29.14 | MIT | build/test only | transitive |
| `@bcoe/v8-coverage` | 1.0.2 | MIT | build/test only | transitive |
| `@dimforge/rapier3d-compat` | 0.12.0 | Apache-2.0 | build/test only | transitive |
| `@emnapi/runtime` | 1.11.3 | MIT | build/test only | transitive |
| `@img/colour` | 1.1.0 | MIT | build/test only | transitive |
| `@img/sharp-libvips-linux-x64` | 1.3.4 | LGPL-3.0-or-later | build/test only | transitive |
| `@img/sharp-libvips-linuxmusl-x64` | 1.3.4 | LGPL-3.0-or-later | build/test only | transitive |
| `@img/sharp-linux-x64` | 0.35.5 | Apache-2.0 | build/test only | transitive |
| `@img/sharp-linuxmusl-x64` | 0.35.5 | Apache-2.0 | build/test only | transitive |
| `@img/sharp-wasm32` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | build/test only | transitive |
| `@jridgewell/resolve-uri` | 3.1.3 | MIT | build/test only | transitive |
| `@jridgewell/sourcemap-codec` | 1.6.0 | MIT | build/test only | transitive |
| `@jridgewell/trace-mapping` | 0.3.31 | MIT | build/test only | transitive |
| `@oxc-project/types` | 0.156.0 | MIT | build/test only | transitive |
| `@petamoriken/float16` | 3.9.3 | MIT | build/test only | transitive |
| `@rolldown/binding-linux-x64-gnu` | 1.2.19 | MIT | build/test only | transitive |
| `@rolldown/binding-linux-x64-musl` | 1.2.19 | MIT | build/test only | transitive |
| `@rolldown/pluginutils` | 1.1.1 | MIT | build/test only | transitive |
| `@tweenjs/tween.js` | 23.1.3 | MIT | build/test only | transitive |
| `@types/chai` | 5.2.3 | MIT | build/test only | transitive |
| `@types/deep-eql` | 4.0.2 | MIT | build/test only | transitive |
| `@types/estree` | 1.0.10 | MIT | build/test only | transitive |
| `@types/node` | 22.20.5 | MIT | build/test only | direct |
| `@types/stats.js` | 0.17.4 | MIT | build/test only | transitive |
| `@types/three` | 0.187.0 | MIT | build/test only | direct |
| `@types/webxr` | 0.5.24 | MIT | build/test only | transitive |
| `@typescript/typescript-linux-x64` | 7.0.2 | Apache-2.0 | build/test only | transitive |
| `@vitest/coverage-v8` | 5.1.0 | MIT | build/test only | direct |
| `@vitest/istanbul-lib-coverage` | 2.1.0 | MIT | build/test only | transitive |
| `@vitest/istanbul-lib-report` | 2.1.0 | MIT | build/test only | transitive |
| `@vitest/mocker` | 5.1.0 | MIT | build/test only | transitive |
| `@vitest/spy` | 5.1.0 | MIT | build/test only | transitive |
| `assertion-error` | 2.0.1 | MIT | build/test only | transitive |
| `ast-v8-to-istanbul` | 1.0.8 | MIT | build/test only | transitive |
| `chai` | 6.3.0 | MIT | build/test only | transitive |
| `detect-libc` | 2.1.2 | Apache-2.0 | build/test only | transitive |
| `es-module-lexer` | 2.3.2 | MIT | build/test only | transitive |
| `estree-walker` | 3.0.3 | MIT | build/test only | transitive |
| `expect-type` | 1.4.0 | Apache-2.0 | build/test only | transitive |
| `fdir` | 6.5.0 | MIT | build/test only | transitive |
| `fflate` | 0.8.3 | MIT | build/test only | transitive |
| `geotiff` | 3.0.5 | MIT | build/test only | direct |
| `js-tokens` | 10.0.0 | MIT | build/test only | transitive |
| `lerc` | 3.0.0 | Apache-2.0 | build/test only | transitive |
| `lightningcss` | 1.33.0 | MPL-2.0 | build/test only | transitive |
| `lightningcss-linux-x64-gnu` | 1.33.0 | MPL-2.0 | build/test only | transitive |
| `lightningcss-linux-x64-musl` | 1.33.0 | MPL-2.0 | build/test only | transitive |
| `magic-string` | 1.4.5 | MIT | build/test only | transitive |
| `magicast` | 0.5.5 | MIT | build/test only | transitive |
| `meshoptimizer` | 1.1.1 | MIT | build/test only | transitive |
| `nanoid` | 3.3.20 | MIT | build/test only | transitive |
| `obug` | 3.0.0 | MIT | build/test only | transitive |
| `pako` | 2.2.0 | (MIT AND Zlib) | build/test only | transitive |
| `parse-headers` | 2.0.6 | MIT | build/test only | transitive |
| `picocolors` | 1.1.1 | ISC | build/test only | transitive |
| `picomatch` | 4.0.7 | MIT | build/test only | transitive |
| `playwright` | 1.60.0 | Apache-2.0 | build/test only | direct |
| `playwright-core` | 1.60.0 | Apache-2.0 | build/test only | transitive |
| `postcss` | 8.5.33 | MIT | build/test only | transitive |
| `quick-lru` | 6.1.2 | MIT | build/test only | transitive |
| `rolldown` | 1.2.19 | MIT | build/test only | transitive |
| `semver` | 7.8.6 | ISC | build/test only | transitive |
| `sharp` | 0.35.5 | Apache-2.0 | build/test only | direct |
| `source-map-js` | 1.2.2 | BSD-3-Clause | build/test only | transitive |
| `std-env` | 4.3.0 | MIT | build/test only | transitive |
| `tinybench` | 6.2.3 | MIT | build/test only | transitive |
| `tinyexec` | 1.3.1 | MIT | build/test only | transitive |
| `tinyglobby` | 0.2.17 | MIT | build/test only | transitive |
| `tinyrainbow` | 3.2.0 | MIT | build/test only | transitive |
| `tslib` | 2.9.1 | 0BSD | build/test only | transitive |
| `typescript` | 7.0.2 | Apache-2.0 | build/test only | direct |
| `undici-types` | 6.21.0 | MIT | build/test only | transitive |
| `vite` | 8.3.8 | MIT | build/test only | direct |
| `vitest` | 5.1.0 | MIT | build/test only | direct |
| `web-worker` | 1.5.0 | Apache-2.0 | build/test only | transitive |
| `why-is-node-running` | 3.2.1 | MIT | build/test only | transitive |
| `xml-utils` | 1.10.2 | CC0-1.0 | build/test only | transitive |
| `zstddec` | 0.2.0 | MIT AND BSD-3-Clause | build/test only | transitive |

</details>

## 7. The teammate's GitHub `main` work, now integrated

GitHub `main` at `282249d` (the teammate's country labels, flags, ownership and explored
areas) was merged into the navigator branch and published as `0cc5553` on 2026-11-15; its data
files are S18 to S20 above, its flags are discussed in AI-USE.md section 6, and its
`docs/DATA_SOURCES.md` is compared in section 8. `origin/Abdel` (`595fe28`) adds no files.

## 8. Comparison with the teammate's `docs/DATA_SOURCES.md`

The teammate keeps a data-sources note, `docs/DATA_SOURCES.md` (from GitHub `main`, in the
tree since `0cc5553`). This document is the complete register; it was checked against that note
entry by entry. The note is the teammate's and was not edited.

| Entry in DATA_SOURCES.md | Here | Agrees | Differs or adds |
| --- | --- | --- | --- |
| 1. Landing list | S16 | Yes: since `c023022` its section 1 describes the per-row sources added by T-38 | Adds the verification of the 26 LROC positions and that the summaries' origin is not established (L3) |
| 2. Ownership record (GCAT) | S18 | Yes: CC BY 4.0, checked at planet4589.org | Adds GCAT's own citation wording |
| 3. Globe colour and relief | S6, S7 | Yes: `lroc_color_poles_8k.tif`, `ldem_16_uint.tif`, `LDEM_64.IMG` from the MIT mirror, relief ×4 | Quotes the SVS and NASA usage statements instead of a summary |
| 4. Earth texture | S8 | Yes: SVS 2915, cloud-free | Adds the credit line SVS asks for |
| 5. Site imagery tiles | R1 | Yes: the two layers and the on-screen credit | Its "To check before public release: JAXA's reuse terms" is answered from Moon Trek's metadata (scientific and educational use; L6) |
| 6. Terrain around each site | S3 | Yes: products, 129 × 129 grids at 60 m and 480 m | Its archive link used to answer HTTP 404; `c023022` corrected it to the LOLA archive |
| 7. High-resolution site terrain | S4 | Yes: release `LROLRC_2001`, 19 sites, credit NASA/GSFC/ASU | Adds the LROC terms (PDS products are public domain) and the citations |
| 8. Photo-derived relief | S5 | Yes | — |
| 9. Sun and Earth positions | S10, S11 | Yes on the sources | Its agreement figures come from `npm run check-ephemeris` (sub-points at the 28 landing times); the validated figures are those in STATUS.md section 4 |
| 10. Close-up surface maps | S9 | Yes: third-party pack, "origin and licence unknown" | Adds that its AI status is not established (L2) |
| 11. Explored area at each site | S19, S20 | Yes on sources; the display now shrinks from 10× to true size near the ground | Adds that the bundled LROC table is byte-identical to the archive's current file |
| Not in that note | S1, S2, S12 to S15, S17, sections 4 to 6 | — | The LOLA grids in `public/data/dem`, PGDA product 69, the ice targets, Diviner, the ShadowCam index, the run-time services, the test references and the software licences |

## 9. What is not established

Licences, provenance and AI status that could not be established from the sources are listed
once, for the operator, in [AI-USE.md section 8](AI-USE.md#8-open-list-for-the-operator)
(items L1 to L8 concern this document).
