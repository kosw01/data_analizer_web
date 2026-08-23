"use strict";

/* 시계열 화면
   여러 채널을 겹쳐 그린다 */

/* ============================================================
   시계열
   ============================================================ */

function renderTS(ctx, w, h, th) {
  const cfg = ui.cfg.ts;
  const chs = store.channels.filter(c => ui.tsSel.has(c.id));
  if (th.bg) { ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h); }
  if (!chs.length) {
    ctx.fillStyle = th.textDim; ctx.font = "14px -apple-system,sans-serif"; ctx.textAlign = "center";
    ctx.fillText("채널을 하나 이상 선택하세요.", w / 2, h / 2);
    return null;
  }
  const norm = $("tsYMode").value === "norm";
  const showPts = $("tsPoints").checked;
  const allTimed = chs.every(c => c.timeKind !== "index");
  const mixed = !allTimed && chs.some(c => c.timeKind !== "index");

  const series = chs.map(c => {
    const xs = allTimed ? (i => c.times[i]) : (i => i / (c.sampleRate || 1) * 1000);
    return { ch: c, pts: lttb(xs, c.values, c.n, 2000) };
  });

  let xmin = Infinity, xmax = -Infinity;
  for (const s of series) for (const [x] of s.pts) { if (x < xmin) xmin = x; if (x > xmax) xmax = x; }
  if (!(xmax > xmin)) xmax = xmin + 1;

  let ymin, ymax;
  if (norm) { ymin = 0; ymax = 1; }
  else {
    ymin = Infinity; ymax = -Infinity;
    for (const s of series) { if (s.ch.min < ymin) ymin = s.ch.min; if (s.ch.max > ymax) ymax = s.ch.max; }
    if (!(ymax > ymin)) { ymax = ymin + 1; ymin -= 1; }
    const pad = (ymax - ymin) * 0.08; ymin -= pad; ymax += pad;
  }
  const uMin = numOrNull(cfg.yMin), uMax = numOrNull(cfg.yMax);
  if (uMin !== null) ymin = uMin;
  if (uMax !== null) ymax = uMax;
  if (!(ymax > ymin)) ymax = ymin + 1;

  const L = 78, R = 18, T = cfg.title ? 36 : 16, B = 50;
  const pw = w - L - R, ph = h - T - B;
  const px = x => L + (x - xmin) / (xmax - xmin) * pw;
  const py = y => T + (1 - (y - ymin) / (ymax - ymin)) * ph;

  const span = xmax - xmin;
  drawFrame(ctx, { L, T, pw, ph, px, py },
    niceTicks(xmin, xmax, Math.max(3, Math.floor(pw / 115))).map(v => [v, allTimed ? fmtTime(v, span) : fmtNum(v / 1000, 2) + "s"]),
    niceTicks(ymin, ymax, 5).map(v => [v, fmtNum(v, 3)]),
    cfg.xLabel || (allTimed ? "시각" : "경과 시간"),
    cfg.yLabel || (norm ? "정규화 (0~1)" : "값"),
    cfg.title, th, cfg.grid);

  ctx.save();
  ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
  for (const s of series) {
    const c = s.ch, rng = c.max - c.min || 1;
    const yv = v => norm ? (v - c.min) / rng : v;
    const breakAt = c.timeKind === "irregular" ? Math.max((xmax - xmin) / 2000 * 4, 1) : Infinity;
    ctx.strokeStyle = c.color; ctx.lineWidth = cfg.lineWidth;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.globalAlpha = series.length > 1 ? 0.9 : 1;
    ctx.beginPath();
    let open = false;
    for (let i = 0; i < s.pts.length; i++) {
      const [x, v] = s.pts[i];
      if (!isFinite(v)) { open = false; continue; }
      if (i > 0 && x - s.pts[i - 1][0] > breakAt) open = false;
      const X = px(x), Y = py(yv(v));
      if (!open) { ctx.moveTo(X, Y); open = true; } else ctx.lineTo(X, Y);
    }
    ctx.stroke();
    if (showPts) {
      ctx.fillStyle = c.color;
      for (const [x, v] of s.pts) { if (isFinite(v)) ctx.fillRect(px(x) - 1, py(yv(v)) - 1, 2.4, 2.4); }
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  return { series, chs, mixed, norm };
}

function drawTS() {
  if ($("tsPlotCard").hidden) return;
  const t0 = performance.now();
  const { ctx, w, h } = setupCanvas($("tsCv"), ui.cfg.ts.height);
  const r = renderTS(ctx, w, h, themeNow());
  $("tsLegend").innerHTML = ""; $("tsNote").textContent = "";
  if (!r) return;
  $("tsLegend").innerHTML = r.series.map(s =>
    `<div><span class="dot" style="background:${s.ch.color}"></span>${s.ch.name}
     <span class="rg">${fmtNum(s.ch.min, 3)} ~ ${fmtNum(s.ch.max, 3)}</span></div>`).join("");
  const total = r.chs.reduce((a, c) => a + c.n, 0);
  const shown = r.series.reduce((a, s) => a + s.pts.length, 0);
  $("tsNote").textContent =
    `${r.chs.length}개 채널 · 원본 ${total.toLocaleString()}점 → 화면 ${shown.toLocaleString()}점 (LTTB) · 렌더 ${(performance.now() - t0).toFixed(1)}ms`
    + (r.mixed ? " · 시간축 없는 채널이 섞여 경과 시간 기준" : "")
    + (!r.norm && r.chs.length > 1 ? " · 스케일이 다르면 개별 축을 쓰세요" : "");
}
