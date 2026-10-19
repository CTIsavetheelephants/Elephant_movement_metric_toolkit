/* Clean fixes of one study area -> metrics. Mirrors the per-study-area body of
 * compute_metrics_from_cleaned.R: project to the study area's UTM zone, merge the
 * same animal exported under two names, drop collars too coarse for 4 h, build the
 * 4 h steps, compute every metric. */
(function (G) {
  const EMT = (G.EMT = G.EMT || {});

  function byName(fixes) {
    const m = new Map();
    for (const f of fixes) {
      let g = m.get(f.name);
      if (!g) m.set(f.name, (g = []));
      g.push(f);
    }
    for (const g of m.values()) g.sort((a, b) => a.t - b.t);
    return m;
  }

  /* fixes: [{name, sex ('female'|'male'|null), t, lon, lat}] for ONE study area.
   * opts: {studyArea, country, tz, sourceFiles, compat, onProgress(stage, frac)} */
  function metricsForStudyArea(fixes, opts) {
    const o = Object.assign({ tz: "UTC", compat: { pointsUTC: false, emdMaskFlip: false } }, opts);
    const say = (s, f) => o.onProgress && o.onProgress(s, f);
    const report = { studyArea: o.studyArea, nFixesIn: fixes.length };

    const zone = EMT.utm.zoneFor(fixes.map((f) => f.lon), fixes.map((f) => f.lat));
    for (const f of fixes) { const p = EMT.utm.project(f.lon, f.lat, zone); f.x = p[0]; f.y = p[1]; }
    report.utmEpsg = zone.epsg;

    // median-gap exclusion is computed on the names as supplied (before merging)
    const gx = EMT.steps.medianGapExclusion(byName(fixes), o.maxResampleGapH || 6);
    say("Checking for duplicate animals", 0.05);
    const dd = EMT.steps.dedupIndividuals(fixes.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.t - b.t)));
    report.duplicates = dd.report;
    report.excluded = gx.excluded;
    const kept = dd.fixes.filter((f) => gx.include.has(f.name));
    const groups = byName(kept);

    say("Resampling to 4-hour steps", 0.1);
    let steps = [];
    const qc = { zero_step: 0, stationary_run: 0 };
    let i = 0;
    for (const [, fx] of groups) {
      const r = EMT.steps.individualSteps(fx, o.tz);
      steps = steps.concat(r.steps);
      qc.zero_step += r.qc.zero_step; qc.stationary_run += r.qc.stationary_run;
      say("Resampling to 4-hour steps", 0.1 + 0.1 * (++i / groups.size));
    }
    report.stepQC = qc;
    report.nIndividuals = groups.size;
    report.nSteps = steps.length;
    if (!steps.length) return { rows: [], failed: [], report, tracks: {} };
    // 4 h positions per elephant (step starts, metres in this study area's UTM zone) for
    // the net squared displacement figure; never written to any output file
    const tracks = {};
    for (const s of steps) (tracks[s.name] = tracks[s.name] || []).push(s.t, s.x, s.y);
    for (const n of Object.keys(tracks)) tracks[n] = Float64Array.from(tracks[n]);

    const res = EMT.metrics.computeAll(steps, {
      tz: o.tz, studyArea: o.studyArea, dataset: o.dataset, country: o.country, sourceFiles: o.sourceFiles, compat: o.compat,
      onMetric: (m, k, n) => say("Computing " + m, 0.2 + 0.8 * (k / n)),
    });
    report.rtRadiusM = res.rtRadius;
    report.failedMetrics = res.failed;
    return { rows: res.rows, failed: res.failed, report, tracks };
  }

  function rowsToCSV(rows, extraCols) {
    const cols = EMT.metrics.COLUMNS.concat(extraCols || []);
    const esc = (v) => {
      if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) return "";
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.join(",")];
    for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(","));
    return lines.join("\n") + "\n";
  }

  EMT.pipeline = { metricsForStudyArea, rowsToCSV, byName };
})(typeof globalThis !== "undefined" ? globalThis : self);
