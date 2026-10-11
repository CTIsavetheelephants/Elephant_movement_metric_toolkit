/* Movement metrics - a line-by-line port of Elephant_metrics_shiny/scripts/metrics_udfixed.R
 * (prepare_metric_inputs + metric_* + build_metric_long_cti).
 *
 * compat flags reproduce two behaviours of the current R code so outputs match the
 * central metrics_long.csv exactly; flip them once the R pipeline is fixed:
 *   pointsUTC      : steps_to_points() drops the tz column, so prepare_metric_inputs()
 *                    falls back to UTC for every POINT-based calendar field (year, month,
 *                    day, ISO week, and the 06:00 "biological day", which therefore starts
 *                    06:00 UTC = 09:00 in East Africa). Step-based metrics use local time.
 *                    Weekly metrics label a week by the month of its first fix in the
 *                    timestamp column's own (local) zone.
 *   emdMaskFlip    : calc_emd_prev_year() applies the 95% isopleth mask positionally
 *                    across two differently ordered grids (vertically mirrored mask). */
(function (G) {
  const EMT = (G.EMT = G.EMT || {});
  const U = EMT.util, T = EMT.time, K = EMT.kde;
  const { meanOrNA, sdOrNA, seOrNA, countFinite, roundR, clamp01, diameter, groupBy, nDistinct } = U;
  const H6 = 6 * T.HOUR;

  const METRIC_ORDER = [
    "mean_speed", "night_day_speed_ratio", "night_speed", "day_speed", "net_displacement", "daily_msd",
    "straightness", "diurnality", "max_displacement", "out_back_idx_month", "weekly_net_displacement_month",
    "weekly_max_displacement_month", "max_yearly_displacement", "10day_net_displacement", "10day_max_displacement",
    "ud50_area_year", "ud95_area_year", "mcp_area_year", "intensity_of_use", "vi_prev_year_95ud",
    "mean_residence_time", "male_female_ba_overlap_year", "emd_year",
  ];
  const GRAN = { max_yearly_displacement: "year", ud50_area_year: "year", ud95_area_year: "year", mcp_area_year: "year",
                 intensity_of_use: "year", vi_prev_year_95ud: "year", male_female_ba_overlap_year: "year", emd_year: "year" };

  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

  // ---------------------------------------------------------------- prep
  function prepare(steps, tz, compat) {
    const sb = steps.map((s) => {
      const lp = T.localParts(s.t, tz);
      const [iy, iw] = T.isoWeek(lp.dayNum);
      return Object.assign({}, s, { year: lp.y, month: lp.m, day: lp.d, isoY: iy, isoW: iw });
    });
    const medStep = U.median(sb.map((s) => s.sl));
    const rtRadius = Number.isFinite(medStep) ? Math.max(250, Math.min(3000, 3 * medStep)) : NaN;

    const filt = (arr, keyFn, okFn) => {
      const g = groupBy(arr, keyFn), ok = new Set();
      for (const [k, v] of g) if (okFn(v)) ok.add(k);
      return arr.filter((r) => ok.has(keyFn(r)));
    };
    const ym = (r) => r.name + "|" + r.year + "|" + r.month;
    const stepsMonth = filt(sb, ym, (v) => nDistinct(v, (r) => r.day) >= 10);

    // points = step start positions (steps_to_points; burst ends are not kept)
    const ptz = compat.pointsUTC ? "UTC" : tz;
    const pb = sb.map((s) => {
      const lp = T.localParts(s.t, ptz);
      const [iy, iw] = T.isoWeek(lp.dayNum);
      const [by, bm, bd] = T.civilFromDays(T.localParts(s.t - H6, ptz).dayNum);
      return { name: s.name, sex: s.sex, t: s.t, x: s.x, y: s.y, year: lp.y, month: lp.m, day: lp.d,
               isoY: iy, isoW: iw, bioY: by, bioM: bm, bioD: bd };
    });
    const pointsBioMonth = filt(pb, (r) => r.name + "|" + r.bioY + "|" + r.bioM, (v) => nDistinct(v, (r) => r.bioD) >= 10);
    const pointsMonth = filt(pb, ym, (v) => v.length >= 20);
    const pointsWeek = filt(pb, (r) => r.name + "|" + r.isoY + "|" + r.isoW, (v) => v.length >= 10);
    const pointsYear = filt(pb, (r) => r.name + "|" + r.year, (v) => v.length >= 30 && nDistinct(v, (r) => r.month) >= 6);
    return { tz, compat, stepsBase: sb, stepsMonth, pointsBioMonth, pointsMonth, pointsWeek, pointsYear, rtRadius };
  }

  // step biological day: local date of (midpoint - 6 h)
  function stepBio(s, tz) {
    const [y, m, d] = T.civilFromDays(T.localParts(s.t + (s.dtSec * 1000) / 2 - H6, tz).dayNum);
    return { bioY: y, bioM: m, bioD: d };
  }

  // monthly summary of per-unit values: {key -> [values]} -> rows
  function summarise(map, digits, valueFirst) {
    const out = [];
    for (const [, g] of map) {
      const vals = g.vals;
      out.push({ name: g.name, sex: g.sex, year: g.year, month: g.month,
                 value: roundR(meanOrNA(vals), digits), n: countFinite(vals),
                 sd: roundR(sdOrNA(vals), digits), se: roundR(seOrNA(vals), digits) });
    }
    return out;
  }
  function addVal(map, r, year, month, v) {
    const k = r.name + "|" + year + "|" + month;
    let g = map.get(k);
    if (!g) map.set(k, (g = { name: r.name, sex: r.sex, year, month, vals: [] }));
    g.vals.push(v);
  }
  const byKey = (arr, fn) => groupBy(arr, fn);

  // ---------------------------------------------------------------- monthly step metrics
  function speedMetric(prep, filterDN) {
    const m = new Map();
    for (const s of prep.stepsMonth) if (!filterDN || s.dayNight === filterDN) addVal(m, s, s.year, s.month, s.speed);
    return summarise(m, 2);
  }
  function ndRatio(prep) {
    const days = new Map();
    for (const s of prep.stepsMonth) {
      if (s.dayNight !== "Day" && s.dayNight !== "Night") continue;
      const b = stepBio(s, prep.tz);
      const k = s.name + "|" + b.bioY + "|" + b.bioM + "|" + b.bioD;
      let g = days.get(k);
      if (!g) days.set(k, (g = { s, b, Day: [], DaySl: [], Night: [], NightSl: [] }));
      g[s.dayNight].push(s.speed); g[s.dayNight + "Sl"].push(s.sl);
    }
    const mon = new Map();
    for (const [, g] of days) {
      const md = meanOrNA(g.Day), mn = meanOrNA(g.Night);
      const sd = meanOrNA(g.DaySl), sn = meanOrNA(g.NightSl);
      const ok = Number.isFinite(md) && Number.isFinite(mn) && countFinite(g.Day) >= 2 && countFinite(g.Night) >= 2 && sd >= 25 && sn >= 25;
      addVal(mon, g.s, g.b.bioY, g.b.bioM, ok ? Math.log(mn / md) : NaN);
    }
    const out = [];
    for (const [, g] of mon) {
      const n = countFinite(g.vals);
      if (n < 10) continue;
      const gm = Math.exp(meanOrNA(g.vals));
      out.push({ name: g.name, sex: g.sex, year: g.year, month: g.month, value: roundR(gm, 3), n,
                 sd: roundR(gm * sdOrNA(g.vals), 3), se: roundR(gm * seOrNA(g.vals), 3) });
    }
    return out;
  }
  function straightness(prep) {
    const mon = new Map();
    for (const [, d] of byKey(prep.stepsMonth, (s) => s.name + "|" + s.year + "|" + s.month + "|" + s.day)) {
      if (d.length < 2) continue;
      let path = 0;
      for (const s of d) path += s.sl;
      const disp = dist(d[0], d[d.length - 1]);
      let v = path > 0 ? disp / path : NaN;
      v = Number.isFinite(v) && v <= 1 + 1e-6 ? Math.min(v, 1) : NaN;
      addVal(mon, d[0], d[0].year, d[0].month, v);
    }
    return summarise(mon, 3);
  }
  function diurnality(prep) {
    const days = new Map();
    for (const s of prep.stepsMonth) {
      if (s.dayNight !== "Day" && s.dayNight !== "Night") continue;
      const b = stepBio(s, prep.tz);
      const k = s.name + "|" + b.bioY + "|" + b.bioM + "|" + b.bioD;
      let g = days.get(k);
      if (!g) days.set(k, (g = { s, b, day: 0, night: 0, hasDay: false, hasNight: false }));
      if (s.dayNight === "Day") { g.day += s.sl; g.hasDay = true; } else { g.night += s.sl; g.hasNight = true; }
    }
    const mon = new Map();
    for (const [, g] of days) {
      if (!g.hasDay) continue;                      // left_join(day_m, night_m)
      const v = g.hasNight ? (g.day - g.night) / (g.day + g.night) : NaN;
      addVal(mon, g.s, g.b.bioY, g.b.bioM, v);
    }
    return summarise(mon, 3);
  }

  // ---------------------------------------------------------------- daily point metrics (bio day)
  function bioDays(prep) {
    return byKey(prep.pointsBioMonth, (p) => p.name + "|" + p.bioY + "|" + p.bioM + "|" + p.bioD);
  }
  function dailyPoint(prep, fn, digits) {
    const mon = new Map();
    for (const [, d] of bioDays(prep)) {
      const v = fn(d);
      if (v === undefined) continue;                // day dropped (filter n_fix >= 3)
      addVal(mon, d[0], d[0].bioY, d[0].bioM, v);
    }
    return summarise(mon, digits);
  }
  const netDisp = (d) => (d.length < 3 ? undefined : dist(d[0], d[d.length - 1]) / 1000);
  const msd = (d) => {
    if (d.length < 3) return NaN;                   // kept as NA (no filter in R)
    let s = 0;
    for (let i = 1; i < d.length; i++) s += ((d[i].x - d[0].x) ** 2 + (d[i].y - d[0].y) ** 2) / 1e6;
    return s / (d.length - 1);
  };
  const maxDisp = (d) => (d.length < 3 ? NaN : diameter(d.map((p) => p.x), d.map((p) => p.y)) / 1000);
  const outBack = (d) => {
    if (d.length < 3) return undefined;
    const net = dist(d[0], d[d.length - 1]) / 1000;
    let mx = -Infinity;
    for (const p of d) mx = Math.max(mx, dist(d[0], p) / 1000);
    return Number.isFinite(mx) && mx > 0 ? 1 - net / mx : NaN;
  };

  // ---------------------------------------------------------------- weekly / 10-day
  function weekly(prep, fn) {
    const mon = new Map();
    for (const [, w] of byKey(prep.pointsWeek, (p) => p.name + "|" + p.isoY + "|" + p.isoW)) {
      let t0 = Infinity;
      for (const p of w) t0 = Math.min(t0, p.t);
      const lp = T.localParts(t0, prep.tz);              // year/month of the week start, local zone
      const y = lp.y, m = lp.m;
      addVal(mon, w[0], y, m, fn(w));
    }
    return summarise(mon, 3);
  }
  function dekad(prep, fn) {
    const mon = new Map();
    for (const [, g] of byKey(prep.pointsMonth, (p) => p.name + "|" + p.year + "|" + p.month + "|" + (p.day <= 10 ? 1 : p.day <= 20 ? 2 : 3))) {
      if (g.length < 3) continue;
      addVal(mon, g[0], g[0].year, g[0].month, fn(g));
    }
    return summarise(mon, 3);
  }

  // ---------------------------------------------------------------- annual metrics
  function perIndYear(prep) { return byKey(prep.pointsYear, (p) => p.name + "|" + p.year); }
  const xsOf = (a) => Float64Array.from(a, (p) => p.x), ysOf = (a) => Float64Array.from(a, (p) => p.y);
  function annual(prep, fn) {
    const out = [];
    for (const [, g] of perIndYear(prep)) {
      const r = fn(g);
      out.push(Object.assign({ name: g[0].name, sex: g[0].sex, year: g[0].year, month: null, sd: NaN, se: NaN }, r));
    }
    return out;
  }
  function mcpKm2(g) { return g.length < 5 ? NaN : U.convexHullArea(g.map((p) => p.x), g.map((p) => p.y)) / 1e6; }
  function intensity(prep) {
    const path = new Map();
    for (const s of prep.stepsBase) {
      const k = s.name + "|" + s.year;
      path.set(k, (path.get(k) || 0) + (Number.isFinite(s.sl) ? s.sl : 0));
    }
    return annual(prep, (g) => {
      const mcp = mcpKm2(g), km = (path.get(g[0].name + "|" + g[0].year) || 0) / 1000;
      return { value: Number.isFinite(mcp) && mcp > 0 ? roundR(km / Math.sqrt(mcp), 4) : NaN, n: 1 };
    });
  }
  // years of one individual on one shared grid
  function sharedUDs(pts) {
    const years = [...new Set(pts.map((p) => p.year))].sort((a, b) => a - b);
    const grid = K.udGrid(xsOf(pts), ysOf(pts));
    const uds = new Map();
    for (const y of years) {
      const g = pts.filter((p) => p.year === y);
      uds.set(y, K.kernelUD(xsOf(g), ysOf(g), grid));
    }
    return { years, grid, uds };
  }
  function viPrevYear(prep) {
    const out = [];
    for (const [, pts] of byKey(prep.pointsYear, (p) => p.name)) {
      const yrs = new Set(pts.map((p) => p.year));
      if (yrs.size < 2) continue;
      const { years, grid, uds } = sharedUDs(pts);
      for (let i = 1; i < years.length; i++) {
        const v = clamp01(clamp01(K.overlapVI(uds.get(years[i]), uds.get(years[i - 1]), grid.cs)));
        out.push({ name: pts[0].name, sex: pts[0].sex, year: years[i], month: null, value: v, n: Number.isFinite(v) ? 1 : 0, sd: NaN, se: NaN });
      }
    }
    return out;
  }
  function emdYear(prep) {
    const out = [];
    for (const [, pts] of byKey(prep.pointsYear, (p) => p.name)) {
      const yrs = new Set(pts.map((p) => p.year));
      if (yrs.size < 2) continue;
      const { years, grid, uds } = sharedUDs(pts);
      const ras = years.map((y) => K.emdRaster(uds.get(y), K.volumeUD(uds.get(y), grid.cs), grid, 95, prep.compat.emdMaskFlip));
      const r0 = ras.find((r) => r);
      if (!r0) continue;
      const cx = new Float64Array(r0.bx * r0.by), cy = new Float64Array(r0.bx * r0.by);
      for (let br = 0; br < r0.by; br++) for (let bc = 0; bc < r0.bx; bc++) { cx[br * r0.bx + bc] = (bc + 0.5) * r0.size; cy[br * r0.bx + bc] = -(br + 0.5) * r0.size; }
      for (let i = 1; i < years.length; i++) {
        if (years[i] - years[i - 1] > 1 || !ras[i] || !ras[i - 1]) continue;
        let v;
        try { v = EMT.emd.emd(cx, cy, ras[i - 1].w, ras[i].w, 50000); } catch (e) { v = NaN; }
        if (!Number.isFinite(v)) continue;
        out.push({ name: pts[0].name, sex: pts[0].sex, year: years[i], month: null, value: v / 1000, n: 1, sd: NaN, se: NaN });
      }
    }
    return out;
  }
  function residenceTime(prep) {
    const R = prep.rtRadius, out = [];
    if (!Number.isFinite(R)) return out;
    for (const [, g0] of byKey(prep.pointsMonth, (p) => p.name + "|" + p.year + "|" + p.month)) {
      const g = g0.slice().sort((a, b) => a.t - b.t);
      const rt = [];
      for (let i = 0; i < g.length; i++) {
        const inside = [];
        for (let j = 0; j < g.length; j++) if (dist(g[i], g[j]) <= R) inside.push(j);
        let bout = 0, start = 0, myBout = -1;
        const bouts = [];
        for (let k = 0; k < inside.length; k++) {
          if (k > 0 && (g[inside[k]].t - g[inside[k - 1]].t) / T.HOUR > 12) { bouts.push([start, k - 1]); start = k; bout++; }
          if (inside[k] === i) myBout = bout;
        }
        bouts.push([start, inside.length - 1]);
        const [a, b] = bouts[myBout];
        rt.push((g[inside[b]].t - g[inside[a]].t) / T.HOUR);
      }
      out.push({ name: g[0].name, sex: g[0].sex, year: g[0].year, month: g[0].month, value: roundR(meanOrNA(rt), 3), n: g.length, sd: NaN, se: NaN });
    }
    return out;
  }
  function baOverlap(prep) {
    const out = [];
    for (const [, g] of byKey(prep.pointsYear, (p) => p.year)) {
      const f = g.filter((p) => p.sex === "female"), m = g.filter((p) => p.sex === "male");
      if (f.length < 20 || m.length < 20) continue;
      const both = f.concat(m);
      const grid = K.udGrid(xsOf(both), ysOf(both));
      const v = clamp01(K.overlapBA(K.kernelUD(xsOf(f), ysOf(f), grid), K.kernelUD(xsOf(m), ysOf(m), grid), grid.cs));
      if (!Number.isFinite(v)) continue;
      for (const sx of ["female", "male"]) out.push({ name: null, sex: sx, year: g[0].year, month: null, value: v, n: 1, sd: NaN, se: NaN });
    }
    return out;
  }

  // ---------------------------------------------------------------- driver
  const FUNS = {
    mean_speed: (p) => speedMetric(p, null),
    night_day_speed_ratio: ndRatio,
    night_speed: (p) => speedMetric(p, "Night"),
    day_speed: (p) => speedMetric(p, "Day"),
    net_displacement: (p) => dailyPoint(p, netDisp, 3),
    daily_msd: (p) => dailyPoint(p, msd, 4),
    straightness,
    diurnality,
    max_displacement: (p) => dailyPoint(p, maxDisp, 3),
    out_back_idx_month: (p) => dailyPoint(p, outBack, 4),
    weekly_net_displacement_month: (p) => weekly(p, (w) => dist(w[0], w[w.length - 1]) / 1000),
    weekly_max_displacement_month: (p) => weekly(p, (w) => (w.length < 2 ? NaN : diameter(w.map((q) => q.x), w.map((q) => q.y)) / 1000)),
    max_yearly_displacement: (p) => annual(p, (g) => ({ value: roundR(diameter(g.map((q) => q.x), g.map((q) => q.y)) / 1000, 3), n: g.length })),
    "10day_net_displacement": (p) => dekad(p, (g) => dist(g[0], g[g.length - 1]) / 1000),
    "10day_max_displacement": (p) => dekad(p, (g) => diameter(g.map((q) => q.x), g.map((q) => q.y)) / 1000),
    ud50_area_year: (p) => annual(p, (g) => ({ value: roundR(K.udAreaKm2(xsOf(g), ysOf(g), 50), 3), n: nDistinct(g, (q) => q.month) })),
    ud95_area_year: (p) => annual(p, (g) => ({ value: roundR(K.udAreaKm2(xsOf(g), ysOf(g), 95), 3), n: nDistinct(g, (q) => q.month) })),
    mcp_area_year: (p) => annual(p, (g) => ({ value: roundR(mcpKm2(g), 3), n: g.length })),
    intensity_of_use: intensity,
    vi_prev_year_95ud: viPrevYear,
    mean_residence_time: residenceTime,
    male_female_ba_overlap_year: baOverlap,
    emd_year: emdYear,
  };

  /* steps of ONE study area -> long rows (metrics_long.csv schema).
   * onMetric(name, i, n) reports progress. */
  function computeAll(steps, opts) {
    const o = Object.assign({ tz: "UTC", studyArea: "", dataset: null, country: "", sourceFiles: "",
                              compat: { pointsUTC: false, emdMaskFlip: false }, onMetric: null, metrics: METRIC_ORDER }, opts);
    const prep = prepare(steps, o.tz, o.compat);
    const rows = [], failed = [];
    o.metrics.forEach((m, i) => {
      if (o.onMetric) o.onMetric(m, i, o.metrics.length);
      let res;
      try { res = FUNS[m](prep); } catch (e) { failed.push({ metric: m, error: String(e && e.message || e) }); return; }
      for (const r of res) {
        rows.push({ Dataset: o.dataset || o.studyArea, Study_Area: o.studyArea, Name: r.name, Sex: r.sex, year: r.year,
                    month: GRAN[m] ? null : r.month, metric: m, value: r.value, granularity: GRAN[m] || "month",
                    n_units: r.n, sd_units: r.sd, se_units: r.se, source_files: o.sourceFiles, country: o.country });
      }
    });
    return { rows, failed, rtRadius: prep.rtRadius };
  }

  const COLUMNS = ["Dataset", "Study_Area", "Name", "Sex", "year", "month", "metric", "value", "granularity",
                   "n_units", "sd_units", "se_units", "source_files", "country"];
  EMT.metrics = { METRIC_ORDER, GRAN, COLUMNS, prepare, computeAll, FUNS };
})(typeof globalThis !== "undefined" ? globalThis : self);
