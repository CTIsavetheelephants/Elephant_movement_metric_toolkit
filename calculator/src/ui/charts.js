/* Minimal SVG charts (no external library - the calculator must work offline).
 * All return an SVG string; colours come from CSS variables so dark mode works. */
(function (G) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const fmt = (v) => {
    if (!Number.isFinite(v)) return "";
    const a = Math.abs(v);
    return a >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toPrecision(2);
  };
  function niceTicks(lo, hi, n = 5) {
    if (!(hi > lo)) { hi = lo + 1; lo = lo - 1; }
    const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw);
    const out = [], a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;   // ticks enclose the data
    for (let v = a; v <= b + step * 1e-9; v += step) out.push(+v.toPrecision(12));
    return out;
  }
  const PALETTE = ["#1f6fb2", "#d95f02", "#7570b3", "#1b9e77", "#e7298a", "#66a61e", "#b8860b", "#a6761d", "#666666", "#377eb8"];

  /* Line chart. series: [{label, color, width, dash, opacity, band, dots, pts: [[x, y, lo, hi, tip]]}]
   * x: numeric; xTicks: [{v, label}] */
  function line(o) {
    const W = o.width || 640, H = o.height || 320, L = 60, R = 14, T = 14, B = o.legend === false ? 34 : 34 + 22 * Math.ceil(o.series.filter((s) => s.label).length / 3);
    const all = o.series.flatMap((s) => s.pts.flatMap((p) => [p[1], s.band ? p[2] : p[1], s.band ? p[3] : p[1]])).filter(Number.isFinite);
    if (!all.length) return empty(W, 120, "No values for this selection");
    let y0 = Math.min(...all), y1 = Math.max(...all);
    if (o.yZero && y0 > 0) y0 = 0;
    if (o.refY !== undefined) { y0 = Math.min(y0, o.refY); y1 = Math.max(y1, o.refY); }
    const pad = (y1 - y0) * 0.06 || Math.abs(y1) * 0.1 || 1;
    const yt = niceTicks(y0 - pad, y1 + pad, 5);
    const ya = yt[0], yb = yt[yt.length - 1];
    const [xa, xb] = o.xDomain;
    const X = (x) => L + ((x - xa) / (xb - xa || 1)) * (W - L - R);
    const Y = (y) => T + (1 - (y - ya) / (yb - ya)) * (H - T - B);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(o.title || "chart")}" class="chart">`;
    for (const t of yt) s += `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${L - 6}" y="${Y(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
    for (const t of o.xTicks) if (t.v >= xa && t.v <= xb) s += `<text x="${X(t.v)}" y="${H - B + 16}" text-anchor="middle">${esc(t.label)}</text>`;
    s += `<text transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" class="axlab">${esc(o.yLabel || "")}</text>`;
    if (o.refY !== undefined) s += `<line x1="${L}" x2="${W - R}" y1="${Y(o.refY)}" y2="${Y(o.refY)}" class="ref"/>`;
    for (const sr of o.series) {
      const pts = sr.pts.filter((p) => Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
      if (!pts.length) continue;
      const op = sr.opacity ?? 1;
      if (sr.band) {
        const b = pts.filter((p) => Number.isFinite(p[2]) && Number.isFinite(p[3]));
        // one band polygon per run of points without a gap (like the line)
        const runs = [];
        for (const p of b) {
          const last = runs[runs.length - 1];
          if (last && p[0] - last[last.length - 1][0] <= (o.maxGap || Infinity)) last.push(p); else runs.push([p]);
        }
        for (const rb of runs) if (rb.length > 1) s += `<path d="M${rb.map((p) => X(p[0]) + "," + Y(p[3])).join("L")}L${rb.slice().reverse().map((p) => X(p[0]) + "," + Y(p[2])).join("L")}Z" fill="${sr.color}" opacity="${0.18 * op}"/>`;
        if (sr.bars) for (const p of b) s += `<line x1="${X(p[0])}" x2="${X(p[0])}" y1="${Y(p[2])}" y2="${Y(p[3])}" stroke="${sr.color}" stroke-width="1.5" opacity="${op}"/>`;
      }
      // break the line where consecutive x are more than maxGap apart
      let d = "", prev = null;
      for (const p of pts) { d += (prev === null || p[0] - prev > (o.maxGap || Infinity) ? "M" : "L") + X(p[0]) + "," + Y(p[1]); prev = p[0]; }
      s += `<path d="${d}" fill="none" stroke="${sr.color}" stroke-width="${sr.width || 1.5}" opacity="${op}" ${sr.dash ? `stroke-dasharray="${sr.dash}"` : ""} stroke-linejoin="round"/>`;
      if (sr.dots !== false) for (const p of pts) s += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${sr.r || 2.6}" fill="${sr.color}" opacity="${op}">${p[4] ? `<title>${esc(p[4])}</title>` : ""}</circle>`;
    }
    const lg = o.series.filter((x) => x.label);
    if (o.legend !== false) lg.forEach((sr, i) => {
      const lx = L + (i % 3) * ((W - L) / 3), ly = H - B + 34 + 22 * Math.floor(i / 3);
      s += `<line x1="${lx}" x2="${lx + 18}" y1="${ly - 4}" y2="${ly - 4}" stroke="${sr.color}" stroke-width="${Math.max(2, sr.width || 2)}" ${sr.dash ? `stroke-dasharray="${sr.dash}"` : ""}/><text x="${lx + 24}" y="${ly}">${esc(sr.label.length > 34 ? sr.label.slice(0, 33) + "…" : sr.label)}</text>`;
    });
    return s + "</svg>";
  }

  /* Horizontal dot plot: rows [{label, m, lo, hi, color, bold, tip}] already sorted */
  function dots(o) {
    const rows = o.rows.filter((r) => Number.isFinite(r.m));
    if (!rows.length) return empty(o.width || 760, 120, "No values for this selection");
    const W = o.width || 640, rh = 18, L = 210, R = 16, T = 8, B = 40, H = T + rows.length * rh + B;
    const vals = rows.flatMap((r) => [r.m, r.lo, r.hi]).filter(Number.isFinite);
    const xt = niceTicks(Math.min(...vals), Math.max(...vals), 6);
    const xa = xt[0], xb = xt[xt.length - 1], X = (x) => L + ((x - xa) / (xb - xa)) * (W - L - R);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart" role="img" aria-label="${esc(o.title || "ranking")}">`;
    for (const t of xt) s += `<line x1="${X(t)}" x2="${X(t)}" y1="${T}" y2="${H - B}" class="grid"/><text x="${X(t)}" y="${H - B + 16}" text-anchor="middle">${fmt(t)}</text>`;
    s += `<text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle" class="axlab">${esc(o.xLabel || "")}</text>`;
    rows.forEach((r, i) => {
      const y = T + i * rh + rh / 2;
      if (r.bold) s += `<rect x="0" y="${y - rh / 2}" width="${W}" height="${rh}" class="hlrow"/>`;
      s += `<text x="${L - 8}" y="${y + 4}" text-anchor="end" ${r.bold ? 'font-weight="700"' : ""}>${esc(r.label.length > 34 ? r.label.slice(0, 33) + "…" : r.label)}</text>`;
      if (Number.isFinite(r.lo) && Number.isFinite(r.hi)) s += `<line x1="${X(r.lo)}" x2="${X(r.hi)}" y1="${y}" y2="${y}" stroke="${r.color}" stroke-width="2" opacity=".5"/>`;
      s += `<circle cx="${X(r.m)}" cy="${y}" r="${r.bold ? 5.5 : 4}" fill="${r.color}"><title>${esc(r.tip || r.label)}</title></circle>`;
    });
    return s + "</svg>";
  }

  /* Heat map: rowLabels, colLabels, cells [{r, c, v, tip}], diverging domain [-d, d] */
  function heat(o) {
    const W = o.width || 760, L = 60, T = 22, cw = (W - L - 70) / o.colLabels.length, ch = 22, H = T + o.rowLabels.length * ch + 10;
    const d = o.domain || 3;
    const col = (v) => {
      const t = Math.max(-1, Math.min(1, v / d));
      return t < 0 ? `color-mix(in srgb, #2166ac ${Math.round(-t * 100)}%, var(--card))` : `color-mix(in srgb, #d95f02 ${Math.round(t * 100)}%, var(--card))`;
    };
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart" role="img" aria-label="heat map">`;
    o.colLabels.forEach((c, j) => (s += `<text x="${L + j * cw + cw / 2}" y="14" text-anchor="middle">${esc(c)}</text>`));
    o.rowLabels.forEach((r, i) => (s += `<text x="${L - 6}" y="${T + i * ch + 15}" text-anchor="end">${esc(r)}</text>`));
    for (const c of o.cells) s += `<rect x="${L + c.c * cw + 1}" y="${T + c.r * ch + 1}" width="${cw - 2}" height="${ch - 2}" rx="2" fill="${col(c.v)}"><title>${esc(c.tip)}</title></rect>`;
    const lx = W - 56;
    [-d, 0, d].forEach((v, i) => (s += `<rect x="${lx}" y="${T + i * 24}" width="14" height="14" fill="${col(v)}" stroke="var(--line)"/><text x="${lx + 20}" y="${T + i * 24 + 11}">${v > 0 ? "+" : ""}${v}</text>`));
    return s + `<text x="${lx}" y="${T + 84}" class="axlab">z</text></svg>`;
  }

  /* Small-multiple polar "wheels": panels [{title, vals: [12], color}] */
  function wheels(o) {
    const n = o.panels.length, per = Math.min(3, n), size = 360, W = per * size, rows = Math.ceil(n / per), H = rows * (size + 34);
    const vmax = Math.max(...o.panels.flatMap((p) => p.vals).filter(Number.isFinite), o.refV || 0) || 1;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" class="chart" role="img" aria-label="monthly wheels">`;
    o.panels.forEach((p, k) => {
      const cx = (k % per) * size + size / 2, cy = Math.floor(k / per) * (size + 34) + size / 2 + 34, R = size / 2 - 26;
      s += `<text x="${cx}" y="${cy - R - 26}" text-anchor="middle" font-weight="600" class="axlab">${esc(p.title)}</text><circle cx="${cx}" cy="${cy}" r="${R}" fill="none" class="grid"/>`;
      p.vals.forEach((v, m) => {
        if (!Number.isFinite(v)) return;
        // month m's wedge is centred on (m - 3)/12 of a turn, so January sits exactly at the top
        const a0 = ((m - 3.5) / 12) * 2 * Math.PI, a1 = ((m - 2.5) / 12) * 2 * Math.PI, r = (Math.max(0, v) / vmax) * R;
        s += `<path d="M${cx},${cy}L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)}A${r},${r} 0 0 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)}Z" fill="${p.color}" opacity=".85" stroke="var(--card)"><title>${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m]}: ${fmt(v)}</title></path>`;
      });
      if (o.refV) s += `<circle cx="${cx}" cy="${cy}" r="${(o.refV / vmax) * R}" fill="none" stroke="#c0392b" stroke-dasharray="3 3"/>`;
      "JFMAMJJASOND".split("").forEach((l, m) => { const a = ((m - 3) / 12) * 2 * Math.PI; s += `<text x="${cx + (R + 12) * Math.cos(a)}" y="${cy + (R + 12) * Math.sin(a) + 4}" text-anchor="middle" class="axlab">${l}</text>`; });
    });
    return s + "</svg>";
  }
  /* Horizontal distributions: rows [{label, sub, color, q: {p5, p25, p50, p75, p95}, m, mLo, mHi, pts: [values], tip}]
   * Reference groups draw a box (25-75%), whiskers (5-95%) and median; the user's
   * population draws its elephants as dots plus the mean ± SE. */
  function boxes(o) {
    const W = o.width || 640, rh = 46, L = 190, R = 16, T = 6, B = 40, H = T + o.rows.length * rh + B;
    const vals = o.rows.flatMap((r) => (r.q ? [r.q.p5, r.q.p95] : []).concat(r.pts || [], [r.m, r.mLo, r.mHi])).filter(Number.isFinite);
    if (!vals.length) return empty(W, 120, "No values for this selection");
    const xt = niceTicks(Math.min(...vals), Math.max(...vals), 6);
    const xa = xt[0], xb = xt[xt.length - 1], X = (x) => L + ((x - xa) / (xb - xa)) * (W - L - R);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart" role="img" aria-label="${esc(o.title || "distributions")}">`;
    for (const t of xt) s += `<line x1="${X(t)}" x2="${X(t)}" y1="${T}" y2="${H - B}" class="grid"/><text x="${X(t)}" y="${H - B + 16}" text-anchor="middle">${fmt(t)}</text>`;
    s += `<text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle" class="axlab">${esc(o.xLabel || "")}</text>`;
    o.rows.forEach((r, i) => {
      const y = T + i * rh + rh / 2;
      s += `<text x="${L - 8}" y="${y - 2}" text-anchor="end" ${r.own ? 'font-weight="700"' : ""} class="axlab">${esc(r.label)}</text>`;
      if (r.sub) s += `<text x="${L - 8}" y="${y + 12}" text-anchor="end">${esc(r.sub)}</text>`;
      if (r.q) {
        const q = r.q;
        s += `<line x1="${X(q.p5)}" x2="${X(q.p95)}" y1="${y}" y2="${y}" stroke="${r.color}" stroke-width="1.5"/>`;
        s += `<rect x="${X(q.p25)}" y="${y - 9}" width="${Math.max(1, X(q.p75) - X(q.p25))}" height="18" fill="${r.color}" opacity=".3" stroke="${r.color}"><title>${esc(r.tip || "")}</title></rect>`;
        s += `<line x1="${X(q.p50)}" x2="${X(q.p50)}" y1="${y - 9}" y2="${y + 9}" stroke="${r.color}" stroke-width="2.5"/>`;
      }
      for (const p of r.pts || []) s += `<circle cx="${X(p)}" cy="${y + ((p * 7919) % 1 - 0.5) * 10}" r="2.6" fill="${r.color}" opacity=".55"/>`;
      if (Number.isFinite(r.mLo) && Number.isFinite(r.mHi)) s += `<line x1="${X(r.mLo)}" x2="${X(r.mHi)}" y1="${y}" y2="${y}" stroke="${r.color}" stroke-width="3"/>`;
      if (Number.isFinite(r.m)) s += `<path d="M${X(r.m)},${y - 7}L${X(r.m) + 6},${y}L${X(r.m)},${y + 7}L${X(r.m) - 6},${y}Z" fill="${r.own ? r.color : "var(--card)"}" stroke="${r.color}" stroke-width="1.5"><title>${esc(r.tip || "")}</title></path>`;
    });
    return s + "</svg>";
  }
  function empty(W, H, msg) {
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart"><text x="${W / 2}" y="${H / 2}" text-anchor="middle">${esc(msg)}</text></svg>`;
  }
  G.EMTCharts = { line, dots, heat, wheels, boxes, niceTicks, PALETTE, fmt };
})(typeof globalThis !== "undefined" ? globalThis : self);
