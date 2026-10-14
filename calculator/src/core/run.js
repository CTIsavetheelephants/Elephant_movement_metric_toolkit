/* Whole job: extracted fixes -> automatic cleaning -> metrics per study area ->
 * output files. Used by the calculator's Web Worker. */
(function (G) {
  const EMT = (G.EMT = G.EMT || {});
  const VERSION = "1.2.0";

  /* settings: {studyArea, country, tz, sexByName: {name: 'female'|'male'|''},
   *            anonymise, organisation, compat, sourceFiles} */
  function runJob(fixesIn, settings, onProgress) {
    const say = (stage, frac) => onProgress && onProgress(stage, frac);
    const t0 = Date.now();
    say("Cleaning tracks", 0.02);
    const cl = EMT.clean.clean(fixesIn, {});
    const fixes = cl.fixes;

    // sex: user's table wins, else the most common value in the file
    const sexVotes = new Map();
    for (const f of fixes) if (f.sex) {
      const v = sexVotes.get(f.name) || { female: 0, male: 0 };
      v[f.sex]++; sexVotes.set(f.name, v);
    }
    const sexOf = (nm) => {
      const u = settings.sexByName && settings.sexByName[nm];
      if (u === "female" || u === "male") return u;
      const v = sexVotes.get(nm);
      return v ? (v.female >= v.male ? (v.female ? "female" : null) : "male") : null;
    };
    // optional pseudonyms, stable order (first fix)
    const firstT = new Map();
    for (const f of fixes) if (!firstT.has(f.name) || f.t < firstT.get(f.name)) firstT.set(f.name, f.t);
    const names = [...firstT.keys()].sort((a, b) => firstT.get(a) - firstT.get(b) || (a < b ? -1 : 1));
    const prefix = (settings.studyArea || "EL").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "EL";
    const alias = new Map(names.map((n, i) => [n, settings.anonymise ? `${prefix}_${String(i + 1).padStart(3, "0")}` : n]));
    for (const f of fixes) { f.sex = sexOf(f.name); }

    const bySA = new Map();
    for (const f of fixes) {
      // each elephant's study area as assigned on step 3 (whole elephant, not per row)
      const sa = (settings.studyAreaByName && settings.studyAreaByName[f.name]) ||
                 (settings.studyAreaFromColumn && f.sa) || settings.studyArea || "Study area";
      if (!bySA.has(sa)) bySA.set(sa, []);
      bySA.get(sa).push(f);
    }
    let rows = [];
    const saReports = [];
    let k = 0;
    for (const [sa, fx] of bySA) {
      const base = 0.1 + (0.88 * k) / bySA.size, span = 0.88 / bySA.size;
      const r = EMT.pipeline.metricsForStudyArea(fx.map((f) => ({ name: f.name, sex: f.sex, t: f.t, lon: f.lon, lat: f.lat })), {
        studyArea: sa, country: settings.country || "", tz: settings.tz || "UTC", sourceFiles: settings.sourceFiles || "",
        dataset: sa, compat: settings.compat,
        onProgress: (stage, f) => say(`${sa}: ${stage}`, base + span * f),
      });
      rows = rows.concat(r.rows);
      saReports.push(r.report);
      k++;
    }
    for (const r of rows) {
      if (r.Name !== null) r.Name = alias.get(r.Name) || r.Name;
      r.organisation = settings.organisation || "";
      r.tool_version = VERSION;
    }
    say("Done", 1);
    return {
      rows, cleaning: cl.report, removed: cl.removed, studyAreas: saReports, alias: settings.anonymise ? [...alias] : null,
      seconds: (Date.now() - t0) / 1000, version: VERSION,
    };
  }

  function removedCSV(removed, alias) {
    const a = alias ? new Map(alias) : null;
    const lines = ["name,timestamp_utc,lon,lat,reason"];
    for (const r of removed) {
      lines.push([JSON.stringify(a ? a.get(r.name) || r.name : r.name), new Date(r.t).toISOString(), r.lon, r.lat, r.flag].join(","));
    }
    return lines.join("\n") + "\n";
  }

  function reportText(res, settings) {
    const L = EMT.clean.LABELS, c = res.cleaning;
    const lines = [];
    lines.push("ELEPHANT MOVEMENT METRICS CALCULATOR - run report");
    lines.push(`Tool version ${res.version}   Run ${new Date().toISOString()}   (${res.seconds.toFixed(1)} s)`);
    lines.push(`Organisation: ${settings.organisation || "-"}   Study area: ${settings.studyArea || "-"}   Country: ${settings.country || "-"}`);
    lines.push(`Time zone: ${settings.tz}   Timestamps in file: ${settings.assumeUTC ? "UTC" : "local time"}`);
    lines.push(`Input file(s): ${settings.sourceFiles}`);
    lines.push("");
    lines.push("1. AUTOMATIC CLEANING");
    lines.push(`   Fixes read: ${c.nIn}   kept: ${c.nOut}   removed: ${c.nIn - c.nOut}`);
    if (Number.isFinite(c.medianIntervalH)) lines.push(`   Median fix interval: ${c.medianIntervalH.toFixed(2)} h`);
    for (const [k, v] of Object.entries(c.counts).sort((a, b) => b[1] - a[1])) lines.push(`   - ${v} : ${L[k] || k}`);
    if (c.collarSplits && c.collarSplits.length) lines.push(`   Individuals split by overlapping collars: ${c.collarSplits.map((s) => s.name).join(", ")}`);
    lines.push("");
    lines.push("2. METRICS");
    for (const s of res.studyAreas) {
      lines.push(`   Study area "${s.studyArea}": ${s.nIndividuals || 0} individual(s) resampled to 4 h, ${s.nSteps || 0} steps`);
      if (s.excluded && s.excluded.length) lines.push(`     Excluded (median fix interval > 6 h, cannot resample to 4 h): ${s.excluded.map((e) => e.name).join(", ")}`);
      if (s.duplicates && s.duplicates.length) lines.push(`     Same animal under two names, merged: ${s.duplicates.map((d) => d.dropped_name + " -> " + d.kept_name).join("; ")}`);
      if (s.stepQC) lines.push(`     Stuck-collar / repeated-position steps removed: ${s.stepQC.stationary_run + s.stepQC.zero_step}`);
      if (s.failedMetrics && s.failedMetrics.length) lines.push(`     Metrics that failed: ${s.failedMetrics.map((m) => m.metric).join(", ")}`);
    }
    const byMetric = new Map();
    for (const r of res.rows) byMetric.set(r.metric, (byMetric.get(r.metric) || 0) + 1);
    lines.push("");
    lines.push("   Values per metric:");
    for (const m of EMT.metrics.METRIC_ORDER) lines.push(`     ${m.padEnd(32)} ${byMetric.get(m) || 0}`);
    lines.push("");
    lines.push("The metrics file contains only summary values per individual-month or individual-year.");
    lines.push("It contains no coordinates or timestamps of fixes.");
    return lines.join("\n") + "\n";
  }

  EMT.run = { runJob, removedCSV, reportText, VERSION };
})(typeof globalThis !== "undefined" ? globalThis : self);
