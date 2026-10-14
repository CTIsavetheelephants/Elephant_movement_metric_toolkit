/* Web Worker: all file reading, cleaning and metric work happens here so the page
 * stays responsive. The core (EMT.*) is prepended to this file at build time. */
let state = { files: [], excel: null, fixes: null, headers: null, mapping: null, primary: 0, history: new Set() };

/* "Combined tracking data" file: every fix the user loaded, written by makeHistory()
 * after a run so it can be loaded again next time with a new download. Recognised by
 * its exact header and always read with this fixed mapping (times are UTC, "Z"). */
const HISTORY_COLS = ["name", "tag", "sex", "study_area", "timestamp_utc", "lon", "lat"];
const isHistoryHeader = (h) => h.map((c) => String(c).trim()).join(",") === HISTORY_COLS.join(",");
const HISTORY_MAPPING = {
  cols: { id: 0, tag: 1, sex: 2, studyArea: 3, timestamp: 4, date: -1, time: -1, lon: 5, lat: 6, x: -1, y: -1, geometry: -1, species: -1 },
  coordMode: "lonlat", dateOrder: "dmy", assumeUTC: true, tz: "UTC", speciesFilter: false,
};
async function firstRow(file) {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (EMT.parse.isExcel(head)) return null;
  let row = null;
  await EMT.parse.streamCSV(file, (r) => { if (!row) row = r; }, { maxRows: 1 });
  return row;
}

const post = (msg) => self.postMessage(msg);
const progress = (stage, frac) => post({ cmd: "progress", stage, frac });

async function readHead(file, n) {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (EMT.parse.isExcel(head)) {
    const rows = await EMT.parse.readExcel(file);
    return { excel: rows, headers: (rows[0] || []).map(String), sample: rows.slice(1, n + 1) };
  }
  let headers = null;
  const sample = [];
  await EMT.parse.streamCSV(file, (r) => { if (!headers) headers = r; else sample.push(r); }, { maxRows: n + 1 });
  return { excel: null, headers: headers || [], sample };
}

async function preview(files) {
  state = { files, excel: null, fixes: null, primary: 0, history: new Set() };
  for (let i = 0; i < files.length; i++) { const r = await firstRow(files[i]); if (r && isHistoryHeader(r)) state.history.add(i); }
  // columns are checked on the first file that is NOT a combined tracking data file
  const prim = files.findIndex((_, i) => !state.history.has(i));
  state.primary = prim >= 0 ? prim : 0;
  const h = await readHead(files[state.primary], 3000);
  state.excel = h.excel;
  state.headers = h.headers;
  const det = EMT.parse.detectColumns(h.headers, h.sample);
  let lookup = null, utm = null;
  const c = det.cols;
  const num = (v) => (typeof v === "number" ? v : parseFloat(String(v).replace(",", ".")));
  if (det.coordMode === "lonlat" || det.coordMode === "xy_degrees") {
    const lo = det.coordMode === "lonlat" ? c.lon : c.x, la = det.coordMode === "lonlat" ? c.lat : c.y;
    lookup = EMT.tzlookup.lookup(h.sample.map((r) => num(r[lo])), h.sample.map((r) => num(r[la])));
  } else if (det.coordMode === "wkt") {
    const p = h.sample.map((r) => EMT.parse.WKT.exec(String(r[c.geometry]))).filter(Boolean);
    lookup = EMT.tzlookup.lookup(p.map((m) => +m[1]), p.map((m) => +m[2]));
  } else if (det.coordMode === "utm") {
    const s = h.sample.slice(0, 200);
    utm = EMT.parse.suggestUtmZone(s.map((r) => num(r[c.x])), s.map((r) => num(r[c.y])));
    if (utm) {
      const ll = s.map((r) => EMT.utm.unproject(num(r[c.x]), num(r[c.y]), utm.zone, utm.south));
      lookup = EMT.tzlookup.lookup(ll.map((p) => p[0]), ll.map((p) => p[1]));
    }
  }
  post({ cmd: "preview", headers: h.headers, sample: h.sample.slice(0, 8).map((r) => r.map((v) => (v === null || v === undefined ? "" : String(v)))),
         det, lookup, utm, allTZ: EMT.tzlookup.ALL_TZ, nFiles: files.length,
         primaryName: files[state.primary].name, nHistory: state.history.size, onlyHistory: prim < 0 });
}

