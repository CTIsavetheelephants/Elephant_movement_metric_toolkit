/* Reading collaborator files: streaming CSV (any size), Excel (via SheetJS when
 * present), automatic column detection, and row -> fix extraction. */
(function (G) {
  const EMT = (G.EMT = G.EMT || {});
  const T = EMT.time;

  // ------------------------------------------------------------------ CSV
  function sniffDelimiter(line) {
    const c = { ",": 0, ";": 0, "\t": 0, "|": 0 };
    let q = false;
    for (const ch of line) { if (ch === '"') q = !q; else if (!q && ch in c) c[ch]++; }
    return Object.keys(c).sort((a, b) => c[b] - c[a])[0];
  }
  /* Incremental CSV parser: feed(text) any number of times, then end().
   * onRow(array) is called per record (quotes and embedded newlines handled). */
  function csvParser(onRow) {
    let delim = null, field = "", row = [], q = false, pendingQuote = false, buf = "", first = true;
    function push(text) {
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (pendingQuote) {
          pendingQuote = false;
          if (c === '"') { field += '"'; continue; }
          q = false;
        }
        if (q) {
          if (c === '"') pendingQuote = true; else field += c;
          continue;
        }
        if (c === '"' && field === "") q = true;
        else if (c === delim) { row.push(field); field = ""; }
        else if (c === "\n") { row.push(field.endsWith("\r") ? field.slice(0, -1) : field); field = ""; emit(); }
        else field += c;
      }
    }
    function emit() {
      if (first) { first = false; if (row.length && row[0].charCodeAt(0) === 0xfeff) row[0] = row[0].slice(1); }
      if (!(row.length === 1 && row[0] === "")) onRow(row);
      row = [];
    }
    return {
      feed(text) {
        if (delim === null) {
          buf += text;
          const nl = buf.indexOf("\n");
          if (nl < 0) return;
          delim = sniffDelimiter(buf.slice(0, nl));
          text = buf; buf = "";
        }
        push(text);
      },
      end() {
        if (delim === null) { delim = sniffDelimiter(buf); push(buf); }
        if (pendingQuote) { pendingQuote = false; q = false; }
        if (field !== "" || row.length) { row.push(field); emit(); }
      },
    };
  }
  /* Stream a File/Blob (browser) through the parser. Returns a promise.
   * maxRows stops early (used for the preview pass). Encoding: UTF-8, falling back
   * to latin1 when the first chunk is not valid UTF-8. */
  async function streamCSV(file, onRow, opts) {
    const o = Object.assign({ maxRows: Infinity, onProgress: null }, opts);
    let enc = "utf-8";
    try { new TextDecoder("utf-8", { fatal: true }).decode(await file.slice(0, 65536).arrayBuffer()); }
    catch (e) { enc = "latin1"; }
    const dec = new TextDecoder(enc);
    let n = 0, done = false;
    const STOP = {};
    const p = csvParser((r) => { if (n++ >= o.maxRows) throw STOP; onRow(r); });
    const CH = 8 * 1024 * 1024;
    try {
      for (let off = 0; off < file.size; off += CH) {
        const text = dec.decode(await file.slice(off, off + CH).arrayBuffer(), { stream: off + CH < file.size });
        p.feed(text);
        if (o.onProgress) o.onProgress(Math.min(1, (off + CH) / file.size));
      }
      p.end();
    } catch (e) { if (e !== STOP) throw e; done = true; }
    return { truncated: done };
  }
  function parseCSVText(text) {
    const rows = [];
    const p = csvParser((r) => rows.push(r));
    p.feed(text); p.end();
    return rows;
  }

  // ------------------------------------------------------------------ Excel
  async function readExcel(file) {
    if (!G.XLSX) throw new Error("Excel support is not available in this build - please save the sheet as CSV.");
    const wb = G.XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array", cellDates: false, dense: true });
    let best = null;
    for (const nm of wb.SheetNames) {
      const rows = G.XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, raw: true, defval: "", blankrows: false });
      if (!best || rows.length > best.length) best = rows;
    }
    return best || [];
  }
  function isExcel(bytes) {
    return (bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf);   // xlsx zip / xls OLE
  }

  // ------------------------------------------------------------------ column detection
  const norm = (s) => String(s).toLowerCase().trim().replace(/[\s._-]+/g, "_");
  const CAND = {
    id: ["name", "individual_local_identifier", "id_number", "extra__subject__name", "subject_name", "animal_id", "animal",
         "elephant", "elephant_id", "elephant_name", "individual", "individual_id", "id", "subject"],
    tag: ["tag_local_identifier", "tag", "tagid", "tag_id", "collar_id", "collar", "collarid", "deviceid", "device_id",
          "device", "serial", "collar_serial", "unit_id", "groupby_col"],
    timestamp: ["timestamp", "fixtime", "fix_time", "timestamp_corrected", "time_stamp", "date_time", "datetime",
                "utc_timestamp", "gmt_timestamp", "timestamp_utc", "acquisition_time", "recorded_at", "date_time_utc", "time_utc"],
    date: ["date", "utc_date", "gmt_date", "gps_date", "fix_date", "lmt_date", "date_utc"],
    time: ["time", "utc_time", "gmt_time", "gps_time", "lmt_time", "time_utc", "fixtime"],
    lat: ["lat_wgs", "location_lat", "latitude", "lat", "gps_latitude", "y_wgs", "lat_dd", "latitude_deg", "decimal_latitude"],
    lon: ["lon_wgs", "location_long", "longitude", "lon", "long", "lng", "gps_longitude", "x_wgs", "lon_dd", "longitude_deg", "decimal_longitude"],
    x: ["easting", "utm_x", "utm_easting", "x", "x_utm", "east"],
    y: ["northing", "utm_y", "utm_northing", "y", "y_utm", "north"],
    geometry: ["geometry", "geom", "wkt", "the_geom", "location"],
    sex: ["sex", "gender", "animal_sex", "individual_sex"],
    species: ["species", "individual_taxon_canonical_name", "taxon", "taxon_canonical_name"],
    studyArea: ["study_area", "studyarea", "site", "region", "population", "park", "area", "collar_location"],
  };
  function findCol(headers, list) {
    const h = headers.map(norm);
    for (const c of list) { const i = h.indexOf(c); if (i >= 0) return i; }
    return -1;
  }
  const numFrac = (rows, i, lo, hi) => {
    let ok = 0, n = 0;
    for (const r of rows) {
      const v = r[i];
      if (v === "" || v === null || v === undefined) continue;
      n++;
      const f = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
      if (Number.isFinite(f) && f >= lo && f <= hi) ok++;
    }
    return n ? ok / n : 0;
  };
  const WKT = /POINT\s*Z?\s*\(\s*(-?[\d.eE+-]+)[\s,]+(-?[\d.eE+-]+)/i;

  /* Guess the mapping from the header and a sample of rows. Returns column
   * indices (-1 = absent) plus guessed settings. */
  function detectColumns(headers, sample) {
    const m = {};
    for (const k of Object.keys(CAND)) m[k] = findCol(headers, CAND[k]);
    // when both date and timestamp exist prefer a timestamp that carries a time
    if (m.timestamp >= 0 && sample.length) {
      const hasTime = sample.slice(0, 50).some((r) => /\d:\d\d/.test(String(r[m.timestamp])) || typeof r[m.timestamp] === "number");
      if (!hasTime && m.date < 0) { m.date = m.timestamp; m.timestamp = -1; }
    }
    // no recognised timestamp name: use any column whose values hold a full date AND
    // time (e.g. a column just called "Time" or "Date" with "2019-12-07 15:00:06")
    if (m.timestamp < 0 && sample.length) {
      const FULL = /\d{1,4}[-/.][\dA-Za-z]{1,4}[-/.]\d{1,4}[ T]+\d{1,2}:\d{2}/;
      const isFull = (i) => { const v = sample.slice(0, 200).map((r) => String(r[i] ?? "")).filter(Boolean); return v.length && v.filter((s) => FULL.test(s)).length / v.length >= 0.8; };
      const order = [m.date, m.time].filter((i) => i >= 0).concat(headers.map((_, i) => i));
      const hit = order.find((i) => i >= 0 && isFull(i));
      if (hit !== undefined) m.timestamp = hit;
    }
    if (m.timestamp >= 0) { m.date = -1; m.time = -1; }
    if (m.time >= 0 && m.date < 0) m.time = -1;
    if (m.id < 0 && m.tag >= 0) { m.id = m.tag; m.tag = -1; }
    if (m.tag === m.id) m.tag = -1;
    // coordinates: prefer valid degree columns, else WKT, else projected x/y
    let coordMode = null;
    if (m.lat >= 0 && m.lon >= 0 && numFrac(sample, m.lat, -90, 90) > 0.9 && numFrac(sample, m.lon, -180, 180) > 0.9) coordMode = "lonlat";
    else if (m.geometry >= 0 && sample.some((r) => WKT.test(String(r[m.geometry])))) coordMode = "wkt";
    else if (m.x >= 0 && m.y >= 0) {
      coordMode = numFrac(sample, m.x, -180, 180) > 0.9 && numFrac(sample, m.y, -90, 90) > 0.9 ? "xy_degrees" : "utm";
    }
    let order = "dmy";
    const stampCol = m.timestamp >= 0 ? m.timestamp : m.date;
    if (stampCol >= 0) order = T.detectDateOrder(sample.map((r) => r[stampCol]).filter((v) => typeof v === "string"));
    // Movebank exports: "timestamp" is UTC when a study-local column also exists
    const movebank = headers.map(norm).includes("study_local_timestamp");
    return { cols: m, coordMode, dateOrder: order, movebank };
  }

  /* Rows -> fixes. mapping = {cols, coordMode, dateOrder, assumeUTC, tz, utmZone,
   * utmSouth, speciesFilter}. Returns {fixes, dropped: {reason: n}}. */
  function extractFixes(rows, mp) {
    const c = mp.cols, dropped = {};
    const drop = (k) => (dropped[k] = (dropped[k] || 0) + 1);
    const fixes = [];
    const num = (v) => (typeof v === "number" ? v : parseFloat(String(v).trim().replace(",", ".")));
    for (const r of rows) {
      if (mp.speciesFilter && c.species >= 0) {
        const sp = String(r[c.species] || "").toLowerCase();
        if (sp && !/elephant|loxodonta|savann|forest/.test(sp)) { drop("not_elephant"); continue; }
      }
      let name = c.id >= 0 ? String(r[c.id] ?? "").trim() : "";
      if (!name) { drop("no_id"); continue; }
      const tag = c.tag >= 0 ? String(r[c.tag] ?? "").trim() : "";
      const p = c.timestamp >= 0 ? T.parseStamp(r[c.timestamp], mp.dateOrder)
                                 : T.parseDateTime(r[c.date], c.time >= 0 ? r[c.time] : null, mp.dateOrder);
      const t = T.toUTC(p, mp.assumeUTC, mp.tz);
      if (!Number.isFinite(t)) { drop("bad_timestamp"); continue; }
      let lon, lat;
      if (mp.coordMode === "lonlat") { lon = num(r[c.lon]); lat = num(r[c.lat]); }
      else if (mp.coordMode === "xy_degrees") { lon = num(r[c.x]); lat = num(r[c.y]); }
      else if (mp.coordMode === "wkt") {
        const w = WKT.exec(String(r[c.geometry] || ""));
        if (w) { lon = +w[1]; lat = +w[2]; }
      } else if (mp.coordMode === "utm") {
        const x = num(r[c.x]), y = num(r[c.y]);
        if (Number.isFinite(x) && Number.isFinite(y) && mp.utmZone) [lon, lat] = EMT.utm.unproject(x, y, mp.utmZone, mp.utmSouth);
      }
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) { drop("no_coordinates"); continue; }
      const sex = c.sex >= 0 ? normSex(r[c.sex]) : null;
      const sa = c.studyArea >= 0 ? String(r[c.studyArea] ?? "").trim() : "";
      fixes.push({ name, tag, sex, t, lon, lat, sa });
    }
    return { fixes, dropped };
  }
  function normSex(v) {
    const s = String(v ?? "").trim().toLowerCase();
    return ["f", "female", "cow", "fem", "femelle", "femea", "fêmea"].includes(s) ? "female"
         : ["m", "male", "bull", "mâle", "male_", "macho"].includes(s) ? "male" : null;
  }
  /* Suggest a UTM zone for x/y data: the zone that puts most points on African land. */
  function suggestUtmZone(xs, ys) {
    let best = null;
    for (const south of [true, false]) for (let z = 28; z <= 38; z++) {
      let k = 0;
      for (let i = 0; i < xs.length; i++) {
        const [lo, la] = EMT.utm.unproject(xs[i], ys[i], z, south);
        if (Number.isFinite(lo) && lo > -20 && lo < 55 && la > -38 && la < 40 && EMT.tzlookup && EMT.tzlookup.countryAt(lo, la)) k++;
      }
      if (!best || k > best.k) best = { zone: z, south, k };
    }
    return best;
  }

  EMT.parse = { csvParser, streamCSV, parseCSVText, readExcel, isExcel, detectColumns, extractFixes, normSex,
                suggestUtmZone, CAND, WKT };
})(typeof globalThis !== "undefined" ? globalThis : self);
