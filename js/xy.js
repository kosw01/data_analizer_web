"use strict";

/* 상관 화면
   X축을 다른 채널로 두는 산점도와 회귀 */

/* ============================================================
   상관
   ============================================================ */

/* X 채널의 구간 [i0,i1) 안에서만 짝을 만든다 */
function pairXY(cx, cy, i0, i1) {
  if (cx.tableId === cy.tableId) {
    const end = Math.min(i1, cy.n);
    return { i0, i1: end, yi: i => i, how: "같은 파일 · 행 번호로 결합" };
  }
  if (!cx.times || !cy.times) return { i0: 0, i1: 0, how: "시간축이 없어 다른 파일끼리 결합할 수 없습니다" };
  const tol = Math.max(1, (cy.times[1] - cy.times[0]) || 1000) * 0.75;
  const map = new Int32Array(Math.max(0, i1 - i0)).fill(-1);
  let j = 0, hit = 0;
  for (let i = i0; i < i1; i++) {
    const t = cx.times[i];
    while (j + 1 < cy.n && Math.abs(cy.times[j + 1] - t) <= Math.abs(cy.times[j] - t)) j++;
    if (Math.abs(cy.times[j] - t) <= tol) { map[i - i0] = j; hit++; }
  }
  return { i0, i1, yi: i => map[i - i0],
           how: `다른 파일 · 시각 최근접 결합 (${hit.toLocaleString()}쌍, 허용 ${fmtDur(tol)})` };
}

