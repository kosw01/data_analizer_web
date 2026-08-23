"use strict";

/* 플롯 공통
   LTTB 다운샘플링, 눈금 계산, 축 그리기, PNG 저장 */

/* ============================================================
   플롯 공통
   ============================================================ */

function lttb(xs, ys, n, target) {
  if (n <= target) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = [xs(i), ys[i]];
    return out;
  }
  const every = (n - 2) / (target - 2);
  const out = [[xs(0), ys[0]]];
  let a = 0;
  for (let i = 0; i < target - 2; i++) {
    let avgX = 0, avgY = 0, cnt = 0;
    const rs = Math.floor((i + 1) * every) + 1, re = Math.min(Math.floor((i + 2) * every) + 1, n);
    for (let j = rs; j < re; j++) { avgX += xs(j); avgY += ys[j]; cnt++; }
    if (cnt) { avgX /= cnt; avgY /= cnt; }
    const ps = Math.floor(i * every) + 1, pe = Math.floor((i + 1) * every) + 1;
    const ax = xs(a), ay = ys[a];
    let best = ps, bestArea = -1;
    for (let j = ps; j < pe && j < n; j++) {
      const area = Math.abs((ax - avgX) * (ys[j] - ay) - (ax - xs(j)) * (avgY - ay));
      if (area > bestArea) { bestArea = area; best = j; }
    }
    out.push([xs(best), ys[best]]); a = best;
  }
  out.push([xs(n - 1), ys[n - 1]]);
  return out;
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
