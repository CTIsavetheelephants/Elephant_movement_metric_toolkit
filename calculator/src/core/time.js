/* Time handling: UTC epoch milliseconds everywhere, local calendar parts via the
 * IANA time-zone database built into every browser/Node (Intl). */
(function (G) {
  const EMT = (G.EMT = G.EMT || {});
  const DAY = 86400000, HOUR = 3600000;

  // ---- tz offset (ms to add to UTC to get local wall clock), cached per hour ----
  const fmtCache = new Map(), offCache = new Map();
  function fmtFor(tz) {
    let f = fmtCache.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
        hour: "numeric", minute: "numeric", second: "numeric",
      });
      fmtCache.set(tz, f);
    }
    return f;
  }
  function tzOffset(tz, ms) {
    if (!tz || tz === "UTC") return 0;
    const hk = Math.floor(ms / HOUR);
    let c = offCache.get(tz);
    if (!c) { c = new Map(); offCache.set(tz, c); }
    let off = c.get(hk);
    if (off === undefined) {
      const p = {};
      for (const part of fmtFor(tz).formatToParts(new Date(hk * HOUR))) p[part.type] = part.value;
      const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      off = asUTC - hk * HOUR;
      c.set(hk, off);
    }
    return off;
  }
  // local wall-clock ms (as if UTC) -> true UTC ms
  function localToUTC(tz, wallMs) {
    let off = tzOffset(tz, wallMs);
    off = tzOffset(tz, wallMs - off);
    return wallMs - off;
  }
  function isValidTZ(tz) {
    try { fmtFor(tz); return true; } catch (e) { return false; }
  }

  // ---- civil date <-> day number (Hinnant), day 0 = 1970-01-01 ----
  function civilFromDays(z) {
    z += 719468;
    const era = Math.floor(z / 146097);
    const doe = z - era * 146097;
    const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    const y = yoe + era * 400;
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const m = mp < 10 ? mp + 3 : mp - 9;
    return [m <= 2 ? y + 1 : y, m, d];
  }
  function daysFromCivil(y, m, d) {
    y -= m <= 2 ? 1 : 0;
    const era = Math.floor(y / 400);
    const yoe = y - era * 400;
    const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }
  function isoWeek(dayNum) {
    const wd = (((dayNum + 3) % 7) + 7) % 7;          // Monday = 0
    const thu = dayNum - wd + 3;
    const isoYear = civilFromDays(thu)[0];
    const week = Math.floor((thu - daysFromCivil(isoYear, 1, 1)) / 7) + 1;
    return [isoYear, week];
  }
  // Calendar parts of a UTC instant in tz
  function localParts(ms, tz) {
    const lm = ms + tzOffset(tz, ms);
    const dayNum = Math.floor(lm / DAY);
    const [y, m, d] = civilFromDays(dayNum);
    const sod = lm - dayNum * DAY;
    return { y, m, d, dayNum, hour: Math.floor(sod / HOUR) };
  }
  // UTC calendar day number of an instant (R as.Date(<POSIXct>) without tz= -> UTC)
  function utcDayNum(ms) { return Math.floor(ms / DAY); }
  // UTC ms of local midnight that starts local day `dayNum` in tz
  function localMidnightUTC(dayNum, tz) { return localToUTC(tz, dayNum * DAY); }

  // ---- timestamp parsing -------------------------------------------------------
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const TIME = "(?:[ T]+(\\d{1,2}):(\\d{2})(?::(\\d{2})(?:[.,](\\d+))?)?\\s*([AaPp][Mm])?)?";
  const ZONE = "\\s*(Z|UTC|GMT|[+-]\\d{2}(?::?\\d{2})?)?";
  const RE_YMD = new RegExp("^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})" + TIME + ZONE + "$", "i");
  const RE_XXY = new RegExp("^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{2,4})" + TIME + ZONE + "$", "i");
  const RE_DMONY = new RegExp("^(\\d{1,2})[-/ ]([A-Za-z]{3,4})[A-Za-z]*[-/ ,]+(\\d{2,4})" + TIME + ZONE + "$", "i");
  const RE_TIMEONLY = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*([AaPp][Mm])?$/;

  function hms(H, M, S, frac, ampm) {
    let h = H ? +H : 0;
    if (ampm) {
      const pm = /p/i.test(ampm);
      if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12;
    }
    const fr = frac ? Number("0." + frac) : 0;
    return ((h * 60 + (M ? +M : 0)) * 60 + (S ? +S : 0) + fr) * 1000;
  }
  function zoneMs(z) {
    if (!z) return null;
    if (/^(z|utc|gmt)$/i.test(z)) return 0;
    const m = /^([+-])(\d{2}):?(\d{2})?$/.exec(z);
    const v = (+m[2] * 60 + (m[3] ? +m[3] : 0)) * 60000;
    return m[1] === "-" ? -v : v;
  }
  function fullYear(y) { y = +y; return y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y; }
  function validYMD(y, m, d) { return m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1980 && y <= 2100; }

  /* Decide day-first vs month-first for a column from a sample of strings.
   * Like the cleaner app, ambiguous columns default to day-first. */
  function detectDateOrder(sample) {
    let dayFirst = 0, monthFirst = 0;
    for (const s of sample) {
      const m = RE_XXY.exec(String(s).trim());
      if (!m) continue;
      if (+m[1] > 12) dayFirst++;
      if (+m[2] > 12) monthFirst++;
    }
    return monthFirst > dayFirst ? "mdy" : "dmy";
  }

  /* Parse one timestamp string to {wall, zone}: wall = wall-clock ms as if UTC,
   * zone = explicit offset ms if the string carried one (else null). Returns null
   * if unparseable. Numbers are treated as Excel serial dates. */
  function parseStamp(s, order) {
    if (s === null || s === undefined || s === "") return null;
    if (typeof s === "number") {
      if (s > 20000 && s < 80000) return { wall: Math.round((s - 25569) * DAY), zone: null };
      if (s > 1e11 && s < 5e12) return { wall: s, zone: 0 };          // epoch ms
      if (s > 3e8 && s < 5e9) return { wall: s * 1000, zone: 0 };     // epoch s
      return null;
    }
    if (s instanceof Date) return isNaN(s) ? null : { wall: s.getTime(), zone: 0 };
    const t = String(s).trim();
    let m, y, mo, d;
    if ((m = RE_YMD.exec(t))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = RE_XXY.exec(t))) {
      y = fullYear(m[3]);
      if (order === "mdy") { mo = +m[1]; d = +m[2]; } else { d = +m[1]; mo = +m[2]; }
    } else if ((m = RE_DMONY.exec(t))) {
      d = +m[1]; mo = MON[m[2].toLowerCase()]; y = fullYear(m[3]);
      if (!mo) return null;
    } else if (/^\d+(\.\d+)?$/.test(t)) {
      return parseStamp(Number(t), order);
    } else return null;
    if (!validYMD(y, mo, d)) return null;
    const wall = Date.UTC(y, mo - 1, d) + hms(m[4], m[5], m[6], m[7], m[8]);
    return { wall, zone: zoneMs(m[9]) };
  }
  // Separate date + time columns
  function parseDateTime(dateStr, timeStr, order) {
    const p = parseStamp(dateStr, order);
    if (!p) return null;
    if (timeStr === null || timeStr === undefined || timeStr === "") return p;
    let add = 0;
    if (typeof timeStr === "number") add = Math.round((timeStr % 1) * DAY);   // Excel time fraction
    else {
      const m = RE_TIMEONLY.exec(String(timeStr).trim());
      if (!m) return null;
      add = hms(m[1], m[2], m[3], m[4], m[5]);
    }
    const dayStart = Math.floor(p.wall / DAY) * DAY;
    return { wall: dayStart + add, zone: p.zone };
  }
  /* Convert a parsed stamp to UTC ms. Explicit offsets in the string always win;
   * otherwise the column is UTC (assumeUTC) or local wall clock in tz. */
  function toUTC(p, assumeUTC, tz) {
    if (!p) return NaN;
    if (p.zone !== null) return p.wall - p.zone;
    return assumeUTC ? p.wall : localToUTC(tz, p.wall);
  }

  EMT.time = { DAY, HOUR, tzOffset, localToUTC, isValidTZ, civilFromDays, daysFromCivil, isoWeek,
               localParts, utcDayNum, localMidnightUTC, detectDateOrder, parseStamp, parseDateTime, toUTC };
})(typeof globalThis !== "undefined" ? globalThis : self);
