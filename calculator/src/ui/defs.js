/* "Metrics definitions" page: plain-language definitions of every metric, with
 * schematic diagrams. Wording follows exactly what the calculator computes
 * (src/core/metrics.js = Elephant_metrics_shiny/scripts/metrics_udfixed.R). */
(function (G) {
  const W = 260, H = 150;
  const svg = (inner, label) => `<svg viewBox="0 0 ${W} ${H}" width="100%" class="defsvg" role="img" aria-label="${label}">${inner}</svg>`;
  const pts = (a) => a.map((p) => p.join(",")).join(" ");
  const dots = (a, cls = "dpt") => a.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.2" class="${cls}"/>`).join("");
  const path = (a, cls = "dpath") => `<polyline points="${pts(a)}" class="${cls}"/>`;
  const line = (a, b, cls, extra = "") => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="${cls}" ${extra}/>`;
  const text = (x, y, t, cls = "dlab", anchor = "middle") => `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${t}</text>`;
  const ARROW = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" class="dhead"/></marker></defs>`;

  // a day of 4-hourly fixes (start = filled, end = ringed)
  const DAY = [[30, 110], [70, 95], [95, 60], [140, 50], [175, 75], [215, 45]];
  const OUTBACK = [[40, 105], [85, 80], [130, 55], [175, 40], [150, 70], [95, 95]];
  const startEnd = (a) => `<circle cx="${a[0][0]}" cy="${a[0][1]}" r="5" class="dstart"/><circle cx="${a[a.length - 1][0]}" cy="${a[a.length - 1][1]}" r="5.5" class="dend"/>`;
  const legendSE = text(10, 142, "filled = first fix, ring = last fix", "dsmall", "start");

  const D = {
    speed: svg(ARROW + path(DAY) + dots(DAY) + `<line x1="72" y1="88" x2="93" y2="64" class="darrow" marker-end="url(#ah)"/>` +
      text(56, 70, "4 h", "dlab") + text(150, 128, "speed = step length ÷ step time", "dlab"), "speed"),
    daynight: svg(`<rect x="20" y="40" width="110" height="40" class="dday"/><rect x="130" y="40" width="110" height="40" class="dnight"/>` +
      text(75, 65, "day 06:00-18:00") + text(185, 65, "night 18:00-06:00", "dlabinv") +
      `<rect x="30" y="92" width="60" height="12" rx="3" class="dstepday"/>` + text(60, 120, "≥75% in daylight: Day", "dsmall") +
      `<rect x="160" y="92" width="60" height="12" rx="3" class="dstepnight"/>` + text(190, 120, "≤25%: Night", "dsmall") +
      `<rect x="100" y="92" width="60" height="12" rx="3" class="dstepmix"/>` + text(130, 140, "mixed: not used", "dsmall"), "day and night"),
    ndratio: svg(`<rect x="60" y="${130 - 50}" width="45" height="50" class="dbarday"/><rect x="150" y="${130 - 85}" width="45" height="85" class="dbarnight"/>` +
      text(82, 145, "day speed", "dsmall") + text(172, 145, "night speed", "dsmall") + `<line x1="40" y1="130" x2="225" y2="130" class="daxis"/>` +
      text(130, 22, "ratio = night ÷ day (here ≈ 1.7)", "dlab"), "night day ratio"),
    diurnality: svg(`<rect x="30" y="50" width="150" height="22" class="dbarday"/><rect x="30" y="80" width="60" height="22" class="dbarnight"/>` +
      text(188, 66, "day distance", "dsmall", "start") + text(98, 96, "night distance", "dsmall", "start") +
      text(130, 30, "(day − night) ÷ (day + night)", "dlab") + text(130, 130, "−1 = all at night … +1 = all by day", "dsmall"), "diurnality"),
    net: svg(path(DAY) + dots(DAY) + startEnd(DAY) + line(DAY[0], DAY[5], "dkey", 'stroke-dasharray="5 4"') + text(125, 140, "net displacement = first to last fix", "dlab") , "net displacement"),
    max: svg(path(DAY) + dots(DAY) + line([30, 110], [215, 45], "dkey") + text(125, 140, "largest distance between any two fixes", "dlab"), "maximum displacement"),
    msd: svg(dots(DAY) + DAY.slice(1).map((p) => line(DAY[0], p, "dthin")).join("") + startEnd(DAY) + text(125, 140, "mean of (distance from first fix)²", "dlab"), "mean squared displacement"),
    straight: svg(path(DAY, "dpath dpathfat") + dots(DAY) + line(DAY[0], DAY[5], "dkey", 'stroke-dasharray="5 4"') + startEnd(DAY) +
      text(125, 22, "straight-line distance ÷ path length", "dlab") + text(125, 140, "1 = perfectly straight", "dsmall"), "straightness"),
    outback: svg(path(OUTBACK) + dots(OUTBACK) + startEnd(OUTBACK) + line(OUTBACK[0], OUTBACK[3], "dkey") + line(OUTBACK[0], OUTBACK[5], "dkey2", 'stroke-dasharray="5 4"') +
      text(110, 22, "farthest point", "dsmall") + text(125, 140, "1 − (net ÷ farthest) · 1 = back to start", "dlab"), "out and back"),
    windows: svg(`<line x1="20" y1="70" x2="240" y2="70" class="daxis"/>` +
      [[20, 93, "1-10"], [93, 166, "11-20"], [166, 240, "21-end"]].map(([a, b, l], i) => `<rect x="${a + 2}" y="55" width="${b - a - 4}" height="30" rx="4" class="dwin${i}"/>` + text((a + b) / 2, 75, l)).join("") +
      text(130, 40, "one month, three 10-day periods", "dlab") + text(130, 115, "weekly metrics: the same per calendar week", "dsmall") +
      text(130, 132, "monthly value = average of the periods", "dsmall"), "periods"),
    yearmax: svg(dots([[40, 90], [60, 60], [85, 105], [110, 40], [135, 80], [160, 110], [190, 55], [220, 85], [75, 75], [150, 60]]) +
      line([40, 90], [220, 85], "dkey") + text(130, 140, "widest spread of the year's fixes", "dlab"), "yearly displacement"),
    ud: svg(`<ellipse cx="130" cy="72" rx="105" ry="52" class="dud95"/><ellipse cx="115" cy="78" rx="45" ry="24" class="dud50"/><ellipse cx="175" cy="58" rx="24" ry="14" class="dud50"/>` +
      text(115, 82, "50%") + text(210, 112, "95%") + text(130, 142, "areas holding 50% and 95% of use", "dlab"), "utilisation distribution"),
    mcp: svg(dots([[50, 95], [70, 50], [110, 70], [140, 35], [200, 55], [215, 100], [150, 115], [100, 110], [130, 80], [170, 80]]) +
      `<polygon points="50,95 70,50 140,35 200,55 215,100 150,115 100,110" class="dhull"/>` + text(130, 140, "smallest polygon around all fixes", "dlab"), "MCP"),
    intensity: svg(`<polygon points="20,40 110,40 110,120 20,120" class="dhull"/>` +
      path([[30, 110], [95, 50], [40, 60], [100, 110], [35, 85], [100, 75], [45, 50]]) +
      `<polygon points="140,30 245,30 245,125 140,125" class="dhull"/>` + path([[150, 115], [185, 85], [210, 60], [238, 38]]) +
      text(65, 140, "high: winding in a small area", "dsmall") + text(193, 140, "low: crossing a big area", "dsmall") +
      text(130, 20, "distance travelled ÷ √(MCP area)", "dlab"), "intensity of use"),
    residence: svg(`<circle cx="120" cy="75" r="45" class="dcircle"/>` + path([[40, 120], [95, 95], [115, 70], [135, 85], [125, 60], [140, 75], [200, 30]]) +
      dots([[95, 95], [115, 70], [135, 85], [125, 60], [140, 75]]) + `<circle cx="120" cy="75" r="4" class="dstart"/>` +
      text(130, 142, "time spent inside the circle around each fix", "dlab") + text(200, 110, "radius", "dsmall") + line([120, 75], [165, 75], "dthin"), "residence time"),
    vi: svg(`<ellipse cx="100" cy="75" rx="70" ry="45" class="dudA"/><ellipse cx="160" cy="75" rx="70" ry="45" class="dudB"/>` +
      text(60, 75, "last year") + text(200, 75, "this year") + text(130, 80, "overlap", "dlab") + text(130, 142, "share of use in common (0 to 1)", "dlab"), "overlap with previous year"),
    emd: svg(ARROW + `<ellipse cx="70" cy="75" rx="45" ry="35" class="dudA"/><ellipse cx="190" cy="75" rx="45" ry="35" class="dudB"/>` +
      `<line x1="105" y1="62" x2="152" y2="62" class="darrow" marker-end="url(#ah)"/><line x1="110" y1="88" x2="150" y2="88" class="darrow" marker-end="url(#ah)"/>` +
      text(70, 125, "last year", "dsmall") + text(190, 125, "this year", "dsmall") + text(130, 22, "average distance use must move", "dlab"), "earth mover's distance"),
    ba: svg(`<ellipse cx="105" cy="75" rx="70" ry="45" class="dudF"/><ellipse cx="160" cy="80" rx="65" ry="40" class="dudM"/>` +
      text(70, 72, "females") + text(200, 82, "males") + text(130, 142, "similarity of the two areas of use (0 to 1)", "dlab"), "male female overlap"),
  };

  const M = (key, title, unit, when, what, how, diagram) => ({ key, title, unit, when, what, how, diagram });
  // The 9 metrics of the final reduced set in the continental baseline analysis (they carry the
  // least redundant information). Listed first in the results drop-downs.
  const PRIORITY = ["mean_speed", "night_speed", "diurnality", "straightness", "out_back_idx_month",
                    "mean_residence_time", "ud95_area_year", "vi_prev_year_95ud", "emd_year"];
  // cards that describe several metrics name the priority one
  const PRIORITY_PART = { day_speed: "night speed", ud95_area_year: "95% UD area" };
  const prioBadge = (key) => PRIORITY_PART[key] ? `<span class="prio">&#9733; Priority metric: ${PRIORITY_PART[key]}</span>`
    : PRIORITY.includes(key) ? '<span class="prio">&#9733; Priority metric</span>' : "";
  const GROUPS = [
    ["Speed and daily rhythm", [
      M("mean_speed", "Mean speed", "km/h", "monthly", "How fast the elephant moves on average.", "Average speed of all 4-hour steps in the month (step length ÷ step time).", D.speed),
      M("day_speed", "Day speed and night speed", "km/h", "monthly", "Average speed in daylight and in darkness.", "Steps with at least 75% of their time between 06:00 and 18:00 local time count as day; steps with at most 25% count as night. Steps that straddle dusk or dawn are left out.", D.daynight),
      M("night_day_speed_ratio", "Night/day speed ratio", "ratio", "monthly", "Whether the elephant moves faster at night (above 1) or by day (below 1).", "For each day with at least 2 day steps and 2 night steps, night speed ÷ day speed (that day's daylight paired with the following night). The monthly value is the geometric mean of the daily ratios, from at least 10 days.", D.ndratio),
      M("diurnality", "Diurnality", "−1 to +1", "monthly", "How much of the daily travel happens in daylight.", "For each day: (distance moved by day − distance by night) ÷ (day + night distance), averaged over the month. +1 = all movement by day, −1 = all at night.", D.diurnality),
    ]],
    ["Daily movement (each day runs 06:00 to 06:00)", [
      M("net_displacement", "Daily net displacement", "km", "monthly", "How far the elephant ends up from where it started the day.", "Straight-line distance between the first and last fix of each day (at least 3 fixes), averaged over the month.", D.net),
      M("max_displacement", "Daily maximum displacement", "km", "monthly", "How widely the elephant ranges within a day.", "Largest distance between any two fixes of the day, averaged over the month.", D.max),
      M("daily_msd", "Daily mean squared displacement", "km²", "monthly", "How far the elephant spreads out from its start point during the day; large moves weigh heavily.", "Mean of the squared distances of each fix from the day's first fix, averaged over the month.", D.msd),
      M("straightness", "Daily straightness", "0 to 1", "monthly", "How direct the day's path is.", "Straight-line distance between the day's first and last positions ÷ the total path length (calendar days with at least 2 steps). 1 = a perfectly straight line.", D.straight),
      M("out_back_idx_month", "Out-and-back index", "0 to 1", "monthly", "Whether the elephant goes out and comes back (near 1) or keeps going (near 0).", "1 − (net displacement ÷ farthest distance reached from the day's start), averaged over the month.", D.outback),
    ]],
    ["Longer periods", [
      M("weekly_net_displacement_month", "Weekly and 10-day net and maximum displacement", "km", "monthly", "The same net and maximum displacement as above, over a week or a 10-day period instead of a day.", "Weeks need at least 10 fixes; 10-day periods (days 1-10, 11-20, 21-end of month) at least 3. Each month's value is the average of its weeks or periods.", D.windows),
      M("max_yearly_displacement", "Maximum yearly displacement", "km", "yearly", "The width of the area used in a year.", "Largest distance between any two fixes in the year.", D.yearmax),
    ]],
    ["Space use (yearly)", [
      M("ud95_area_year", "50% and 95% UD area", "km²", "yearly", "The core area (50%) and the home range (95%).", "A utilisation distribution is a smoothed map of where the elephant spent its time (kernel density, fixed 1 km bandwidth). The areas are the smallest regions holding 50% and 95% of that use.", D.ud),
      M("mcp_area_year", "Annual MCP area", "km²", "yearly", "The full extent of the year's range.", "Area of the smallest convex polygon enclosing all of the year's positions (100% minimum convex polygon).", D.mcp),
      M("intensity_of_use", "Intensity of use", "ratio", "yearly", "Whether the elephant moves a lot within a small area (high) or travels across a large one (low).", "Total distance travelled in the year (km) ÷ √(MCP area, km²).", D.intensity),
      M("mean_residence_time", "Mean residence time", "hours", "monthly", "How long the elephant tends to stay in one place.", "For each fix: how long the elephant stayed within a circle around it (radius = 3 × the population's typical 4-hour step, between 250 m and 3 km; an absence of more than 12 hours ends a visit). Averaged over the month's fixes.", D.residence),
    ]],
    ["Change between years", [
      M("vi_prev_year_95ud", "Range overlap with previous year (VI)", "0 to 1", "yearly", "How much this year's space use overlaps last year's.", "Volume of intersection between this year's and the previous year's utilisation distributions. 1 = identical use, 0 = no overlap.", D.vi),
      M("emd_year", "Space-use shift from previous year (EMD)", "km", "yearly", "How far the elephant's space use moved between years.", "Earth mover's distance between consecutive years' 95% utilisation distributions: the average distance the use would have to move to turn last year's pattern into this year's (distances capped at 50 km). 0 = the same place.", D.emd),
    ]],
    ["Males and females", [
      M("male_female_ba_overlap_year", "Male-female overlap (BA)", "0 to 1", "yearly, per study area", "How much the areas used by males and females overlap.", "Bhattacharyya's affinity between the utilisation distributions of all females and all males in the study area that year (at least 20 fixes per sex). 1 = identical use.", D.ba),
    ]],
  ];

  function html() {
    const basis = `<div class="note defbasis"><b>How all metrics are calculated</b>
      <ul>
        <li>Tracks are first cleaned automatically, then resampled to one position every 4 hours (±30 minutes). Collars that usually record less often than every 6 hours are skipped.</li>
        <li>A <b>day</b> runs from 06:00 to 06:00 local time, so each daylight period is paired with the night that follows. Daylight is 06:00-18:00.</li>
        <li><b>Monthly</b> values need at least 10 days of data in the month. <b>Yearly</b> values need at least 30 positions spread over at least 6 months of the year.</li>
        <li>Distances are measured on a flat map projection (UTM) of the study area.</li>
      </ul></div>
      <p class="prionote"><span class="prio">&#9733; Priority metric</span> = preliminary research indicates less redundancy with other metrics.</p>`;
    return basis + GROUPS.map(([g, ms]) => `<h3 class="defgroup">${g}</h3>` + ms.map((m) => `
      <div class="defcard">
        <div class="deftext">
          <h4>${m.title} ${prioBadge(m.key)}</h4>
          <p class="defmeta"><span>${m.unit}</span><span>${m.when}</span></p>
          <p><b>What it shows:</b> ${m.what}</p>
          <p><b>How it is calculated:</b> ${m.how}</p>
        </div>
        <div class="defpic">${m.diagram}</div>
      </div>`).join("")).join("");
  }
  G.EMTDefs = { html, PRIORITY };
})(typeof globalThis !== "undefined" ? globalThis : self);
