/* "My elephants" and "Compare with other populations" views (results page).
 * Everything is computed in the browser from the user's metric rows and the
 * reference summaries embedded in this file. */
(function (G) {
  const C = G.EMTCharts, $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const SEXCOL = { Female: "#e8736c", Male: "#23a55a", Unknown: "#6d9eeb" };
  const OWN = ["#d95f02", "#c2185b", "#7570b3", "#8d6e00"];
  const GCOL = { all: "#5f6b66", forest: "#1b7f4c", savannah: "#b07d1a", east: "#1f6fb2" };

  const META = {
    mean_speed: ["Mean speed", "Mean speed (km/h)"], night_day_speed_ratio: ["Night/day speed ratio", "Night/day speed ratio"],
    night_speed: ["Night speed", "Night speed (km/h)"], day_speed: ["Day speed", "Day speed (km/h)"],
    net_displacement: ["Daily net displacement", "Daily net displacement (km)"], daily_msd: ["Daily mean squared displacement", "Daily MSD (km²)"],
    straightness: ["Daily straightness", "Daily straightness (0-1)"], diurnality: ["Diurnality", "Diurnality (-1 night to +1 day)"],
    max_displacement: ["Daily maximum displacement", "Daily max displacement (km)"], out_back_idx_month: ["Out-and-back index", "Out-and-back index"],
    weekly_net_displacement_month: ["Weekly net displacement", "Weekly net displacement (km)"],
    weekly_max_displacement_month: ["Weekly maximum displacement", "Weekly max displacement (km)"],
    max_yearly_displacement: ["Maximum yearly displacement", "Max yearly displacement (km)"],
    "10day_net_displacement": ["10-day net displacement", "10-day net displacement (km)"],
    "10day_max_displacement": ["10-day maximum displacement", "10-day max displacement (km)"],
    ud50_area_year: ["50% UD area (core range)", "50% UD area (km²)"], ud95_area_year: ["95% UD area (home range)", "95% UD area (km²)"],
    mcp_area_year: ["Annual MCP area", "MCP area (km²)"], intensity_of_use: ["Intensity of use", "Path km / √MCP km"],
    vi_prev_year_95ud: ["Range overlap with previous year (VI)", "Volume of intersection (0-1)"],
    mean_residence_time: ["Mean residence time", "Residence time (hours)"],
    male_female_ba_overlap_year: ["Male-female range overlap (BA)", "Bhattacharyya affinity (0-1)"],
    emd_year: ["Space-use shift from previous year (EMD)", "EMD (km)"],
  };
  const title = (m) => (META[m] || [m])[0], ylab = (m) => (META[m] || [m, m])[1];
  const sexOf = (s) => (s === "female" || s === "Female" ? "Female" : s === "male" || s === "Male" ? "Male" : "Unknown");

  let REF = null, rows = [], ownSAs = [], tracks = null;
  function loadReference() {
    try { const t = $("ref-data").textContent.trim(); REF = t && t[0] === "{" ? JSON.parse(t) : null; } catch (e) { REF = null; }
    return REF;
  }

  function options(sel, items, keep) {
    const cur = keep ? sel.value : null;
    sel.innerHTML = items.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
    if (cur && items.some(([v]) => String(v) === cur)) sel.value = cur;
  }
  const metricItems = (list) => Object.keys(META).filter((m) => list.has(m)).map((m) => [m, title(m)]);

  // ================================================================ setup
  function init(r, tr) {
    tracks = tr && Object.keys(tr).length ? tr : null;   // 4 h positions; absent when a saved metrics file is reopened
    rows = r.map((x) => Object.assign({}, x, { value: x.value === "" || x.value === null ? NaN : +x.value, year: +x.year,
                                               month: x.month === "" || x.month === null || x.month === undefined ? null : +x.month }));
    ownSAs = [...new Set(rows.map((x) => x.Study_Area))];
    const have = new Set(rows.filter((x) => Number.isFinite(x.value)).map((x) => x.metric));
    options($("myMetric"), metricItems(have), true);
    options($("myArea"), ownSAs.map((s) => [s, s]), true);
    $("myAreaWrap").classList.toggle("hidden", ownSAs.length < 2);
    loadReference();
    const cmpHave = new Set([...have, ...(REF ? Object.keys(REF.metrics) : [])]);   // reference-only metrics too
    options($("cmpMetric"), [["__overview", "Overview: all metrics"]].concat(metricItems(cmpHave)), true);
    $("refInfo").textContent = REF
      ? `Reference: ${REF.meta.n_elephants} elephants in ${REF.meta.n_study_areas} study areas (data held by Save the Elephants, updated ${REF.meta.source_modified}), summarised only as pooled groups - no individual study areas or elephants. Values from fewer than ${REF.meta.min_sites} study areas are not shown, except for STE's own East Africa data.`
      : "No reference data is included in this copy of the calculator.";
    const keep = new Set([...document.querySelectorAll("#cmpGroups input:checked")].map((i) => i.value));
    $("cmpGroups").innerHTML = REF ? REF.groups.map((g) => `<label><input type="checkbox" value="${g.id}" ${!keep.size || keep.has(g.id) ? "checked" : ""}>
      <span class="swatch" style="background:${GCOL[g.id] || "#888"}"></span>${esc(g.label)} <span class="muted small">(${g.n_elephants} elephants, ${g.n_sites} study areas)</span></label>`).join("") : "";
    refreshElephants();
    drawMine(); drawCompare();
  }

  // ================================================================ My elephants
  function mineRows() {
    const sa = ownSAs.length > 1 ? $("myArea").value : ownSAs[0];
    return rows.filter((x) => x.Study_Area === sa && x.metric === $("myMetric").value && Number.isFinite(x.value) && x.Name);
  }
  function refreshElephants() {
    const names = [...new Set(mineRows().map((x) => x.Name))].sort();
    options($("myFocal"), names.map((n) => [n, n]), true);
    const keep = new Set([...document.querySelectorAll("#myCompare input:checked")].map((i) => i.value));
    const others = names.filter((n) => n !== $("myFocal").value);
    $("myCompare").innerHTML = others.map((n) => `<label><input type="checkbox" value="${esc(n)}" ${keep.has(n) ? "checked" : ""}> ${esc(n)}</label>`).join("") || '<span class="muted">No other elephants for this metric.</span>';
  }
  const tx = (x) => x.year + (x.month ? (x.month - 0.5) / 12 : 0.5);
  function drawMine() {
    const v = mineRows(), m = $("myMetric").value, fig = document.querySelector('input[name="myFig"]:checked').value;
    const focal = $("myFocal").value;
    const comp = [...document.querySelectorAll("#myCompare input:checked")].map((i) => i.value).filter((n) => n !== focal).slice(0, 9);
    const monthly = v.some((x) => x.month);
    const nsd = fig === "nsd";
    $("nsdStartWrap").classList.toggle("hidden", !nsd);
    $("nsdHelp").classList.toggle("hidden", !nsd);
    $("myMetric").closest(".field").classList.toggle("hidden", nsd);
    $("myTable").closest(".tablewrap").classList.toggle("hidden", nsd);
    if (nsd) { $("myChart").innerHTML = drawNSD([focal].concat(comp)); if (!$("nsdHelp").innerHTML) $("nsdHelp").innerHTML = nsdHelp(); return; }
    let svg = "";
    if (!v.length) svg = '<p class="muted">No values for this metric.</p>';
    else if (fig === "ts") {
      const bg = new Map();
      for (const x of v) { const k = tx(x); (bg.get(k) || bg.set(k, []).get(k)).push(x.value); }
      const bgPts = [...bg].map(([k, a]) => {
        const n = a.length, mu = a.reduce((p, q) => p + q, 0) / n, sd = n > 1 ? Math.sqrt(a.reduce((p, q) => p + (q - mu) ** 2, 0) / (n - 1)) : 0;
        return [k, mu, mu - sd / Math.sqrt(n), mu + sd / Math.sqrt(n), `Population mean ${C.fmt(mu)} (${n} elephants)`];
      });
      const ser = [{ label: "All your elephants: mean ± SE", color: "var(--muted)", dash: "5 4", band: true, dots: false, pts: bgPts }];
      [focal].concat(comp).forEach((n, i) => ser.push({
        label: n, color: C.PALETTE[i % C.PALETTE.length], width: i ? 1.4 : 2.6, r: i ? 2.2 : 3,
        pts: v.filter((x) => x.Name === n).map((x) => [tx(x), x.value, null, null, `${n} ${x.year}${x.month ? "-" + String(x.month).padStart(2, "0") : ""}: ${C.fmt(x.value)}`]),
      }));
      const xs = v.map(tx), y0 = Math.floor(Math.min(...xs)), y1 = Math.ceil(Math.max(...xs));
      svg = C.line({ series: ser, xDomain: [y0, y1], xTicks: yearTicks(y0, y1), yLabel: ylab(m), maxGap: monthly ? 0.2 : 1.5,
                     refY: m === "night_day_speed_ratio" ? 1 : undefined });
    } else if (fig === "z") {
      // one panel per selected elephant, then the whole population; every panel uses the
      // same years so the rows line up and months can be compared down the page
      const all = v.filter((x) => x.month);
      const shownNames = new Set([focal].concat(comp));
      const years = [...new Set(all.filter((x) => shownNames.has(x.Name)).map((x) => x.year))].sort((a, b) => a - b);   // years the shown elephants cover
      const panel = (title, d, tipName) => {
        let h = `<h4 class="zhead">${esc(title)}</h4>`;
        if (d.length < 3) return h + '<p class="muted small">Not enough monthly values for a heat map.</p>';
        const mu = d.reduce((p, q) => p + q.value, 0) / d.length, sd = Math.sqrt(d.reduce((p, q) => p + (q.value - mu) ** 2, 0) / (d.length - 1)) || 1;
        return h + C.heat({ rowLabels: years.map(String), colLabels: MON,
          cells: d.map((x) => ({ r: years.indexOf(x.year), c: x.month - 1, v: (x.value - mu) / sd,
                                 tip: `${tipName} ${x.year} ${MON[x.month - 1]}: ${C.fmt(x.value)}${x.n ? " (" + x.n + " elephants)" : ""}, z = ${((x.value - mu) / sd).toFixed(2)}` })) });
      };
      svg = `<p class="muted small">Each month compared with that panel's own average (blue = lower, orange = higher). The bottom panel is the average of all your elephants, so you can see whether an unusual month was unusual for everyone or only for one elephant.</p>`;
      for (const n of [focal].concat(comp)) svg += panel(n, all.filter((x) => x.Name === n), n);
      const pop = new Map();
      for (const x of all) { const k = x.year * 100 + x.month; (pop.get(k) || pop.set(k, { year: x.year, month: x.month, a: [] }).get(k)).a.push(x.value); }
      const popRows = [...pop.values()].filter((p) => years.includes(p.year)).map((p) => ({ year: p.year, month: p.month, value: p.a.reduce((s, q) => s + q, 0) / p.a.length, n: p.a.length }));
      svg += panel(`All your elephants (${new Set(all.map((x) => x.Name)).size})`, popRows, "All elephants");
    } else if (fig === "wheel") {
      const panels = [focal].concat(comp).map((n) => {
        const d = v.filter((x) => x.Name === n && x.month);
        const vals = MON.map((_, k) => { const a = d.filter((x) => x.month === k + 1).map((x) => x.value); return a.length ? a.reduce((p, q) => p + q, 0) / a.length : NaN; });
        return { title: n, vals, color: SEXCOL[sexOf((d[0] || {}).Sex)] };
      }).filter((p) => p.vals.some(Number.isFinite));
      svg = panels.length ? C.wheels({ panels, refV: m === "night_day_speed_ratio" ? 1 : 0 }) : '<p class="muted">The monthly wheel needs monthly values.</p>';
    } else {
      const names = [...new Set(v.map((x) => x.Name))].sort();
      const ys = v.map((x) => x.year), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const cols = monthly ? (y1 - y0 + 1) * 12 : y1 - y0 + 1;
      const cell = (x) => (monthly ? (x.year - y0) * 12 + (x.month || 1) - 1 : x.year - y0);
      const W = 760, L = 150, cw = Math.max(2, (W - L - 10) / cols), ch = 16, H = 24 + names.length * ch;
      let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart">`;
      const yearW = (monthly ? 12 : 1) * cw, every = Math.max(1, Math.ceil(34 / yearW));   // >= 34 px between labels
      for (let y = y0; y <= y1; y++) if ((y - y0) % every === 0) s += `<text x="${L + (monthly ? (y - y0) * 12 : y - y0) * cw}" y="12">${y}</text>`;
      names.forEach((n, i) => {
        s += `<text x="${L - 6}" y="${24 + i * ch + 11}" text-anchor="end" ${n === focal ? 'font-weight="700"' : ""}>${esc(n.length > 22 ? n.slice(0, 21) + "…" : n)}</text>`;
        s += `<rect x="${L}" y="${18 + i * ch}" width="${cols * cw}" height="${ch - 3}" fill="var(--cell0)"/>`;
        for (const x of v.filter((q) => q.Name === n)) s += `<rect x="${L + cell(x) * cw}" y="${18 + i * ch}" width="${Math.max(1, cw - 1)}" height="${ch - 3}" fill="${n === focal ? C.PALETTE[0] : comp.includes(n) ? C.PALETTE[(comp.indexOf(n) + 1) % C.PALETTE.length] : "var(--c2)"}"><title>${esc(n)} ${x.year}${x.month ? "-" + x.month : ""}</title></rect>`;
      });
      svg = s + "</svg>";
    }
    $("myChart").innerHTML = svg;
    const tbl = [...new Set(v.map((x) => x.Name))].sort().map((n) => {
      const d = v.filter((x) => x.Name === n), mu = d.reduce((p, q) => p + q.value, 0) / d.length, ys = d.map((x) => x.year);
      return `<tr><td>${esc(n)}</td><td>${sexOf(d[0].Sex)}</td><td>${d.length}</td><td>${Math.min(...ys)}-${Math.max(...ys)}</td><td>${C.fmt(mu)}</td></tr>`;
    }).join("");
    $("myTable").innerHTML = `<thead><tr><th>Elephant</th><th>Sex</th><th>Values</th><th>Years</th><th>Mean</th></tr></thead><tbody>${tbl}</tbody>`;
  }
  // ================================================================ Net squared displacement
  // NSD = squared straight-line distance (km²) of each 4 h position from a start point:
  // the elephant's first position overall, or its first position in each calendar year.
  const DAY = 864e5;
  const yStart = (y) => Date.UTC(y, 0, 1);
  const fracYear = (t) => { const y = new Date(t).getUTCFullYear(); return y + (t - yStart(y)) / (yStart(y + 1) - yStart(y)); };
  function nsdSeries(a, from, to, xOf) {
    const out = [], n = (to - from) / 3, every = Math.max(1, Math.ceil(n / 2500));   // thin very long tracks for drawing
    const x0 = a[from + 1], y0 = a[from + 2];
    for (let i = from; i < to; i += 3 * every) out.push([xOf(a[i]), ((a[i + 1] - x0) ** 2 + (a[i + 2] - y0) ** 2) / 1e6]);
    return out;
  }
  function drawNSD(names) {
    if (!tracks) return '<p class="note">Net squared displacement needs the GPS positions, which a saved metrics file does not contain. Load your tracking data and calculate the metrics to see this figure.</p>';
    names = names.filter((n) => tracks[n]);
    if (!names.length) return '<p class="muted">No positions for this elephant.</p>';
    const kmHint = '<p class="hint">NSD is in km²: 100 km² = 10 km from the start point, 400 km² = 20 km, 2,500 km² = 50 km. Calculated from the cleaned 4-hour positions.</p>';
    if ($("nsdStart").value === "first") {
      const series = names.map((n, i) => ({ label: n, color: C.PALETTE[i % C.PALETTE.length], width: i ? 1.3 : 2, dots: false,
                                            pts: nsdSeries(tracks[n], 0, tracks[n].length, fracYear) }));
      const xs = series.flatMap((s) => [s.pts[0][0], s.pts[s.pts.length - 1][0]]), x0 = Math.min(...xs), x1 = Math.max(...xs);
      return C.line({ series, xDomain: [x0, x1], xTicks: dateTicks(x0, x1), yLabel: "NSD (km²)", yZero: true, maxGap: 3 / 365, height: 340 }) + kmHint;
    }
    // one panel per elephant, one line per calendar year; colours follow the year in every panel
    const years = new Set();
    const per = names.map((n) => {
      const a = tracks[n], by = new Map();
      for (let i = 0; i < a.length; i += 3) { const y = new Date(a[i]).getUTCFullYear(); if (!by.has(y)) by.set(y, [i, i]); by.get(y)[1] = i + 3; }
      const ys = [...by].filter(([, [f, t]]) => (t - f) / 3 >= 30);   // >= 5 days of positions
      ys.forEach(([y]) => years.add(y));
      return { n, ys };
    });
    const yl = [...years].sort((a, b) => a - b), col = (y) => C.PALETTE[yl.indexOf(y) % C.PALETTE.length];
    const ticks = MON.map((l, k) => ({ v: (Date.UTC(2001, k, 1) - Date.UTC(2001, 0, 1)) / DAY, label: l }));
    let h = '<p class="muted small">Distance from where the elephant was at the start of each year (or when its collar started that year). Same-coloured lines are the same year in every panel.</p>';
    for (const { n, ys } of per) {
      h += `<h4 class="zhead">${esc(n)}</h4>`;
      if (!ys.length) { h += '<p class="muted small">Not enough positions.</p>'; continue; }
      const series = ys.map(([y, [f, t]]) => ({ label: String(y), color: col(y), width: 1.6, dots: false,
                                              pts: nsdSeries(tracks[n], f, t, (tt) => (tt - yStart(y)) / DAY) }));
      h += C.line({ series, xDomain: [0, 366], xTicks: ticks, yLabel: "NSD (km²)", yZero: true, maxGap: 3, height: 280 });
    }
    return h + kmHint;
  }
  function dateTicks(x0, x1) {
    if (x1 - x0 > 3) return yearTicks(Math.ceil(x0), Math.floor(x1));
    const t = [];
    for (let y = Math.floor(x0); y <= x1; y++) for (let m = 0; m < 12; m += 3) t.push({ v: y + m / 12, label: m ? MON[m] : `${MON[0]} ${y}` });
    return t;
  }
  // explainer with sketches of the typical NSD shapes (made-up curves, small fixed wiggle)
  function nsdHelp() {
    const PAT = [
      ["Range resident", "Rises quickly, then levels off. Stays within one home range.", (t) => 0.35 * (1 - Math.exp(-t * 12))],
      ["Migratory", "Rises to a plateau, then drops back. Seasonal move between two areas and back.",
       (t) => 0.9 / (1 + Math.exp(-(t - 0.3) * 30)) - 0.9 / (1 + Math.exp(-(t - 0.72) * 30)) + 0.05],
      ["Dispersal", "One step up to a new, higher plateau. Leaves for a new area and stays.",
       (t) => 0.1 * (1 - Math.exp(-t * 15)) + 0.75 / (1 + Math.exp(-(t - 0.5) * 25))],
      ["Nomadic", "Keeps rising without levelling off. No fixed home range.", (t) => 0.95 * t],
    ];
    const W = 200, H = 110, L = 14, B = 16;
    const sk = PAT.map(([name, txt, f], k) => {
      let d = "";
      for (let i = 0; i <= 80; i++) {
        const t = i / 80, v = Math.max(0, f(t) + 0.02 * Math.sin(i * 1.7 + k) + 0.012 * Math.sin(i * 4.3 + 2 * k));
        d += (i ? "L" : "M") + (L + t * (W - L - 6)).toFixed(1) + " " + (H - B - v * (H - B - 8)).toFixed(1);
      }
      return `<div class="pat"><b>${name}</b><svg viewBox="0 0 ${W} ${H}" aria-hidden="true">
        <line x1="${L}" y1="6" x2="${L}" y2="${H - B}" stroke="var(--line)" stroke-width="1.5"/><line x1="${L}" y1="${H - B}" x2="${W - 4}" y2="${H - B}" stroke="var(--line)" stroke-width="1.5"/>
        <text x="8" y="${(H - B) / 2}" transform="rotate(-90 8 ${(H - B) / 2})" text-anchor="middle">NSD</text>
        <text x="${W - 4}" y="${H - 3}" text-anchor="end">time →</text>
        <path d="${d}" fill="none" stroke="var(--hl)" stroke-width="2" stroke-linejoin="round"/></svg><p>${txt}</p></div>`;
    }).join("");
    return `<div class="explain">
        <div><h3>What is net squared displacement (NSD)?</h3>
          <p>For every position, NSD is the straight-line distance from a starting point, squared. It ignores the path taken and asks only <i>"how far is the elephant from where it started?"</i></p>
          <p>Squaring makes large movements stand out, so a move to a new area appears as a clear step rather than being lost in day-to-day wandering.</p></div>
        <div><h3>Why is it useful?</h3>
          <p>The shape of the NSD line over time shows the kind of movement an elephant is making: staying in one home range, moving seasonally between areas, leaving for good, or wandering widely. This helps you:</p>
          <ul><li>spot seasonal migrations and their timing each year</li>
            <li>see when an elephant shifts to a new range (e.g. a young male dispersing)</li>
            <li>check whether a change in a metric is due to the elephant moving somewhere else</li></ul></div>
      </div>
      <h3>What the shapes mean</h3>
      <div class="patterns">${sk}</div>
      <p class="hint">Real tracks are noisier than these sketches, and an elephant can switch strategy between years. NSD depends on the start point: measured from the collaring point, a long track is dominated by its biggest move, so "Start of each year" is usually easier to compare.</p>`;
  }

  function yearTicks(a, b) {
    const step = Math.max(1, Math.round((b - a) / 8));
    const t = [];
    for (let y = a; y <= b; y += step) t.push({ v: y, label: String(y) });
    return t;
  }

  // ================================================================ Compare
  // Reference = pooled groups only (all / forest / savannah / East Africa); the
  // user's own population(s) are summarised the same way (EMT.compare).
  const selGroups = () => [...document.querySelectorAll("#cmpGroups input:checked")].map((i) => i.value);
  const isBA = (m) => m === "male_female_ba_overlap_year";
  const sexSel = (m) => (isBA(m) ? "All" : $("cmpSex").value);
  const unit = (m) => (isBA(m) ? "study areas" : "elephants");
  const perLab = (scale, p) => (scale === "month" ? MON[p - 1] : String(p));
  const seLo = (p) => (p.se !== null && Number.isFinite(p.se) ? p.m - p.se : null);
  const seHi = (p) => (p.se !== null && Number.isFinite(p.se) ? p.m + p.se : null);
  function qObj(q) {
    const P = REF.meta.probs, at = (p) => q[P.findIndex((x) => Math.abs(x - p) < 1e-9)];
    return { p5: at(0.05), p25: at(0.25), p50: at(0.5), p75: at(0.75), p95: at(0.95) };
  }
  function drawCompare() {
    const m = $("cmpMetric").value, view = document.querySelector('input[name="cmpView"]:checked').value;
    $("cmpViewWrap").classList.toggle("hidden", m === "__overview");
    $("cmpSexWrap").classList.toggle("hidden", isBA(m));
    if (!REF) { $("cmpChart").innerHTML = '<p class="muted">This copy of the calculator has no reference data, so only your own population can be shown (see "Monitoring My Elephants").</p>'; return; }
    if (m === "__overview") return overview();
    const gs = new Set(selGroups());
    const own = G.EMT.compare.summarise(rows, m, view).filter((r) => r.sex === sexSel(m));
    const ref = G.EMT.compare.referenceRows(REF, m, view).filter((r) => gs.has(r.g) && r.sex === sexSel(m));
    if (view === "month" && !own.length && !G.EMT.compare.referenceRows(REF, m, "month").length) {
      $("cmpChart").innerHTML = '<p class="muted">Seasonal patterns are only available for monthly metrics.</p>'; return;
    }
    if (!own.length && !ref.length) { $("cmpChart").innerHTML = '<p class="muted">No values for this selection.</p>'; return; }
    const ownPops = [...new Set(own.map((r) => r.pop))];
    let html;
    if (view === "global") {
      const rowsB = [];
      ownPops.forEach((sa, i) => {
        const r = own.find((x) => x.pop === sa);
        rowsB.push({ label: sa, sub: `yours: ${r.n} ${unit(m)}`, own: true, color: OWN[i % OWN.length], pts: r.vals, m: r.m, mLo: seLo(r), mHi: seHi(r),
                     tip: `${sa}: mean ${C.fmt(r.m)}${r.se !== null ? " ± " + C.fmt(r.se) : ""} (${r.n} ${unit(m)})` });
      });
      for (const g of REF.groups) {
        const r = ref.find((x) => x.g === g.id);
        if (!r) continue;
        const q = r.q ? qObj(r.q) : null;
        rowsB.push({ label: g.label, sub: `${r.n} ${unit(m)}, ${r.ns} study areas`, color: GCOL[g.id], q, m: r.m,
                     tip: `${g.label}: mean ${C.fmt(r.m)}${q ? ", median " + C.fmt(q.p50) : ""} (${r.n} ${unit(m)})` });
      }
      html = `<p class="muted small">Each dot is one of your ${unit(m)} (average over its years); the filled diamond is your population mean ± SE. ` +
             `For each reference group: box = middle 50% of its ${unit(m)}, line = 5-95%, bar = median, open diamond = mean.</p>` +
             C.boxes({ rows: rowsB, xLabel: ylab(m) });
    } else {
      const ser = [];
      for (const g of REF.groups) {
        const pts = ref.filter((r) => r.g === g.id);
        if (!pts.length) continue;
        ser.push({ label: g.label, color: GCOL[g.id], width: 1.8, r: 2.2, band: true,
                   pts: pts.map((p) => [p.period, p.m, seLo(p), seHi(p), `${g.label}, ${perLab(view, p.period)}: ${C.fmt(p.m)} (${p.n} ${unit(m)}, ${p.ns} study areas)`]) });
      }
      ownPops.forEach((sa, i) => ser.push({ label: sa + " (yours)", color: OWN[i % OWN.length], width: 2.8, r: 3.4, band: view === "month", bars: view === "year",
        pts: own.filter((r) => r.pop === sa).map((p) => [p.period, p.m, seLo(p), seHi(p), `${sa}, ${perLab(view, p.period)}: ${C.fmt(p.m)}${p.se !== null ? " ± " + C.fmt(p.se) : ""} (${p.n} ${unit(m)})`]) }));
      const xs = ser.flatMap((s) => s.pts.map((p) => p[0]));
      const dom = view === "year" ? [Math.min(...xs) - 0.5, Math.max(...xs) + 0.5] : [0.5, 12.5];
      html = `<p class="muted small">${view === "year" ? "Mean across elephants per year (± SE)" : "Mean by calendar month across years and elephants (± SE)"}, for each reference group and your population.</p>` +
        C.line({ series: ser, xDomain: dom, xTicks: view === "year" ? yearTicks(Math.ceil(dom[0]), Math.floor(dom[1])) : MON.map((l, i) => ({ v: i + 1, label: l })),
                 yLabel: ylab(m), maxGap: 1.5, refY: m === "night_day_speed_ratio" ? 1 : undefined });
    }
    $("cmpChart").innerHTML = html;
  }
  // your median vs each reference group's median, metric by metric, on a shared value scale
  const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y), n = s.length;
                          return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
  function cmpBar(own, q) {
    // scale = the group's 5-95% range, widened to include your median if it falls outside
    let lo = Math.min(q.p5, Number.isFinite(own) ? own : q.p5), hi = Math.max(q.p95, Number.isFinite(own) ? own : q.p95);
    const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.1 || 1;
    lo -= pad; hi += pad;
    const pos = (v) => (100 * (v - lo)) / (hi - lo);
    const g = pos(q.p50), o = Number.isFinite(own) ? pos(own) : null;
    // labels sit above their line; when the lines are close, push the labels apart
    const near = o !== null && Math.abs(o - g) < 30;
    const shift = (me, other) => (!near ? "-50%" : me <= other ? "-100%" : "0%");
    const lab = (cls, p, val, other) => `<span class="cmplab ${cls}" style="left:${p.toFixed(1)}%;transform:translateX(${shift(p, other)})">${C.fmt(val)}</span>`;
    return `<div class="cmpbar"><div class="cmpband" style="left:${pos(q.p5).toFixed(1)}%;width:${(pos(q.p95) - pos(q.p5)).toFixed(1)}%"></div>` +
      `<div class="cmpline grp" style="left:${g.toFixed(1)}%"></div>` + lab("grp", g, q.p50, o ?? g) +
      (o !== null ? `<div class="cmpline own" style="left:${o.toFixed(1)}%"></div>` + lab("own", o, own, g) : "") + `</div>`;
  }
  function overview() {
    const groups = REF.groups.filter((g) => selGroups().includes(g.id));
    const sexTxt = $("cmpSex").value === "All" ? "" : ` (${$("cmpSex").value.toLowerCase()}s only)`;
    let body = "";
    for (const m of Object.keys(META)) {
      const own = G.EMT.compare.summarise(rows, m, "global", () => "yours").find((r) => r.sex === sexSel(m));
      if (!own) continue;
      const ownMed = median(own.vals || []);
      const refG = G.EMT.compare.referenceRows(REF, m, "global").filter((r) => r.sex === sexSel(m));
      body += `<tr><td>${esc(title(m))}</td>` + groups.map((g) => {
        const r = refG.find((x) => x.g === g.id);
        return r && r.q ? `<td>${cmpBar(ownMed, qObj(r.q))}</td>` : "<td>-</td>";
      }).join("") + "</tr>";
    }
    $("cmpChart").innerHTML = `<div class="cmplegend small">
        <span><i class="sw own"></i>Your elephants: median${sexTxt}</span>
        <span><i class="sw grp"></i>Group's median elephant</span>
        <span><i class="sw band"></i>Middle 90% of the group's elephants</span>
        <span class="muted">Each elephant is averaged over its years first. Male-female overlap: study areas instead of elephants.</span>
      </div>
      <div class="tablewrap tall"><table class="cmptable"><thead><tr><th>Metric</th>${groups.map((g) => `<th>${esc(g.label)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function wire() {
    ["myMetric", "myArea"].forEach((id) => $(id).addEventListener("change", () => { refreshElephants(); drawMine(); }));
    $("myFocal").addEventListener("change", () => { refreshElephants(); drawMine(); });
    $("myCompare").addEventListener("change", drawMine);
    $("nsdStart").addEventListener("change", drawMine);
    document.querySelectorAll('input[name="myFig"]').forEach((r) => r.addEventListener("change", drawMine));
    ["cmpMetric", "cmpSex"].forEach((id) => $(id).addEventListener("change", drawCompare));
    $("cmpGroups").addEventListener("change", drawCompare);
    document.querySelectorAll('input[name="cmpView"]').forEach((r) => r.addEventListener("change", drawCompare));
  }
  G.EMTExplore = { init, wire, loadReference, title };
})(typeof globalThis !== "undefined" ? globalThis : self);
