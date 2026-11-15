# Data sources

Every dataset this application uses, where it comes from, how it is produced, what it is used for, and
how far it can be trusted. Anything shown in the app that is **not** from a dataset (generated detail)
is listed at the end.

Last reviewed: 14 November 2026.

## Summary

| # | Dataset | Provider | Used for | File(s) in this repo | Script |
|---|---|---|---|---|---|
| 1 | [Landing list](#1-landing-list) | This project (hand-entered) | Markers, info card | `public/data/landings.json` | — |
| 2 | [Ownership record (GCAT)](#2-ownership-record-gcat) | Jonathan C. McDowell | "Belongs to" and "Owner" | `public/data/sources/gcat-landers.json` | `npm run fetch-gcat` |
| 3 | [Globe colour and relief](#3-globe-colour-and-relief) | NASA SVS / LRO LROC, LOLA | Globe | `public/textures/moon_*` | `npm run fetch-textures` |
| 4 | [Earth texture](#4-earth-texture) | NASA SVS Blue Marble | Earth in the sky | `public/textures/earth_2k.jpg` | `npm run fetch-textures` |
| 5 | [Site imagery tiles](#5-site-imagery-tiles-nasa-moon-trek) | NASA Moon Trek (LROC WAC, Kaguya TC) | Fly-in and surface view | streamed, not stored | — |
| 6 | [Terrain around each site](#6-terrain-around-each-site) | NASA PDS: SLDEM2015, LOLA polar DEMs | Surface view | `public/terrain/<site>.bin` | `npm run fetch-terrain` |
| 7 | [High-resolution site terrain](#7-high-resolution-site-terrain-lroc-nac) | NASA PDS: LROC NAC DTMs and orthophotos | Surface view, 19 sites | `public/terrain/<site>_fine.bin`, `_ortho.webp` | `npm run fetch-apollo-terrain` |
| 8 | [Photo-derived relief](#8-photo-derived-relief) | Derived here from dataset 7 | Surface view, 19 sites | `public/terrain/<site>_detail.webp` | `npm run derive-detail` |
| 9 | [Sun and Earth positions](#9-sun-and-earth-positions) | astronomy-engine; checked against JPL Horizons | Lighting, phases, sky | `public/data/horizons-check.json` | `npm run fetch-horizons`, `npm run check-ephemeris` |
| 10 | [Close-up surface maps](#10-close-up-surface-maps) | "moon-surface" asset pack (third party) | Generated detail | `public/textures/surface_detail_*` | `scripts/make-surface-detail.mjs` |
| 11 | [Explored area at each site](#11-explored-area-at-each-site) | NASA PDS: LROC anthropogenic objects and traverse maps; Apollo Analyst's Notebook | Coloured area on the globe, "Explored" in the card | `public/data/sources/site-areas.json`, `lroc-anthropogenic-objects.csv` | `npm run fetch-site-areas` |
| 12 | [Simulated rovers](#12-simulated-rovers) — **fake, not data** | This project (invented) | Rovers near a site: globe, site card, surface view | `public/data/rovers.json` | `npm run build-rovers` |
| 13 | [Rover 3D model](#13-rover-3d-model) | clgreene86, Sketchfab (third party, CC BY 4.0) | Shape of the simulated rovers in the surface view | `public/models/opportunity-rover/` | `npm run build-rover-model` |

Downloaded source files are cached in `scripts/.cache/` (git-ignored, about 600 MB) so the scripts can be re-run
without downloading again.

---

## 1. Landing list

- **File:** `public/data/landings.json` — 28 successful soft landings, 1966 to March 2025.
- **Fields:** name, program, country, landing date and time (UTC), latitude and longitude, crewed, region, summary,
  an `approx` flag on the two sites whose landers have not been found in LRO images (Luna 9, Luna 13), and per row
  `sources` (where its position and its time come from, with citations and links) and, where a value could not be
  confirmed, `unsourced`.
- **Provenance:** entered by hand during development; every row checked against published sources on 2026-11-15
  (task T-38), and corrected where they differed.
- **Verification:**
  - *Country:* all 28 agree with the GCAT ownership record (dataset 2). The app shows a warning on any site
    where they disagree.
  - *Coordinates:* 26 sites are the lander's measured position in the LROC catalogue of anthropogenic objects
    (Wagner, R. V., et al. 2017, *Coordinates of anthropogenic features on the Moon*, Icarus 283, 92–103,
    doi:10.1016/j.icarus.2016.05.011; the version in `public/data/sources/lroc-anthropogenic-objects.csv`, dataset 11),
    each with the catalogue's method and stated uncertainty; for Apollo, the Lunar Module descent stage. Luna 9 and
    Luna 13 keep NSSDCA's positions, uncertain by kilometres.
  - *Landing times:* checked against NSSDCA, A. Siddiqi's *Beyond Earth* (NASA SP-2018-4041), CNSA/Xinhua, ISRO, JAXA,
    NASA, Firefly and LROC; the citation of each is in the row. Three are not confirmed to the minute and are marked
    `unsourced`: Luna 23 (only the date is published), Chandrayaan-3 and IM-2.
- **Not included:** failed landings, impacts, and landings after March 2025.

## 2. Ownership record (GCAT)

- **What it is:** for each lander, the owning organisation and the **responsible state** — the country
  accountable for the object under the Outer Space Treaty (1967). No country owns lunar territory; a state
  keeps jurisdiction over the hardware it places there.
- **Provider:** GCAT, the General Catalog of Artificial Space Objects, by Jonathan C. McDowell
  (Harvard–Smithsonian Center for Astrophysics). <https://planet4589.org/space/gcat/>
- **Licence:** CC BY 4.0 — free to reuse with attribution. Cite as: *J. McDowell, General Catalog of Artificial
  Space Objects, https://planet4589.org/space/gcat*.
- **Files read:** `tsv/cat/deepcat.tsv` (deep-space objects) and `tsv/tables/orgs.tsv` (organisation and country
  names). Catalogue version used: *Updated 2026 Nov 13*.
- **Produced:** `public/data/sources/gcat-landers.json`, one record per landing: GCAT id (`jcat`), international
  designation, object name, owner code and name, state code and name, and the state's dates of existence. Values
  are copied unchanged; the script only adds the readable names from GCAT's own organisation table, and the
  retrieval date.
- **Which object:** the object that remains at the landing site — the lander, or for Apollo and the Luna sample
  return missions, the descent stage left behind. The mapping from landing to GCAT id is listed in
  `scripts/fetch-gcat-landers.mjs`.
- **Separate by design:** this file never modifies `landings.json`; the two are linked only by landing id.
- **Result:**

  | Responsible state | Landings | Owners recorded |
  |---|---|---|
  | United States | 14 | NASA JPL (Surveyor), NASA Manned Spacecraft Center (Apollo), Intuitive Machines (IM-1, IM-2), Firefly Aerospace (Blue Ghost) |
  | USSR (shown as Russia) | 8 | IKI / Babakin Science and Research Centre (Luna) |
  | China | 4 | China Aerospace Corporation, CAST / Lunar and Deep Space Exploration lab (Chang'e) |
  | India | 1 | ISRO (Chandrayaan-3) |
  | Japan | 1 | JAXA / ISAS (SLIM) |

- **Successor states:** GCAT records the USSR as the responsible state for the Luna landers, as it was at launch.
  The app **displays** these as Russia, the USSR's successor state, with a Russian flag and the note "launched by
  the USSR" (also in the country filter). This is a display choice made in `src/data/ownership.ts`; neither
  `gcat-landers.json` nor `landings.json` is changed, and both still say USSR.
- **Why not NASA NSSDCA:** NASA's NSSDCA Master Catalog was tried first. As of November 2026 it only returns US
  spacecraft; Soviet, Chinese, Indian and Japanese entries return an error page.
- **Not a legal register:** GCAT is a research catalogue. The legal record is the UN Register of Objects Launched
  into Outer Space (UNOOSA). It was not used because it could not be queried by script.

## 3. Globe colour and relief

- **Colour:** LROC Wide Angle Camera global mosaic, from NASA's Scientific Visualization Studio *CGI Moon Kit*
  (<https://svs.gsfc.nasa.gov/4720>), file `lroc_color_poles_8k.tif`. Resized to `moon_color_2k/4k/8k.jpg`.
- **Relief (4K):** LOLA elevation from the same kit (`ldem_16_uint.tif`, 16 px per degree), turned into a normal
  map, `moon_normal_4k.jpg`.
- **Relief (8K):** LOLA Gridded Data Record `LDEM_64.IMG` (64 px per degree, about 474 m), PDS Geosciences mirror at
  MIT (<https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/>), turned into `moon_normal_8k.webp`. Loaded on
  desktop only.
- **Exaggeration:** the normal maps were computed with the relief at 4× its true height; the app scales them back by 1/4 (`src/scene/globe.ts`), so the globe is shaded and drawn at true scale.
- **Credit:** NASA / GSFC / Arizona State University (LROC); NASA / GSFC (LOLA); NASA Scientific Visualization
  Studio. NASA data is generally not subject to copyright in the US.

## 4. Earth texture

- **Source:** NASA Blue Marble, from the Scientific Visualization Studio (<https://svs.gsfc.nasa.gov/2915>),
  `bluemarble-2048.png` → `earth_2k.jpg`.
- **Used for:** the Earth in the lunar sky (surface view) and beside the globe. Cloud-free composite; it does not
  show real weather at any date.

## 5. Site imagery tiles (NASA Moon Trek)

- **Service:** NASA Moon Trek WMTS tiles, <https://trek.nasa.gov/tiles/Moon/EQ/>, loaded live by the browser
  (Trek allows cross-origin access). Nothing is stored in the repo.
- **Layers:**
  - `LRO_WAC_Mosaic_Global_303ppd_v02` — LROC WAC, about 100 m per pixel, wide context around each site.
  - `Kaguya_TCortho_Mosaic_Global_4096ppd` — JAXA SELENE (Kaguya) Terrain Camera ortho mosaic, about 7–10 m per
    pixel, tiles up to zoom 10 (about 20 m on the ground).
- **Credit:** LROC WAC (NASA/GSFC/ASU); Kaguya TC (JAXA/SELENE), via NASA Moon Trek. Shown in the info card.
- **To check before public release:** JAXA's reuse terms for Kaguya data served through Trek.
- **Links:** the info card also links to LROC QuickMap (<https://quickmap.lroc.im-ldi.com>) and Moon Trek for each
  site. QuickMap is used only as an external viewer; no data is taken from it.

## 6. Terrain around each site

- **Source:** NASA Planetary Data System, Geosciences Node, LRO LOLA archive
  (<https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/>):
  - `sldem2015/` — SLDEM2015 (LOLA combined with Kaguya stereo), 512 px per degree, about 59 m, 60° S to 60° N.
  - `lola_gdr/polar/` — LOLA polar stereographic DEMs: `ldem_60s_60m` (Chandrayaan-3, IM-1) and `ldem_80s_20m`
    (IM-2).
- **Produced:** `public/terrain/<site>.bin` — two square height grids per site, 129 × 129 samples, at 60 m (7.7 km
  across) and 480 m (61 km across); and `public/terrain/index.json`.
- **Download:** only the rows around each site are fetched (HTTP range requests); the source files are 1–2 GB each.

## 7. High-resolution site terrain (LROC NAC)

- **Source:** LROC Narrow Angle Camera digital terrain models and orthophotos, PDS release `LROLRC_2001`, served
  by the PDS Imaging Node
  (<https://pds.mcp.nasa.gov/data/store/img/lunar_reconnaissance_orbiter/pds4/lroc/lro-l-lroc-5-rdr/LROLRC_2001/DATA/SDP/NAC_DTM/>).
- **Matching to sites:** `scripts/nac-dtm-candidates.json` lists, for each landing, the archive products whose centre
  lies within 30 km, nearest first. It was built from the archive's file listing.
- **Produced** for 19 of 28 sites: `<site>_fine.bin` (513 × 513 heights, 3 m spacing, 1.5 km square) and
  `<site>_ortho.webp` (orthophoto resampled onto the same square). Heights are shifted onto the 60 m model's
  datum (shifts of 0.5–4.5 m).
- **Resolution by site:**

  | Elevation | Photo | Sites |
  |---|---|---|
  | 2 m | 0.5–0.6 m | Apollo 11, 12, 14, 15, 16; Surveyor 3, 7; Luna 16, 20, 23, 24 |
  | 3 m | 0.9–1.0 m | Chang'e 5, SLIM |
  | 4–5 m | 1.1–1.6 m | Apollo 17, Luna 21, Chang'e 3, 4, 6, Blue Ghost Mission 1 |

- **No product covering the landing point:** Luna 9, Luna 13, Luna 17, Surveyor 1, Surveyor 5, Surveyor 6, IM-1,
  IM-2, and Chandrayaan-3 (a product exists, but in a polar projection the script does not read). These sites use
  dataset 6 plus generated detail.
- **Baked lighting:** the orthophotos have their own shadows from when they were taken, which do not move with the
  app's Sun.
- **Rate limits:** the archive returns HTTP 429 after many requests and then blocks for about an hour. The script
  uses a few large requests with pauses.
- **Credit:** NASA / GSFC / Arizona State University.

## 8. Photo-derived relief

- **What it is:** relief finer than the elevation models, worked out from shading in the orthophotos
  (photoclinometry). The Sun's direction for each photo is computed from its acquisition time (dataset 9).
- **Produced:** `<site>_detail.webp`, 1 m per pixel, for the 19 sites with an orthophoto.
- **Quality check:** correlated against the stereo elevation models where both resolve features; every site kept
  shows positive agreement (0.23–0.60). Results below 0.2 would be discarded.
- **Limits:** bright or dark objects (such as the landers themselves) read as bumps or pits; ground in shadow in the
  photo gets no relief.

## 9. Sun and Earth positions

- **Computed by:** the `astronomy-engine` library (MIT licence) in `src/astro/ephemeris.ts`.
- **Checked against:** JPL Horizons (<https://ssd.jpl.nasa.gov/horizons/>), target 301 (Moon) seen from Earth's
  centre, quantities 14 and 15 (sub-Earth and sub-solar points), at each landing time. Saved in
  `public/data/horizons-check.json`.
- **Agreement:** within 0.004° (Sun) and 0.008° (Earth) at all 28 landing times. Re-run with
  `npm run check-ephemeris`.
- **Earthshine:** night-side lighting strength is an approximation scaled by Earth's lit fraction; it is not a
  measured value.

## 10. Close-up surface maps

- **Source:** "moon-surface" asset pack supplied as `moon-surface.zip` (Blender-made crater terrain: normal map and
  diffuse map). **Artist-made, not lunar data.** Origin and licence unknown — confirm before publishing.
- **Produced:** `surface_detail_normal.jpg` (2048 px) and `surface_detail_tone.jpg` (1024 px), made seamless by
  `scripts/make-surface-detail.mjs`.
- **Used for:** shading only, as part of "Generated detail". Never changes terrain shape.

## 11. Explored area at each site

- **What it is:** the ground each mission is known to have worked on, quoted at true size in the info card
  (`site-areas.json`). It is no longer drawn on the globe. Instead the globe shows **territories**
  (`src/scene/globe/territories.ts`): the whole Moon is coloured by the country of the nearest landing site
  currently shown, so neighbouring sites of one country share one continuous territory and borders run halfway
  between sites of different countries. Hiding sites with the mission filters redivides the Moon among the rest.
  **The territories are a display of who landed nearest, derived only from the landing coordinates; they are
  not data and not a boundary of any kind. No country owns any lunar ground** — the Outer Space Treaty (1967)
  forbids national claims. What a country does keep is ownership of its hardware, and that hardware (landers,
  rovers, instruments, equipment left along traverses) is spread across this area. So this is the closest real
  equivalent of "what a country owns" at a site; it is not a legal boundary.
- **Sources:**
  - LROC `ANTHROPOGENIC_OBJECTS` (NASA PDS, `LROLRC_2001/EXTRAS/SHAPEFILE/`) — measured positions of landers, rovers
    and instruments. Wagner, R. V., et al. (2017), *Coordinates of anthropogenic features on the Moon*, Icarus 283,
    92–103, doi:10.1016/j.icarus.2016.05.011; updated 14 August 2026. Saved unchanged as
    `public/data/sources/lroc-anthropogenic-objects.csv`.
  - LROC `APOLLO_11`, `APOLLO_12`, `APOLLO_14` (same archive) — mapped walking paths of each astronaut on each EVA.
    Gonzales et al. (2019), LPSC L, abstract 3089.
  - Apollo Analyst's Notebook, NASA PDS Geosciences Node (<https://an.rsl.wustl.edu/apollo/>), map services
    `Apollo11_vec` … `Apollo17_vec` — traverses, sampling stations, deployed instruments and sample sites for every
    Apollo mission. The Lunar Roving Vehicle traverses (Apollo 15–17) were reconstructed from the rover navigation
    records in NASA TN D-7469. Checked against LROC's lunar module positions: they agree within about 10 m.
- **Method:** convex hull of every known point for the mission, widened by 30 m or the position uncertainty,
  whichever is larger. Stored as a lat/lon polygon per landing in `site-areas.json`, with its size, the points used
  and any caveat. Every catalogued object for a mission lies inside its area by construction.
- **Sizes:** most robotic sites are a single lander (about 60 m across). Apollo 11 0.14 km, Apollo 12 0.6 km
  (includes the walk to Surveyor 3), Apollo 14 1.6 km, Apollo 15 6.0 km, Apollo 16 8.5 km, Apollo 17 11.4 km,
  Lunokhod 1 2.4 km, Lunokhod 2 15 km.
- **Still incomplete** (shown in the info card) — no route data could be found as a public dataset:
  - Lunokhod 1 (about 10 km driven) and Lunokhod 2 (about 40 km): only the rovers' final positions are catalogued,
    so the area is the straight corridor from lander to rover. The routes have been mapped in research papers
    (Karachevtseva et al.; Gusakova et al., EPSC 2012) but not released as data.
  - Chang'e 4's Yutu-2 (about 1.6 km by November 2024), Chang'e 3's Yutu and Chandrayaan-3's Pragyan: lander (and
    Yutu's final position) only.
  - Luna 9 and Luna 13 have not been located in LROC images; their areas sit at this project's approximate
    coordinates.
- **Not included:** hardware that crashed rather than landed (spent rocket stages, ascent stages, impactors, failed
  landers). The LROC catalogue lists many of these impact sites with their mission, but they are not landing sites.
- **Also useful:** the catalogue's lander positions are independent measurements that could be used to check the
  coordinates in `landings.json` (not done yet).

## 12. Simulated rovers

> **This is fake data.** Every rover in `public/data/rovers.json` is invented by this project. No mission,
> catalogue or measurement stands behind any name, operator, mass, speed, position or route in it. It exists so
> that the surface view has vehicles moving at a believable pace. It must never be presented as real, and it is
> kept apart from every real dataset above: it is read only to draw and list the rovers, and it changes no other file.

- **File:** `public/data/rovers.json` — 12 rovers beside 10 of the landing sites. The file opens with
  `"simulated": true` and a note saying so, and every rover carries `"simulated": true`; the loader
  (`src/data/rovers.ts`) refuses a file or a rover without it.
- **The only real thing in it:** the landing each rover is placed beside (`siteId`, from dataset 1) and that
  landing's country. The agencies named as `operator` are real organisations, but **none of them operates, has
  announced or is associated with any of these rovers**; the names are there only so the rows look like the
  landing list.
- **Fields:** `id`, `name`, `siteId`, `country`, `operator`, `kind` (`robotic` or `crewed`), `role`, `massKg`,
  `speedMps` (driving speed), `phaseS`, `lengthM` (one lap), `home` (first point of the path) and `path`.
- **Routes:** `path` is a closed circuit of latitude/longitude points a few metres apart (same frame as
  `landings.json`). The rover drives from point to point in straight lines at `speedMps`, and from the last point
  back to the first. At a point with `stopS` it halts for that many seconds; `activity` says what for. The circuit
  repeats without end from `epochUtc` (2026-01-01 00:00 UTC), and `phaseS` is how far into a lap the rover is at
  that instant, so every clock time, past or future, gives a position. At one simulated second per real second a
  rover covers `speedMps` metres each second.
- **How it is made:** `scripts/build-rovers.mjs` holds the roster, written by hand. For each rover it picks a few
  stations at random bearings and distances around a point near the lander, joins them with a smooth curve, samples
  it every 2–14 m with a small sideways wobble, and gives each station a halt. The random numbers are seeded by the
  rover's id, so re-running the script writes the same file. No route comes within 8 m of the lander.
- **What was made to look plausible:** speeds are in the range of real vehicles — 0.05–0.4 m/s for the robotic
  rovers (Yutu-2 drove at up to about 0.06 m/s, VIPER was designed for about 0.2 m/s) and 2.8 m/s, about 10 km/h,
  for the one crewed vehicle (the Apollo Lunar Roving Vehicle averaged about 9 km/h). Robotic circuits are
  130–730 m long and stay within 250 m of the lander; the crewed one is 3.3 km. A lap takes 0.8–3.5 hours.

  | Site | Rovers (all invented) |
  |---|---|
  | IM-2 Athena | Prospector-1, Kestrel |
  | IM-1 Odysseus | Malapert Relay Rover |
  | Chandrayaan-3 | Anveshak-1 |
  | Chang'e 4 | Tansuo-1 |
  | Chang'e 6 | Tansuo-2 |
  | Chang'e 3 | Guanghan |
  | SLIM | Hayate |
  | Blue Ghost Mission 1 | Juniper |
  | Apollo 15 | Hadley Scout |
  | Apollo 17 | Mule-2, LTV Pathfinder (crewed) |

- **On screen:** the surface view (`src/scene/surface/rovers.ts`) draws each rover whose circuit starts within
  5 km of the site with the model of dataset 13 scaled to a size worked out from its mass (a plain box on wheels
  until the model has loaded), standing on the ground as drawn, with the label
  "<name> · simulated rover" (and what it is doing while halted). They are part of the generated detail: the
  **Generated detail** button hides them.
- **On the globe** (`src/scene/globe/roverMarkers.ts`): shown and filtered with the landing markers, in amber.
  From far away a site with rovers has a bold amber ring round its landing marker and, at the ring's upper right,
  an amber badge with a small rover drawn on it and the number of rovers when there is more than one; both keep
  their size on screen at every altitude. Within about 350 km the rovers are named under the ring ("Hayate ·
  simulated rover"). The left panel carries a one-line key to these symbols. Once the circuits are wide enough on screen, each
  is drawn as a line with the rover as an amber diamond on it, at its true position, moving, with its name. The
  camera comes no closer than about 10 km, where a pixel is about 8 m, so circuits that stay within about 60 m of
  the lander (Hayate, Anveshak-1) keep the ring at every zoom.
- **In the site card:** the row "Rovers (simulated)" gives each rover's present distance and compass bearing from
  the lander, whether it is driving or halted, and how far its circuit reaches — the ground to keep clear of.
- **Their clock:** the rovers run on real time, not on the app's clock, so they always drive at their stated
  speed and stand in the same place in every view. The app's clock usually runs at an hour a second or stands still; scrubbing it moves the Sun, not the
  rovers.
- **Limits:** routes ignore the terrain and may cross craters or slopes no rover would drive. They have nothing to
  do with the real rovers at some of these sites (Yutu, Yutu-2, Pragyan, the Apollo LRVs), whose final positions
  are in dataset 11. The rovers exist at every date, including before their site's landing.
- **Checked by:** `src/data/rovers.test.ts` (labelling, sites, speeds, continuity of each circuit, and that a rover
  never moves faster than its stated speed).

## 13. Rover 3D model

- **What it is:** "NASA Opportunity Rover", a 3D model by **clgreene86** on Sketchfab
  (<https://sketchfab.com/3d-models/nasa-opportunity-rover-448474b302be4035baa2895878d6b29b>). An artist's model
  of NASA's Mars rover Opportunity. **Not a NASA product and not lunar hardware.**
- **Licence:** CC BY 4.0 (<http://creativecommons.org/licenses/by/4.0/>): the author must be credited and changes
  stated. Credit as: *This work is based on "NASA Opportunity Rover" by clgreene86, licensed under CC-BY-4.0.*
  The licence text as downloaded, with the changes added, is shipped beside the model in
  `public/models/opportunity-rover/LICENSE.txt`, and the credit is shown in the surface view's ground note at any
  site with rovers.
- **Changes made** (`scripts/build-rover-model.mjs`): the two colour textures are resized from 2048 to 1024 pixels
  and saved as JPEG; the two metal/roughness textures are left out. The geometry is unchanged (about 9,800
  triangles). In the app it is drawn with plain diffuse shading and scaled to each rover's size.
- **Used for:** the shape of every simulated rover (dataset 12) in the surface view, the crewed vehicle included.
  It says nothing about what those invented rovers would look like: a Mars rover stands in for all of them.
- **Not in the repo:** the original download (`nasa_opportunity_rover.zip`, 4.6 MB). To rebuild, download it from
  the page above, unzip it, and run `npm run build-rover-model -- <folder>`.

## Colours

Sites are coloured by the country their hardware belongs to: USA blue, Russia (USSR) red, China yellow, India
orange, Japan purple. Defined in `src/data/landings.ts`.

---

## Generated, not data

Shown in the surface view and switched off by the **Generated detail** button:

- craters smaller than the local data can resolve (shading and, near the viewer, geometry);
- rocks and boulders;
- sub-metre surface texture and tone variation (dataset 10);
- at the 9 sites without high-resolution terrain, small craters and bumps within about 770 m of the landing point.

- the **simulated rovers** (section 12): their names, positions and routes are invented. Each carries the label
  "simulated rover" on screen.

The surface view's note states which kind of ground the viewer is on at each site.
