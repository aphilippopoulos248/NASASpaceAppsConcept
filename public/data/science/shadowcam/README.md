# ShadowCam controlled mosaics: an index, not the images

`index.json` lists the 26 controlled mosaics of permanently shadowed regions in the KPLO
ShadowCam Data Archive (20 at the south pole, 6 at the north; 14 sites), with for each: site,
season and local time of the images, image dates, pixel scale, the permanently shadowed regions
it shows, the authors' bounding outline, and links to the product in the archive.
`shadowcam_coverage.lxg` holds one 0/1 grid per mosaic, sampled at 200 m from the footprint the
archive publishes (which follows the valid pixels, strips and gaps included). The app reads both
through `src/science/shadowCam.ts` to tell whether a point is covered and to link out.

**No ShadowCam imagery is included.** The archive carries no licence or usage statement (bundle
label, archive SIS and product readmes were checked on 2026-11-14), so the app credits and links
to the products instead of redistributing them.

- Archive: KPLO ShadowCam Data Archive (PDS4 bundle), ShadowCam SOC,
  https://pds.shadowcam.im-ldi.com/ , https://doi.org/10.17189/y89z-kt98 .
- Credit line: the ShadowCam site prints "NASA/KARI/Arizona State University" under its images
  up to mid-2025 and "NASA/KARI/Intuitive Machines" in 2026. The archive names no credit line.
- Citation requested by the product readmes: Grieser, S. A., Collins, W. M., Henriksen, M. R.,
  Mahanti, P., & Robinson, M. S. (2025). ShadowCam Controlled Mosaics: A Valuable Data Product
  for High-Resolution Lunar Mapping. LPSC 56, abstract #2523. Outlines: Collins, W. M., et al.
  (2026). Remote Sensing, 18(3), 525. https://doi.org/10.3390/rs18030525 .

Sources read: `derived/vector/shadowcam_vector_controlled_mosaics_{sp,np}/` (outline tables,
"all the ShadowCam controlled mosaics released up through September 2026") and each product's
readme under `derived/cmosaic/<site>/`.

Things to know:
- "Covered" is decided per 200 m cell (cell centre inside the published footprint). Within
  200 m of an edge it can be off either way. The grids reproduce the footprint areas to within
  1 %.
- `outline` is the authors' loose bounding polygon, for drawing; it includes gaps.
- Three entries carry `sourceDisagreements`, where the archive's outline table and the product
  readme state different facts (pixel scale of Amundsen, image count of Shoemaker, month of
  Cabeus B).
- Seasons and local times are the archive's own (see `seasonDefinition` in the index).

Rebuild with `node --experimental-strip-types --no-warnings scripts/build-shadowcam-index.mjs`
(downloads 20 MB of tables and 26 readmes into `scripts/.cache/shadowcam/`).
