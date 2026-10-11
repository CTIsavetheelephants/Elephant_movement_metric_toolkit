/* Clock check: are a file's timestamps UTC or local time?
 * Elephants have a consistent daily movement rhythm. We fit the rhythm of the
 * user's data with the clock read "as if UTC" (speed vs local mean solar time =
 * UTC + longitude/15) and find the time shift that best matches the STE template
 * (calculator/reference/build_diel_template.R). A best shift near 0 h means UTC; a
 * shift near the study area's time-zone offset (e.g. +3 h in Kenya) means the
 * clock is local time. Same method as Elephant_metrics_shiny/timezone_examination. */
(function (G) {
  const EMT = (G.EMT = G.EMT || {});
  const HOUR = 3600000, RAD = Math.PI / 180;

  function hav(lon1, lat1, lon2, lat2) {
    const a = Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  // least-squares harmonic curve (K harmonics) evaluated on the template grid, standardised
  function curve(h, y, K, grid) {
    const P = 2 * K + 1, A = Array.from({ length: P }, () => new Float64Array(P)), b = new Float64Array(P), row = new Float64Array(P);
    const fill = (x) => { row[0] = 1; for (let k = 1; k <= K; k++) { row[2 * k - 1] = Math.cos((2 * Math.PI * k * x) / 24); row[2 * k] = Math.sin((2 * Math.PI * k * x) / 24); } };
    for (let i = 0; i < h.length; i++) {
      fill(h[i]);
      for (let r = 0; r < P; r++) { b[r] += row[r] * y[i]; for (let c = 0; c < P; c++) A[r][c] += row[r] * row[c]; }
    }
    for (let c = 0; c < P; c++) {                     // Gaussian elimination with pivoting
      let p = c;
      for (let r = c + 1; r < P; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-9) return null;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for (let r = 0; r < P; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < P; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
    }
    const coef = Array.from(b, (v, i) => v / A[i][i]);
    const f = grid.map((x) => { fill(x); let s = 0; for (let k = 1; k < P; k++) s += coef[k] * row[k]; return s; });
    const m = f.reduce((a, c) => a + c, 0) / f.length, sd = Math.sqrt(f.reduce((a, c) => a + (c - m) ** 2, 0) / (f.length - 1));
    return sd > 0 ? f.map((v) => (v - m) / sd) : null;
  }
  function cor(a, b) {
    const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
    return sab / Math.sqrt(saa * sbb);
  }
  // correlation of curve(h) with template(h - s), for s in -6..6 h
  function shiftProfile(cv, tpl, step) {
    const n = tpl.length, out = [];
    for (let s = -6; s <= 6 + 1e-9; s += step) {
      const k = Math.round(s / step);
      out.push([s, cor(cv, cv.map((_, i) => tpl[(((i - k) % n) + n) % n]))]);
    }
    return out;
  }

  /* fixes: [{name, t, lon, lat}] with t computed under the user's current choice
   * (assumeUTC true -> t is the clock as written). Returns a verdict object. */
  function checkClock(fixes, opts) {
    const tpl = opts.template && opts.template.grid;
    if (!tpl) return { verdict: "unavailable" };
    const step = opts.template.step_h || 0.25, grid = tpl.map((_, i) => i * step);
    const tz = opts.tz || "UTC";
    const byName = new Map();
    for (const f of fixes) (byName.get(f.name) || byName.set(f.name, []).get(f.name)).push(f);
    const h = [], y = [], dts = [], contrib = new Set();
    const every = Math.max(1, Math.floor(fixes.length / 400000));    // cap work on huge files
    for (const fx of byName.values()) {
      fx.sort((a, b) => a.t - b.t);
      for (let i = 0; i + 1 < fx.length; i += every) {
        const a = fx[i], b = fx[i + 1], dt = (b.t - a.t) / HOUR;
        if (!(dt >= 0.25 && dt <= 4.5)) continue;
        const mid = (a.t + b.t) / 2;
        const wall = opts.assumeUTC ? mid : mid + EMT.time.tzOffset(tz, mid);     // the clock as written, read as UTC
        h.push((((wall / HOUR) % 24) + a.lon / 15 + 48) % 24);
        y.push(hav(a.lon, a.lat, b.lon, b.lat) / dt);
        dts.push(dt); contrib.add(a.name);
      }
    }
    // a rhythm estimate needs plenty of steps: one 4-hourly elephant (~600 steps,
    // e.g. Mana Pools) gave a spurious +3 h shift
    if (h.length < 2000) return { verdict: "unclear", reason: "not enough data to judge the daily rhythm", nSteps: h.length };
    const nInd = contrib.size;
    const K = EMT.util.median(dts) > 2.5 ? 2 : 3;
    const cv = curve(h, y, K, grid);
    if (!cv) return { verdict: "unclear", reason: "too few times of day", nSteps: h.length };
    const prof = shiftProfile(cv, tpl, step);
    const best = prof.reduce((a, b) => (b[1] > a[1] ? b : a));
    const midT = fixes[Math.floor(fixes.length / 2)].t;
    const offH = EMT.time.tzOffset(tz, midT) / HOUR;
    const rAt = (s) => prof.reduce((a, b) => (Math.abs(b[0] - s) < Math.abs(a[0] - s) ? b : a))[1];
    const out = { shift: best[0], corr: best[1], offsetH: offH, rUTC: rAt(0), rLocal: rAt(offH), nSteps: h.length };
    if (Math.abs(offH) < 0.5) return Object.assign(out, { verdict: "either" });
    // Thresholds from the leave-one-out test on STE's 64 cleaned files: true clocks
    // land within +/-1 h of the right answer in 56/64 files (forest sites lean
    // early, some savannah sites late), so only call it when the gap is clear.
    const dU = Math.abs(best[0]), dL = Math.abs(best[0] - offH);
    const near = Math.min(dU, dL), far = Math.max(dU, dL);
    if (best[1] < 0.6 || near > 1.5) return Object.assign(out, { verdict: "unclear", reason: "the daily rhythm does not clearly match either" });
    const verdict = dU <= dL ? "utc" : "local";
    if (near <= 0.75 && far >= 1.75) return Object.assign(out, { verdict, confidence: "high" });
    // individual rhythms differ by up to ~1 h, so a borderline call needs several elephants
    if (far - near >= 1 && nInd >= 3) return Object.assign(out, { verdict, confidence: "moderate" });
    return Object.assign(out, { verdict: "unclear", reason: "the rhythm falls between the two" });
  }

  EMT.diel = { checkClock, curve, shiftProfile };
})(typeof globalThis !== "undefined" ? globalThis : self);
