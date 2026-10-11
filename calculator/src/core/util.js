/* Elephant Movement Metrics Calculator - shared numeric helpers.
 * Every core file attaches to the EMT namespace so the same code runs in the
 * browser (inlined into the HTML / a Web Worker) and in Node (validation). */
(function (G) {
  const EMT = (G.EMT = G.EMT || {});

  const finite = (v) => typeof v === "number" && Number.isFinite(v);

  // mean_or_na / sd_or_na / se_or_na (metrics_udfixed.R)
  function meanOrNA(a) {
    let s = 0, n = 0;
    for (const v of a) if (finite(v)) { s += v; n++; }
    return n ? s / n : NaN;
  }
  function sdOrNA(a) {
    const f = a.filter(finite);
    if (f.length < 2) return NaN;
    const m = f.reduce((p, c) => p + c, 0) / f.length;
    let ss = 0;
    for (const v of f) ss += (v - m) * (v - m);
    return Math.sqrt(ss / (f.length - 1));
  }
  function seOrNA(a) {
    const f = a.filter(finite);
    if (!f.length) return NaN;
    if (f.length === 1) return 0;
    return sdOrNA(f) / Math.sqrt(f.length);
  }
  function countFinite(a) {
    let n = 0;
    for (const v of a) if (finite(v)) n++;
    return n;
  }
  // R's stats::median (type 7 midpoint for even n), NA removed
  function median(a) {
    const f = a.filter(finite).sort((x, y) => x - y);
    if (!f.length) return NaN;
    const h = f.length >> 1;
    return f.length % 2 ? f[h] : (f[h - 1] + f[h]) / 2;
  }
  function quantile(a, p) {
    const f = a.filter(finite).sort((x, y) => x - y);
    if (!f.length) return NaN;
    const h = (f.length - 1) * p, lo = Math.floor(h);
    return f[lo] + (h - lo) * ((f[Math.min(lo + 1, f.length - 1)]) - f[lo]);
  }
  // R round(x, d): R >= 4.0 rounds to the closest representable decimal, which
  // toFixed reproduces (it uses the exact binary value, not x*10^d).
  function roundR(x, d) {
    if (!finite(x)) return NaN;
    return Number(x.toFixed(d));
  }
  function clamp01(x) {
    if (!finite(x)) return NaN;
    return Math.min(Math.max(x, 0), 1);
  }
  // max pairwise distance (stats::dist max) of parallel x/y arrays
  function diameter(xs, ys) {
    let best = -Infinity;
    const n = xs.length;
    for (let i = 0; i < n; i++) {
      const xi = xs[i], yi = ys[i];
      for (let j = i + 1; j < n; j++) {
        const dx = xs[j] - xi, dy = ys[j] - yi;
        const d = dx * dx + dy * dy;
        if (d > best) best = d;
      }
    }
    return n < 2 ? NaN : Math.sqrt(best);
  }
  // Group an array of records by a key function, preserving first-seen order
  function groupBy(arr, keyFn) {
    const m = new Map();
    for (const r of arr) {
      const k = keyFn(r);
      let g = m.get(k);
      if (!g) { g = []; m.set(k, g); }
      g.push(r);
    }
    return m;
  }
  function nDistinct(arr, fn) {
    const s = new Set();
    for (const r of arr) s.add(fn(r));
    return s.size;
  }
  // Convex hull area (Andrew's monotone chain), used for the 100% MCP
  function convexHullArea(xs, ys) {
    const pts = xs.map((x, i) => [x, ys[i]]).filter((p) => finite(p[0]) && finite(p[1]));
    if (pts.length < 3) return 0;
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    let a = 0;
    for (let i = 0; i < hull.length; i++) {
      const p = hull[i], q = hull[(i + 1) % hull.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(a) / 2;
  }

  EMT.util = { finite, meanOrNA, sdOrNA, seOrNA, countFinite, median, quantile, roundR,
               clamp01, diameter, groupBy, nDistinct, convexHullArea };
})(typeof globalThis !== "undefined" ? globalThis : self);
