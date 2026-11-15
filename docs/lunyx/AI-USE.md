# Lunyx: how AI ("Super Intelligence") was used, asset inventory and branding check

Disclosure for the NASA Space Apps 2026 submission (task T-3 of the hub project "Lunyx
Navigator and Submission"; requirements in `docs/lunyx/SUBMISSION-DOCS-BRIEF.md`, section 3).

- **State described:** the tree at `08b5cfa` (`am/lunyx-experience/integration`, which contains
  `am/lunyx/integration` up to `b6f7392`: the original project's feature set with the mission
  presets, the T-37 notices, the T-38 landing sources, the T-39 flags, the T-40 downloads, the
  T-43 coordinate entry, the T-46 band rule and compare focus, the T-47 and T-48 rise and set
  spans, the T-50 finer skyline and all four of the science project's deliveries), plus this
  task's documents; the original team's T-49, published in `44eb72a`, is described from its
  commits and STATUS.md there; checked on 2026-11-15 (UTC).
- **Nothing has been altered.** Every watermark, label or metadata change below is a proposal
  for the operator to approve (section 5). Items that could not be established are in section 8.
- **Who wrote this:** an AI agent (Claude, hub handle @submission) from the repository, its git
  history and the sources quoted. It is not a statement by NASA or by any data provider.
- The official material calls AI "Super Intelligence (SI)" (section 1). This document says
  "AI" and means the same thing.
- Datasets, credits and licences are in [SOURCES.md](SOURCES.md).

## 1. The rules, quoted at their sources

The operator relayed NASA's guidance from a GitHub discussion (and noted, for the demo format,
that the official guide was not available to them). The official guide is published, so it is
quoted first. The
spaceappschallenge.org pages were read on 2026-11-15 in headless Chromium (curl fails TLS
verification on this machine); the GitHub and nasa.gov pages with curl.

### 1.1 Project Submission Guide, form field "Use of Super Intelligence (SI)"

https://www.spaceappschallenge.org/resources/project-submission-guide/ (dated November 13,
2026):

> Use of Super Intelligence (SI)
> Did you utilize any Super Intelligence (SI) tools and software in preparing your solution? If yes, how did you use them?
> The use of SI tools, such as machine learning, chatbots, image generation, and large language models, is permitted for the NASA Space Apps Challenge and should be used as a tool to accelerate innovation and creativity for your challenge solution. SI should not be used to (come up with your idea of how to solve the challenge).
> Generated content may not use, contain, or modify any NASA branding or design elements (such as the NASA logos, flags, or mission identifiers). We require that you clearly indicate where and how SI tools were utilized in your project, including:
> - Images and videos: Must include a visible watermark to indicate SI generation .
> - Audio: Must acknowledge SI generation in descriptive text and metadata.
> - Code and data: Must acknowledge SI generation in descriptive text and metadata.
> This SI question is for data‑collection purposes only, and your response will not be seen by the judges. However, judges will be able to see any SI‑generated indicators within your project—such as watermarks, descriptive text, or metadata. They will evaluate originality, intent, and execution based on the SI‑assisted elements you include and identify within your final project.

