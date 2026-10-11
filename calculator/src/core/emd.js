/* Earth Mover's Distance with a thresholded ground distance, as move::emd(...,
 * threshold = T) (Pele & Werman emd_hat_gd_metric): cost(i, j) = min(dist, T).
 * Solved exactly as a min-cost flow with a primal network simplex
 * (strongly feasible trees + Cunningham's leaving-arc rule, block pricing).
 * Arcs are only built for pairs closer than T; every other unit routes through a
 * hub node at cost T, which is equivalent to the thresholded distance. */
(function (G) {
  const EMT = (G.EMT = G.EMT || {});

  // integer masses summing exactly to M (largest remainder)
  function quantize(w, M) {
    const out = new Float64Array(w.length);
    let s = 0;
    for (const v of w) s += v;
    const rem = [];
    let tot = 0;
    for (let i = 0; i < w.length; i++) {
      const v = (w[i] / s) * M, f = Math.floor(v);
      out[i] = f; tot += f; rem.push([v - f, i]);
    }
    rem.sort((a, b) => b[0] - a[0]);
    for (let k = 0; k < M - tot; k++) out[rem[k][1]] += 1;
    return out;
  }

  function networkSimplex(nNodes, supply, src, tgt, cost) {
    const mReal = src.length, root = nNodes, N = nNodes + 1, M = mReal + nNodes;
    const S = new Int32Array(M), T = new Int32Array(M), C = new Float64Array(M), F = new Float64Array(M);
    const state = new Int8Array(M);          // 1 = non-tree at lower bound, 0 = tree
    S.set(src); T.set(tgt); C.set(cost); state.fill(1, 0, mReal);
    let maxC = 0;
    for (let k = 0; k < mReal; k++) if (cost[k] > maxC) maxC = cost[k];
    const ART = (maxC + 1) * N;
    const parent = new Int32Array(N), pred = new Int32Array(N), depth = new Int32Array(N);
    const pi = new Float64Array(N);
    const children = Array.from({ length: N }, () => []);
    parent[root] = -1; depth[root] = 0;
    for (let u = 0; u < nNodes; u++) {
      const a = mReal + u;
      C[a] = ART; state[a] = 0;
      if (supply[u] > 0) { S[a] = u; T[a] = root; F[a] = supply[u]; pi[u] = -ART; }
      else if (supply[u] < 0) { S[a] = root; T[a] = u; F[a] = -supply[u]; pi[u] = ART; }
      else { S[a] = u; T[a] = root; F[a] = 0; pi[u] = -ART; }   // zero-flow arcs point to the root
      parent[u] = root; pred[u] = a; depth[u] = 1; children[root].push(u);
    }
    const eps = 1e-9 * Math.max(1, maxC);
    const B = Math.max(64, Math.floor(Math.sqrt(M)));
    let next = 0, iter = 0;
    const upath = [], vpath = [], stack = [];

    function findEntering() {
      let best = -1, bestRC = -eps, cnt = 0;
      for (let k = 0; k < M; k++) {
        const a = next;
        next = next + 1 === M ? 0 : next + 1;
        if (state[a] === 1) {
          const rc = C[a] + pi[S[a]] - pi[T[a]];
          if (rc < bestRC) { bestRC = rc; best = a; }
        }
        if (++cnt === B) { if (best >= 0) return best; cnt = 0; }
      }
      return best;
    }

    for (;;) {
      const e = findEntering();
      if (e < 0) break;
      if (++iter > 50 * M + 1e6) throw new Error("EMD network simplex did not converge");
      const u = S[e], v = T[e];
      // join node (apex)
      let a = u, b = v;
      while (a !== b) {
        if (depth[a] > depth[b]) a = parent[a];
        else if (depth[b] > depth[a]) b = parent[b];
        else { a = parent[a]; b = parent[b]; }
      }
      const join = a;
      upath.length = 0; vpath.length = 0;
      for (let x = u; x !== join; x = parent[x]) upath.push(x);
      for (let x = v; x !== join; x = parent[x]) vpath.push(x);
      // Cunningham: last blocking arc along the cycle orientation from the apex:
      // apex -> (down) u, then u -> v, then v -> (up) apex
      let delta = Infinity, leaveNode = -1;
      for (let k = upath.length - 1; k >= 0; k--) {
        const x = upath[k], ar = pred[x];
        if (S[ar] === x && F[ar] <= delta) { delta = F[ar]; leaveNode = x; }   // traversed against direction
      }
      for (let k = 0; k < vpath.length; k++) {
        const x = vpath[k], ar = pred[x];
        if (S[ar] !== x && F[ar] <= delta) { delta = F[ar]; leaveNode = x; }
      }
      if (delta === Infinity) throw new Error("EMD unbounded");
      if (delta > 0) {
        F[e] += delta;
        for (const x of upath) { const ar = pred[x]; F[ar] += S[ar] === x ? -delta : delta; }
        for (const x of vpath) { const ar = pred[x]; F[ar] += S[ar] === x ? delta : -delta; }
      }
      // tree update: drop pred[leaveNode], hang its subtree from the entering arc
      const leaveArc = pred[leaveNode];
      const onU = upath.indexOf(leaveNode) >= 0;
      const q = onU ? u : v, p = onU ? v : u;
      const ch = children[parent[leaveNode]];
      ch.splice(ch.indexOf(leaveNode), 1);
      let prevNode = p, prevArc = e, w = q;
      for (;;) {
        const oldParent = parent[w], oldPred = pred[w];
        if (w !== leaveNode) { const c2 = children[oldParent]; c2.splice(c2.indexOf(w), 1); }
        children[prevNode].push(w);
        parent[w] = prevNode; pred[w] = prevArc;
        if (w === leaveNode) break;
        prevNode = w; prevArc = oldPred; w = oldParent;
      }
      state[e] = 0; state[leaveArc] = 1;
      // potentials + depth of the moved subtree
      stack.length = 0; stack.push(q);
      while (stack.length) {
        const x = stack.pop(), px = parent[x], ar = pred[x];
        depth[x] = depth[px] + 1;
        pi[x] = S[ar] === px ? pi[px] + C[ar] : pi[px] - C[ar];
        for (const c of children[x]) stack.push(c);
      }
    }
    let infeasible = 0;
    for (let k = mReal; k < M; k++) infeasible += F[k];
    let total = 0;
    for (let k = 0; k < mReal; k++) total += F[k] * C[k];
    return { total, infeasible, iter };
  }

  /* EMD between two weight vectors on the same cell centres (cx, cy), in the
   * units of the coordinates. Cells empty in both are dropped, as move::emd does. */
  function emd(cx, cy, w1, w2, threshold) {
    const P = [], Q = [];
    for (let i = 0; i < w1.length; i++) {
      if (w1[i] > 0) P.push(i);
      if (w2[i] > 0) Q.push(i);
    }
    if (!P.length || !Q.length) return NaN;
    const MASS = 1e9;
    const qa = quantize(P.map((i) => w1[i]), MASS), qb = quantize(Q.map((i) => w2[i]), MASS);
    const nP = P.length, nQ = Q.length, hub = nP + nQ, nNodes = nP + nQ + 1;
    const supply = new Float64Array(nNodes);
    for (let i = 0; i < nP; i++) supply[i] = qa[i];
    for (let j = 0; j < nQ; j++) supply[nP + j] = -qb[j];
    const src = [], tgt = [], cost = [];
    for (let i = 0; i < nP; i++) {
      const xi = cx[P[i]], yi = cy[P[i]];
      for (let j = 0; j < nQ; j++) {
        const d = Math.hypot(cx[Q[j]] - xi, cy[Q[j]] - yi);
        if (d < threshold) { src.push(i); tgt.push(nP + j); cost.push(d); }
      }
      src.push(i); tgt.push(hub); cost.push(threshold);
    }
    for (let j = 0; j < nQ; j++) { src.push(hub); tgt.push(nP + j); cost.push(0); }
    const r = networkSimplex(nNodes, supply, Int32Array.from(src), Int32Array.from(tgt), Float64Array.from(cost));
    if (r.infeasible > 0.5) throw new Error("EMD infeasible");
    return r.total / MASS;
  }

  EMT.emd = { emd, networkSimplex, quantize };
})(typeof globalThis !== "undefined" ? globalThis : self);