function renderXY(ctx, w, h, th) {
  const cfg = ui.cfg.xy;
  const cx = store.channels.find(c => c.id === ui.xyX);
  const ys = store.channels.filter(c => ui.xySel.has(c.id) && c.id !== ui.xyX);
  if (th.bg) { ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h); }
  if (!cx || !ys.length) {
    ctx.fillStyle = th.textDim; ctx.font = "14px -apple-system,sans-serif"; ctx.textAlign = "center";
    ctx.fillText(!cx ? "X축 채널을 고르세요." : "Y축 채널을 하나 이상 고르세요.", w / 2, h / 2);
    return null;
  }
  const norm = $("xyYMode").value === "norm";
  const useFit = $("xyFit").checked, useTimeColor = $("xyTime").checked;

  const [rx0, rx1] = rangeBounds(cx);
  const sets = [], notes = [];
  for (const cy of ys) {
    const p = pairXY(cx, cy, rx0, rx1);
    notes.push(`${cy.name}: ${p.how}`);
    const nUse = p.i1 - p.i0;
    if (nUse <= 0) { sets.push({ ch: cy, pts: [], r: NaN }); continue; }
    const stride = Math.max(1, Math.ceil(nUse / 40000));
    const pts = [];
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, m = 0;
    for (let i = p.i0; i < p.i1; i += stride) {
      const yj = p.yi(i); if (yj < 0) continue;
      const a = cx.values[i], b = cy.values[yj];
      if (!isFinite(a) || !isFinite(b)) continue;
      pts.push([a, b, (i - p.i0) / nUse]);
      sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b; m++;
    }
    const den = Math.sqrt((m * sxx - sx * sx) * (m * syy - sy * sy));
    const r = den ? (m * sxy - sx * sy) / den : NaN;
    const slope = (m * sxx - sx * sx) ? (m * sxy - sx * sy) / (m * sxx - sx * sx) : NaN;
    sets.push({ ch: cy, pts, r, slope, icpt: (sy - slope * sx) / m, m, stride });
  }

  let xmin = Infinity, xmax = -Infinity;
  for (const s of sets) for (const [a] of s.pts) { if (a < xmin) xmin = a; if (a > xmax) xmax = a; }
  if (!(xmax > xmin)) { xmax = xmin + 1; xmin -= 1; }
  const xp = (xmax - xmin) * 0.05; xmin -= xp; xmax += xp;

  let ymin, ymax;
  if (norm) { ymin = -0.05; ymax = 1.05; }
  else {
    ymin = Infinity; ymax = -Infinity;
    for (const s of sets) for (const [, b] of s.pts) { if (b < ymin) ymin = b; if (b > ymax) ymax = b; }
    if (!(ymax > ymin)) { ymax = ymin + 1; ymin -= 1; }
    const p = (ymax - ymin) * 0.06; ymin -= p; ymax += p;
  }
  if (!norm) [ymin, ymax] = expandForLimits(ymin, ymax, cfg.limits);
  const uMin = numOrNull(cfg.yMin), uMax = numOrNull(cfg.yMax);
  if (uMin !== null) ymin = uMin;
  if (uMax !== null) ymax = uMax;
  if (!(ymax > ymin)) ymax = ymin + 1;

  const L = 82, R = 18, T = cfg.title ? 36 : 16, B = 52;
  const pw = w - L - R, ph = h - T - B;
  const px = x => L + (x - xmin) / (xmax - xmin) * pw;
  const py = y => T + (1 - (y - ymin) / (ymax - ymin)) * ph;

  drawFrame(ctx, { L, T, pw, ph, px, py },
    niceTicks(xmin, xmax, Math.max(3, Math.floor(pw / 100))).map(v => [v, fmtNum(v, 3)]),
    niceTicks(ymin, ymax, 5).map(v => [v, fmtNum(v, 3)]),
    cfg.xLabel || cx.name,
    cfg.yLabel || (norm ? "정규화 (0~1)" : (ys.length === 1 ? ys[0].name : "값")),
    cfg.title, th, cfg.grid);

  ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
  const d = cfg.dot;
  for (const s of sets) {
    if (!s.pts.length) continue;
    let lo = Infinity, hi = -Infinity;
    for (const [, b] of s.pts) { if (b < lo) lo = b; if (b > hi) hi = b; }
    const rng = hi - lo || 1;
    const yv = v => norm ? (v - lo) / rng : v;
    ctx.globalAlpha = s.pts.length > 8000 ? 0.28 : (s.pts.length > 2000 ? 0.5 : 0.8);
    if (useTimeColor) {
      for (const [a, b, t] of s.pts) {
        ctx.fillStyle = `hsl(${220 - 220 * t},72%,50%)`;
        ctx.fillRect(px(a) - d / 2, py(yv(b)) - d / 2, d, d);
      }
    } else {
      ctx.fillStyle = s.ch.color;
      for (const [a, b] of s.pts) ctx.fillRect(px(a) - d / 2, py(yv(b)) - d / 2, d, d);
    }
    ctx.globalAlpha = 1;
    if (useFit && isFinite(s.slope)) {
      ctx.strokeStyle = s.ch.color; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(px(xmin), py(yv(s.slope * xmin + s.icpt)));
      ctx.lineTo(px(xmax), py(yv(s.slope * xmax + s.icpt)));
      ctx.stroke(); ctx.setLineDash([]);
    }
  }
  ctx.restore();
  if (!norm) drawLimits(ctx, { L, T, pw, ph, py }, cfg.limits, th, ymin, ymax);
  return { sets, notes, useTimeColor };
}

function drawXY() {
  const card = $("xyPlotCard");
  if (!card || card.hidden) return;
  const t0 = performance.now();
  const { ctx, w, h } = setupCanvas($("xyCv"), plotHeight($("xyCv"), ui.cfg.xy.ratio));
  const r = renderXY(ctx, w, h, themeNow());
  $("xyStat").innerHTML = ""; $("xyNote").innerHTML = "";
  if (!r) return;
  $("xyStat").innerHTML = r.sets.map(s => {
    if (!s.pts.length) return `<span class="b" style="background:var(--dangerBg);color:var(--danger)"><b>결합 실패</b>${s.ch.name}</span>`;
    const strength = Math.abs(s.r) >= 0.7 ? "강함" : Math.abs(s.r) >= 0.4 ? "보통" : "약함";
    return `<span class="b"><b>r = ${fmtNum(s.r, 3)}</b>${s.ch.name} · ${strength} · 기울기 ${fmtNum(s.slope, 5)}</span>`;
  }).join("");
  $("xyNote").innerHTML = r.notes.join("<br>") + `<br>렌더 ${(performance.now() - t0).toFixed(1)}ms`
    + (r.sets[0] && r.sets[0].stride > 1 ? ` · ${r.sets[0].stride}점마다 하나씩 표시` : "")
    + (r.useTimeColor ? " · 색은 시간 순서(파랑 → 빨강)" : "");
}