The same guide makes the demo limits binding ("Adhere to the 30-second and 7-slide limits.
Projects that exceed these limits will not be eligible for Global Judging."); the demo note
itself is task T-9.

### 1.2 Participant FAQ

https://www.spaceappschallenge.org/resources/participant-faqs/ (dated November 13, 2026):

> What is Super Intelligence? Can teams utilize it during the hackathon?
> In accordance with the September 29, 2026 U.S. Executive Order, "the executive branch shall use the terms 'Super Intelligence' and 'SI' in place of 'Artificial Intelligence' and 'AI.'"
> Super Intelligence (SI) refers to computer systems that perform tasks typically associated with human reasoning, decision-making, content creation, and problem-solving. Examples include large language models, conversational assistants, image and video generation tools, foundation models, and code generation tools.
> Participants may use SI tools to accelerate innovation, streamline development, and enhance creativity in support of their challenge solution. Each team's project submission must include a description of how SI tools were used during the development of their project.

### 1.3 Global Organizing Team answer in discussion #1849

https://github.com/nasa/spaceapps/discussions/1849, answer by the maintainer account
"Nick-GO-Team", 2026-11-06 16:59 UTC, marked as the answer (the question was about another
challenge; the paragraph on AI is general). The source the operator relayed:

> The use of Artificial Intelligence (AI) tools is permitted for the NASA Space Apps Challenge and can be used as a tool to accelerate innovation and creativity. However, generated content may not use, contain, or modify any [NASA branding or design elements](https://www.nasa.gov/nasa-brand-center/brand-guidelines/) (such as the NASA logos, flags, or mission identifiers). We also require that you clearly indicate where and how AI tools were utilized in your project, including:
> - Images and videos: Must be amended to include a visible watermark indicating they are AI-generated.
> - Audio: Must acknowledge AI generation in descriptive text and metadata.
> - Code and data: Must acknowledge AI generation in descriptive text and metadata.
> We look forward to seeing your original thoughts and your skills exemplified in your projects. Our judges will consider originality, intent, and execution in the context of AI-assisted work.

The official guide (1.1) says the same with "SI" wording, and adds that SI should not be used
to come up with the idea and that judges see the watermarks, text and metadata, not the form
answer.

### 1.4 NASA's usage guidelines for AI applications that use NASA data

https://www.nasa.gov/nasa-brand-center/images-and-media/ (the page linked by the guide's
"NASA branding" rules and by the PGDA and NASA SVS pages). This applies to the in-app
assistant (section 3):

> Per the Sept. 29, 2026, Executive Order 14434: Inaugurating the Era of Super Intelligence, NASA is working to update its communications to incorporate the term “super intelligence” as directed.
> Super Intelligence (SI) Applications
> NASA is committed to transparency, open science, and making data available to everyone. While a wealth of public information is available for use in super intelligence (SI) applications, it’s important to understand the following when using our data for SI development:
> Attribution: NASA cannot verify the accuracy of information once it’s incorporated into a large language model. Therefore, attribution of the information directly to NASA is not permitted. Similarly, NASA does not permit our Insignia (i.e., NASA Meatball, Worm logotype, or Seal) to appear with SI generated imagery or in the training of SI tools. To promote transparency, NASA strongly encourages SI-generated products maintain a marking indicating the product is SI generated.
> Source Disclosure (No Permission Implied): As a statement of fact, you can acknowledge your SI tool includes NASA source material, but do not imply any review or permission was granted by NASA for its specific use.
> Accuracy Disclaimer: It’s important to clarify that NASA is not responsible for the accuracy of the information generated by your SI model.
> SI Model Attribution: All outputs from the SI model should be attributed to the SI product itself, not NASA. References like “according to NASA” or similar are prohibited in SI products.
> Endorsement: Use of NASA content to train SI models does not constitute endorsement by NASA.
> By following these guidelines, you can ensure transparency and responsible use of our public information in your SI applications.

## 2. How AI was used to build Lunyx

### 2.1 In one paragraph (for the submission form)

The concept, the screens and the feature list come from the team's own design document
(`docs/reference/`: a document exported from Google Docs, and two mockups made of handwritten
notes and sketches drawn over screenshots of other products). Almost all of the code, the data-processing scripts,
the tests, the validation scripts and the documentation were written by AI coding agents
(Anthropic's Claude Code running the Claude Fable 5.2 and Claude Opus 5.5 models) under the
direction of the team, who set the requirements and made the key decisions recorded in the
project hub. Several agents worked in parallel, coordinated through a local
task-and-message hub ("Agent Manager"). The app's results are computed from the NASA and
partner datasets listed in SOURCES.md, processed by those AI-written scripts; no result is
produced by a language model. The landing catalogue cites a published source for every
position and time. The app contains an optional AI assistant that operates the
app through the same actions as its controls (section 3). No image, video or audio in the
project was made with a generative AI model, as far as the repository shows; two assets of
unrecorded origin are listed in section 8.

(Whether the first sentence can stay depends on open item L11, and the last one on L2 and L3,
in section 8.)

### 2.2 Evidence in the repository

At `08b5cfa` the history has 471 commits:

| Commits | With a "Co-Authored-By: Claude …" trailer | Without |
| --- | --- | --- |
| 243 non-merge commits from the local git account that the operator's sessions and the hub's agents share | 242 (71 "Claude Fable 5.2", 171 "Claude Opus 5.5") | 1: `5763608` "WIP analysis: topocentric sky model, Horizons bundle, skyline", made on the @analysis agent's branch (my reading of the history) |
| 10 non-merge commits from the teammate's GitHub account | 2 (`4ab3892` the first app, `98964da` a Vite setting; both "Claude Fable 5.2") | 8: `49fee90`, `418760e`, `8bfd842`, `2ab7daa` (surface scene and the close-up textures), `008be62`, `bf39978`, `f812385`, `2855d22` (country labels, flags, explored areas, a merge fix); AI status not recorded (open item L4) |
| 218 merge commits | 62 | 156 (90 by the hub's integration bot, 1 GitHub pull-request merge, 63 by the local account, 2 by the teammate) |

The hub ran its agents on `claude-fable-5-2` (decision D-2 of the original project) and now
lists this project's agents on `claude-opus-5-5`; the commit trailers name both models. The
committed screenshots were taken by agents with headless Chromium.

### 2.3 By part of the project

| Part | Who made it | Evidence |
| --- | --- | --- |
| Idea, screens, feature list | The team: design document and mockups | `docs/reference/Lunyx-design.pdf`, `globe.jpg`, `surface.jpg`, `team-doc.txt`. The PDF and mockups went into git in the bootstrap commit `b923462` (local `main`, 2026-11-14 14:36 UTC-5) and onto the published history in `2116471` (14:43); the teammate's first app commit `4ab3892` (14:39) came separately from GitHub. Whether an AI tool helped draft any part of the documents is not recorded (open item L11) |
| App code (`src/`, `index.html`, styles), server (`server/`) | AI agents, under human direction | Commit trailers (2.2); the hub's task records |
| Data-processing scripts (`scripts/`) | AI agents; `make-surface-detail.mjs`, `fetch-gcat-landers.mjs` and `fetch-site-areas.mjs` arrived in teammate commits without a trailer | Commit trailers |
| Tests, browser tests, validation scripts and fixtures | AI agents. The "independent" validation (T-18, T-26 and T-34 in the original project, T-3 in the science project) was done by separate AI agent sessions that did not read the app's implementation: they called its public entry points and, where a stated rule had to be reproduced (the T-32 edge easing), worked from its written description. They ran on the same kind of AI model that wrote the app, so the checks are independent of the app's code, not of the model. It is not a human or NASA review | `tests/fixtures/**` (the third round in `tests/fixtures/validation/science-validation/`), `docs/lunyx/validation.md` |
| Documentation (`docs/lunyx/**`, the data READMEs, this file) | AI agents | Commit trailers |
| Screenshots (`docs/lunyx/handover/screens/`, `docs/lunyx/screenshots/`) | Captured by AI agents from the running app | Commits with trailers; section 4, groups A23 and A32 |
| Decisions and direction | The operator (team member); the AI coordinator agents recorded the technical decisions | Operator decisions D-1, D-2, D-6 and D-7 of the original project and the operator's messages; D-3, D-4, D-5 and D-8 there and D-1 to D-3 here were recorded by coordinator agents |

### 2.4 What AI was not used for (as far as checked)

- No code in the repository calls an image, video, speech-synthesis or other generative-media
  service (searched all code and configuration files for the usual APIs and service names;
  none found).
- None of the 155 images in the repository carries EXIF, XMP or C2PA metadata, so none carries a
  generator's signature (absence of metadata is not proof by itself). The only embedded data are
  colour profiles (ICC) in 24 JPEG screenshots under `docs/lunyx/handover/screens/` and, in three
  PNG screenshots there (`t33-scrubber-1440.png`, `t42-stars-note.png`, `t47-card-im2.png`), PNG
  text chunks that hold only their creation and modification times.
- Every image's origin is traced in section 4 to a NASA or partner source, to a script in this
  repository, to a capture of the app, or to the team's mockups, except the two close-up
  textures (open item L2).
- No result shown by the app comes from a language model: results come from the analysis code
  and the datasets; the assistant may quote only tool results (its system prompt says so), and
  it has never been run against a real model on the build machine (section 3). The landing
  catalogue's positions and times now cite their sources (T-38); who wrote its one-line summaries
  is not recorded (L3).

## 3. The in-app assistant (AI at run time)

The assistant is a drawer (button lower right). Its tools are generated from the app's action
registry, the same operations the on-screen controls run (original decisions D-1 and D-3), so
what it does stays visible in the app.

| Mode | When | AI? | How it is labelled |
| --- | --- | --- | --- |
| Claude API, server-side relay (`server/llm/anthropic.ts`) | The server has `ANTHROPIC_API_KEY` (or SDK credentials) | Yes: default model `claude-opus-5-5` (`server/llm/env.ts`); `LUNYX_LLM_MODEL` can name another (labels exist for `claude-fable-5-2`, `claude-sonnet-5-5`, `claude-haiku-5-5`). With the default betas on, a declined request is retried by the API on the model it recommends (server-side fallback; `LUNYX_LLM_BETAS=off` turns it off) | Every reply shows the model's name; the drawer's status line reads "Language model: <name>" |
| Jev router, TypeSafe AI (`server/llm/jev.ts`) | `LUNYX_LLM_ROUTER=jev` and `TYPESAFE_API_KEY` | Yes: a classification model that decides how much effort the Claude model spends on a request; the user's latest message and the action names are sent to TypeSafe's API. It never removes a tool | Not shown separately |
| Deterministic mode (`src/assistant/deterministic/`) | No key (the default) | No: a fixed command grammar | "Deterministic mode: no language model" on every reply |
| Scripted test model (`server/llm/scripted.ts`) | `LUNYX_LLM_PROVIDER=scripted`, for tests | No | "Scripted test model (not a language model)" |
| Voice dictation (`src/assistant/voice.ts`) | The user presses the microphone, where the browser offers speech recognition | Yes, the browser vendor's speech recognition ("it may send audio to the browser vendor", per the code); Lunyx receives text only and puts it in the message box for review | Microphone button |

Keys stay on the server and are never sent to the browser. **The assistant has never been
run against a real language model or the real Jev service on the build machine** (no keys
there; STATUS.md section 4): everything about the model modes above is read from the code and
its tests with a scripted stand-in, not observed. The committed screenshots that show the
assistant (`t15-*.png`, `t11-ab-with-assistant-1280.png`) show deterministic mode.

**Against NASA's guidance for AI applications (1.4)**, findings for the owner (@assistant) and
the operator; relayed through @coordinator, not patched here:

| # | Guidance | What the code does now | Proposal |
| --- | --- | --- | --- |
| F1 | "All outputs from the SI model should be attributed to the SI product itself, not NASA. References like “according to NASA” or similar are prohibited in SI products." | The system prompt (`server/llm/prompt.ts`) does not mention this, while action descriptions and results the model reads name NASA products (e.g. "NASA PGDA product 69" in `src/core/scienceActions.ts` and in the basis text of `src/science/polarAverages.ts`) | Add one rule to the system prompt: attribute results to Lunyx's computation, name the dataset (for example "PGDA product 69, Mazarico et al. 2011") as the data source, never write "according to NASA" or imply NASA reviewed a result; add a test that the rule is present |
| F2 | "NASA strongly encourages SI-generated products maintain a marking indicating the product is SI generated." | Replies carry the model's name ("Claude Opus 5.5"), not the words "AI-generated" | Label model replies "AI-generated · <model name>" |
| F3 | "It’s important to clarify that NASA is not responsible for the accuracy of the information generated by your SI model." | No such statement in the drawer or the docs | One line in the drawer (empty state or footer) and in the README: "Answers are generated by an AI model from Lunyx's own results. NASA is not responsible for their accuracy and has not reviewed them." |
| F4 | "do not imply any review or permission was granted by NASA" | The app and docs credit NASA data in text only and claim no review | Keep it so; T-9's README states it |

## 4. Asset inventory

**Scope:** every tracked file at `08b5cfa` that is an image, texture, document image or data
file: everything except source code, configuration and Markdown. **498 files, 171.2 MB**: 155
images (JPEG, PNG, WebP), 1 PDF, 342 data and text files. Each was checked as stated in the
"How verified" column, not assumed from its name.

**Classes used:**

- **D, derived from measured data**: a measured product (or a product its authors computed
  from measurements) transformed by a script in this repository: resampled, averaged,
  reprojected, re-encoded, or a new quantity such as a normal map. The script is named.
- **C, computed by a third party**: values computed by the provider's model and kept as
  delivered (JPL Horizons ephemerides).
- **K, kept as published**: a third party's file or catalogue extract copied without changing its
  values (a measured table, a research catalogue).
- **P, procedurally generated by a script in this repository**: of the stored files, only the
  third-party notices (A29), which a script assembles from the packages' licence texts. At
  run time the app generates rocks, small craters and sub-metre texture (labelled "generated
  detail" on screen, `src/scene/surface/assets.ts`) and the stars behind the globe (2 500 random
  points, `createStars` in `src/scene/globe.ts`: decoration, not a star map; since the original
  team's T-42 the globe's relief chip says "Background stars are decorative").
- **AI, AI-generated media**: an image, video or audio file produced by a generative AI model.
  **No file is confirmed in this class**; the close-up textures (A11) are not established.
- **A, written by an AI agent**: a data or configuration file that a coding agent wrote
  directly, rather than a script producing it from a source: the mission presets (A30) and the
  assistant's example requests (A31). The landing catalogue's one-line summaries (part of A18)
  may belong here; not established (L3).
- **U, not established**: origin, licence or AI status unknown (section 8).
- **S, screenshot of Lunyx**: a capture of the running app (data rendered by code; no
  generative image model).
- **H, team design material**: made by the team, with third-party screenshots pasted in.
- **V, validation record**: third-party outputs (C) plus results computed by checking code that
  AI agents wrote.

"Written by AI agents" in the last column always refers to the code that made or transformed
the file (section 2), which the guide asks to acknowledge for code and data.

| Group | Files | Count | Size | Class | Origin | How verified | AI involvement |
| --- | --- | ---: | ---: | --- | --- | --- | --- |
| A1 | `public/data/dem/lola_global_{16ppd,4ppd}.lxg` | 2 | 17.10 MB | D | LOLA LDEM_16, LDEM_4 (SOURCES S1) → `scripts/build-dem.mjs` | SHA-256 matches the index; T-26 compared samples with the PDS originals | Script written by AI agents |
| A2 | `public/data/dem/lola_south_*.lxg` | 3 | 21.93 MB | D | LOLA polar grids (S2) → `build-dem.mjs` | As A1 | As A1 |
| A3 | `public/data/dem/index.json` | 1 | 7.5 kB | D (metadata) | Written by `build-dem.mjs` | Read; its checksums match A1 and A2 | As A1 |
| A4 | `public/terrain/<site>.bin`, `public/terrain/index.json` | 29 | 3.74 MB | D | SLDEM2015 and LOLA polar grids (S3) → `scripts/fetch-terrain.mjs` | Product per site recorded in `index.json`; first commit `4ab3892` (teammate, AI trailer) | As A1 |
| A5 | `public/terrain/<site>_fine.bin` | 19 | 20.00 MB | D | LROC NAC elevation models (S4) → `scripts/fetch-apollo-terrain.mjs` | Product per site in `index.json`; commit `4ab3892` | As A1 |
| A6 | `public/terrain/<site>_ortho.webp` | 19 | 13.15 MB | D | LROC NAC orthophotos (S4), resampled → `fetch-apollo-terrain.mjs` | As A5; no embedded metadata | As A1 |
| A7 | `public/terrain/<site>_detail.webp` | 19 | 16.88 MB | D | Computed from A6 by photoclinometry → `scripts/derive-detail.mjs` | Script read; agreement per site in `index.json` | As A1 |
| A8 | `public/textures/moon_color_{2k,4k,8k}.jpg` | 3 | 5.71 MB | D | NASA SVS CGI Moon Kit 2019 colour map (S6), resized → `scripts/fetch-textures.mjs` | Script read; image viewed; no metadata | As A1 |
| A9 | `public/textures/moon_normal_4k.jpg`, `moon_normal_8k.webp` | 2 | 17.69 MB | D | Normal maps computed from LOLA elevation (S7) → `fetch-textures.mjs` | As A8 | As A1 |
| A10 | `public/textures/earth_2k.jpg` | 1 | 0.20 MB | D | NASA SVS Blue Marble (S8), re-encoded → `fetch-textures.mjs` | As A8 | As A1 |
| A11 | `public/textures/surface_detail_{normal,tone}.jpg` | 2 | 1.82 MB | **U** | Third-party "moon-surface" asset pack, made tileable by `scripts/make-surface-detail.mjs` (S9) | Script and commits `418760e`, `2ab7daa` read; images viewed (stylised craters, not lunar imagery); no metadata | **Not established** whether a person or an AI tool made the pack (L2); the commits carry no trailer (L4) |
| A12 | `public/data/horizons/*.json` | 3 | 0.32 MB | C | JPL Horizons (S10) → `scripts/build-horizons-bundle.mjs` | Query recorded in each file; added in `5763608` | Script written by AI agents |
| A13 | `public/data/horizons-check.json` | 1 | 5.7 kB | C | JPL Horizons (S11) → `scripts/fetch-horizons.mjs` | Script read; commit `4ab3892` | As A12 |
| A14 | `public/data/heatmap/*` (8 maps, index) | 9 | 13.44 MB | D | PGDA product 69 (S12) → `scripts/build-heatmap.mjs` | SHA-256 matches the index | Script written by AI agents |
| A15 | `public/data/ice-targets/lemelin2021-psr.geojson` | 1 | 0.24 MB | D | Lemelin et al. 2021, CC BY 4.0 (S13) → `scripts/build-ice-targets.py` | Source MD5s match the Zenodo record; changes listed in the file | As A14 |
| A16 | `public/data/science/diviner/*` (4 maps, index) | 5 | 9.55 MB | D | Schorghofer and Williams, CC0 (S14) → `scripts/build-diviner.mjs` | SHA-256 match the index; source MD5s match the Dataverse record | As A14 |
| A17 | `public/data/science/shadowcam/{index.json,shadowcam_coverage.lxg}` | 2 | 0.13 MB | D | ShadowCam archive tables and readmes (S15) → `scripts/build-shadowcam-index.mjs`; no imagery | SHA-256 of the grid matches the index | As A14 |
| A18 | `public/data/landings.json` | 1 | 17.0 kB | K | 28 landings; since T-38 each position and time cites its source: 26 LROC measured positions (A27), Luna 9 and 13 from NSSDCA (approximate), times from NSSDCA, Siddiqi 2018, agencies, Firefly (SOURCES S16) | All 26 LROC positions equal the bundled LROC table; two NSSDCA entries re-read at the source | Values replaced and sourced by an AI agent (@analysis, T-38); the one-line summaries come from the teammate's first commit ("Claude Fable 5.2" trailer) and their authorship is **not established** (L3) |
| A19 | `scripts/nac-dtm-candidates.json` | 1 | 12.1 kB | D | Built from the PDS archive's file listing (S17) | Commit `4ab3892` | As A4 |
| A20 | `src/analysis/__fixtures__/horizons-{topo,dsn}-check.json` | 2 | 0.11 MB | C | JPL Horizons → `scripts/fetch-horizons-{topo,dsn}-check.mjs` | Commits `5763608`, `30dd8c9` | As A12 |
| A21 | `tests/fixtures/horizons/**` | 59 | 1.26 MB | V | Horizons raw outputs, parsed tables, checker results, SPICE cross-check results (SOURCES section 5) | Retrieval log and README in the folder | Checking code written by an AI agent (@ephemeris-check) |
| A22 | `tests/fixtures/validation/**` | 195 | 8.66 MB | V | Horizons outputs, the app's outputs before and after fixes, the validator's results, quotations of published mission facts, a copy of the ALSJ Sun and Earth table, and the science project's third round (`science-validation/`) | `sources.json` lists every quotation with URL | As A21 |
| A23 | `docs/lunyx/handover/screens/*` | 85 | 14.13 MB | S | Captures of the app (globe, overlays, site card, compare panel, nearby list, window table and outlook, mission presets including the eclipse, the scrubber's rise and set spans, surface view with key metrics and skyline chart (including its rise and set bands), assistant in deterministic mode) | All 85 viewed: app interface and rendered data only, no logos; no EXIF, XMP or C2PA (24 carry an ICC colour profile, three PNGs their creation time) | Captured by AI agents; nothing generated by an image model |
| A24 | `docs/reference/Lunyx-design.pdf`, `globe.jpg`, `surface.jpg` | 3 | 2.65 MB | H | The team's design document (Google Docs export) and mockups: hand-drawn annotations over pasted third-party screenshots | Viewed page by page; no metadata in the JPEGs | Not AI-generated as far as checked; the PDF's "Transcription" section reads like an automatic speech-to-text transcript (my reading; L11). Contains third-party images and NASA posters with the insignia (section 6, L9) |
| A26 | `public/data/sources/gcat-landers.json` | 1 | 13.1 kB | K | GCAT catalogue extract, values unchanged (SOURCES S18) → `scripts/fetch-gcat-landers.mjs` | Licence and citation read at planet4589.org; version recorded in the file | Script from a teammate commit without trailer (L4) |
| A27 | `public/data/sources/lroc-anthropogenic-objects.csv` | 1 | 21.0 kB | K | LROC measured hardware positions (SOURCES S19) → `scripts/fetch-site-areas.mjs` | Byte-identical to the archive's current file | As A26 |
| A28 | `public/data/sources/site-areas.json` | 1 | 34.3 kB | D | Convex hulls of A27 and traverse maps (SOURCES S20) → `scripts/fetch-site-areas.mjs` | Script and sources read | As A26 |
| A29 | `public/licences/THIRD-PARTY-NOTICES.txt` | 1 | 16.4 kB | P | Licence texts of the shipped packages, assembled by `scripts/build-licences.mjs` (T-37; since T-40 its header names `docs/lunyx/SOURCES.md`) | Read; `src/licences.test.ts` checks it is current | Script written by an AI agent (commits `b4a2648`, `fd46b48`, "Claude Opus 5.5" trailers); the licence texts are the packages' own |
| A30 | `public/data/presets.json` | 1 | 4.1 kB | A | The three "Missions to replay" (site, window, clock, rate, view, sources), written with T-22; the IM-2 and Blue Ghost sources follow the LROC positions since T-38 | `src/data/presets.test.ts` checks every time and sentence against the catalogue, the bundled Horizons tables and the analysis | Written by an AI agent (commits `f9668e3`, `b68ecc4`, "Claude Opus 5.5" trailers) |
| A31 | `src/assistant/deterministic/examples.json` | 1 | 5.4 kB | A | One example request per action for deterministic mode, read by its help text and tests | Read | Written by an AI agent (commits `5405cb1`, `bb3c602`, `db2f6ca`, `e0b2060`, "Claude Opus 5.5" trailers) |
| A32 | `docs/lunyx/screenshots/**` | 22 | 2.37 MB | S | The desktop walkthrough's captures of the app (T-2) on build `27b0f30`, before the mission presets and T-38, at 1280x720 and 1920x1080, described in `docs/lunyx/screenshots/REVIEW.md` | All 22 viewed: app interface and rendered data only, no logos; no metadata; the assistant shots are in deterministic mode | Captured by an AI agent (@desktop-workflow) |
| A33 | `docs/lunyx/handover/T-50-worst-cases.txt` | 1 | 6.7 kB | V | The app's passages at the validator's three worst-case pins, before and after the original team's T-50 (finer skyline reading), cited by STATUS.md | Read; two of the handover's worst cases recomputed from it, within 1 s | Written by an AI agent (commit `1fcb77d`, "Claude Opus 5.5" trailer) |
| A25 | `docs/reference/{team-doc,challenge-page}.txt` | 2 | 20.4 kB | H | Text export of the team document (both tabs); copy of the challenge page text | Read | Authorship of tab 2 ("Our ideas") not recorded (L11) |

Not counted above: the data folders' `README.md` files (documentation written by AI agents,
like the rest of `docs/`).

<details>
<summary>Every file, with its group and the commit that added it (498 rows)</summary>

| File | Size | Group | Added in | AI co-author trailer on that commit |
| --- | ---: | --- | --- | --- |
| `docs/lunyx/handover/T-50-worst-cases.txt` | 6.7 kB | A33 | `1fcb77d` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t10-apollo11-1280.jpg` | 124.2 kB | A23 | `47908f2` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t10-apollo11-chart-tracks-1280.jpg` | 109.4 kB | A23 | `47908f2` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t10-apollo11-table-1280.jpg` | 152.6 kB | A23 | `47908f2` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t10-im2-1280.jpg` | 126.8 kB | A23 | `47908f2` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t10-im2-1920.jpg` | 239.1 kB | A23 | `67db1fb` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t10-im2-390.jpg` | 38.8 kB | A23 | `47908f2` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t10-im2-chart-390.jpg` | 37.9 kB | A23 | `47908f2` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t10-im2-chart-expanded-1280.jpg` | 99.5 kB | A23 | `47908f2` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t10-im2-chart-time-1280.jpg` | 100.2 kB | A23 | `47908f2` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t10-im2-explain-1280.jpg` | 116.4 kB | A23 | `47908f2` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t10-im2-explain-390.jpg` | 48.1 kB | A23 | `47908f2` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t10-im2-metrics-390.jpg` | 60.9 kB | A23 | `47908f2` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t11-ab-1280.png` | 283.3 kB | A23 | `c33a05e` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t11-ab-390.png` | 112.9 kB | A23 | `c33a05e` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t11-ab-table-1280.png` | 293.5 kB | A23 | `c33a05e` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t11-ab-table-390.png` | 91.7 kB | A23 | `c33a05e` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t11-ab-with-assistant-1280.png` | 253.6 kB | A23 | `c33a05e` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t11-candidate-as-b-1280.png` | 282.9 kB | A23 | `73e7847` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t11-candidate-as-b-table-1280.png` | 237.8 kB | A23 | `73e7847` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t11-nearby-1280.png` | 249.4 kB | A23 | `73e7847` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t11-nearby-390.png` | 90.5 kB | A23 | `73e7847` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t11-nearby-progress-1280.png` | 159.7 kB | A23 | `73e7847` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t11-outlook-1280.png` | 223.7 kB | A23 | `c64c177` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t11-surface-1280.png` | 273.9 kB | A23 | `73e7847` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t11-window-table-1280.png` | 250.0 kB | A23 | `c64c177` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t11-window-table-390.png` | 136.6 kB | A23 | `c64c177` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t12-1280-b.png` | 562.4 kB | A23 | `4f29f08` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t12-1280.png` | 523.9 kB | A23 | `4f29f08` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t12-1920.png` | 841.7 kB | A23 | `4f29f08` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t12-390-pin.png` | 143.0 kB | A23 | `4f29f08` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t12-390.png` | 117.9 kB | A23 | `4f29f08` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t12-surface.png` | 138.8 kB | A23 | `4f29f08` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t13-390-globe.jpg` | 47.5 kB | A23 | `7aa1bc8` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t13-390-pole.jpg` | 42.9 kB | A23 | `7aa1bc8` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t13-limb-off.jpg` | 166.0 kB | A23 | `7aa1bc8` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t13-limb-x10.jpg` | 168.7 kB | A23 | `7aa1bc8` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t13-overlay-avg-earth.jpg` | 262.8 kB | A23 | `7aa1bc8` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t13-overlay-avg-sunlight.jpg` | 211.3 kB | A23 | `7aa1bc8` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t13-overlay-coverage.jpg` | 259.4 kB | A23 | `7aa1bc8` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t13-overlay-sunband.jpg` | 138.9 kB | A23 | `7aa1bc8` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t13-polar-im2.jpg` | 114.2 kB | A23 | `7aa1bc8` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t13-polar-shackleton.jpg` | 92.7 kB | A23 | `7aa1bc8` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t15-1280.png` | 512.7 kB | A23 | `7d18fad` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t15-390.png` | 53.8 kB | A23 | `7d18fad` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t20-card-im2-whole.jpg` | 111.2 kB | A23 | `96b6337` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t20-card-im2.jpg` | 145.7 kB | A23 | `bb2f460` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t20-ice-targets.jpg` | 152.2 kB | A23 | `bb2f460` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t20-phone-card.jpg` | 58.7 kB | A23 | `96b6337` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t20-phone-folded.jpg` | 40.5 kB | A23 | `96b6337` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t22-eclipse-after.png` | 147.9 kB | A23 | `6528c54` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t22-eclipse-before.png` | 154.6 kB | A23 | `6528c54` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t22-eclipse-totality.png` | 142.1 kB | A23 | `6528c54` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t22-filters.png` | 36.0 kB | A23 | `6528c54` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t22-im2-playing.jpg` | 109.6 kB | A23 | `6528c54` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t25-card-1280.png` | 637.2 kB | A23 | `941737a` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t25-phone-folded.png` | 246.3 kB | A23 | `941737a` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t25-phone-open.png` | 224.8 kB | A23 | `941737a` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t25-pin-1280.png` | 674.2 kB | A23 | `941737a` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t30-apollo-11-1280.png` | 88.2 kB | A23 | `dfe5bd3` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t30-faustini-1280.png` | 210.3 kB | A23 | `dfe5bd3` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t30-im2-1280.png` | 191.5 kB | A23 | `dfe5bd3` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t30-shackleton-rim-1280.png` | 220.4 kB | A23 | `dfe5bd3` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t30-shackleton-rim-390.png` | 213.4 kB | A23 | `dfe5bd3` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t33-phone-390.jpg` | 41.4 kB | A23 | `96b6337` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t33-scrubber-1440.png` | 21.4 kB | A23 | `96b6337` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t39-flags.png` | 31.0 kB | A23 | `75cecfd` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t42-stars-note.png` | 7.9 kB | A23 | `7f019a3` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t47-blue-ghost.jpg` | 120.0 kB | A23 | `4fe183b` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t47-card-im2.png` | 79.9 kB | A23 | `4fe183b` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t47-scrubber-bg.png` | 27.9 kB | A23 | `4fe183b` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t47-scrubber-im2.png` | 44.3 kB | A23 | `4fe183b` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t48-im2-setting-metrics.jpg` | 49.4 kB | A23 | `59c8653` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t48-im2-time-passages-1280.jpg` | 126.5 kB | A23 | `59c8653` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t9-apollo11-downsun.jpg` | 83.7 kB | A23 | `736f79d` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t9-apollo11-landing.jpg` | 92.8 kB | A23 | `736f79d` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t9-gpu-grain-lattice-before-after.jpg` | 36.1 kB | A23 | `67db1fb` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t9-gpu-im2-full-ground-1920.jpg` | 257.1 kB | A23 | `67db1fb` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/handover/screens/t9-im2-downsun-shadows.jpg` | 115.2 kB | A23 | `736f79d` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t9-im2-earth-phase.jpg` | 60.2 kB | A23 | `736f79d` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t9-im2-eclipse-2025-03-14.jpg` | 65.1 kB | A23 | `736f79d` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t9-im2-landing-sun-2.5deg.jpg` | 101.0 kB | A23 | `736f79d` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t9-im2-sunset-track-behind-terrain.jpg` | 85.5 kB | A23 | `736f79d` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t9-pin-shackleton-rim-downsun.jpg` | 99.9 kB | A23 | `736f79d` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t9-pin-shackleton-rim-sun-1deg.jpg` | 100.4 kB | A23 | `736f79d` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/handover/screens/t9-site-marker.jpg` | 81.9 kB | A23 | `736f79d` (local git account) | Claude Fable 5.2 |
| `docs/lunyx/screenshots/27b0f30/1280x720/01-open.jpg` | 72.2 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1280x720/04-pin-card.jpg` | 128.3 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1280x720/07-nearby-ranked.jpg` | 95.0 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1280x720/08-compare-candidate-as-b.jpg` | 117.6 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1280x720/12-im2-card-landing.jpg` | 81.6 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1280x720/14-im2-surface-key-metrics.jpg` | 86.4 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1280x720/15-im2-surface-why-sun.jpg` | 92.0 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1280x720/16-im2-surface-chart-table.jpg` | 94.3 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1280x720/17-im2-surface-earth.jpg` | 82.7 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1280x720/18-im2-surface-sun-paths.jpg` | 86.2 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1280x720/22-im2-surface-at-sun-fully-set.jpg` | 74.6 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1280x720/24-apollo11-surface-landing-sun.jpg` | 75.5 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1280x720/25-assistant-open.jpg` | 81.0 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1280x720/28-assistant-compare.jpg` | 115.3 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1280x720/30-assistant-surface.jpg` | 109.9 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1920x1080/01-open.jpg` | 130.7 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1920x1080/06-im2-surface-key-metrics.jpg` | 174.3 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1920x1080/08-im2-surface-chart-table.jpg` | 166.1 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1920x1080/09-im2-surface-earth.jpg` | 130.9 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1920x1080/10-im2-surface-sun-paths.jpg` | 140.8 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1920x1080/14-im2-surface-at-sun-fully-set.jpg` | 104.7 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/lunyx/screenshots/27b0f30/1920x1080/16-apollo11-surface-landing-sun.jpg` | 130.3 kB | A32 | `6a24334` (local git account) | Claude Opus 5.5 |
| `docs/reference/Lunyx-design.pdf` | 2.00 MB | A24 | `2116471` (local git account) | Claude Opus 5.5 |
| `docs/reference/challenge-page.txt` | 8.2 kB | A25 | `14edf18` (local git account) | Claude Fable 5.2 |
| `docs/reference/globe.jpg` | 306.1 kB | A24 | `2116471` (local git account) | Claude Opus 5.5 |
| `docs/reference/surface.jpg` | 335.9 kB | A24 | `2116471` (local git account) | Claude Opus 5.5 |
| `docs/reference/team-doc.txt` | 12.2 kB | A25 | `14edf18` (local git account) | Claude Fable 5.2 |
| `public/data/dem/index.json` | 7.5 kB | A3 | `457803e` (local git account) | Claude Fable 5.2 |
| `public/data/dem/lola_global_16ppd.lxg` | 15.63 MB | A1 | `457803e` (local git account) | Claude Fable 5.2 |
| `public/data/dem/lola_global_4ppd.lxg` | 1.47 MB | A1 | `457803e` (local git account) | Claude Fable 5.2 |
| `public/data/dem/lola_south_80s_160m.lxg` | 8.11 MB | A2 | `457803e` (local git account) | Claude Fable 5.2 |
| `public/data/dem/lola_south_85s_80m.lxg` | 6.62 MB | A2 | `457803e` (local git account) | Claude Fable 5.2 |
| `public/data/dem/lola_south_875s_40m.lxg` | 7.20 MB | A2 | `457803e` (local git account) | Claude Fable 5.2 |
| `public/data/heatmap/index.json` | 24.6 kB | A14 | `84b3add` (local git account) | Claude Fable 5.2 |
| `public/data/heatmap/pgda69_north_earth_visibility_120m.lxg` | 2.41 MB | A14 | `84b3add` (local git account) | Claude Fable 5.2 |
| `public/data/heatmap/pgda69_north_earth_visibility_960m.lxg` | 744.3 kB | A14 | `84b3add` (local git account) | Claude Fable 5.2 |
| `public/data/heatmap/pgda69_north_illumination_120m.lxg` | 2.77 MB | A14 | `84b3add` (local git account) | Claude Fable 5.2 |
| `public/data/heatmap/pgda69_north_illumination_960m.lxg` | 1.22 MB | A14 | `84b3add` (local git account) | Claude Fable 5.2 |
| `public/data/heatmap/pgda69_south_earth_visibility_120m.lxg` | 1.98 MB | A14 | `84b3add` (local git account) | Claude Fable 5.2 |
| `public/data/heatmap/pgda69_south_earth_visibility_960m.lxg` | 702.6 kB | A14 | `84b3add` (local git account) | Claude Fable 5.2 |
| `public/data/heatmap/pgda69_south_illumination_120m.lxg` | 2.39 MB | A14 | `84b3add` (local git account) | Claude Fable 5.2 |
| `public/data/heatmap/pgda69_south_illumination_960m.lxg` | 1.19 MB | A14 | `84b3add` (local git account) | Claude Fable 5.2 |
| `public/data/horizons-check.json` | 5.7 kB | A13 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/data/horizons/blue-ghost-1-2025-03.json` | 163.1 kB | A12 | `5763608` (local git account) | none |
| `public/data/horizons/im-2-2025-03.json` | 157.4 kB | A12 | `5763608` (local git account) | none |
| `public/data/horizons/index.json` | 804 B | A12 | `5763608` (local git account) | none |
| `public/data/ice-targets/lemelin2021-psr.geojson` | 244.0 kB | A15 | `fade8ce` (local git account) | Claude Opus 5.5 |
| `public/data/landings.json` | 17.0 kB | A18 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/data/presets.json` | 4.1 kB | A30 | `f9668e3` (local git account) | Claude Opus 5.5 |
| `public/data/science/diviner/diviner_north_annual_max_240m.lxg` | 2.55 MB | A16 | `ef281e1` (local git account) | Claude Fable 5.2 |
| `public/data/science/diviner/diviner_north_annual_mean_240m.lxg` | 1.40 MB | A16 | `ef281e1` (local git account) | Claude Fable 5.2 |
| `public/data/science/diviner/diviner_south_annual_max_240m.lxg` | 3.24 MB | A16 | `ef281e1` (local git account) | Claude Fable 5.2 |
| `public/data/science/diviner/diviner_south_annual_mean_240m.lxg` | 2.36 MB | A16 | `ef281e1` (local git account) | Claude Fable 5.2 |
| `public/data/science/diviner/index.json` | 13.8 kB | A16 | `ef281e1` (local git account) | Claude Fable 5.2 |
| `public/data/science/shadowcam/index.json` | 60.3 kB | A17 | `13fb73f` (local git account) | Claude Fable 5.2 |
| `public/data/science/shadowcam/shadowcam_coverage.lxg` | 74.0 kB | A17 | `13fb73f` (local git account) | Claude Fable 5.2 |
| `public/data/sources/gcat-landers.json` | 13.1 kB | A26 | `008be62` (teammate, via GitHub) | none |
| `public/data/sources/lroc-anthropogenic-objects.csv` | 21.0 kB | A27 | `f812385` (teammate, via GitHub) | none |
| `public/data/sources/site-areas.json` | 34.3 kB | A28 | `f812385` (teammate, via GitHub) | none |
| `public/licences/THIRD-PARTY-NOTICES.txt` | 16.4 kB | A29 | `b4a2648` (local git account) | Claude Opus 5.5 |
| `public/terrain/apollo-11.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-11_detail.webp` | 955.1 kB | A7 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-11_fine.bin` | 1.05 MB | A5 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-11_ortho.webp` | 1.16 MB | A6 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-12.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-12_detail.webp` | 971.3 kB | A7 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-12_fine.bin` | 1.05 MB | A5 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-12_ortho.webp` | 1.01 MB | A6 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-14.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-14_detail.webp` | 989.7 kB | A7 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-14_fine.bin` | 1.05 MB | A5 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-14_ortho.webp` | 1.12 MB | A6 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-15.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-15_detail.webp` | 929.2 kB | A7 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-15_fine.bin` | 1.05 MB | A5 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-15_ortho.webp` | 1.13 MB | A6 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-16.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-16_detail.webp` | 941.5 kB | A7 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-16_fine.bin` | 1.05 MB | A5 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-16_ortho.webp` | 1.11 MB | A6 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-17.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-17_detail.webp` | 872.8 kB | A7 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-17_fine.bin` | 1.05 MB | A5 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/apollo-17_ortho.webp` | 236.5 kB | A6 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/blue-ghost-1.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/blue-ghost-1_detail.webp` | 911.4 kB | A7 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/blue-ghost-1_fine.bin` | 1.05 MB | A5 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/blue-ghost-1_ortho.webp` | 283.2 kB | A6 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/chandrayaan-3.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/change-3.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/change-3_detail.webp` | 761.6 kB | A7 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/change-3_fine.bin` | 1.05 MB | A5 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/change-3_ortho.webp` | 106.0 kB | A6 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/change-4.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/change-4_detail.webp` | 853.8 kB | A7 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/change-4_fine.bin` | 1.05 MB | A5 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/change-4_ortho.webp` | 197.0 kB | A6 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/change-5.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/change-5_detail.webp` | 907.7 kB | A7 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/change-5_fine.bin` | 1.05 MB | A5 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/change-5_ortho.webp` | 375.6 kB | A6 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/change-6.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/change-6_detail.webp` | 878.5 kB | A7 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/change-6_fine.bin` | 1.05 MB | A5 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/change-6_ortho.webp` | 330.3 kB | A6 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/im-1.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/im-2.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/index.json` | 11.5 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-13.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-16.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-16_detail.webp` | 964.7 kB | A7 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-16_fine.bin` | 1.05 MB | A5 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-16_ortho.webp` | 1.20 MB | A6 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-17.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-20.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-20_detail.webp` | 735.5 kB | A7 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-20_fine.bin` | 1.05 MB | A5 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-20_ortho.webp` | 422.7 kB | A6 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-21.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-21_detail.webp` | 743.1 kB | A7 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-21_fine.bin` | 1.05 MB | A5 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-21_ortho.webp` | 191.2 kB | A6 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-23.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-23_detail.webp` | 867.0 kB | A7 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-23_fine.bin` | 1.05 MB | A5 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-23_ortho.webp` | 844.4 kB | A6 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-24.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-24_detail.webp` | 909.4 kB | A7 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-24_fine.bin` | 1.05 MB | A5 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-24_ortho.webp` | 1.13 MB | A6 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/luna-9.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/slim.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/slim_detail.webp` | 815.4 kB | A7 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/slim_fine.bin` | 1.05 MB | A5 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/slim_ortho.webp` | 195.2 kB | A6 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/surveyor-1.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/surveyor-3.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/surveyor-3_detail.webp` | 972.0 kB | A7 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/surveyor-3_fine.bin` | 1.05 MB | A5 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/surveyor-3_ortho.webp` | 1.03 MB | A6 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/surveyor-5.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/surveyor-6.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/surveyor-7.bin` | 133.1 kB | A4 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/surveyor-7_detail.webp` | 898.1 kB | A7 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/surveyor-7_fine.bin` | 1.05 MB | A5 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/terrain/surveyor-7_ortho.webp` | 1.09 MB | A6 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/textures/earth_2k.jpg` | 203.6 kB | A10 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/textures/moon_color_2k.jpg` | 295.8 kB | A8 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/textures/moon_color_4k.jpg` | 1.13 MB | A8 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/textures/moon_color_8k.jpg` | 4.28 MB | A8 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/textures/moon_normal_4k.jpg` | 5.29 MB | A9 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/textures/moon_normal_8k.webp` | 12.41 MB | A9 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `public/textures/surface_detail_normal.jpg` | 1.75 MB | A11 | `418760e` (teammate, via GitHub) | none |
| `public/textures/surface_detail_tone.jpg` | 69.3 kB | A11 | `418760e` (teammate, via GitHub) | none |
| `scripts/nac-dtm-candidates.json` | 12.1 kB | A19 | `4ab3892` (teammate, via GitHub) | Claude Fable 5.2 |
| `src/analysis/__fixtures__/horizons-dsn-check.json` | 67.5 kB | A20 | `30dd8c9` (local git account) | Claude Fable 5.2 |
| `src/analysis/__fixtures__/horizons-topo-check.json` | 39.4 kB | A20 | `5763608` (local git account) | none |
| `src/assistant/deterministic/examples.json` | 5.4 kB | A31 | `5405cb1` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/horizons/ephemeris-check/data/antimeridian.epochs-1969-2035.json` | 17.0 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/data/apollo-11.epochs-1969-2035.json` | 16.9 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/data/apollo-17.epochs-1969-2035.json` | 16.9 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/data/blue-ghost-1.eclipse-2025-03-14.json` | 20.6 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/data/blue-ghost-1.epochs-1969-2035.json` | 16.9 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/data/blue-ghost-1.surface-2025-03.json` | 127.2 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/data/change-4.epochs-1969-2035.json` | 17.0 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/data/im-2.epochs-1969-2035.json` | 16.8 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/data/im-2.surface-2025-03.json` | 89.7 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/data/limb-east.epochs-1969-2035.json` | 16.8 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/data/limb-west.epochs-1969-2035.json` | 16.8 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/data/near-north-pole.epochs-1969-2035.json` | 16.8 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/data/near-south-pole.epochs-1969-2035.json` | 16.8 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/data/north-pole.epochs-1969-2035.json` | 16.9 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/data/south-pole.epochs-1969-2035.json` | 16.9 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/index.json` | 15.3 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/antimeridian.epochs-1969-2035.earth.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/antimeridian.epochs-1969-2035.sun.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/apollo-11.epochs-1969-2035.earth.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/apollo-11.epochs-1969-2035.sun.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/apollo-17.epochs-1969-2035.earth.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/apollo-17.epochs-1969-2035.sun.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/blue-ghost-1.eclipse-2025-03-14.earth.txt` | 17.9 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/blue-ghost-1.eclipse-2025-03-14.sun.txt` | 17.9 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/blue-ghost-1.epochs-1969-2035.earth.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/blue-ghost-1.epochs-1969-2035.sun.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/blue-ghost-1.surface-2025-03.earth.txt` | 66.9 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/blue-ghost-1.surface-2025-03.sun.txt` | 66.9 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/change-4.epochs-1969-2035.earth.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/change-4.epochs-1969-2035.sun.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/im-2.epochs-1969-2035.earth.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/im-2.epochs-1969-2035.sun.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/im-2.surface-2025-03.earth.txt` | 49.7 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/im-2.surface-2025-03.sun.txt` | 49.7 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/limb-east.epochs-1969-2035.earth.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/limb-east.epochs-1969-2035.sun.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/limb-west.epochs-1969-2035.earth.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/limb-west.epochs-1969-2035.sun.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/moon-subpoints.2025-03-02T0900Z_2025-03-17T0000Z_60m.txt` | 41.7 kB | A21 | `710e0f1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/moon-subpoints.2025-03-06T1800Z_2025-03-17T0000Z_60m.txt` | 31.3 kB | A21 | `710e0f1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/moon-subpoints.2025-03-14T0300Z_2025-03-14T1100Z_10m.txt` | 11.7 kB | A21 | `710e0f1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/moon-subpoints.epochs-1969-2035.txt` | 9.9 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/near-north-pole.epochs-1969-2035.earth.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/near-north-pole.epochs-1969-2035.sun.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/near-south-pole.epochs-1969-2035.earth.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/near-south-pole.epochs-1969-2035.sun.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/north-pole.epochs-1969-2035.earth.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/north-pole.epochs-1969-2035.sun.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/retrieval-log.json` | 44.4 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/south-pole.epochs-1969-2035.earth.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/raw/south-pole.epochs-1969-2035.sun.txt` | 14.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/results/baseline-integration-45a0860.json` | 1.4 kB | A21 | `710e0f1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/results/baseline-integration-45a0860.txt` | 4.6 kB | A21 | `710e0f1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/results/skyAt-analysis-43731e3.json` | 10.0 kB | A21 | `710e0f1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/results/skyAt-analysis-43731e3.txt` | 6.8 kB | A21 | `710e0f1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/results/skyAt-integration-32ef35a.json` | 10.0 kB | A21 | `bbe80bf` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/results/skyAt-integration-32ef35a.txt` | 6.8 kB | A21 | `bbe80bf` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/sets.json` | 11.1 kB | A21 | `ce048a1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/horizons/ephemeris-check/spice-crosscheck.json` | 5.6 kB | A21 | `710e0f1` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/dsn/app-af1b499.json` | 338.4 kB | A22 | `7155330` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/app-now.json` | 329.9 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/horizons/apollo-11.2031-04.dss14.site-sees-station.json` | 6.9 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/horizons/apollo-11.2031-04.dss14.station-sees-site.json` | 34.1 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/horizons/apollo-11.2031-04.dss43.site-sees-station.json` | 6.9 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/horizons/apollo-11.2031-04.dss43.station-sees-site.json` | 34.0 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/horizons/apollo-11.2031-04.dss63.site-sees-station.json` | 6.9 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/horizons/apollo-11.2031-04.dss63.station-sees-site.json` | 34.1 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/horizons/chandrayaan-3.2023-08.dss14.site-sees-station.json` | 6.9 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/horizons/chandrayaan-3.2023-08.dss14.station-sees-site.json` | 34.1 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/horizons/chandrayaan-3.2023-08.dss43.site-sees-station.json` | 6.9 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/horizons/chandrayaan-3.2023-08.dss43.station-sees-site.json` | 34.0 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/horizons/chandrayaan-3.2023-08.dss63.site-sees-station.json` | 6.9 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/horizons/chandrayaan-3.2023-08.dss63.station-sees-site.json` | 34.1 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/horizons/im-2.2025-03.dss14.site-sees-station.json` | 34.0 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/horizons/im-2.2025-03.dss14.station-sees-site.json` | 34.1 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/horizons/im-2.2025-03.dss43.site-sees-station.json` | 33.7 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/horizons/im-2.2025-03.dss43.station-sees-site.json` | 34.0 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/horizons/im-2.2025-03.dss63.site-sees-station.json` | 34.0 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/horizons/im-2.2025-03.dss63.station-sees-site.json` | 34.1 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/queries.json` | 6.4 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/raw/apollo-11.2031-04.dss14.site-sees-station.txt.gz` | 8.7 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/raw/apollo-11.2031-04.dss14.station-sees-site.txt.gz` | 33.8 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/raw/apollo-11.2031-04.dss43.site-sees-station.txt.gz` | 8.8 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/raw/apollo-11.2031-04.dss43.station-sees-site.txt.gz` | 33.8 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/raw/apollo-11.2031-04.dss63.site-sees-station.txt.gz` | 8.7 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/raw/apollo-11.2031-04.dss63.station-sees-site.txt.gz` | 33.8 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/raw/chandrayaan-3.2023-08.dss14.site-sees-station.txt.gz` | 8.7 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/raw/chandrayaan-3.2023-08.dss14.station-sees-site.txt.gz` | 33.8 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/raw/chandrayaan-3.2023-08.dss43.site-sees-station.txt.gz` | 8.7 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/raw/chandrayaan-3.2023-08.dss43.station-sees-site.txt.gz` | 33.9 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/raw/chandrayaan-3.2023-08.dss63.site-sees-station.txt.gz` | 8.7 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/raw/chandrayaan-3.2023-08.dss63.station-sees-site.txt.gz` | 33.7 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/raw/im-2.2025-03.dss14.site-sees-station.txt.gz` | 31.0 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/raw/im-2.2025-03.dss14.station-sees-site.txt.gz` | 33.9 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/raw/im-2.2025-03.dss43.site-sees-station.txt.gz` | 31.1 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/raw/im-2.2025-03.dss43.station-sees-site.txt.gz` | 33.9 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/raw/im-2.2025-03.dss63.site-sees-station.txt.gz` | 30.9 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/raw/im-2.2025-03.dss63.station-sees-site.txt.gz` | 33.7 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/raw/retrieval-log.json` | 13.1 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/results-af1b499.json` | 27.2 kB | A22 | `7155330` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/results-af1b499.txt` | 6.0 kB | A22 | `7155330` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/results.json` | 27.2 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/results.txt` | 6.0 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/dsn/scenarios.json` | 2.6 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/earth/app-before.json` | 105.3 kB | A22 | `982a067` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/earth/app-now.json` | 110.7 kB | A22 | `982a067` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/earth/results.json` | 16.2 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/earth/results.txt` | 9.0 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/earth/scenarios.json` | 1.4 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/events/alsj-app-before.json` | 29.5 kB | A22 | `982a067` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/events/alsj-app-now.json` | 29.5 kB | A22 | `982a067` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/events/alsj_rows.json` | 14.0 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/events/alsj_scotti_altaz.txt` | 4.8 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/events/app-before-bundled.json` | 135.5 kB | A22 | `982a067` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/events/app-before.json` | 250.9 kB | A22 | `982a067` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/events/app-now-bundled.json` | 138.6 kB | A22 | `982a067` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/events/app-now.json` | 255.2 kB | A22 | `982a067` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/events/results.json` | 6.8 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/events/results.txt` | 6.0 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/events/scenarios-bundled.json` | 984 B | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/events/scenarios.json` | 1.8 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/events/sources.json` | 5.0 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/apollo-15.1971-07-08.json` | 29.8 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/blue-ghost-1.2025-03.json` | 31.0 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/chandrayaan-3.2023-08-09.json` | 64.9 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/connecting-ridge.2025-03-04.json` | 115.2 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/im-2.2025-03-04.json` | 114.8 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/limb-east.2025-03-04.json` | 115.9 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/limb-west.2025-03-04.json` | 114.4 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/queries.json` | 1.7 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/raw/apollo-15.1971-07-08.earth.txt.gz` | 22.5 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/raw/apollo-15.1971-07-08.sun.txt.gz` | 17.3 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/raw/blue-ghost-1.2025-03.earth.txt.gz` | 22.9 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/raw/blue-ghost-1.2025-03.sun.txt.gz` | 17.9 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/raw/chandrayaan-3.2023-08-09.earth.txt.gz` | 44.8 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/raw/chandrayaan-3.2023-08-09.sun.txt.gz` | 32.7 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/raw/connecting-ridge.2025-03-04.earth.txt.gz` | 76.5 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/raw/connecting-ridge.2025-03-04.sun.txt.gz` | 54.0 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/raw/im-2.2025-03-04.earth.txt.gz` | 76.6 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/raw/im-2.2025-03-04.sun.txt.gz` | 54.8 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/raw/limb-east.2025-03-04.earth.txt.gz` | 76.5 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/raw/limb-east.2025-03-04.sun.txt.gz` | 53.9 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/raw/limb-west.2025-03-04.earth.txt.gz` | 76.3 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/raw/limb-west.2025-03-04.sun.txt.gz` | 55.8 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/raw/retrieval-log.json` | 11.6 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/raw/shackleton-rim.2025-03-04.earth.txt.gz` | 76.5 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/raw/shackleton-rim.2025-03-04.sun.txt.gz` | 53.8 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/horizons/shackleton-rim.2025-03-04.json` | 115.3 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/illumination/app-9bc4878.json` | 28.7 kB | A22 | `602cefd` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/illumination/app-before.json` | 25.0 kB | A22 | `982a067` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/illumination/app-now.json` | 21.9 kB | A22 | `982a067` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/illumination/results-9bc4878.json` | 25.4 kB | A22 | `602cefd` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/illumination/results-9bc4878.txt` | 10.2 kB | A22 | `602cefd` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/illumination/results.json` | 19.2 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/illumination/results.txt` | 8.1 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/illumination/scenarios.json` | 3.6 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/outlook/app-9bc4878.json` | 308.6 kB | A22 | `602cefd` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/outlook/app-now.json` | 299.4 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/outlook/model-series-input.json` | 315 B | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/outlook/results-9bc4878.json` | 18.2 kB | A22 | `602cefd` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/outlook/results-9bc4878.txt` | 8.0 kB | A22 | `602cefd` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/outlook/results.json` | 16.4 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/outlook/results.txt` | 7.2 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/outlook/scenarios.json` | 586 B | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/reference/skyline.apollo-11.m2.json` | 47.8 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/reference/skyline.apollo-15.m2.json` | 49.1 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/reference/skyline.blue-ghost-1.m2.json` | 45.4 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/reference/skyline.chandrayaan-3.m2.json` | 48.8 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/reference/skyline.connecting-ridge.m0.json` | 40.5 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/reference/skyline.connecting-ridge.m2.json` | 50.4 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/reference/skyline.im-2.m0.json` | 48.4 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/reference/skyline.im-2.m2.json` | 48.9 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/reference/skyline.limb-east.m2.json` | 49.2 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/reference/skyline.limb-west.m2.json` | 49.4 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/reference/skyline.ridge-top.m0.json` | 43.4 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/reference/skyline.ridge-top.m2.json` | 51.5 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/reference/skyline.rim-top.m0.json` | 41.3 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/reference/skyline.rim-top.m2.json` | 53.2 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/reference/skyline.shackleton-floor.m0.json` | 52.1 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/reference/skyline.shackleton-floor.m2.json` | 52.1 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/reference/skyline.shackleton-rim.m0.json` | 39.9 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/reference/skyline.shackleton-rim.m2.json` | 40.4 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/sites.json` | 2.2 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/skyline/app-before.json` | 188.6 kB | A22 | `982a067` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/skyline/app-now.json` | 199.5 kB | A22 | `982a067` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/skyline/reference-apollo-15.json` | 21.7 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/skyline/reference-chandrayaan-3.json` | 21.4 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/skyline/reference-connecting-ridge.json` | 21.7 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/skyline/reference-connecting-ridge@0m.json` | 19.9 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/skyline/reference-im-2.json` | 21.6 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/skyline/reference-im-2@0m.json` | 21.5 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/skyline/reference-ridge-top@0m.json` | 20.5 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/skyline/reference-rim-top@0m.json` | 19.8 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/skyline/reference-shackleton-rim.json` | 19.8 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/skyline/reference-shackleton-rim@0m.json` | 19.7 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/skyline/results.json` | 28.3 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/skyline/results.txt` | 14.2 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/skyline/scenarios.json` | 2.2 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/slope/app-now.json` | 131.2 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/slope/results.json` | 15.4 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/slope/results.txt` | 6.6 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/slope/scenarios.json` | 5.9 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/spans/app-now.json` | 121.9 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/spans/results.json` | 4.0 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/spans/results.txt` | 2.2 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/spans/scenarios.json` | 1.1 kB | A22 | `a9bc640` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/terrain/app-heights-af1b499.json` | 10.6 kB | A22 | `7155330` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/terrain/app-heights-af1b499.txt` | 3.9 kB | A22 | `7155330` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/terrain/results.json` | 1.9 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/terrain/results.txt` | 1.5 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/terrain/seams-eased.json` | 11.8 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/terrain/seams-eased.txt` | 4.8 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/terrain/seams.json` | 4.8 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/terrain/seams.txt` | 2.6 kB | A22 | `c96dd00` (local git account) | Claude Fable 5.2 |
| `tests/fixtures/validation/ephemeris-check/transitions/app-9bc4878-bundled.json` | 116.5 kB | A22 | `602cefd` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/transitions/app-9bc4878.json` | 275.5 kB | A22 | `602cefd` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/transitions/results-9bc4878-sky0.5.json` | 47.3 kB | A22 | `602cefd` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/transitions/results-9bc4878-sky0.5.txt` | 13.8 kB | A22 | `602cefd` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/transitions/results-9bc4878.json` | 51.0 kB | A22 | `602cefd` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/transitions/results-9bc4878.txt` | 15.7 kB | A22 | `602cefd` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/transitions/scenarios-bundled.json` | 1.0 kB | A22 | `b41cadc` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/ephemeris-check/transitions/scenarios.json` | 1.7 kB | A22 | `b41cadc` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/blue-ghost-products/new-pin.txt` | 1.1 kB | A22 | `97d0b66` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/blue-ghost-products/results.json` | 11.1 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/blue-ghost-products/results.txt` | 4.6 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-eased/app-af1b499.json` | 84.8 kB | A22 | `7155330` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-eased/reference-apollo-12@2m.json` | 22.1 kB | A22 | `7155330` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-eased/reference-blue-ghost-1@2m.json` | 21.6 kB | A22 | `7155330` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-eased/reference-luna-23@2m.json` | 22.2 kB | A22 | `7155330` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-eased/results.json` | 10.2 kB | A22 | `7155330` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-eased/results.txt` | 3.1 kB | A22 | `7155330` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-eased/scenarios.json` | 709 B | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/app-1289083.json` | 557.0 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/fresh-pins.json` | 815 B | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/reference-apollo-15@0.5m.json` | 21.7 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/reference-apollo-15@0m.json` | 21.7 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/reference-chandrayaan-3@0.5m.json` | 21.1 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/reference-chandrayaan-3@0m.json` | 20.7 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/reference-connecting-ridge@0.5m.json` | 20.7 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/reference-fresh-a@0.5m.json` | 20.9 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/reference-fresh-a@0m.json` | 20.7 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/reference-fresh-a@2m.json` | 21.0 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/reference-fresh-b@0.5m.json` | 20.9 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/reference-fresh-b@0m.json` | 20.6 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/reference-fresh-b@2m.json` | 21.6 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/reference-im-2@0.5m.json` | 21.6 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/reference-ridge-top@0.5m.json` | 21.3 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/reference-ridge-top@2m.json` | 22.0 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/reference-rim-top@0.5m.json` | 20.6 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/reference-rim-top@2m.json` | 22.3 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/reference-shackleton-rim@0.5m.json` | 19.8 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/results.json` | 72.1 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/results.txt` | 27.6 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |
| `tests/fixtures/validation/science-validation/skyline-masts/scenarios.json` | 7.0 kB | A22 | `af49a12` (local git account) | Claude Opus 5.5 |

</details>

## 5. Watermarks and acknowledgements that follow (proposals, awaiting the operator)

| # | What | Rule that applies | Proposal | Who would do it |
| --- | --- | --- | --- | --- |
| W1 | Screenshots of the app (A23, the walkthrough's A32 under `docs/lunyx/screenshots/`, and any new ones) | Watermark applies to SI-generated images and videos; these are captures of software, not generated images | No watermark. Caption them in text where they appear: "Screenshot of Lunyx; the software was written with AI assistance (see AI-USE.md)" | Doc owners |
| W2 | The demo (video of 30 s or less, or at most 7 slides) | Any SI-generated image or video in it needs a visible watermark; SI-generated audio (for example an AI voice-over) needs acknowledgement in text and metadata; no NASA insignia or other NASA branding | If the demo is screen recordings of the app and slides made by the team: no watermark, one line "Built with AI coding agents; see AI-USE.md". If any generated picture, clip or voice is added: watermark or acknowledge it as the rule says | Operator |
| W3 | Code | "Code and data: Must acknowledge SI generation in descriptive text and metadata." | Descriptive text: a short "How AI was used" section in `README.md` linking here (T-9) and this file. Metadata: the Co-Authored-By trailers already on 244 of 253 non-merge commits; optionally one line in `package.json` `description` | README: @submission (T-9); `package.json`: @coordinator |
| W4 | Data files produced by AI-written scripts (A1 to A10, A12 to A17, A19 to A22; A26 to A28 if L4 shows their scripts were AI-written) and data written by AI agents (A30, A31) | As W3 | Descriptive text: SOURCES.md and the data READMEs name the script that made each file; this file says the scripts were written by AI agents. Metadata: add a field such as `"processedBy": "scripts/<name> (written by AI coding agents)"` to the `index.json` of each data folder | Data owners (@ice-targets, @analysis) |
| W5 | `public/data/landings.json` (A18) | As W3, if any of its text was written by the AI model | Largely done by T-38: every row cites its sources and the file's `note` explains them; what remains is to say who wrote the one-line summaries (L3) | Operator, after L3 |
| W6 | Close-up textures (A11) | Licence must be documented; if AI-generated, a visible watermark would be required, which a tiling texture cannot carry sensibly | If origin and licence are not confirmed before submission: replace them with textures generated by a script in this repository, or ship without them | Operator decides; owner of `public/textures` (@ice-targets) |
| W7 | In-app assistant | NASA's AI-application guidance (1.4) | F1 to F3 in section 3 | @assistant |
| W8 | Design references (A24) | NASA insignia rules; Space Apps terms on third-party material | Do not publish `docs/reference/` images and PDF with the final project (keep the repository private, or publish a copy without them) | Operator |
| W9 | Third-party notices in the built app | MIT and OFL notice conditions | Done by the original team's T-37: `/licences/THIRD-PARTY-NOTICES.txt` ships with the site (SOURCES.md section 6) | — |

## 6. NASA branding check

What the rules prohibit: generated content that uses, contains or modifies NASA branding or
design elements "(such as the NASA logos, flags, or mission identifiers)" (1.1), and NASA's
Insignia, Logotype or Seal appearing with SI-generated imagery (1.4). NASA's brand guidelines
add that the Insignia, Logotype and Seal "may not be used for any purpose without explicit
permission" and not on products, publications or web pages that are not NASA-sponsored.

**The app** (checked in `index.html`, `src/**`, `public/**` at `08b5cfa`):

- The only wordmark is the text "LUNYX" (`index.html`, set in Space Grotesk).
- The only icons are four inline SVG drawings written in the code: a chat bubble and a
  microphone (`src/ui/assistant/drawer.ts`), the "little person" (`src/ui/globe/person.ts`) and
  a compass rose (`src/ui/shared/compass.ts`). None resembles a NASA mark. The only other SVGs are
  the skyline chart (`src/ui/surface/skylineChart.ts`) and the seasonal-outlook chart
  (`src/ui/compare/outlookTab.ts`), both drawn from computed series.
- The only images the app loads are the textures and terrain images of groups A6 to A11 and,
  online, the Moon Trek tiles. All 46 of those committed images (8 textures, 19 orthophotos,
  19 relief images) were viewed; none shows a logo, flag or emblem.
- "NASA" appears in the interface only as text in data credits and notes (for example "NASA
  PGDA product 69", "via NASA Moon Trek", "NASA's cloud-free Blue Marble").
- Mission names ("Apollo 11", "IM-2 Athena", "Blue Ghost Mission 1") appear as plain-text
  labels of the landing catalogue. No mission patch, logo or graphic identifier is used.
- The assistant produces text and runs the app's own actions; it generates no images.
- National flags (since `0cc5553`, the teammate's work): `src/scene/flags.ts` draws simplified
  flags by code ("drawn rather than loaded so there are no image assets to license") on the
  landing markers when "flags" is switched on in the Filters panel (off by default), and in the
  site card: the United States, Russia (also shown for hardware launched by the USSR), China,
  India and Japan (viewed in `t39-flags.png`). Since the original team's T-39 (`50aaace`) the
  United States flag has its 50 stars and China's small stars point at the large one; an unused
  USSR drawing was removed in `fb0a5d2`. These are national flags, not NASA's flag, insignia or any mission identifier
  (L10).
- Result: **no NASA logo, insignia, seal, NASA flag or mission identifier is used, generated or
  modified by the app.**

**The documents:**

- `docs/reference/Lunyx-design.pdf`, page 3, reproduces two NASA "Earth Phases" posters that
  carry the NASA insignia and the agency's name. They are reproductions of NASA posters inside
  the team's design notes, not generated or modified by AI. The same mockups paste in
  screenshots of third-party products: map and street-level photo services, a physics
  simulation's control panel, a shopping site's chat widget and a chart from a tutorial site
  (`globe.jpg`, `surface.jpg`, and pages 1 and 2 of the PDF). Open item L9; proposal W8.
- SOURCES.md, this file and the handover notes mention NASA in text only and claim no NASA
  review or endorsement.

## 7. The teammate's GitHub `main` work

GitHub `main` at `282249d` was integrated and published as `0cc5553` on 2026-11-15. Its three
data files are rows A26 to A28 above, its flags are in section 6, and its sources are S18 to S20
in SOURCES.md. None of its commits carries an AI trailer (L4).

## 8. Open list for the operator

Nothing below has been filled with a guess. "Ask" means the answer is not in the repository or
at the source.

| # | Item | Why it matters | What would settle it |
| --- | --- | --- | --- |
| L1 | The repository has no `LICENSE` file | Space Apps terms: original content without an OSI licence is distributed by NASA under Apache 2.0 | Choose a licence (or accept the Apache 2.0 default) |
| L2 | `public/textures/surface_detail_{normal,tone}.jpg` (A11): origin and licence of the "moon-surface" asset pack; whether a person or an AI tool made it | Third-party material must have its licence documented; the submit checkbox confirms no copyrighted material is used without permission; an AI-generated image would need a watermark | Ask the teammate where `moon-surface.zip` came from and under which licence; otherwise W6 |
| L3 | `public/data/landings.json` (A18): positions and times are sourced since T-38, except three times not confirmed to the minute (Luna 23's time of day, Chandrayaan-3's and IM-2's minutes). Still unknown: who wrote the one-line summaries, and whether the AI model supplied the original values | The summaries are shown in the app; AI-generated text and data must be acknowledged | Ask the teammate; otherwise acknowledge the summaries as possibly AI-written |
| L4 | The teammate's eight commits without an AI trailer (`49fee90`, `418760e`, `8bfd842`, `2ab7daa`, `008be62`, `bf39978`, `f812385`, `2855d22`): surface scene, close-up textures, country labels, flags, explored areas and their scripts | The code and data acknowledgement in 2.1 should be exact | Ask the teammate whether an AI tool wrote that code |
| L5 | JPL Horizons: no licence or usage terms stated on the manual, API documentation or Horizons page | Licences of data used must be documented | Cite as the manual asks (SOURCES S10); state "terms not stated" |
| L6 | Kaguya TC tiles via NASA Moon Trek (run time only). Moon Trek's metadata quotes JAXA: the data are JAXA's copyright and "can be allowed to use for scientific and educational utilization" (SOURCES R1) | Displayed with credit, not redistributed; a public hackathon submission may or may not count as educational use | The operator's reading; otherwise drop the Kaguya layer and keep the LROC WAC layer, whose metadata says "Use_Constraints: None" |
| L7 | Copy of the Apollo Lunar Surface Journal Sun and Earth table (J. Scotti) in the test fixtures: no terms found | Third-party material in the repository | Keep with credit (it is hosted by NASA), or remove the copy and keep the URL |
| L8 | Resolved: the built app used to ship three.js and the two fonts without their licence texts | MIT and OFL notice conditions | Done in T-37 (`27b0f30`): `/licences/THIRD-PARTY-NOTICES.txt` |
| L9 | `docs/reference/` holds third-party screenshots and NASA posters with the insignia | Insignia rules; "no copyrighted materials … that we don't have permission to use" | Approve W8 before the repository or any copy of it is made public |
| L10 | National flags drawn by code (in the build since `0cc5553`, off by default), with a 50-star United States flag since the original T-39; mission names shown as plain text | The SI rule lists "flags" and "mission identifiers" among NASA branding elements. NASA's brand pages use "identifier" for its graphic marks (the Insignia and its lockups), so plain-text mission names look outside it (my reading) | The operator's reading of the rule; keep, change or drop the flags; confirm that plain-text mission names are fine |
| L11 | Ideation: who drafted tab 2 ("Our ideas") of the team document and the text of the design PDF, and whether any AI tool helped; which tool made the PDF's "Transcription" section | The guide says SI "should not be used to (come up with your idea of how to solve the challenge)" | Ask the team |
| L12 | The operator's channel to the agents: the hub describes the operator as possibly speaking through ChatGPT | If an assistant such as ChatGPT relayed or shaped instructions, it belongs in the SI description | Operator confirms which tools were used |
| L13 | Assistant findings F1 to F3 (section 3) | NASA's guidance for AI applications | Operator approves; @assistant implements |
| L14 | ShadowCam: no licence or usage statement in its archive | Imagery may not be redistributed without permission | Nothing to do while the app only links (current state) |
| L15 | Metadata acknowledgement for code and data (W3, W4) | "acknowledge SI generation in descriptive text and metadata" | Approve or adjust W3 and W4 |
