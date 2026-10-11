// Release a new version of the calculator (README "How I release a new version"):
//
//   node release.js <version> "<what's new>" [--required]
//
//   e.g.  node release.js 1.2.0 "Clearer comparison overview"
//         node release.js 1.2.1 "Fixes a wrong home-range value" --required
//
// (In RStudio, use release_calculator.R instead - it runs this for you.)
// It:
//   1. sets the version in build.js and src/core/run.js
//   2. builds docs/index.html (node build.js) - the page GitHub Pages publishes
//   3. writes docs/version.json - the note every copy of the calculator checks
//   4. records the release in ../CHANGELOG.md
// and then reminds you to push the changes to GitHub, which publishes them.
//
// --required   copies older than this version are told they must update, and cannot
//              send results until they do. Without it the minimum stays as it was.
// Giving the CURRENT version rebuilds and rewrites version.json without bumping anything.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const here = (...p) => path.join(__dirname, ...p);

const args = process.argv.slice(2);
const required = args.includes("--required");
const [version, notes] = args.filter((a) => a !== "--required");
const usage = 'usage: node release.js <version> "<what\'s new>" [--required]';
if (!/^\d+\.\d+\.\d+$/.test(version || "")) { console.error(usage); process.exit(1); }
if (!notes || !notes.trim()) { console.error('Please describe what changed, e.g. "Clearer comparison overview".\n' + usage); process.exit(1); }

const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number);
                        for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const files = { build: here("build.js"), run: here("src", "core", "run.js") };
const buildSrc = fs.readFileSync(files.build, "utf8");
const current = (buildSrc.match(/version: "(\d+\.\d+\.\d+)"/) || [])[1];
if (!current) throw new Error("could not find the version in build.js");
if (cmp(version, current) < 0) { console.error(`${version} is older than the current version ${current}.`); process.exit(1); }

const rel = JSON.parse(fs.readFileSync(here("release.config.json"), "utf8"));
if (!rel.siteUrl) console.warn("note: siteUrl is empty in release.config.json - this build has no update check.");
if (!rel.receiverUrl) console.warn("note: receiverUrl is empty in release.config.json - Send uses e-mail.");

// ---- 1. set the version
if (version !== current) {
  fs.writeFileSync(files.build, buildSrc.replace(`version: "${current}"`, `version: "${version}"`));
  const runSrc = fs.readFileSync(files.run, "utf8");
  if (!runSrc.includes(`VERSION = "${current}"`)) throw new Error("src/core/run.js does not hold the current version " + current);
  fs.writeFileSync(files.run, runSrc.replace(`VERSION = "${current}"`, `VERSION = "${version}"`));
  console.log(`version ${current} -> ${version}`);
}

// ---- 2. build, 3. write the version note next to the page
execFileSync(process.execPath, [here("build.js")], { stdio: "inherit" });
const notePath = here("..", "docs", "version.json");
const prev = fs.existsSync(notePath) ? JSON.parse(fs.readFileSync(notePath, "utf8")) : {};
const note = {
  latest: version,
  min_version: required ? version : prev.min_version || "1.0.0",
  released: new Date().toISOString().slice(0, 10),
  notes: notes.trim(),
  download: rel.siteUrl ? rel.siteUrl.replace(/\/?$/, "/") : "",
};
fs.writeFileSync(notePath, JSON.stringify(note, null, 2) + "\n");

// ---- 4. changelog (newest first, under the title)
const logPath = here("..", "CHANGELOG.md");
const head = "# Changelog\n\nReleases of the Elephant Movement Metrics Calculator, newest first.\n";
const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : head;
const entry = `\n## ${version} (${note.released})${required ? " - required update" : ""}\n\n${note.notes}\n`;
const at = log.search(/\n## /);
fs.writeFileSync(logPath, at < 0 ? log.replace(/\n*$/, "\n") + entry : log.slice(0, at).replace(/\n*$/, "\n") + entry + log.slice(at));

console.log(`
Done: docs/index.html and docs/version.json (latest ${note.latest}, minimum ${note.min_version}), CHANGELOG.md updated.

Now push the changes to GitHub (e.g. in GitHub Desktop). GitHub Pages publishes them within a
few minutes; copies opened online then show "A newer version is available".
`);
