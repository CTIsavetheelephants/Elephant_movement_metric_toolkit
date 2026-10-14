// Build the single, self-contained, offline calculator page:
//   node build.js            -> ../docs/index.html  (the page GitHub Pages publishes)
// Everything (core, worker, UI, SheetJS for Excel, clock-check template and - only when
// comparisons are switched on - the reference summaries) is inlined, so a saved copy of
// the page opens by double-click with no internet.
//
// Settings come from release.config.json (see README "Releasing a new version"):
//   siteUrl         the GitHub Pages address. Saved copies read siteUrl + "version.json"
//                   for the update check, and the update banner links to siteUrl
//   receiverUrl     Apps Script receiver URL (receiver/README.md), used by the Send button
//                   only; empty = e-mail fallback
//   sendEmail       address for the e-mail fallback
//   compareEnabled  false = "Compare with other populations" is shown greyed out ("Coming
//                   soon") and NO reference summaries are put in the page.
//                   true  = the comparison views are on and the reference summaries ARE
//                   embedded in the published (public) page
//   referencePath   where build_reference.R wrote reference_summaries.json (relative to
//                   this folder; kept OUTSIDE the repo). Only read when compareEnabled
// Environment variables override them for a one-off build:
//   EMT_SEND_URL, EMT_SEND_EMAIL, EMT_SITE_URL, EMT_REF (reference summaries JSON)
// To release a new version use release_calculator.R / release.js (bumps the version, then runs this).
const fs = require("fs");
const path = require("path");
const here = (...p) => path.join(__dirname, ...p);
const read = (...p) => fs.readFileSync(here(...p), "utf8");
const REL = fs.existsSync(here("release.config.json")) ? JSON.parse(read("release.config.json")) : {};

const siteUrl = (process.env.EMT_SITE_URL || REL.siteUrl || "").replace(/\/?$/, "/");
const CONFIG = {
  version: "1.2.0",
  sendUrl: process.env.EMT_SEND_URL || REL.receiverUrl || "",
  sendEmail: process.env.EMT_SEND_EMAIL || REL.sendEmail || "angela@savetheelephants.org",
  siteUrl: siteUrl === "/" ? "" : siteUrl,
  compare: REL.compareEnabled === true,
  ref: process.env.EMT_REF || path.resolve(__dirname, REL.referencePath || "reference/private/reference_summaries.json"),
  diel: here("reference", "diel_template.json"),
};
const OUT_DIR = here("..", "docs");
const CORE = ["util.js", "time.js", "utm.js", "tzlookup.js", "steps.js", "kde.js", "emd.js", "metrics.js",
              "pipeline.js", "parse.js", "clean.js", "run.js", "compare.js", "diel.js"];
const MAIN_CORE = ["util.js", "time.js", "parse.js", "compare.js"];   // needed on the page itself (saved-file view)
const noClose = (s) => s.replace(/<\/script/gi, "<\/script");

const xlsxPath = here("vendor", "xlsx.full.min.js");
const vendor = fs.existsSync(xlsxPath) ? fs.readFileSync(xlsxPath, "utf8") + "\n" : "";
if (!vendor) console.warn("note: vendor/xlsx.full.min.js not found - Excel files will not be readable (CSV only)");

// Reference summaries: ONLY read and embedded when comparisons are switched on.
let ref = "";
if (CONFIG.compare) {
  if (fs.existsSync(CONFIG.ref)) {
    ref = JSON.stringify(JSON.parse(fs.readFileSync(CONFIG.ref, "utf8"))).replace(/</g, "\u003c");
    console.warn("NOTE: compareEnabled is true - the pooled reference summaries are embedded in docs/index.html, which is PUBLIC once pushed.");
  } else console.warn(`note: compareEnabled is true but ${CONFIG.ref} was not found - the "Compare with other populations" view will be empty`);
}

const core = CORE.map((f) => `/* ---- ${f} ---- */\n` + read("src", "core", f)).join("\n");
const workerSrc = noClose(vendor + core + "\n" + read("src", "ui", "worker.js"));
const app = noClose(
  MAIN_CORE.map((f) => read("src", "core", f)).join("\n") + "\n" + read("src", "ui", "charts.js") + "\n" + read("src", "ui", "defs.js") + "\n" +
  read("src", "ui", "explore.js") + "\n" +
  read("src", "ui", "app.js").replace("__VERSION__", CONFIG.version).replace("__SEND_URL__", CONFIG.sendUrl)
    .replace("__SEND_EMAIL__", CONFIG.sendEmail).replace("__SITE_URL__", CONFIG.siteUrl)
    .replace("__COMPARE__", CONFIG.compare ? "on" : "off"));

if (!read("src", "core", "run.js").includes(`VERSION = "${CONFIG.version}"`)) throw new Error("version mismatch between build.js and core/run.js");

const html = read("src", "ui", "template.html")
  .replace("/*__CSS__*/", () => read("src", "ui", "style.css"))
  .replace("/*__REF__*/", () => ref)
  .replace("/*__DIEL__*/", () => (fs.existsSync(CONFIG.diel) ? JSON.stringify(JSON.parse(fs.readFileSync(CONFIG.diel, "utf8"))) : ""))
  .replace("/*__WORKER__*/", () => workerSrc)
  .replace("/*__APP__*/", () => app);
// refuse to write a page whose scripts do not parse (a syntax error = a blank, dead page)
for (const [label, code] of [["worker", workerSrc], ["page", app]]) {
  try { new Function(code); } catch (e) { throw new Error(`build stopped: syntax error in ${label} script - ${e.message}`); }
}
// privacy guard: with comparisons off, the page must not carry any reference data
if (!CONFIG.compare && !/<script type="application\/json" id="ref-data"><\/script>/.test(html))
  throw new Error("build stopped: reference data found in the page although compareEnabled is false");
fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, "index.html");
fs.writeFileSync(out, html);
fs.writeFileSync(path.join(OUT_DIR, ".nojekyll"), "");   // GitHub Pages: serve files as they are
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB; Excel ${vendor ? "yes" : "no"}; ` +
            `compare ${CONFIG.compare ? "ON, reference " + (ref ? JSON.parse(ref).meta.n_study_areas + " study areas" : "none") : "off (coming soon; no reference data)"}; ` +
            `send ${CONFIG.sendUrl ? "direct" : "e-mail fallback"}; update check ${CONFIG.siteUrl ? CONFIG.siteUrl + "version.json" : "off (no siteUrl)"})`);
