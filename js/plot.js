"use strict";

/* 플롯 공통
   LTTB 다운샘플링, 눈금 계산, 축 그리기, PNG 저장 */

/* ============================================================
   플롯 공통
   ============================================================ */

/* i0 이상 i1 미만 구간만 축약한다 */
function lttb(xs, ys, i0, i1, target) {
  const n = i1 - i0;
  if (n <= 0) return [];
  if (n <= target) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = [xs(i0 + i), ys[i0 + i]];
    return out;
  }
  const every = (n - 2) / (target - 2);
  const out = [[xs(i0), ys[i0]]];
  let a = i0;
  for (let i = 0; i < target - 2; i++) {
    let avgX = 0, avgY = 0, cnt = 0;
    const rs = i0 + Math.floor((i + 1) * every) + 1;
    const re = Math.min(i0 + Math.floor((i + 2) * every) + 1, i1);
    for (let j = rs; j < re; j++) { avgX += xs(j); avgY += ys[j]; cnt++; }
    if (cnt) { avgX /= cnt; avgY /= cnt; }
    const ps = i0 + Math.floor(i * every) + 1, pe = i0 + Math.floor((i + 1) * every) + 1;
    const ax = xs(a), ay = ys[a];
    let best = ps, bestArea = -1;
    for (let j = ps; j < pe && j < i1; j++) {
      const area = Math.abs((ax - avgX) * (ys[j] - ay) - (ax - xs(j)) * (avgY - ay));
      if (area > bestArea) { bestArea = area; best = j; }
    }
    out.push([xs(best), ys[best]]); a = best;
  }
  out.push([xs(i1 - 1), ys[i1 - 1]]);
  return out;
}

/* ---- 구간 ---- */

/* times는 오름차순이라고 보고 이분 탐색한다 (중복은 있어도 된다) */
function lowerBound(arr, n, v) {
  let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; arr[m] < v ? lo = m + 1 : hi = m; }
  return lo;
}
function upperBound(arr, n, v) {
  let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; arr[m] <= v ? lo = m + 1 : hi = m; }
  return lo;
}

/* 채널에서 실제로 쓸 인덱스 범위 [i0, i1) */
function rangeBounds(ch) {
  const r = ui.range;
  if (r.mode === "all") return [0, ch.n];
  if (ch.times) {
    const i0 = r.tStart === null ? 0 : lowerBound(ch.times, ch.n, r.tStart);
    const i1 = r.tEnd === null ? ch.n : upperBound(ch.times, ch.n, r.tEnd);
    return [i0, Math.max(i0, i1)];
  }
  const rate = ch.sampleRate || 1;
  const i0 = r.sStart === null ? 0 : Math.max(0, Math.floor(r.sStart * rate));
  const i1 = r.sEnd === null ? ch.n : Math.min(ch.n, Math.floor(r.sEnd * rate) + 1);
  return [i0, Math.max(i0, i1)];
}

/* 구간 안에서 다시 낸 통계 — 전체 통계를 그대로 쓰면 축이 어긋난다 */
function statsInRange(ch, i0, i1) {
  let mn = Infinity, mx = -Infinity, sum = 0, cnt = 0;
  for (let i = i0; i < i1; i++) {
    const v = ch.values[i];
    if (!isFinite(v)) continue;
    if (v < mn) mn = v; if (v > mx) mx = v; sum += v; cnt++;
  }
  return cnt ? { min: mn, max: mx, mean: sum / cnt, count: cnt }
             : { min: 0, max: 1, mean: NaN, count: 0 };
}

function niceTicks(min, max, count) {
  const span = max - min;
  if (!(span > 0)) return [min];
  const mag = Math.pow(10, Math.floor(Math.log10(span / count)));
  const norm = (span / count) / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(v);
  return out;
}

/* 축 뼈대 — 라벨은 각 축의 '가운데'에 놓는다 */
function drawFrame(ctx, box, xt, yt, xLabel, yLabel, title, th, grid) {
  const { L, T, pw, ph, px, py } = box;
  ctx.lineWidth = 1;
  ctx.font = "11px -apple-system,sans-serif";

  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (const [v, label] of yt) {
    const y = Math.round(py(v)) + 0.5;
    if (y < T - 1 || y > T + ph + 1) continue;
    if (grid) { ctx.strokeStyle = th.divider; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); }
    ctx.fillStyle = th.textDim; ctx.fillText(label, L - 8, y);
  }
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (const [v, label] of xt) {
    const x = Math.round(px(v)) + 0.5;
    if (x < L - 1 || x > L + pw + 1) continue;
    if (grid) { ctx.strokeStyle = th.divider; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); }
    ctx.fillStyle = th.textDim; ctx.fillText(label, x, T + ph + 8);
  }
  // 테두리
  ctx.strokeStyle = th.divider;
  ctx.strokeRect(L + 0.5, T + 0.5, pw, ph);

  ctx.fillStyle = th.textNormal;
  ctx.font = "600 12px -apple-system,sans-serif";
  if (xLabel) { ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(xLabel, L + pw / 2, T + ph + 26); }
  if (yLabel) {
    ctx.save(); ctx.translate(16, T + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(yLabel, 0, 0); ctx.restore();
  }
  if (title) {
    ctx.fillStyle = th.textStrong; ctx.font = "700 15px -apple-system,sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(title, L, 8);
  }
}

function setupCanvas(cv, h) {
  const ctx = cv.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 800;
  cv.style.height = h + "px";
  cv.width = w * dpr; cv.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

const numOrNull = v => (v === "" || v === null || v === undefined || !isFinite(Number(v))) ? null : Number(v);

/* PNG 저장 — 테마 무관 라이트 고정, 2배 해상도 */
function savePng(kind) {
  const cfg = ui.cfg[kind];
  const src = $(kind + "Cv");
  const w = src.clientWidth || 800, h = cfg.height, scale = 2;
  const off = document.createElement("canvas");
  off.width = w * scale; off.height = h * scale;
  const ctx = off.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  (kind === "ts" ? renderTS : renderXY)(ctx, w, h, { ...LIGHT });
  off.toBlob(blob => {
    const name = (cfg.title || (kind === "ts" ? "시계열" : "상관")).replace(/[\/\\:*?"<>|]/g, "_");
    downloadBlob(blob, `${name}.png`);
  }, "image/png");
}
