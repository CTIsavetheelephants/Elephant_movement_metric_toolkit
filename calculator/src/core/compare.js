/* Summaries for "Compare with other populations". The user's own population is
 * summarised exactly like the embedded reference groups
 * (calculator/reference/build_reference.R):
 *   year  : per elephant-year mean (of monthly values), then mean / SE across elephants
 *   global: per elephant mean of its elephant-year means, then across elephants
 *           (+ the individual elephant values, for plotting)
 *   month : per elephant x calendar-month mean across years, then across elephants
 *   sexes : All, Female, Male.   BA overlap: one value per study area-year.
 * The reference holds only pooled group summaries - no study areas, no elephants. */
(function (G) {
  const EMT = (G.EMT = G.EMT || {});
  const SEX = ["All", "Female", "Male"];
  const sexOf = (s) => (s === "female" || s === "Female" ? "Female" : s === "male" || s === "Male" ? "Male" : "Unknown");
  const num = (v) => (v === "" || v === null || v === undefined ? NaN : +v);

  function cellStats(vals) {
    const n = vals.length, m = vals.reduce((a, b) => a + b, 0) / n;
    const sd = n > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : NaN;
    return { n, m, se: n > 1 ? sd / Math.sqrt(n) : null };
  }
  // pop(row) -> population label (default: Study_Area); elephants are Study_Area|Name
  function summarise(rows, metric, scale, pop) {
    pop = pop || ((r) => r.Study_Area);
    const v = rows.filter((r) => r.metric === metric && Number.isFinite(num(r.value)));
    if (!v.length) return [];
    const out = [];
    const push = (cells) => {
      for (const c of cells.values()) {
        const s = cellStats(c.vals);
        out.push({ pop: c.pop, sex: c.sex, period: c.period, n: s.n, m: s.m, se: s.se, vals: scale === "global" ? c.vals : undefined });
      }
    };
    const addTo = (cells, popId, sex, period, val) => {
      for (const sx of sex === "Unknown" ? ["All"] : ["All", sex]) {
        const k = popId + "\u0001" + sx + "\u0001" + period;
        let c = cells.get(k);
        if (!c) cells.set(k, (c = { pop: popId, sex: sx, period, vals: [] }));
        c.vals.push(val);
      }
    };
    if (metric === "male_female_ba_overlap_year") {      // population-level values
      const sy = new Map();
      for (const r of v) sy.set(pop(r) + "\u0001" + r.Study_Area + "\u0001" + r.year, { pop: pop(r), sa: r.Study_Area, year: +r.year, val: num(r.value) });
      const cells = new Map();
      if (scale === "year") for (const s of sy.values()) addTo(cells, s.pop, "Unknown", s.year, s.val);
      else if (scale === "global") {
        const bySite = new Map();
        for (const s of sy.values()) { const k = s.pop + "\u0001" + s.sa; (bySite.get(k) || bySite.set(k, { pop: s.pop, a: [] }).get(k)).a.push(s.val); }
        for (const b of bySite.values()) addTo(cells, b.pop, "Unknown", 0, b.a.reduce((x, y) => x + y, 0) / b.a.length);
      }
      push(cells);
      return out;
    }
    if (scale === "month" && v.some((r) => r.granularity !== "month")) return [];
    // stage 1: one value per elephant per period
    const ind = new Map();
    for (const r of v) {
      const per = scale === "month" ? num(r.month) : +r.year;
      if (!Number.isFinite(per)) continue;
      const k = [pop(r), r.Study_Area, r.Name, per].join("\u0001");
      let g = ind.get(k);
      if (!g) ind.set(k, (g = { pop: pop(r), ele: r.Study_Area + "|" + r.Name, sex: sexOf(r.Sex), period: per, s: 0, n: 0 }));
      g.s += num(r.value); g.n++;
    }
    let units = [...ind.values()].map((g) => ({ pop: g.pop, ele: g.ele, sex: g.sex, period: g.period, val: g.s / g.n }));
    if (scale === "global") {                            // elephant mean of its elephant-year means
      const e = new Map();
      for (const u of units) { const k = u.pop + "\u0001" + u.ele; (e.get(k) || e.set(k, { pop: u.pop, sex: u.sex, a: [] }).get(k)).a.push(u.val); }
      units = [...e.values()].map((x) => ({ pop: x.pop, sex: x.sex, period: 0, val: x.a.reduce((p, q) => p + q, 0) / x.a.length }));
    }
    const cells = new Map();
    for (const u of units) addTo(cells, u.pop, u.sex, u.period, u.val);
    push(cells);
    return out;
  }

  // embedded reference (columnar JSON) -> rows {g, label, sex, period, n, ns, m, se, q}
  function referenceRows(ref, metric, scale) {
    const e = ref && ref.metrics[metric] && ref.metrics[metric][scale];
    if (!e) return [];
    const lab = new Map(ref.groups.map((g) => [g.id, g.label]));
    return e.g.map((g, i) => ({ g, label: lab.get(g), sex: ref.sexes[e.x[i]], period: e.p[i], n: e.n[i], ns: e.ns[i],
                                m: e.m[i], se: e.se[i], q: e.q ? e.q[i] : null }));
  }
  // share (0-100) of a group's elephants below value v, interpolated from its percentiles
  function percentileOf(q, probs, v) {
    if (!q || !Number.isFinite(v)) return null;
    if (v <= q[0]) return probs[0] * 100 * (v < q[0] ? 0.5 : 1);
    if (v >= q[q.length - 1]) return 100 - (1 - probs[probs.length - 1]) * 100 * (v > q[q.length - 1] ? 0.5 : 1);
    for (let i = 1; i < q.length; i++) if (v <= q[i]) {
      const f = q[i] === q[i - 1] ? 0 : (v - q[i - 1]) / (q[i] - q[i - 1]);
      return 100 * (probs[i - 1] + f * (probs[i] - probs[i - 1]));
    }
    return null;
  }

  EMT.compare = { summarise, referenceRows, percentileOf, SEX };
})(typeof globalThis !== "undefined" ? globalThis : self);
