/* Calculator page logic (main thread). Heavy work runs in the Web Worker. */
(function () {
  const SEND_URL = "__SEND_URL__";       // Apps Script receiver (receiver/README.md), Send button only; empty = e-mail fallback
  const SEND_EMAIL = "__SEND_EMAIL__";
  const VERSION = "__VERSION__";
  const SITE_URL = "__SITE_URL__";       // GitHub Pages site: serves version.json and the latest calculator
  const COMPARE = "__COMPARE__" === "on";   // release.config.json "compareEnabled"; off = Compare greyed out ("Coming soon")
  const $ = (id) => document.getElementById(id);
  const worker = new Worker(URL.createObjectURL(new Blob([$("worker-src").textContent], { type: "text/javascript" })));
  let files = [], preview = null, scanned = null, results = null, assumeUTC = true;

  $("ver").textContent = VERSION;
  // Compare switched off: keep its card visible but greyed out with a "Coming soon" note
  if (!COMPARE) {
    const card = document.querySelector('.nextcard[data-open="tabCompare"]');
    card.disabled = true; card.classList.add("soon"); card.setAttribute("aria-disabled", "true");
    document.querySelectorAll(".cmpOnly").forEach((el) => el.classList.add("hidden"));
  }
  EMTExplore.wire();

  // ------------------------------------------------------------- update check
  // When online, read the version note (version.json on the GitHub Pages site; written
  // by release.js). Sends nothing about the user's data. Offline, blocked or slow (5 s)
  // = silently skipped, and everything works as before.
  let update = null;   // { latest, required, ... } when this copy is out of date
  const cmpVer = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
                             for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
  const isVer = (v) => /^\d+\.\d+\.\d+$/.test(String(v || ""));
  function checkForUpdate() {
    if (!SITE_URL || navigator.onLine === false || !window.fetch) return;
    const ctl = window.AbortController ? new AbortController() : null;
    if (ctl) setTimeout(() => ctl.abort(), 5000);
    fetch(SITE_URL + "version.json", { cache: "no-store", signal: ctl ? ctl.signal : undefined })
      .then((r) => (r.ok ? r.json() : null))
      .then((n) => {
        if (!n || !isVer(n.latest) || cmpVer(VERSION, n.latest) >= 0) return;
        update = { latest: n.latest, notes: String(n.notes || ""), required: isVer(n.min_version) && cmpVer(VERSION, n.min_version) < 0,
                   download: /^https:\/\//.test(n.download || "") ? n.download : "" };
        showUpdate();
      })
      .catch(() => {});
  }
  function showUpdate() {
    const b = $("updateBanner");
    b.textContent = "";
    b.classList.toggle("required", update.required);
    const head = document.createElement("b");
    head.textContent = update.required ? `Please update this calculator to version ${update.latest}. ` : `A newer version of this calculator (${update.latest}) is available. `;
    b.appendChild(head);
    b.appendChild(document.createTextNode(update.required ? `This copy (${VERSION}) is out of date and can no longer send results. ` : `You have ${VERSION}. `));
    if (update.download) {
      const a = document.createElement("a");
      a.href = update.download; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Open the new version";
      b.appendChild(a);
      b.appendChild(document.createTextNode(" (to use it offline, save it with Ctrl+S / Cmd+S and use the new file instead of this one)."));
    } else b.appendChild(document.createTextNode("Please ask Save the Elephants for the new file."));
    if (update.notes) { const s = document.createElement("span"); s.className = "notes"; s.textContent = "What's new: " + update.notes; b.appendChild(s); }
    b.classList.remove("hidden");
  }
  checkForUpdate();

  // ------------------------------------------------------------- navigation
  function go(n) {
    for (let i = 1; i <= 5; i++) $("step" + i).classList.toggle("hidden", i !== n);
    document.querySelectorAll("#stepper li").forEach((li) => {
      const s = +li.dataset.step;
      li.classList.toggle("on", s === n); li.classList.toggle("done", s < n);
    });
    $("err").classList.add("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => go(+b.dataset.go)));
  function fail(msg) { $("err").textContent = msg; $("err").classList.remove("hidden"); }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const fmtN = (n) => Number(n).toLocaleString();
  const fmtD = (t) => new Date(t).toISOString().slice(0, 10);

  // ------------------------------------------------------------- 1. load
  const drop = $("drop");
  ["dragenter", "dragover"].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (ev) => load([...ev.dataTransfer.files]));
  $("file").addEventListener("change", (ev) => load([...ev.target.files]));
  async function load(fs) {
    if (!fs.length) return;
    files = fs;
    // a metrics file made by this tool -> straight to the results views
    const head = await fs[0].slice(0, 4000).text().catch(() => "");
    const first = head.split(/\r?\n/)[0].replace(/^﻿/, "");
    if (/(^|,)metric(,|$)/.test(first) && /(^|,)granularity(,|$)/.test(first) && /(^|,)value(,|$)/.test(first)) return openMetricsFile(fs[0]);
    drop.querySelector("strong").textContent = "Reading " + fs.map((f) => f.name).join(", ") + " ...";
    worker.postMessage({ cmd: "preview", files });
  }
  async function openMetricsFile(f) {
    const table = EMT.parse.parseCSVText(await f.text());
    const h = table.shift().map((c) => c.replace(/^﻿/, ""));
    const rows = table.map((r) => Object.fromEntries(h.map((c, i) => [c, r[i] === "NA" ? "" : r[i]])));
    if (!rows.length) return fail("That metrics file is empty.");
    const sas = [...new Set(rows.map((r) => r.Study_Area))];
    results = { settings: { studyArea: sas.join(", "), organisation: rows[0].organisation || "" }, rows, metricsCSV: await f.text(), report: null,
                fromFile: f.name, tool_version: rows[0].tool_version || "" };
    $("resTitle").textContent = "- " + f.name;
    ["reportRow", "historyRow", "removedRow", "runDetails", "btnBack3"].forEach((id) => $(id).classList.add("hidden"));
    $("stats").innerHTML = `<div class="stat"><b>${sas.length}</b><span>study area(s): ${esc(sas.join(", "))}</span></div>` +
      `<div class="stat"><b>${new Set(rows.filter((r) => r.Name).map((r) => r.Study_Area + r.Name)).size}</b><span>elephants</span></div>` +
      `<div class="stat"><b>${fmtN(rows.length)}</b><span>total metric values</span></div>`;
    EMTExplore.init(rows);
    updateLocks(); showTab("tabSummary");
    go(5);
  }

  // ------------------------------------------------------------- 2. columns
  const FIELDS = [
    ["id", "Elephant name / ID", true], ["timestamp", "Date and time"], ["date", "Date (if separate)"], ["time", "Time (if separate)"],
    ["lon", "Longitude"], ["lat", "Latitude"], ["x", "UTM easting"], ["y", "UTM northing"], ["geometry", "WKT geometry"],
    ["sex", "Sex"], ["species", "Species"], ["tag", "Collar / tag ID"], ["studyArea", "Study area"],
  ];
  function showPreview(p) {
    preview = p;
    const opts = ['<option value="-1">(none)</option>'].concat(p.headers.map((h, i) => `<option value="${i}">${esc(h || "(column " + (i + 1) + ")")}</option>`)).join("");
    $("mapFields").innerHTML = FIELDS.map(([k, label, req]) =>
      `<div class="maprow" data-k="${k}"><label for="m_${k}">${label}${req ? ' <span class="req">*</span>' : ""}</label><select id="m_${k}">${opts}</select></div>`).join("");
    for (const [k] of FIELDS) {
      const s = $("m_" + k);
      s.value = String(p.det.cols[k] ?? -1);
      s.addEventListener("change", () => { refreshMapRows(); renderPreview(); timeHints(); });
    }
    refreshMapRows();
    // time zone
    const tzs = p.allTZ.slice();
    const guess = p.lookup ? p.lookup.tz : "Africa/Nairobi";
    if (!tzs.includes(guess)) tzs.unshift(guess);
    $("tz").innerHTML = tzs.map((t) => `<option ${t === guess ? "selected" : ""}>${t}</option>`).join("") + '<option value="UTC">UTC</option>';
    $("tzHint").textContent = p.lookup ? `Detected from the coordinates: ${p.lookup.country}. Used to decide day and night (06:00-18:00 local).`
                                       : "Used to decide day and night (06:00-18:00 local).";
    if (p.lookup) $("country").value = p.lookup.country;
    $("dateOrder").value = p.det.dateOrder;
    timeHints();
    const stampCol = p.det.cols.timestamp >= 0 ? p.det.cols.timestamp : p.det.cols.date;
    const ambiguous = stampCol >= 0 && p.sample.some((r) => /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(String(r[stampCol]).trim()));
    $("dateOrderField").classList.toggle("hidden", !ambiguous);
    $("utmField").classList.toggle("hidden", p.det.coordMode !== "utm");
    if (p.utm) { $("utmZone").value = p.utm.zone; $("utmHemi").value = p.utm.south ? "S" : "N"; }
    // combined tracking data file(s) are read automatically; the columns shown are another file's
    $("histNote").classList.toggle("hidden", !p.nHistory);
    $("histNote").textContent = !p.nHistory ? ""
      : p.onlyHistory ? "This is a combined tracking data file saved by this calculator: its columns are already set below."
      : `Your combined tracking data file${p.nHistory > 1 ? "s are" : " is"} read automatically. The columns below are from ${p.primaryName}; please check them.`;
    defaultSA = p.primaryName.replace(/\.[^.]+$/, "").replace(/_?\d{4}-\d{2}-\d{2}_combined_tracking_data$/, "").replace(/[_-]+/g, " ").replace(/\b(clean|data|export|gps|fixes?)\b/gi, "").trim();
    renderPreview();
    drop.querySelector("strong").textContent = "Drop file(s) here";
    go(2);
  }
  function refreshMapRows() {
    const v = (k) => +$("m_" + k).value;
    const hasStamp = v("timestamp") >= 0, hasLL = v("lon") >= 0 && v("lat") >= 0, hasXY = v("x") >= 0 && v("y") >= 0;
    const show = { date: !hasStamp, time: !hasStamp, x: !hasLL, y: !hasLL, geometry: !hasLL && !hasXY };
    for (const [k] of FIELDS) {
      const row = document.querySelector(`.maprow[data-k="${k}"]`);
      if (k in show) row.classList.toggle("hidden", !show[k] && v(k) < 0);
    }
    $("utmField").classList.toggle("hidden", !(hasXY && !hasLL && preview && preview.det.coordMode === "utm"));
  }
  function currentCols() {
    const c = {};
    for (const [k] of FIELDS) c[k] = +$("m_" + k).value;
    return c;
  }
  function renderPreview() {
    const c = currentCols(), used = new Set(Object.values(c).filter((i) => i >= 0));
    const head = preview.headers.map((h, i) => `<th class="${used.has(i) ? "mapped" : ""}">${esc(h)}</th>`).join("");
    const body = preview.sample.map((r) => "<tr>" + preview.headers.map((_, i) => `<td class="${used.has(i) ? "mapped" : ""}">${esc(r[i] ?? "")}</td>`).join("") + "</tr>").join("");
    $("preview").innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  }
  function setUTC(v) {
    assumeUTC = v;
    $("dateOrder").addEventListener("change", () => preview && timeHints());
  document.querySelectorAll("#utcSeg button").forEach((b) => b.classList.toggle("on", (b.dataset.v === "utc") === v));
  }
  /* UTC or local? 1) times carrying their own zone ("Z", "+03:00") need no choice;
   * 2) column names often say (UTC_Date / LMT_Time, Movebank timestamp);
   * 3) otherwise default to UTC - the clock check after reading the file
   *    (core/diel.js) then recommends a change if the daily rhythm disagrees. */
  let explicitZone = false;
  function timeHints() {
    const c = currentCols(), col = c.timestamp >= 0 ? c.timestamp : c.date;
    const vals = col >= 0 ? preview.sample.map((r) => r[col]).filter((v) => v !== "" && v !== null && v !== undefined) : [];
    const zoned = vals.filter((v) => { const p = EMT.time.parseStamp(v, $("dateOrder").value); return p && p.zone !== null; }).length;
    explicitZone = vals.length > 0 && zoned / vals.length >= 0.9;
    $("utcSeg").classList.toggle("hidden", explicitZone);
    const names = [c.timestamp, c.date, c.time].filter((i) => i >= 0).map((i) => preview.headers[i]).join(" ");
    if (explicitZone) {
      setUTC(true);
      const zones = new Set(vals.map((v) => { const p = EMT.time.parseStamp(v, $("dateOrder").value); return p && p.zone; }).filter((z) => z !== null && z !== undefined));
      const isUTC = [...zones].every((z) => z === 0);
      const z = [...zones][0], hm = (ms) => `${ms < 0 ? "-" : "+"}${String(Math.floor(Math.abs(ms) / 3600000)).padStart(2, "0")}:${String(Math.abs(ms) / 60000 % 60).padStart(2, "0")}`;
      $("utcHint").textContent = isUTC ? "UTC timezone detected. Will be converted to local time."
                                       : `Time zone (${hm(z)}) detected. Will be converted to local time.`;
    } else if (/utc|gmt|zulu/i.test(names) || preview.det.movebank) {
      setUTC(true);
      $("utcHint").textContent = preview.det.movebank ? "This looks like a Movebank export, whose 'timestamp' column is UTC." : "The column name says UTC, so UTC is selected.";
    } else if (/lmt|local/i.test(names)) {
      setUTC(false);
      $("utcHint").textContent = "The column name says local time (LMT), so Local time is selected.";
    } else {
      setUTC(true);
      $("utcHint").textContent = "Not sure? Leave UTC: most collar systems export UTC. After reading the file, the calculator checks the elephants' daily rhythm and tells you if the times look like local time instead.";
    }
  }
  document.querySelectorAll("#utcSeg button").forEach((b) => b.addEventListener("click", () => setUTC(b.dataset.v === "utc")));

  $("btnScan").addEventListener("click", () => {
    const c = currentCols();
    const coordMode = c.lon >= 0 && c.lat >= 0 ? "lonlat" : c.x >= 0 && c.y >= 0 ? (preview.det.coordMode === "xy_degrees" ? "xy_degrees" : "utm") : c.geometry >= 0 ? "wkt" : null;
    const missing = [];
    if (c.id < 0) missing.push("elephant name / ID");
    if (c.timestamp < 0 && c.date < 0) missing.push("date and time");
    if (!coordMode) missing.push("coordinates (longitude + latitude, UTM easting + northing, or WKT)");
    if (coordMode === "utm" && !(+$("utmZone").value >= 1)) missing.push("UTM zone");
    if (missing.length) return fail("Please choose a column for: " + missing.join(", ") + ".");
    scan();
  });
  function scan() {
    const c = currentCols();
    const coordMode = c.lon >= 0 && c.lat >= 0 ? "lonlat" : c.x >= 0 && c.y >= 0 ? (preview.det.coordMode === "xy_degrees" ? "xy_degrees" : "utm") : c.geometry >= 0 ? "wkt" : null;
    const mapping = { cols: c, coordMode, dateOrder: $("dateOrder").value, assumeUTC, tz: $("tz").value, explicitZone,
                      utmZone: +$("utmZone").value, utmSouth: $("utmHemi").value === "S", speciesFilter: true };
    $("btnScan").disabled = true; $("btnScan").textContent = "Reading...";
    let template = null;
    try { template = JSON.parse($("diel-data").textContent); } catch (e) { /* no template in this build */ }
    worker.postMessage({ cmd: "scan", mapping, template });
  }
  // result of the daily-rhythm clock check, shown on step 3
  function showClock(k) {
    const box = $("clockNote"), tz = $("tz").value;
    const chosen = assumeUTC ? "UTC" : "local time";
    if (!k || k.verdict === "explicit" || k.verdict === "unavailable") { box.className = "note hidden"; return; }
    const off = k.offsetH !== undefined ? `UTC${k.offsetH >= 0 ? "+" : ""}${k.offsetH}` : "";
    let html, cls = "note";
    if (k.verdict === "either") html = `Clock check: ${esc(tz)} is the same as UTC, so it does not matter whether the times are UTC or local.`;
    else if (k.verdict === "unclear") {
      cls = "note muted";
      html = `Clock check: we could not tell from the elephants' daily rhythm whether the times are UTC or local (${esc(k.reason || "")}). ` +
             `You chose <b>${chosen}</b>. If unsure, ask whoever exported the data; most collar systems export UTC.`;
    } else {
      const says = k.verdict === "utc" ? "UTC" : `local time (${esc(tz)}, ${off})`;
      const agrees = (k.verdict === "utc") === assumeUTC;
      const how = k.confidence === "high" ? "clearly matches" : "probably matches";
      if (agrees) html = `Clock check: the elephants' daily rhythm ${how} times in <b>${says}</b>, as you chose.`;
      else {
        cls = "note warn";
        html = `<b>Clock check:</b> the elephants' daily rhythm ${how} times in <b>${says}</b>, but you chose <b>${chosen}</b>. ` +
               `If the times were really ${says}, day and night would be misplaced by about ${Math.abs(k.offsetH)} hours. ` +
               `<div class="row gap" style="margin-top:8px"><button class="small primary" id="clockSwitch">Switch to ${k.verdict === "utc" ? "UTC" : "local time"} and re-read</button>` +
               `<button class="small ghost" id="clockKeep">Keep ${chosen}</button></div>`;
      }
    }
    box.className = cls; box.innerHTML = html;
    if ($("clockSwitch")) {
      $("clockSwitch").onclick = () => { setUTC(k.verdict === "utc"); box.innerHTML = "Re-reading the file..."; scan(); };
      $("clockKeep").onclick = () => { box.className = "note muted"; box.textContent = `Keeping ${chosen} as you chose.`; };
    }
  }

  // ------------------------------------------------------------- 3. elephants
  function showScan(s) {
    scanned = s;
    $("btnScan").disabled = false; $("btnScan").textContent = "Read the whole file";
    if (!s.nFixes) return fail("No usable rows were found. Check the column choices (and the date format) on the previous step.\n" + JSON.stringify(s.dropped));
    const dropTxt = Object.entries(s.dropped).map(([k, v]) => `${fmtN(v)} ${({ no_id: "without an elephant ID", bad_timestamp: "with an unreadable date/time", no_coordinates: "without coordinates", not_elephant: "of other species" })[k] || k}`).join(", ");
    $("scanSummary").innerHTML = `Read <b>${fmtN(s.nFixes)}</b> GPS fixes for <b>${s.individuals.length}</b> elephants` +
      (dropTxt ? `. Skipped rows: ${esc(dropTxt)}.` : ".");
    if (s.nHistoryFixes) $("scanSummary").innerHTML += ` This includes <b>${fmtN(s.nHistoryFixes)}</b> fixes from your combined tracking data file.`;
    $("scanSummary").className = "note" + (s.dropped.bad_timestamp > s.nFixes * 0.05 ? " warn" : "");
    showClock(s.clock);
    showSpan(s.individuals);
    if (s.lookup && !$("country").value) $("country").value = s.lookup.country;
    // study areas: from the file's study-area column (or a combined tracking data file) if
    // there is one, else one area named from the file
    const saCol = (+$("m_studyArea").value >= 0 || s.nHistoryFixes > 0) && s.studyAreas.length > 0;
    saNames = saCol ? s.studyAreas.slice() : [defaultSA];
    if (saCol && s.individuals.some((g) => !g.sa)) saNames.push(defaultSA);          // elephants with blank study area
    s.individuals.forEach((g) => (g.saIdx = g.sa && saNames.includes(g.sa) ? saNames.indexOf(g.sa) : saNames.length - 1));
    fileSACount = saNames.length;
    $("saColHint").textContent = !saCol ? "Enter the study area name."
      : s.studyAreas.length === 1 ? `Study area taken from the file: ${s.studyAreas[0]}. Enter study area name here if that is incorrect.`
      : `Study areas taken from the file: ${s.studyAreas.join(", ")}. Edit any name that is incorrect.`;
    $("indCount").textContent = `(${s.individuals.length})`;
    const rows = s.individuals.map((g, i) => `<tr><td>${esc(g.name)}${g.sexConflict ? '<span class="tag warn">sex differs between rows</span>' : ""}</td>
      <td>${fmtN(g.n)}</td><td>${fmtD(g.first)}</td><td>${fmtD(g.last)}</td>
      <td><select class="sexsel" data-i="${i}"><option value="">unknown</option><option value="female" ${g.sex === "female" ? "selected" : ""}>female</option><option value="male" ${g.sex === "male" ? "selected" : ""}>male</option></select></td>
      <td><select class="sasel" data-i="${i}"></select></td></tr>`).join("");
    $("indTable").innerHTML = `<thead><tr><th>Elephant</th><th>Fixes</th><th>First</th><th>Last</th><th>Sex</th><th>Study area</th></tr></thead><tbody>${rows}</tbody>`;
    renderSAs();
    document.querySelectorAll("#indTable .sasel").forEach((sel) => (sel.value = String(s.individuals[+sel.dataset.i].saIdx)));
    go(3);
  }
  // Warn when the data look like a single download rather than the whole history:
  // annual metrics need >= 6 months in a calendar year, year-to-year metrics need
  // consecutive years, and cleaning treats the start/end of each track specially.
  function showSpan(inds) {
    const box = $("spanNote"), DAY = 864e5;
    const first = Math.min(...inds.map((g) => g.first)), last = Math.max(...inds.map((g) => g.last));
    const months = Math.round((last - first) / DAY / 30.44);
    const short = inds.filter((g) => (g.last - g.first) / DAY < 183).length;
    const why = "Annual metrics (home range, MCP area, intensity of use, yearly displacement) need at least 6 months within a calendar year, " +
                "and year-to-year metrics (range overlap and space-use shift from the previous year) need consecutive years. ";
    const fix = "If you have earlier downloads for these elephants, go back to step 1 and load all the files together, " +
                "or load your <b>combined tracking data</b> file from last time together with the new download.";
    let head = "";
    if ((last - first) / DAY < 395) head = `Your data cover only about ${months} month${months === 1 ? "" : "s"} (${fmtD(first)} to ${fmtD(last)}). `;
    else if (short > inds.length / 2) head = `${short} of your ${inds.length} elephants have less than 6 months of data. `;
    if (!head) { box.className = "note warn hidden"; return; }
    box.className = "note warn";
    box.innerHTML = `<b>${head}</b>${why}${fix}<div class="row gap" style="margin-top:8px"><button class="small ghost" id="spanBack">Back to step 1</button></div>`;
    $("spanBack").onclick = () => { $("file").value = ""; go(1); };
  }
  // ---- study-area names and per-elephant assignment
  let saNames = [], fileSACount = 0, defaultSA = "";
  function renderSAs() {
    $("saList").innerHTML = saNames.map((n, k) => `<div class="sarow"><input data-k="${k}" value="${esc(n)}" placeholder="Study area name">` +
      (k >= fileSACount ? `<button class="small ghost" data-rm="${k}">Remove</button>` : "") + `</div>`).join("");
    refreshSASelects();
  }
  function refreshSASelects() {
    document.querySelectorAll("#indTable .sasel").forEach((sel) => {
      const cur = sel.value;
      sel.innerHTML = saNames.map((n, k) => `<option value="${k}">${esc(n || "(unnamed study area)")}</option>`).join("");
      if (cur !== "" && +cur < saNames.length) sel.value = cur;
    });
  }
  $("saList").addEventListener("input", (e) => { const k = e.target.dataset.k; if (k !== undefined) { saNames[+k] = e.target.value; refreshSASelects(); } });
  $("saList").addEventListener("click", (e) => {
    const k = e.target.dataset.rm;
    if (k === undefined) return;
    document.querySelectorAll("#indTable .sasel").forEach((sel) => {    // its elephants go back to the first study area
      if (+sel.value === +k) sel.value = "0"; else if (+sel.value > +k) sel.value = String(+sel.value - 1);
    });
    const keep = [...document.querySelectorAll("#indTable .sasel")].map((sel) => sel.value);
    saNames.splice(+k, 1); renderSAs();
    document.querySelectorAll("#indTable .sasel").forEach((sel, i) => (sel.value = keep[i]));
  });
  $("addSA").addEventListener("click", () => {
    const keep = [...document.querySelectorAll("#indTable .sasel")].map((sel) => sel.value);
    saNames.push(""); renderSAs();
    document.querySelectorAll("#indTable .sasel").forEach((sel, i) => (sel.value = keep[i]));
    const inputs = $("saList").querySelectorAll("input"); inputs[inputs.length - 1].focus();
  });
  const setBlanks = (v) => document.querySelectorAll("#indTable .sexsel").forEach((s) => { if (!s.value) s.value = v; });
  $("allF").addEventListener("click", () => setBlanks("female"));
  $("allM").addEventListener("click", () => setBlanks("male"));

  $("btnRun").addEventListener("click", () => {
    const names = saNames.map((n) => n.trim());
    const studyAreaByName = {}, used = new Set();
    document.querySelectorAll("#indTable .sasel").forEach((s) => {
      const nm = names[+s.value];
      studyAreaByName[scanned.individuals[+s.dataset.i].name] = nm;
      used.add(+s.value);
    });
    if ([...used].some((k) => !names[k])) return fail("Please give every study area a name.");
    const usedNames = [...used].sort((a, b) => a - b).map((k) => names[k]);
    if (new Set(usedNames).size !== usedNames.length) return fail("Two study areas have the same name. Please make each name different.");
    const sa = usedNames[0];
    const sexByName = {};
    document.querySelectorAll("#indTable .sexsel").forEach((s) => (sexByName[scanned.individuals[+s.dataset.i].name] = s.value));
    const settings = {
      studyArea: sa, studyAreas: usedNames, studyAreaByName, country: $("country").value.trim(), organisation: $("org").value.trim(), tz: $("tz").value,
      assumeUTC, sexByName, anonymise: false,
      sourceFiles: files.map((f) => f.name).join("; "),
      compat: { pointsUTC: false, emdMaskFlip: false },
    };
    results = { settings };
    $("barFill").style.width = "0"; $("stage").textContent = "Starting...";
    go(4);
    worker.postMessage({ cmd: "run", settings });
  });

  // ------------------------------------------------------------- 5. results
  function showResults(r) {
    Object.assign(results, r);
    const c = r.cleaning;
    const nInd = r.studyAreas.reduce((a, s) => a + (s.nIndividuals || 0), 0);
    const excl = r.studyAreas.reduce((a, s) => a + ((s.excluded || []).length), 0);
    const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
    $("stats").innerHTML = stat(fmtN(c.nIn), "fixes read") + stat(fmtN(c.nIn - c.nOut), "removed by cleaning") +
      stat(nInd, "elephants with metrics") + (excl ? stat(excl, "skipped (fixes > 6 h apart)") : "") + stat(fmtN(r.nRows), "total metric values") +
      stat(r.seconds.toFixed(0) + " s", "run time");
    const L = { invalid_coordinates: "Bad / 0,0 coordinates", duplicate: "Exact duplicates", duplicate_5min: "< 5 min after previous fix",
                outside_africa: "Outside Africa", far_outlier: "Far outside the animal's range", suspicious_vehicle: "Speed >= 25 km/h",
                suspicious_airborne: "Speed >= 150 km/h", predeployment: "Before deployment", immobility: "Stationary at end of track",
                shift_episode: "Isolated GPS spike" };
    const cl = Object.entries(c.counts).sort((a, b) => b[1] - a[1]);
    $("cleanTable").innerHTML = "<tbody>" + (cl.length ? cl.map(([k, v]) => `<tr><td>${L[k] || k}</td><td>${fmtN(v)}</td></tr>`).join("") : "<tr><td>Nothing needed removing</td><td>0</td></tr>") + "</tbody>";
    $("metricTable").innerHTML = "<tbody>" + Object.entries(r.perMetric).map(([k, v]) => `<tr><td>${k}</td><td>${fmtN(v)}</td></tr>`).join("") + "</tbody>";
    ["reportRow", "historyRow", "removedRow", "runDetails", "btnBack3"].forEach((id) => $(id).classList.remove("hidden"));
    $("resTitle").textContent = "";
    drawCoverage(r.coverage);
    EMTExplore.init(r.rows);
    updateLocks(); showTab("tabSummary");
    go(5);
  }
  // The results views unlock once the metrics have been sent to STE. Sent files are
  // remembered on this computer (by a fingerprint of the metrics file), so reopening
  // a saved metrics file does not ask again.
  let shownView = "tabSummary";
  const LOCKED_TABS = ["tabCompare"];   // My elephants is always open; comparing needs a submission
  function fingerprint(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16) + ":" + s.length; }
  function sentList() { try { return JSON.parse(localStorage.getItem("emt_sent") || "[]"); } catch (e) { return []; } }
  let sentThisSession = new Set();
  const isSent = () => results && results.metricsCSV && (sentThisSession.has(fingerprint(results.metricsCSV)) || sentList().includes(fingerprint(results.metricsCSV)));
  function markSent() {
    const fp = fingerprint(results.metricsCSV);
    sentThisSession.add(fp);
    try { localStorage.setItem("emt_sent", JSON.stringify(sentList().concat(fp).slice(-200))); } catch (e) { /* storage unavailable */ }
    updateLocks();
    showTab(shownView);      // a locked tab the user was on opens straight away
  }
  function updateLocks() {
    const sent = isSent();
    $("mineReminder").classList.toggle("hidden", sent);
    $("sendArrow").classList.toggle("hidden", sent);   // arrow only while not yet sent
    $("cmpCardAction").textContent = !COMPARE ? "Coming soon: comparisons will open once partners agree to share pooled summaries."
                                   : sent ? "" : "Send your metrics first to unlock";
    $("sendTitle").textContent = sent ? "Sent to Save the Elephants - thank you" : "Send your metrics to Save the Elephants";
    $("sendText").textContent = !COMPARE
      ? (sent ? "If you recalculate, please send your final results again."
              : "Please send once your results are final. Sends only the metrics file (summary values per elephant-month and elephant-year; no locations or times). You see exactly what is sent first.")
      : sent ? "Compare with other populations is now unlocked. If you recalculate, please send your final results again."
             : "Needed to compare your results with other populations. Please send once your results are final. Sends only the metrics file (summary values per elephant-month and elephant-year; no locations or times). You see exactly what is sent first.";
  }
  function showTab(id) {
    if (id === "tabCompare" && !COMPARE) return;
    const locked = LOCKED_TABS.includes(id) && !isSent();
    shownView = id;
    document.querySelectorAll(".tabpanel").forEach((p) => p.classList.toggle("hidden", p.id !== (locked ? "tabLocked" : id)));
  }
  $("btnSend2").addEventListener("click", () => $("btnSend").click());
  let defsReturn = null;
  $("btnDefs").addEventListener("click", () => {
    if (!$("defsBody").innerHTML) $("defsBody").innerHTML = EMTDefs.html();
    defsReturn = [...document.querySelectorAll("section.step")].find((s) => !s.classList.contains("hidden"));
    if (defsReturn) defsReturn.classList.add("hidden");
    $("stepDefs").classList.remove("hidden"); window.scrollTo({ top: 0 });
  });
  const closeDefs = () => { $("stepDefs").classList.add("hidden"); if (defsReturn) defsReturn.classList.remove("hidden"); window.scrollTo({ top: 0 }); };
  $("defsBack").addEventListener("click", closeDefs); $("defsBack2").addEventListener("click", closeDefs);
  document.querySelectorAll(".nextcard").forEach((b) => b.addEventListener("click", () => { showTab(b.dataset.open); window.scrollTo({ top: $("step5").getBoundingClientRect().top + window.scrollY - 12, behavior: "smooth" }); }));
  $("btnSend3").addEventListener("click", () => $("btnSend").click());
  document.querySelectorAll(".backsum").forEach((b) => b.addEventListener("click", () => { showTab("tabSummary"); window.scrollTo({ top: $("step5").getBoundingClientRect().top + window.scrollY - 12, behavior: "smooth" }); }));

  // ------------------------------------------------------------- send to STE
  // Posts the metrics file (and optionally the run report) to STE's Apps Script
  // receiver in a new tab, which shows the confirmation. Without a receiver, or
  // offline, the file is downloaded and an e-mail draft opened instead.
  $("btnSend").addEventListener("click", () => {
    if (update && update.required) {   // a required update is pending: results from this copy are not accepted
      fail(`This calculator (version ${VERSION}) is out of date. Please download version ${update.latest} (see the message at the top), ` +
           "recalculate with it, and send those results.");
      $("updateBanner").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const rows = results.rows || [];
    const sas = [...new Set(rows.map((r) => r.Study_Area))];
    const nEle = new Set(rows.filter((r) => r.Name).map((r) => r.Study_Area + "|" + r.Name)).size;
    const yrs = rows.map((r) => +r.year).filter(Number.isFinite);
    $("sendWhat").innerHTML = `<b>${esc(stem())}_metrics.csv</b>: ${fmtN(rows.length)} metric values for ${nEle} elephants in ${esc(sas.join(", "))} (${Math.min(...yrs)}-${Math.max(...yrs)}).<br>
      Columns: study area, elephant name, sex, year, month, metric, value and summary counts. <b>No locations, no fix times, no raw data.</b>`;
    $("sReport").parentElement.classList.toggle("hidden", !results.report);
    const online = navigator.onLine !== false;
    $("sendHow").textContent = SEND_URL && online
      ? "Clicking Send opens a confirmation page from Save the Elephants in a new tab."
      : `${SEND_URL ? "This computer seems to be offline, so" : "Clicking"} Send will save the file and open an e-mail to ${SEND_EMAIL} - please attach the saved file to it.`;
    $("sendGo").textContent = SEND_URL && online ? "Send" : "Save file and open e-mail";
    $("sendDlg").showModal();
  });
  $("sendForm").addEventListener("submit", (ev) => {
    if (ev.submitter && ev.submitter.value !== "send") return;
    const meta = { study_area: (results.settings.studyAreas || [results.settings.studyArea || ""]).join(", "), organisation: results.settings.organisation || "",
                   contact_name: $("sName").value.trim(), contact_email: $("sEmail").value.trim(), message: $("sMsg").value.trim(),
                   tool_version: VERSION };
    if (SEND_URL && navigator.onLine !== false) {
      const f = document.createElement("form");
      f.method = "POST"; f.action = SEND_URL; f.target = "_blank"; f.acceptCharset = "UTF-8"; f.style.display = "none";
      const add = (k, v) => { const t = document.createElement("textarea"); t.name = k; t.value = v; f.appendChild(t); };
      Object.entries(meta).forEach(([k, v]) => add(k, v));
      add("metrics", results.metricsCSV);
      if ($("sReport").checked && results.report) add("report", results.report);
      document.body.appendChild(f); f.submit(); f.remove();
      markSent();
    } else {
      save(results.metricsCSV, stem() + "_metrics.csv");
      const body = `Hello,\n\nPlease find attached the elephant metrics for ${meta.study_area} (${meta.organisation || "organisation"}), made with the Elephant Movement Metrics Calculator v${VERSION}.\n\n${meta.message}\n\n${meta.contact_name}\n\n[Please attach the file ${stem()}_metrics.csv that was just saved to your Downloads folder.]`;
      window.location.href = `mailto:${SEND_EMAIL}?subject=${encodeURIComponent("Elephant metrics: " + meta.study_area)}&body=${encodeURIComponent(body)}`;
      markSent();   // e-mail fallback: cannot confirm the e-mail was sent, so the click counts
    }
  });
  function drawCoverage(cov) {
    const names = Object.keys(cov).sort();
    if (!names.length) { $("coverage").innerHTML = '<p class="muted">No monthly values (not enough 4-hourly data).</p>'; return; }
    let mn = Infinity, mx = -Infinity, vmax = 0;
    for (const n of names) for (const [y, m, v] of cov[n]) { const k = y * 12 + m - 1; mn = Math.min(mn, k); mx = Math.max(mx, k); vmax = Math.max(vmax, v); }
    const cw = 9, ch = 14, left = 130, top = 16, W = left + (mx - mn + 1) * cw + 10, H = top + names.length * ch + 4;
    const cols = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)"];
    let s = `<svg width="${W}" height="${H}" role="img" aria-label="Months with metrics per elephant">`;
    for (let k = mn; k <= mx; k++) if ((k % 12) === 0) s += `<text x="${left + (k - mn) * cw}" y="11">${Math.floor(k / 12)}</text>`;
    names.forEach((n, i) => {
      const y = top + i * ch;
      s += `<text x="${left - 6}" y="${y + 10}" text-anchor="end">${esc(n.length > 20 ? n.slice(0, 19) + "…" : n)}</text>`;
      s += `<rect x="${left}" y="${y}" width="${(mx - mn + 1) * cw}" height="${ch - 3}" fill="var(--cell0)"/>`;
      for (const [yy, m, v] of cov[n]) {
        const k = yy * 12 + m - 1, b = Math.min(4, Math.floor((v / (vmax || 1)) * 5));
        s += `<rect x="${left + (k - mn) * cw}" y="${y}" width="${cw - 1}" height="${ch - 3}" fill="${cols[b]}"><title>${esc(n)} ${yy}-${String(m).padStart(2, "0")}: ${v} km/h</title></rect>`;
      }
    });
    $("coverage").innerHTML = s + "</svg>";
  }
  function save(text, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  const stem = () => (results.settings.studyArea || "study_area").replace(/[^A-Za-z0-9]+/g, "_") + "_" + new Date().toISOString().slice(0, 10);
  $("dlMetrics").addEventListener("click", () => save(results.metricsCSV, stem() + "_metrics.csv"));
  $("dlReport").addEventListener("click", () => save(results.report, stem() + "_report.txt"));
  $("dlRemoved").addEventListener("click", () => save(results.removed, stem() + "_removed_fixes.csv"));
  $("dlHistory").addEventListener("click", () => {
    $("dlHistory").disabled = true; $("dlHistory").textContent = "Preparing...";
    worker.postMessage({ cmd: "history", settings: results.settings });
  });
  $("restart").addEventListener("click", () => { $("file").value = ""; $("country").value = ""; go(1); });

  // ------------------------------------------------------------- worker messages
  worker.onmessage = (e) => {
    const d = e.data;
    if (d.cmd === "preview") showPreview(d);
    else if (d.cmd === "scanned") showScan(d);
    else if (d.cmd === "progress") {
      $("barFill").style.width = Math.round(d.frac * 100) + "%"; $("stage").textContent = d.stage;
      if (!$("step2").classList.contains("hidden")) $("btnScan").textContent = `${d.stage} ${Math.round(d.frac * 100)}%`;
    } else if (d.cmd === "done") showResults(d);
    else if (d.cmd === "history") {
      save(d.csv, stem() + "_combined_tracking_data.csv");
      $("dlHistory").disabled = false; $("dlHistory").textContent = "Download";
    }
    else if (d.cmd === "error") {
      $("btnScan").disabled = false; $("btnScan").textContent = "Read the whole file";
      drop.querySelector("strong").textContent = "Drop file(s) here";
      fail("Something went wrong: " + d.message);
    }
  };
  worker.onerror = (e) => fail("Something went wrong: " + e.message);
})();
