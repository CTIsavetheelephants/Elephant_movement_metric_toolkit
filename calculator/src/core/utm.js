/* WGS84 -> UTM (Krüger 6th-order series, Karney 2011). Matches PROJ/sf
 * (st_transform to EPSG 326xx/327xx) to well under a millimetre, including
 * points several zones away from the central meridian. */
(function (G) {
  const EMT = (G.EMT = G.EMT || {});
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const n = f / (2 - f), n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
  const A = (a / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
  const alpha = [
    n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180 - (127 * n5) / 288 + (7891 * n6) / 37800,
    (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440 + (281 * n5) / 630 - (1983433 * n6) / 1935360,
    (61 * n3) / 240 - (103 * n4) / 140 + (15061 * n5) / 26880 + (167603 * n6) / 181440,
    (49561 * n4) / 161280 - (179 * n5) / 168 + (6601661 * n6) / 7257600,
    (34729 * n5) / 80640 - (3418889 * n6) / 1995840,
    (212378941 * n6) / 319334400,
  ];
  const e = Math.sqrt(f * (2 - f));
  const D2R = Math.PI / 180;

  // R/to_utm.R: zone from the MEAN longitude, hemisphere from the MEAN latitude
  function zoneFor(lons, lats) {
    let sx = 0, sy = 0, k = 0;
    for (let i = 0; i < lons.length; i++) {
      if (Number.isFinite(lons[i]) && Number.isFinite(lats[i])) { sx += lons[i]; sy += lats[i]; k++; }
    }
    const lon = sx / k, lat = sy / k;
    const zone = Math.floor((lon + 180) / 6) + 1;
    return { zone, south: lat < 0, epsg: (lat >= 0 ? 32600 : 32700) + zone };
  }
  function project(lon, lat, z) {
    const lam = (lon - (z.zone * 6 - 183)) * D2R, phi = lat * D2R;
    const sphi = Math.sin(phi);
    const t = Math.sinh(Math.atanh(sphi) - e * Math.atanh(e * sphi));
    const xiP = Math.atan2(t, Math.cos(lam));
    const etaP = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
    let xi = xiP, eta = etaP;
    for (let j = 1; j <= 6; j++) {
      xi += alpha[j - 1] * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
      eta += alpha[j - 1] * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
    }
    return [500000 + k0 * A * eta, (z.south ? 10000000 : 0) + k0 * A * xi];
  }
  // inverse (UTM -> lon/lat), for files that only carry easting/northing
  const beta = [
    n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360 - (81 * n5) / 512 + (96199 * n6) / 604800,
    n2 / 48 + n3 / 15 - (437 * n4) / 1440 + (46 * n5) / 105 - (1118711 * n6) / 3870720,
    (17 * n3) / 480 - (37 * n4) / 840 - (209 * n5) / 4480 + (5569 * n6) / 90720,
    (4397 * n4) / 161280 - (11 * n5) / 504 - (830251 * n6) / 7257600,
    (4583 * n5) / 161280 - (108847 * n6) / 3991680,
    (20648693 * n6) / 638668800,
  ];
  function unproject(x, y, zone, south) {
    const xi = (y - (south ? 10000000 : 0)) / (k0 * A), eta = (x - 500000) / (k0 * A);
    let xiP = xi, etaP = eta;
    for (let j = 1; j <= 6; j++) {
      xiP -= beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
      etaP -= beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    const tauP = Math.sin(xiP) / Math.sqrt(Math.sinh(etaP) ** 2 + Math.cos(xiP) ** 2);
    const lam = Math.atan2(Math.sinh(etaP), Math.cos(xiP));
    const e2 = e * e;
    let tau = tauP;
    for (let it = 0; it < 6; it++) {
      const s = Math.sinh(e * Math.atanh((e * tau) / Math.sqrt(1 + tau * tau)));
      const ti = tau * Math.sqrt(1 + s * s) - s * Math.sqrt(1 + tau * tau);
      const d = ((tauP - ti) / Math.sqrt(1 + ti * ti)) * ((1 + (1 - e2) * tau * tau) / ((1 - e2) * Math.sqrt(1 + tau * tau)));
      tau += d;
      if (Math.abs(d) < 1e-14) break;
    }
    return [lam / D2R + (zone * 6 - 183), Math.atan(tau) / D2R];
  }
  function projectAll(lons, lats, z) {
    const xs = new Float64Array(lons.length), ys = new Float64Array(lons.length);
    for (let i = 0; i < lons.length; i++) {
      const p = project(lons[i], lats[i], z);
      xs[i] = p[0]; ys[i] = p[1];
    }
    return { xs, ys };
  }
  EMT.utm = { zoneFor, project, unproject, projectAll };
})(typeof globalThis !== "undefined" ? globalThis : self);