async function scan(mapping, template) {
  state.mapping = mapping;
  const fixes = [], dropped = {};
  let nHistoryFixes = 0;
  const add = (res, hist) => {
    for (const f of res.fixes) { if (hist) { f.hist = true; nHistoryFixes++; } fixes.push(f); }
    for (const [k, v] of Object.entries(res.dropped)) dropped[k] = (dropped[k] || 0) + v;
  };
  for (let fi = 0; fi < state.files.length; fi++) {
    const file = state.files[fi];
    const label = state.files.length > 1 ? `Reading file ${fi + 1} of ${state.files.length}` : "Reading file";
    let colMap = null;   // later files may order their columns differently
    const remap = (hdr) => {
      const idx = hdr.map(String);
      const m = {};
      for (const [k, i] of Object.entries(mapping.cols)) m[k] = i >= 0 ? idx.indexOf(state.headers[i]) : -1;
      return m;
    };
    if (state.history.has(fi)) {       // combined tracking data file: fixed mapping
      let batch = [], first = true;
      await EMT.parse.streamCSV(file, (r) => {
        if (first) { first = false; return; }
        batch.push(r);
        if (batch.length >= 50000) { add(EMT.parse.extractFixes(batch, HISTORY_MAPPING), true); batch = []; }
      }, { onProgress: (f) => progress(label, f) });
      if (batch.length) add(EMT.parse.extractFixes(batch, HISTORY_MAPPING), true);
      continue;
    }
    if (fi === state.primary && state.excel) {
      add(EMT.parse.extractFixes(state.excel.slice(1), mapping));
      progress(label, 1);
      continue;
    }
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (EMT.parse.isExcel(head)) {
      const rows = await EMT.parse.readExcel(file);
      add(EMT.parse.extractFixes(rows.slice(1), Object.assign({}, mapping, { cols: remap(rows[0] || []) })));
      continue;
    }
    let batch = [], first = true;
    await EMT.parse.streamCSV(file, (r) => {
      if (first) { first = false; colMap = remap(r); return; }
      batch.push(r);
      if (batch.length >= 50000) { add(EMT.parse.extractFixes(batch, Object.assign({}, mapping, { cols: colMap }))); batch = []; }
    }, { onProgress: (f) => progress(label, f) });
    if (batch.length) add(EMT.parse.extractFixes(batch, Object.assign({}, mapping, { cols: colMap })));
  }
  state.fixes = fixes;
  // per-individual summary for the sex / review table
  const ind = new Map();
  for (const f of fixes) {
    let g = ind.get(f.name);
    if (!g) ind.set(f.name, (g = { name: f.name, n: 0, first: f.t, last: f.t, female: 0, male: 0, sa: new Map() }));
    g.n++;
    if (f.t < g.first) g.first = f.t;
    if (f.t > g.last) g.last = f.t;
    if (f.sex) g[f.sex]++;
    if (f.sa) g.sa.set(f.sa, (g.sa.get(f.sa) || 0) + 1);
  }
  // the clock check looks only at the newly loaded files (a combined tracking data
  // file is already in UTC); with only combined files there is nothing to check
  const newFixes = nHistoryFixes ? fixes.filter((f) => !f.hist) : fixes;
  const clock = mapping.explicitZone || !newFixes.length ? { verdict: "explicit" }
    : EMT.diel.checkClock(newFixes, { template, tz: mapping.tz, assumeUTC: mapping.assumeUTC });
  const lookup = fixes.length ? EMT.tzlookup.lookup(fixes.map((f) => f.lon), fixes.map((f) => f.lat)) : null;
  const sas = new Set(fixes.map((f) => f.sa).filter(Boolean));
  post({
    cmd: "scanned", nFixes: fixes.length, nHistoryFixes, dropped, lookup, clock, studyAreas: [...sas].slice(0, 50),
    individuals: [...ind.values()].sort((a, b) => (a.name < b.name ? -1 : 1)).map((g) => ({
      name: g.name, n: g.n, first: g.first, last: g.last,
      sex: g.female || g.male ? (g.female >= g.male ? "female" : "male") : "",
      sexConflict: g.female > 0 && g.male > 0,
      sa: [...g.sa].sort((a, b) => b[1] - a[1]).map((x) => x[0])[0] || "",   // study area of most of its rows
    })),
  });
}

function run(settings) {
  const fixes = state.fixes.map((f) => Object.assign({}, f));
  const res = EMT.run.runJob(fixes, settings, progress);
  const extra = ["organisation", "tool_version"];
  const metricsCSV = EMT.pipeline.rowsToCSV(res.rows, extra);
  const report = EMT.run.reportText(res, settings);
  const removed = EMT.run.removedCSV(res.removed, res.alias);
  const aliasCSV = res.alias ? "original_name,code\n" + res.alias.map(([a, b]) => `${JSON.stringify(a)},${b}`).join("\n") + "\n" : null;
  // compact summary for the results screen
  const coverage = {};
  for (const r of res.rows) {
    if (r.metric !== "mean_speed") continue;
    (coverage[r.Name] = coverage[r.Name] || []).push([r.year, r.month, r.value]);
  }
  const perMetric = {};
  for (const r of res.rows) perMetric[r.metric] = (perMetric[r.metric] || 0) + 1;
  post({
    cmd: "done", metricsCSV, report, removed, aliasCSV, perMetric, coverage, rows: res.rows, alias: !!res.alias,
    cleaning: res.cleaning, studyAreas: res.studyAreas, nRows: res.rows.length, seconds: res.seconds, version: res.version,
  });
}

/* Every fix the user loaded (all files, BEFORE cleaning, exact repeats removed) as one
 * "combined tracking data" CSV, with the sex and study area confirmed on step 3. */
function makeHistory(settings) {
  const sexBy = settings.sexByName || {}, saBy = settings.studyAreaByName || {};
  const fx = state.fixes.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.t - b.t));
  const q = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [HISTORY_COLS.join(",")];
  let prev = null;
  for (const f of fx) {
    if (prev && prev.name === f.name && prev.t === f.t) continue;
    prev = f;
    const sex = sexBy[f.name] === "female" || sexBy[f.name] === "male" ? sexBy[f.name] : f.sex || "";
    const sa = saBy[f.name] || f.sa || settings.studyArea || "";
    lines.push([q(f.name), q(f.tag || ""), sex, q(sa), new Date(f.t).toISOString(), f.lon, f.lat].join(","));
  }
  post({ cmd: "history", csv: lines.join("\n") + "\n" });
}

self.onmessage = async (e) => {
  try {
    const d = e.data;
    if (d.cmd === "preview") await preview(d.files);
    else if (d.cmd === "scan") await scan(d.mapping, d.template);
    else if (d.cmd === "run") run(d.settings);
    else if (d.cmd === "history") makeHistory(d.settings);
  } catch (err) {
    post({ cmd: "error", message: (err && err.message) || String(err) });
  }
};
