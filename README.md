# Elephant Movement Metrics Calculator

**Open the calculator:** <https://ctisavetheelephants.github.io/Elephant_movement_metric_toolkit/>

A free tool from [Save the Elephants](https://www.savetheelephants.org) for people who track elephants with GPS collars. You load your collar data, and the calculator:

1. **cleans it automatically**, removing bad fixes, duplicates, GPS spikes and collars sitting in an office before deployment. If possible, please check your data before loading it, as the automatic cleaning may miss less obvious errors
2. **calculates 23 movement metrics** for every elephant: speeds, day/night activity, displacement, home-range size, range overlap, residence time and more
3. **shows your elephants** over time, side by side, as heat maps and as seasonal "wheels"
4. **lets you download** the results and, if you choose, **send them to Save the Elephants**

Everything runs inside your web browser. There is nothing to install, and no account or R is needed.

---

## Your data stays on your computer

- The calculator is a single web page. When you load a file, **your own browser reads it**. Your tracking data is never uploaded anywhere, whether you use the online link or a saved copy.
- **Nothing is sent unless you click "Send to Save the Elephants".** Before anything is sent, the calculator shows exactly what will go: only the metrics file, plus the run report if you tick the box. The metrics file holds summary values per elephant-month and elephant-year. It contains **no locations, no fix times and no raw data**.
- If you are online, the page checks a small public note (`version.json`) on this site, only to tell you when a newer version exists. Nothing about you or your data is included in that check.
- The "removed fixes" download is for your own records. It is never sent.

---

## How to use it

### Online
Open the link above, and follow the five steps on the page:

1. **Load data.** Drop in a CSV or Excel export from your collar system (EarthRanger, Movebank, Africa Wildlife Tracking, Vectronic, Lotek, ...). One row per GPS fix.
2. **Check columns.** The calculator guesses which column is the elephant ID, the date/time and the coordinates, and detects the country and time zone. Check its guesses and change any that are wrong.
3. **Elephants.** Enter the study area name and check each elephant's sex.
4. **Calculate.**
5. **Results.**
   - **Summary & files:** download your metrics file, the run report and the list of removed fixes, and (optionally) send the metrics to Save the Elephants.
   - **Monitoring My Elephants:** charts of your own elephants.
   - **Compare with other populations:** *coming soon*. See below.

To look at your results again later, open the calculator and drop your saved `*_metrics.csv` file onto step 1. The **Metrics definitions** button (step 3) explains every metric.

### Offline use (e.g., outside internet coverage)
Open the link once while you have internet, then save the page:
- **Windows / Linux:** press **Ctrl+S**
- **Mac:** press **Cmd+S**

Choose a folder you'll remember. The saved file contains the whole calculator, so double-clicking it later opens it without internet, and it works exactly the same.

When a saved copy is opened while online, it checks for a newer version. If there is one, a yellow banner says *"A newer version is available"*, with a link and a "What's new" line. If an update is **required** (e.g. an older version gave wrong results), the banner is red and that copy cannot send results until you update. To update, open the link and save the page again.

### Compare with other populations: coming soon
Comparing your population with pooled summaries from other study areas is built in but switched off. The card is shown greyed out until the partners who contributed data agree to share pooled summaries publicly.

---

## For Save the Elephants: how I release a new version

The page partners use is `docs/index.html`, which GitHub Pages publishes. **Never edit `docs/` by hand.** It is rebuilt from `calculator/src/` every time.

**Every time you change the calculator:**

1. **Make the change** in `calculator/src/`, and check it works (see *Testing a change* below).
2. **Make the release in RStudio:**
   1. Open `calculator/release_calculator.R`.
   2. Fill in the three settings at the top:
      - `new_version`: higher than the current one. Raise the last number for small fixes or wording (1.1.0 → 1.1.1), the middle number for new features or changed displays (1.1.1 → 1.2.0), and the first number for big changes to how metrics are calculated (1.2.0 → 2.0.0). The current version is at the bottom of the calculator page and at the top of `CHANGELOG.md`.
      - `whats_new`: one sentence. Partners see it in the update banner.
      - `required`: `TRUE` only when older copies must not be used any more (for example, they give wrong results). Otherwise `FALSE`.
   3. Click **Source**. The console shows `Done: docs/index.html and docs/version.json ...`.

   This sets the version number everywhere, rebuilds `docs/index.html`, writes `docs/version.json` and adds the release to `CHANGELOG.md`.
3. **Publish:** push the changes to GitHub with your usual Git tool (e.g. GitHub Desktop). GitHub Pages updates the site within a few minutes. From then on, older copies opened online show the update banner.

`release_calculator.R` runs a small Node.js program, `calculator/release.js`. Node.js must be installed (<https://nodejs.org>, LTS version), but you never need to run it yourself.

### Testing a change before releasing
In the RStudio console:

```r
setwd("C:/Users/angie/OneDrive/Documents/GitHub/STE/Elephant_movement_metric_toolkit/calculator")
system2("node", "build.js")   # rebuilds docs/index.html without changing the version
```

Then open `docs/index.html` in your browser (double-click it in File Explorer).

### Settings: `calculator/release.config.json`

| Setting | What it does |
|---|---|
| `siteUrl` | The GitHub Pages address. Copies check `siteUrl` + `version.json` for updates, and the update banner links here. |
| `receiverUrl` | The Apps Script web app that receives **Send** (see `receiver/README.md`). Empty = Send saves the file and opens an e-mail instead. |
| `sendEmail` | The address used by the e-mail fallback. |
| `compareEnabled` | `false` = "Compare with other populations" is greyed out ("Coming soon") and **no reference data is put in the page**. `true` = comparisons are on. |
| `referencePath` | Where the reference summaries file is, kept **outside** this repo. Only used when `compareEnabled` is `true`. |

### Switching "Compare with other populations" back on
Only do this once partners have agreed: **the summaries then become part of the public page.**

1. In RStudio, open `calculator/reference/build_reference.R` and click **Source**. It writes `reference_summaries.json` next to STE's reference computed metrics file, outside this repo, which is where `referencePath` points.
2. In `calculator/release.config.json`, change `"compareEnabled": false` to `"compareEnabled": true`.
3. Release a new version as above, e.g. `whats_new <- "Compare with other populations is now open"`.

To switch it off again, set it back to `false` and release. The reference data is then removed from the page. Older pushed versions still exist in the repo's history, though, so only switch it on when sharing is agreed.

All the comparison code (`src/core/compare.js` and the Compare part of `src/ui/explore.js`) stays in place while it is switched off.

### One-time GitHub Pages setup
1. On GitHub, open the repository **CTIsavetheelephants/Elephant_movement_metric_toolkit**, then click **Settings** (top right of the repo).
2. In the left menu, click **Pages**.
3. Under **Build and deployment**:
   - **Source:** *Deploy from a branch*
   - **Branch:** `main`, folder `/docs`, then click **Save**.
4. After a minute or two, the page shows *"Your site is live at https://ctisavetheelephants.github.io/Elephant_movement_metric_toolkit/"*.
5. Optional, recommended: tick **Enforce HTTPS** on the same page (usually on by default).

The repository must be **public** for GitHub Pages on a free organisation plan.

### Send button (Apps Script receiver)
**Send** posts the metrics file to a Google Apps Script web app in STE's Google Workspace. The app saves the file to a private Drive folder and e-mails it to STE. Setup, redeploying, and what a public receiver URL does and does not expose are all in [`receiver/README.md`](receiver/README.md).

### Reference data and the clock-check template
| File | Built by | In this repo? |
|---|---|---|
| `reference_summaries.json`: pooled group summaries for *Compare* | `calculator/reference/build_reference.R`, from STE's reference computed metrics file | **No.** Written outside the repo; also blocked by `.gitignore`. |
| `calculator/reference/diel_template.json`: one averaged 24-hour movement-rhythm curve (96 numbers) used by the step-2 clock check (UTC vs local time) | `calculator/reference/build_diel_template.R`, from the cleaned tracking files | Yes. It holds no names, locations, sites or individual values. |

---

## What the calculator does, in more detail

### Time zones
Time handling (UTC or local) is decided in three steps:

1. Times that carry their own zone (`Z`, `+03:00`) are converted automatically.
2. Column names such as `UTC_Date`, `LMT_Time` or Movebank's `timestamp` pre-select the answer.
3. Otherwise UTC is the default. After the file is read, a **clock check** (`src/core/diel.js`) compares the elephants' daily movement rhythm with the template. If the rhythm matches local time instead, it offers a one-click switch. It only says "clearly" when the evidence is unambiguous.

### Automatic cleaning (`src/core/clean.js`)
This follows the rules of STE's tracking-data cleaner, with its default settings. Every flagged fix is removed:

- invalid or 0,0 coordinates
- exact duplicates, and fixes less than 5 min after the previous fix
- speed ≥ 25 km/h, and ≥ 150 km/h into a fix
- pre-deployment fixes (first 30 days)
- isolated > 10 km spikes
- terminal immobility (200 m / 5 days / 10 fixes, in the last 5% of the track)
- points outside Africa, and fixes more than max(300 km, 10× the animal's median distance from its median location)
- overlapping collars on one name are split

### Metrics (`src/core/steps.js`, `kde.js`, `emd.js`, `metrics.js`)
These are a line-by-line port of STE's R metrics pipeline:

- per-study-area UTM projection
- 4-hour resampling with step quality control
- day/night classification
- coverage filters
- all 23 metrics, including fixed 1 km kernel utilisation distributions, volume-of-intersection and Bhattacharyya overlaps, 100% MCP, and an exact thresholded Earth Mover's Distance

The output has the same columns as STE's reference computed metrics file, plus `organisation` and `tool_version`. The calculator was validated against the R pipeline: all 23 metrics agree to the reported decimals.

### Compatibility flags
`src/ui/app.js` passes `compat: { pointsUTC: false, emdMaskFlip: false }`. Setting them to `true` reproduces two behaviours of older versions of the R pipeline, which have since been fixed. This is only for checking old outputs.

---

## Project layout

```
README.md               this file
CHANGELOG.md            every release, newest first (written by release.js)
.gitignore              keeps reference data, partner files and clutter out of git
docs/                   the PUBLISHED site (GitHub Pages) - built, never edit by hand
  index.html              the calculator (one self-contained file)
  version.json            latest version, minimum version, release notes
  .nojekyll               tells GitHub Pages to serve files as they are
calculator/
  src/core/               cleaning, time zones, metrics, comparison maths
  src/ui/                 page layout (template.html, style.css), page logic (app.js),
                          charts, My elephants / Compare views (explore.js),
                          metric definitions (defs.js), background worker
  vendor/xlsx.full.min.js SheetJS, so Excel files can be read
  build.js                builds docs/index.html
  release.js              version bump + build + version.json + changelog
  release_calculator.R    run release.js from RStudio (Source)
  release.config.json     settings (see table above)
  serve.js                optional local test server (node serve.js -> http://localhost:8765/)
  reference/
    build_reference.R       pooled Compare summaries -> written OUTSIDE the repo
    build_diel_template.R   clock-check template -> diel_template.json
    diel_template.json      clock-check template (averaged daily rhythm curve)
receiver/
  Code.gs                 Google Apps Script for the Send button
  README.md               setup, redeploying, what the public URL exposes
```

Questions: angela@savetheelephants.org
