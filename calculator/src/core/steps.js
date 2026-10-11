/* Track -> 4 h steps. Mirrors Elephant_metrics_shiny:
 *   R/process_tracks_to_steps.R (amt make_track/steps/track_resample/steps_by_burst)
 *   scripts/compute_metrics_from_cleaned.R (median-gap exclusion, dedup_individuals)
 * A "fix" is {name, sex, t (UTC ms), lon, lat, x, y}. */
(function (G) {
  const EMT = (G.EMT = G.EMT || {});
  const { DAY, HOUR, localParts, localMidnightUTC } = EMT.time;

  // R round() is half-to-even at .5
  function roundHalfEven(v) {
    const r = Math.round(v);
    return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
  }

  // classify_day_night(): Day if >= 75% of the step duration falls 06:00-18:00
  // local, Night if <= 25%, otherwise null (mixed).
  function classifyDayNight(t1, t2, tz, dayStart = 6, dayEnd = 18, thresh = 0.75) {
    const dur = t2 - t1;
    if (!(dur > 0)) return null;
    const d1 = localParts(t1, tz).dayNum, d2 = localParts(t2, tz).dayNum;
    const ov = (ws, we) => Math.max(0, Math.min(t2, we) - Math.max(t1, ws));
    const b1 = localMidnightUTC(d1, tz);
    let daySec = ov(b1 + dayStart * HOUR, b1 + dayEnd * HOUR);
    if (d2 !== d1) {
      const b2 = localMidnightUTC(d2, tz);
      daySec += ov(b2 + dayStart * HOUR, b2 + dayEnd * HOUR);
    }
    const frac = daySec / dur;
    return frac >= thresh ? "Day" : frac <= 1 - thresh ? "Night" : null;
  }

  // amt:::mk_reg (track_resample): keep the FIRST fix >= rate - tol after the last
  // kept one; a fix beyond rate + tol starts a new burst. Returns burst id or -1.
  function mkReg(t, dist, tol) {
    const n = t.length, out = new Int32Array(n);
    if (!n) return out;
    out[0] = 1;
    let k = 1, i = 0;
    while (i !== n - 1) {
      const tmin = t[i] + dist - tol, tmax = t[i] + dist + tol;
      let j = i + 1;
      while (j < n - 1 && t[j] < tmin) { out[j] = -1; j++; }
      i = j;
      if (j === n - 1 && t[j] < tmin) out[j] = -1;
      else if (t[j] >= tmin && t[j] <= tmax) out[j] = k;
      else { k++; out[j] = k; }
    }
    return out;
  }

  /* One individual's fixes (sorted by t) -> {steps, qc}. Each step:
   * {name, sex, burst, t, x, y, t2, sl, dtSec, speed, dayNight} */
  function individualSteps(fx, tz, opt) {
    const o = Object.assign({ rateH: 4, tolMin: 30, minDtSec: 600, maxSpeed: 15, minBurstPts: 2,
                              statStepM: 10, statMaxH: 12 }, opt || {});
    const qc = { zero_step: 0, stationary_run: 0 };
    // 0) QC raw steps: keep a step only if dt > 10 min and speed < 15 km/h;
    // as_track() then keeps each kept step's start plus the last kept step's end.
    const keep = [];
    let lastEnd = -1;
    for (let i = 0; i + 1 < fx.length; i++) {
      const a = fx[i], b = fx[i + 1];
      const dt = (b.t - a.t) / 1000;
      const sl = Math.hypot(b.x - a.x, b.y - a.y);
      const sp = (sl / dt) * 3.6;
      if (dt > o.minDtSec && sp < o.maxSpeed) { keep.push(i); lastEnd = i + 1; }
    }
    if (!keep.length) return { steps: [], qc };
    const trk = keep.map((i) => fx[i]);
    trk.push(fx[lastEnd]);

    // 1) resample to rate +/- tol, bursts with >= 2 points
    const burst = mkReg(trk.map((p) => p.t), o.rateH * HOUR, o.tolMin * 60000);
    const byBurst = new Map();
    trk.forEach((p, i) => {
      if (burst[i] > 0) {
        let g = byBurst.get(burst[i]);
        if (!g) byBurst.set(burst[i], (g = []));
        g.push(p);
      }
    });
    const steps = [];
    for (const [b, pts] of byBurst) {
      if (pts.length < o.minBurstPts) continue;
      // 2) steps within the burst
      const bs = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], c = pts[i + 1];
        const dtSec = (c.t - a.t) / 1000;
        const sl = Math.hypot(c.x - a.x, c.y - a.y);
        bs.push({ name: a.name, sex: a.sex, burst: b, t: a.t, x: a.x, y: a.y, t2: c.t,
                  sl, dtSec, speed: (sl / dtSec) * 3.6 });
      }
      // 3) artefact QC: runs of < 10 m steps lasting > 12 h, and exact 0 m steps
      let r = 0;
      while (r < bs.length) {
        const stat = bs[r].sl < o.statStepM;
        let e = r, h = 0;
        while (e < bs.length && (bs[e].sl < o.statStepM) === stat) { h += bs[e].dtSec; e++; }
        for (let k = r; k < e; k++) {
          if (stat && h / 3600 > o.statMaxH) { bs[k].qc = "stationary_run"; qc.stationary_run++; }
          else if (bs[k].sl === 0) { bs[k].qc = "zero_step"; qc.zero_step++; }
        }
        r = e;
      }
      for (const s of bs) {
        if (s.qc) continue;
        s.dayNight = classifyDayNight(s.t, s.t2, tz);
        steps.push(s);
      }
    }
    steps.sort((p, q) => p.t - q.t);
    return { steps, qc };
  }

  /* Exclude individuals whose median fix gap (0 < gap <= 48 h) exceeds 6 h:
   * 8 h / 24 h collars cannot be resampled to 4 h. */
  function medianGapExclusion(byName, maxGapH = 6) {
    const include = new Set(), excluded = [];
    for (const [name, fx] of byName) {
      const gaps = [];
      for (let i = 1; i < fx.length; i++) {
        const g = (fx[i].t - fx[i - 1].t) / HOUR;
        if (g > 0 && g <= 48) gaps.push(g);
      }
      if (!gaps.length) { excluded.push({ name, medianGapH: NaN }); continue; }
      const m = EMT.util.median(gaps);
      if (m > maxGapH) excluded.push({ name, medianGapH: m }); else include.add(name);
    }
    return { include, excluded };
  }

  /* dedup_individuals(): the same animal exported under two names. A fix matches
   * when the other name has a fix within 120 s and 5 m; names merge when >= 50% of
   * the shorter track's fixes (over the shared period) match. */
  function dedupIndividuals(fixes) {
    const BIN = 300, MAXS = 120, MAXD = 5, MINOV = 0.5;
    const seen = new Set(), key = [];
    for (const f of fixes) {
      const t = f.t / 1000, k = f.name + "\u0001" + t;
      if (seen.has(k)) continue;
      seen.add(k);
      key.push({ name: f.name, t, x: f.x, y: f.y, tk: roundHalfEven(t / BIN), cx: Math.floor(f.x / 200), cy: Math.floor(f.y / 200) });
    }
    const idx = new Map();
    for (const r of key) {
      for (const d of [-1, 0, 1]) {
        const k = r.tk + d + "|" + r.cx + "|" + r.cy;
        let g = idx.get(k);
        if (!g) idx.set(k, (g = []));
        g.push(r);
      }
    }
    const matched = new Map();   // "a|b" -> Set of t_a
    for (const a of key) {
      const g = idx.get(a.tk + "|" + a.cx + "|" + a.cy);
      if (!g) continue;
      for (const b of g) {
        if (!(a.name < b.name)) continue;
        if (Math.abs(a.t - b.t) > MAXS || Math.hypot(a.x - b.x, a.y - b.y) > MAXD) continue;
        const pk = a.name + "\u0001" + b.name;
        let s = matched.get(pk);
        if (!s) matched.set(pk, (s = new Set()));
        s.add(a.t);
      }
    }
    if (!matched.size) return { fixes, report: [] };
    const rng = new Map(), tByName = new Map();
    for (const r of key) {
      const g = rng.get(r.name);
      if (!g) rng.set(r.name, { t0: r.t, t1: r.t }); else { g.t0 = Math.min(g.t0, r.t); g.t1 = Math.max(g.t1, r.t); }
      let ts = tByName.get(r.name);
      if (!ts) tByName.set(r.name, (ts = []));
      ts.push(r.t);
    }
    const nIn = (nm, lo, hi) => tByName.get(nm).filter((t) => t >= lo && t <= hi).length;
    const pairs = [];
    for (const [pk, s] of matched) {
      const [na, nb] = pk.split("\u0001");
      const ra = rng.get(na), rb = rng.get(nb);
      const lo = Math.max(ra.t0, rb.t0), hi = Math.min(ra.t1, rb.t1);
      const n_a = nIn(na, lo, hi), n_b = nIn(nb, lo, hi);
      const overlap = s.size / Math.max(1, Math.min(n_a, n_b));
      if (overlap >= MINOV) pairs.push({ a: na, b: nb, n_a, n_b, overlap });
    }
    if (!pairs.length) return { fixes, report: [] };
    const nRows = new Map();
    for (const f of fixes) nRows.set(f.name, (nRows.get(f.name) || 0) + 1);
    const map = new Map();
    pairs.map((p, i) => [i, -Math.max(p.n_a, p.n_b)]).sort((p, q) => p[1] - q[1] || p[0] - q[0]).forEach(([k]) => {
      let a = pairs[k].a, b = pairs[k].b;
      if (map.has(a)) a = map.get(a);
      if (map.has(b)) b = map.get(b);
      if (a === b) return;
      const na = nRows.get(a) || 0, nb = nRows.get(b) || 0;
      const keepN = na >= nb ? a : b, dropN = na >= nb ? b : a;
      map.set(dropN, keepN);
      for (const [k2, v] of map) if (v === dropN) map.set(k2, keepN);
    });
    const sexOf = (nm) => {
      const s = [...new Set(fixes.filter((f) => f.name === nm && f.sex).map((f) => f.sex))];
      return s.length ? s.join("/") : null;
    };
    const report = [...map].map(([d, k]) => {
      const p = pairs.find((q) => (q.a === d && q.b === k) || (q.a === k && q.b === d));
      return { dropped_name: d, kept_name: k, overlap: p ? p.overlap : NaN, n_fix_dropped: nRows.get(d) || 0, n_fix_kept: nRows.get(k) || 0 };
    });
    const keptSex = new Map([...new Set(map.values())].map((k) => [k, sexOf(k)]));
    const own = new Set(), seenKey = new Set(), out = [];
    const tkey = (f) => roundHalfEven(f.t / 1000 / BIN);
    for (const f of fixes) if (!map.has(f.name)) own.add(f.name + "|" + tkey(f));
    for (const f of fixes) {
      const isDup = map.has(f.name);
      const nm = isDup ? map.get(f.name) : f.name;
      const k = nm + "|" + tkey(f);
      const dupBefore = seenKey.has(k);
      seenKey.add(k);
      if (isDup && (own.has(k) || dupBefore)) continue;
      out.push(isDup ? Object.assign({}, f, { name: nm, sex: keptSex.get(nm) }) : f);
    }
    out.sort((p, q) => (p.name < q.name ? -1 : p.name > q.name ? 1 : p.t - q.t));
    return { fixes: out, report };
  }

  EMT.steps = { classifyDayNight, mkReg, individualSteps, medianGapExclusion, dedupIndividuals, roundHalfEven };
})(typeof globalThis !== "undefined" ? globalThis : self);
