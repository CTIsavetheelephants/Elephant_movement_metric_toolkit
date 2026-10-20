/* Automatic cleaning - the Tracking_data_cleaner_shiny rules (R/utils_prep.R,
 * R/utils_flags.R, R/mod_flag.R) with the app's default settings, run without
 * human review. Every flagged fix is removed (the review screen ticks all flag types
 * by default). The manual steps have automatic stand-ins:
 *   bounding-box drawing  -> outside_africa (lon -20..55, lat -38..40) and far_outlier
 *                            (> max(300 km, 10 x the animal's median distance from its
 *                            median location))
 *   HQ / airstrip click   -> covered by pre-deployment + end-of-track immobility rules
 *   lasso removal         -> none (isolated spikes are caught by the shift rule)
 * Fixes: {name, tag, sex, t, lon, lat, sa}. */
(function (G) {
  const EMT = (G.EMT = G.EMT || {});
  const U = EMT.util;
  const DAY = EMT.time.DAY, HOUR = EMT.time.HOUR;

  const DEFAULTS = {
    dedupMinGapMin: 5,
    speedVehicleKmh: 25, speedAirKmh: 150,
    predepMaxSpeedKmh: 15, predepMinValidFixes: 5, predepMaxDays: 30,
    immobRadiusM: 200, immobDays: 5, immobMinFixes: 10, immobEndFrac: 0.05,
    shiftM: 10000,
    farOutlierMinM: 300000, farOutlierMult: 10,
    africaBox: [-20, 55, -38, 40],
  };
  const PRIORITY = ["shift_episode", "outside_africa", "far_outlier", "predeployment", "immobility",
                    "suspicious_airborne", "suspicious_vehicle"];
  const LABELS = {
    invalid_coordinates: "Missing, impossible or 0,0 coordinates",
    duplicate: "Exact duplicate (same animal and time)",
    duplicate_5min: "Less than 5 minutes after the previous fix",
    outside_africa: "Outside Africa (GPS error)",
    far_outlier: "Implausibly far from the animal's usual range",
    suspicious_vehicle: "Speed >= 25 km/h into this fix",
    suspicious_airborne: "Speed >= 150 km/h into this fix",
    predeployment: "Before deployment (collar in transit / storage)",
    immobility: "Stationary at the end of the track (dropped collar / mortality)",
    shift_episode: "Isolated jump > 10 km away and back (GPS spike)",
  };

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // ---- pre-deployment (detect_predeployment) ---------------------------------
  function earlyImmobCut(fx, nCap, radius, minDays) {
    let lastI = 0, searchStart = 1;                 // 1-based like the R code
    for (;;) {
      if (searchStart >= nCap) break;
      let found = 0, i = searchStart;
      while (i <= nCap && found === 0) {
        const a = fx[i - 1];
        let j = i + 1;
        while (j <= nCap && dist(fx[j - 1], a) <= radius) j++;
        const stayEnd = j - 1;
        if (stayEnd > i && (fx[stayEnd - 1].t - a.t) / DAY >= minDays) found = stayEnd;
        if (found === 0) i = Math.max(j, i + 1);
      }
      if (found === 0) break;
      lastI = found;
      searchStart = found + 1;
    }
    return lastI;
  }
  function predeployment(fx, o) {
    const n = fx.length, flags = new Array(n).fill(false);
    if (!n) return flags;
    const capT = fx[0].t + o.predepMaxDays * DAY;
    let nCap = 0;
    for (const f of fx) if (f.t <= capT) nCap++;
    const immobCut = nCap < 2 ? 0 : earlyImmobCut(fx, nCap, o.immobRadiusM, o.immobDays);
    // Last speed-flagged fix WITHIN the first predepMaxDays. (The cleaner app takes the
    // last flag in the whole track and ignores it when it falls after the window, so
    // any later GPS spike switched speed-based detection off; fixed here.)
    let lastSus = 0;
    for (let i = 0; i < nCap; i++) if (fx[i].speedFlag === "suspicious_vehicle" || fx[i].speedFlag === "suspicious_airborne") lastSus = i + 1;
    lastSus = Math.max(lastSus, immobCut);
    const startI = lastSus + 1;
    if (startI > n) return flags.fill(true);
    for (let i = startI; i <= n; i++) {
      const endI = Math.min(i + o.predepMinValidFixes - 1, n);
      if (endI - i + 1 !== o.predepMinValidFixes) continue;
      let ok = true;
      for (let k = i; k <= endI; k++) {
        const s = fx[k - 1].speed;
        if (Number.isFinite(s) && s > o.predepMaxSpeedKmh) { ok = false; break; }
      }
      if (ok) { for (let k = 0; k < i - 1; k++) flags[k] = true; break; }
    }
    return flags;
  }
  // ---- end-of-track immobility (flag_immobility) -----------------------------
  function immobility(fx, o) {
    const n = fx.length, out = new Array(n).fill(false);
    let i = 0, terminalStart = -1;
    while (i < n) {
      const a = fx[i];
      let j = i + 1;
      while (j < n && dist(fx[j], a) <= o.immobRadiusM) j++;
      const stayEnd = j - 1;
      if (stayEnd > i) {
        const dur = (fx[stayEnd].t - a.t) / DAY, nIn = stayEnd - i + 1;
        if (dur >= o.immobDays && nIn >= o.immobMinFixes && (n - (stayEnd + 1)) / n <= o.immobEndFrac && terminalStart < 0) terminalStart = i;
      }
      i = Math.max(j, i + 1);
    }
    if (terminalStart >= 0) for (let k = terminalStart; k < n; k++) out[k] = true;
    return out;
  }

  function clean(fixesIn, opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    const removed = [];
    const rm = (f, flag) => removed.push({ name: f.name, t: f.t, lon: f.lon, lat: f.lat, flag });
    const [lo0, lo1, la0, la1] = o.africaBox;
    // 1) coordinate sanity
    let fixes = [];
    for (const f of fixesIn) {
      if (!(f.lon > -180 && f.lon < 180 && f.lat > -90 && f.lat < 90) || (f.lon === 0 && f.lat === 0)) rm(f, "invalid_coordinates");
      else if (f.lon < lo0 || f.lon > lo1 || f.lat < la0 || f.lat > la1) rm(f, "outside_africa");
      else fixes.push(f);
    }
    // 2) exact duplicates, 5-minute minimum gap. Fixes are grouped by elephant name only:
    //    an elephant with several collars stays one elephant (renaming on step 3 lumps or splits)
    fixes.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.t - b.t));
    const kept = [];
    let prev = null, lastKeptT = -Infinity;
    for (const f of fixes) {
      if (!prev || prev.name !== f.name) lastKeptT = -Infinity;
      if (prev && prev.name === f.name && prev.t === f.t) { rm(f, "duplicate"); continue; }
      prev = f;
      if (f.t - lastKeptT < o.dedupMinGapMin * 60000) { rm(f, "duplicate_5min"); continue; }
      lastKeptT = f.t;
      kept.push(f);
    }
    fixes = kept;
    if (!fixes.length) return { fixes, removed, report: { counts: tally(removed), nIn: fixesIn.length, nOut: 0 } };
    // 3) project (one zone for the dataset, like combine_prepped)
    const zone = EMT.utm.zoneFor(fixes.map((f) => f.lon), fixes.map((f) => f.lat));
    for (const f of fixes) { const p = EMT.utm.project(f.lon, f.lat, zone); f.x = p[0]; f.y = p[1]; }
    // 4) median fix interval -> spike-rule gap limit
    const gaps = [];
    const byName = U.groupBy(fixes, (f) => f.name);
    for (const fx of byName.values()) for (let i = 1; i < fx.length; i++) gaps.push((fx[i].t - fx[i - 1].t) / HOUR);
    const medInterval = U.median(gaps);
    const maxGapH = Number.isFinite(medInterval) ? medInterval : 48;

    const out = [];
    const perInd = [];
    for (const [name, all] of byName) {
      // 5) spatial: far outliers (auto stand-in for the drawn bounding box)
      const mx = U.median(all.map((f) => f.x)), my = U.median(all.map((f) => f.y));
      const dc = all.map((f) => Math.hypot(f.x - mx, f.y - my));
      const thr = Math.max(o.farOutlierMinM, o.farOutlierMult * U.median(dc));
      const fx = [];
      all.forEach((f, i) => { if (dc[i] > thr) { f.flag = "far_outlier"; rm(f, "far_outlier"); } else fx.push(f); });
      // 6) speed into each fix
      for (let i = 0; i < fx.length; i++) {
        const f = fx[i];
        if (i === 0) { f.speed = NaN; f.speedFlag = "first_fix"; continue; }
        const s = (f.t - fx[i - 1].t) / 1000, m = dist(f, fx[i - 1]);
        f.speed = s > 0 ? m / 1000 / (s / 3600) : NaN;
        f.speedFlag = !Number.isFinite(f.speed) ? "first_fix" : f.speed >= o.speedAirKmh ? "suspicious_airborne"
                    : f.speed >= o.speedVehicleKmh ? "suspicious_vehicle" : "ok";
      }
      // 7) pre-deployment, 8) spikes, 9) terminal immobility
      const pre = predeployment(fx, o);
      const shift = fx.map((f, i) => {
        if (i === 0 || i === fx.length - 1) return false;
        const a = fx[i - 1], b = fx[i + 1];
        return dist(f, a) > o.shiftM && dist(f, b) > o.shiftM && (f.t - a.t) / HOUR <= maxGapH && (b.t - f.t) / HOUR <= maxGapH;
      });
      const imm = immobility(fx, o).map((v, i) => v && !pre[i]);
      let nRm = 0;
      fx.forEach((f, i) => {
        const flag = shift[i] ? "shift_episode" : pre[i] ? "predeployment" : imm[i] ? "immobility"
                   : f.speedFlag === "suspicious_airborne" ? "suspicious_airborne" : f.speedFlag === "suspicious_vehicle" ? "suspicious_vehicle" : null;
        if (flag) { rm(f, flag); nRm++; } else out.push({ name: f.name, sex: f.sex, t: f.t, lon: f.lon, lat: f.lat, sa: f.sa });
      });
      perInd.push({ name, nIn: all.length, nRemoved: nRm + (all.length - fx.length), first: all[0].t, last: all[all.length - 1].t });
    }
    return {
      fixes: out, removed,
      report: { counts: tally(removed), perIndividual: perInd, medianIntervalH: medInterval,
                nIn: fixesIn.length, nOut: out.length, utmEpsg: zone.epsg },
    };
  }
  function tally(removed) {
    const c = {};
    for (const r of removed) c[r.flag] = (c[r.flag] || 0) + 1;
    return c;
  }

  EMT.clean = { clean, DEFAULTS, LABELS, PRIORITY, predeployment, immobility, earlyImmobCut };
})(typeof globalThis !== "undefined" ? globalThis : self);
