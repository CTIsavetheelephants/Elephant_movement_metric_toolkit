/* Fixed-bandwidth kernel utilisation distributions, reproducing adehabitatHR 0.4.22:
 *   kernelUD(h = 1000, grid = ud_grid(...))  -> C kernelhr(): bivariate normal summed
 *     over the points inside the OPEN square |dx| < 4h, |dy| < 4h of each cell,
 *     scaled by 1 / (n h^2 2 * 3.14159265359)
 *   getvolumeUD -> cumulative % of (density * cs^2), densest cells first (not renormalised)
 *   kernel.area(p) -> (#cells with volume <= p) * cs^2
 *   kerneloverlaphr(VI|BA, conditional = FALSE) -> sum(min) * cs^2 / sum(sqrt*sqrt) * cs^2
 *     (the percent argument is IGNORED unless conditional = TRUE)
 * Grid (metrics_udfixed.R ud_grid): extent = fixes +/- 4h, 500 m cells, <= 250k cells. */
(function (G) {
  const EMT = (G.EMT = G.EMT || {});
  const PI_C = 3.14159265359;
  const UD_H_M = 1000, UD_CELL_M = 500, UD_MAX_CELLS = 250000, EMD_CELL_M = 2000;

  // R seq(from, to, by)
  function rseq(from, to, by) {
    const n = Math.floor((to - from) / by + 1e-10);
    const out = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) out[i] = from + i * by;
    return out;
  }
  function udGrid(xs, ys, h = UD_H_M, cell = UD_CELL_M, maxCells = UD_MAX_CELLS) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < xs.length; i++) {
      if (xs[i] < x0) x0 = xs[i]; if (xs[i] > x1) x1 = xs[i];
      if (ys[i] < y0) y0 = ys[i]; if (ys[i] > y1) y1 = ys[i];
    }
    const buf = 4 * h;
    x0 -= buf; x1 += buf; y0 -= buf; y1 += buf;
    const cs = Math.max(cell, Math.sqrt(((x1 - x0) * (y1 - y0)) / maxCells));
    const gx = rseq(x0, x1 + cs, cs), gy = rseq(y0, y1 + cs, cs);
    return { gx, gy, nx: gx.length, ny: gy.length, cs };
  }
  // density grid, index = iy * nx + ix (iy = 0 at the SOUTH edge)
  function kernelUD(xs, ys, grid, h = UD_H_M) {
    const { gx, gy, nx, ny, cs } = grid;
    const ud = new Float64Array(nx * ny);
    const n = xs.length, lim = 4 * h, k2 = 2 * h * h;
    const ex = new Float64Array(nx), ey = new Float64Array(ny);
    for (let p = 0; p < n; p++) {
      const px = xs[p], py = ys[p];
      let i0 = Math.max(0, Math.floor((px - lim - gx[0]) / cs)), i1 = Math.min(nx - 1, Math.ceil((px + lim - gx[0]) / cs));
      let j0 = Math.max(0, Math.floor((py - lim - gy[0]) / cs)), j1 = Math.min(ny - 1, Math.ceil((py + lim - gy[0]) / cs));
      for (let i = i0; i <= i1; i++) { const dx = px - gx[i]; ex[i] = dx < lim && dx > -lim ? Math.exp(-(dx * dx) / k2) : 0; }
      for (let j = j0; j <= j1; j++) { const dy = py - gy[j]; ey[j] = dy < lim && dy > -lim ? Math.exp(-(dy * dy) / k2) : 0; }
      for (let j = j0; j <= j1; j++) {
        const e = ey[j];
        if (!e) continue;
        const row = j * nx;
        for (let i = i0; i <= i1; i++) if (ex[i]) ud[row + i] += ex[i] * e;
      }
    }
    const norm = 1 / (n * h * h * 2 * PI_C);
    for (let k = 0; k < ud.length; k++) ud[k] *= norm;
    return ud;
  }
  function volumeUD(ud, cs) {
    const idx = Array.from(ud.keys()).sort((a, b) => ud[b] - ud[a] || a - b);
    const vol = new Float64Array(ud.length);
    let c = 0;
    const cs2 = cs * cs;
    for (const k of idx) { c += ud[k] * cs2; vol[k] = c * 100; }
    return vol;
  }
  function areaKm2(vol, cs, percent) {
    let n = 0;
    for (let k = 0; k < vol.length; k++) if (vol[k] <= percent) n++;
    return (n * cs * cs) / 1e6;
  }
  function overlapVI(u1, u2, cs) {
    let s = 0;
    for (let k = 0; k < u1.length; k++) s += Math.min(u1[k], u2[k]);
    return s * cs * cs;
  }
  function overlapBA(u1, u2, cs) {
    let s = 0;
    for (let k = 0; k < u1.length; k++) s += Math.sqrt(u1[k]) * Math.sqrt(u2[k]);
    return s * cs * cs;
  }
  // calc_kernel_ud_area_km2(): own grid from this individual-year's fixes
  function udAreaKm2(xs, ys, percent) {
    if (xs.length < 5) return NaN;
    const g = udGrid(xs, ys);
    const ud = kernelUD(xs, ys, g);
    return areaKm2(volumeUD(ud, g.cs), g.cs, percent);
  }

  /* EMD raster for one year (calc_emd_prev_year): density outside the 95% isopleth
   * set to 0, summed into ~2 km blocks from the raster's top-left corner
   * (raster::aggregate, expand = TRUE), normalised to sum 1.
   * flipMaskBug = true reproduces the current R code, which indexes the volume
   * grid (south-to-north) by the density grid's position (north-to-south), i.e.
   * applies a vertically mirrored 95% mask. */
  function emdRaster(ud, vol, grid, percent = 95, flipMaskBug = false) {
    const { nx, ny, cs } = grid;
    const fact = Math.max(1, Math.round(EMD_CELL_M / cs));
    const bx = Math.ceil(nx / fact), by = Math.ceil(ny / fact);
    const out = new Float64Array(bx * by);
    let tot = 0;
    for (let iy = 0; iy < ny; iy++) {
      const r = ny - 1 - iy;                       // raster row from the top
      const br = Math.floor(r / fact);
      const vRow = (flipMaskBug ? ny - 1 - iy : iy) * nx;
      for (let ix = 0; ix < nx; ix++) {
        let d = ud[iy * nx + ix];
        if (vol[vRow + ix] > percent || !(d >= 0)) d = 0;
        if (d) { out[br * bx + Math.floor(ix / fact)] += d; tot += d; }
      }
    }
    if (!(tot > 0)) return null;
    for (let k = 0; k < out.length; k++) out[k] /= tot;
    return { w: out, bx, by, size: fact * cs };
  }

  EMT.kde = { UD_H_M, UD_CELL_M, UD_MAX_CELLS, EMD_CELL_M, rseq, udGrid, kernelUD, volumeUD, areaKm2,
              overlapVI, overlapBA, udAreaKm2, emdRaster };
})(typeof globalThis !== "undefined" ? globalThis : self);
