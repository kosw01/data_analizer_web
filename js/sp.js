"use strict";

/* 신호처리 화면
   구간을 잘라 zero correction → 필터 → FFT 순서로 처리하고
   처리 결과 시계열과 스펙트럼을 함께 보여준다 */

let spResult = null;   // 마지막 계산 결과. 두 캔버스와 CSV가 함께 쓴다

/* 등간격이 아니면 주파수 해석 자체가 성립하지 않는다 */
function spChannel() {
  const ch = store.channels.find(c => c.id === ui.spX);
  if (!ch) return null;
  return canProcess(ch).ok ? ch : null;
}

/* 전처리 → 필터 → 스펙트럼. 화면 그리기 전에 한 번만 돈다 */
function computeSP() {
  spResult = null;
  const ch = spChannel();
  if (!ch) return null;
  const cfg = ui.cfg.sp;
  const fs = ch.sampleRate;
  if (!(fs > 0)) return null;

  const [i0, i1] = rangeBounds(ch);
  const n = i1 - i0;
  if (n < 8) return null;

  const t0 = performance.now();
  const notes = [];

  const zc = zeroCorrect(ch.values, i0, i1, cfg.zero);
  if (zc.filled) notes.push(`결측 ${zc.filled.toLocaleString()}개를 0으로 채웠습니다`);

  const ft = applyFilter(zc.data, fs, cfg.filter, +cfg.lowCut, +cfg.highCut);
  notes.push(...ft.notes);
  if (cfg.filter !== "none" && !ft.notes.length)
    notes.push("필터는 앞뒤로 두 번 걸어 위상 지연이 없습니다 (실효 4차, 차단점에서 −6 dB)");

  const N = Math.min(+cfg.N, 1 << 20);
  let sp = null;
  if (n < N) notes.push(`구간이 ${n.toLocaleString()}점이라 윈도우 ${N.toLocaleString()}보다 짧습니다. 뒤를 0으로 채웁니다`);
  sp = spectrum(ft.data, fs, N, cfg.win, cfg.welch);

  /* 봉우리는 화면에 보이는 주파수 범위 안에서만 찾는다.
     그러지 않으면 나이퀴스트 근처 잡음이 목록을 다 차지한다 */
  /* FFT 앞쪽 몇 개 빈은 DC 잔여와 창함수 누설로 값이 크게 나온다.
     그대로 두면 Y축이 그쪽에 눌려 정작 보려는 봉우리가 바닥에 붙는다 */
  let peaks = [];
  if (sp) {
    const skip = Math.max(1, Math.min(+cfg.skip || 0, sp.amp.length - 4));
    const fLo = skip * sp.df;
    const fu = numOrNull(cfg.fmax);
    const fHi = fu !== null && fu > 0 ? Math.min(fu, sp.nyquist) : sp.nyquist;
    peaks = findPeaks(sp, 5, cfg.win, { fMin: fLo, fMax: fHi });
  }

  spResult = {
    ch, fs, i0, i1, n, raw: zc.data, filtered: ft.data, sp, peaks, notes,
    ms: performance.now() - t0
  };
  return spResult;
}

/* ---- 위: 처리 결과 시계열 ---- */

function renderSPTime(ctx, w, h, th) {
  const cfg = ui.cfg.sp;
  if (th.bg) { ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h); }
  const R0 = spResult;
  if (!R0) {
    ctx.fillStyle = th.textDim; ctx.font = "14px -apple-system,sans-serif"; ctx.textAlign = "center";
    ctx.fillText("등간격 시간축을 가진 채널을 고르세요.", w / 2, h / 2);
    return null;
  }
  const { ch, fs, i0, n, raw, filtered } = R0;
  const useRaw = cfg.showRaw && cfg.filter !== "none";
  const xs = i => (i / fs) * 1000;

  const series = [];
  if (useRaw) series.push({ vals: raw, color: th.textDim, w: 1 });
  series.push({ vals: filtered, color: ch.color, w: cfg.filter === "none" ? 1.3 : 1.6 });

  let ymin = Infinity, ymax = -Infinity;
  for (const s of series) for (let i = 0; i < n; i++) {
    const v = s.vals[i];
    if (v < ymin) ymin = v; if (v > ymax) ymax = v;
  }
  if (!(ymax > ymin)) { ymax = ymin + 1; ymin -= 1; }
  const pad = (ymax - ymin) * 0.08; ymin -= pad; ymax += pad;
  [ymin, ymax] = expandForLimits(ymin, ymax, cfg.limits);

  const xmin = 0, xmax = (n - 1) / fs * 1000;
  const L = 78, Rr = 18, T = cfg.title ? 36 : 16, B = 46;
  const pw = w - L - Rr, ph = h - T - B;
  const px = x => L + (x - xmin) / ((xmax - xmin) || 1) * pw;
  const py = y => T + (1 - (y - ymin) / (ymax - ymin)) * ph;

  drawFrame(ctx, { L, T, pw, ph, px, py },
    niceTicks(xmin, xmax, Math.max(3, Math.floor(pw / 110))).map(v => [v, fmtNum(v / 1000, 2) + "s"]),
    niceTicks(ymin, ymax, 5).map(v => [v, fmtNum(v, 3)]),
    "경과 시간", "값", cfg.title, th, cfg.grid);

  ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
  for (const s of series) {
    const pts = lttb(xs, s.vals, 0, n, 2000);
    ctx.strokeStyle = s.color; ctx.lineWidth = s.w;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    pts.forEach(([x, v], k) => k ? ctx.lineTo(px(x), py(v)) : ctx.moveTo(px(x), py(v)));
    ctx.stroke();
  }
  ctx.restore();
  drawLimits(ctx, { L, T, pw, ph, py }, cfg.limits, th, ymin, ymax);
  return { useRaw };
}

/* ---- 아래: 스펙트럼 ---- */

function renderSPFreq(ctx, w, h, th) {
  const cfg = ui.cfg.sp;
  if (th.bg) { ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h); }
  const R0 = spResult;
  if (!R0 || !R0.sp) {
    ctx.fillStyle = th.textDim; ctx.font = "14px -apple-system,sans-serif"; ctx.textAlign = "center";
    ctx.fillText("스펙트럼을 낼 수 없습니다.", w / 2, h / 2);
    return null;
  }
  const { sp, peaks, ch } = R0;
  const { freq, amp } = sp;

  const fmaxUser = numOrNull(cfg.fmax);
  const fmax = fmaxUser !== null && fmaxUser > 0 ? Math.min(fmaxUser, sp.nyquist) : sp.nyquist;
  const kmax = Math.max(2, Math.min(amp.length - 1, Math.ceil(fmax / sp.df)));
  /* 앞쪽 빈은 축 범위 계산에서도 빼야 한다. 그리기만 빼면 Y축이 그대로 눌린다 */
  const kmin = Math.max(1, Math.min(+cfg.skip || 1, kmax - 2));
  const fmin = kmin * sp.df;

  const log = cfg.log;
  let ymax = -Infinity, ymin = Infinity;
  for (let k = kmin; k <= kmax; k++) {
    if (amp[k] > ymax) ymax = amp[k];
    if (amp[k] > 0 && amp[k] < ymin) ymin = amp[k];
  }
  if (!isFinite(ymax) || ymax <= 0) { ymax = 1; ymin = 0.001; }
  if (!isFinite(ymin) || ymin <= 0) ymin = ymax * 1e-6;

  const yv = v => log ? Math.log10(Math.max(v, ymin)) : v;
  const lo = log ? Math.log10(ymin) : 0;
  const hi = log ? Math.log10(ymax * 1.6) : ymax * 1.12;

  const L = 78, Rr = 18, T = cfg.sTitle ? 36 : 16, B = 46;
  const pw = w - L - Rr, ph = h - T - B;
  const px = f => L + (f - fmin) / ((fmax - fmin) || 1) * pw;
  const py = v => T + (1 - (yv(v) - lo) / ((hi - lo) || 1)) * ph;

  const yticks = log
    ? (() => {
        const out = [];
        for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) {
          const v = Math.pow(10, e);
          if (v >= ymin * 0.999 && v <= Math.pow(10, hi)) out.push([v, "1e" + e]);
        }
        return out.length > 1 ? out : [[ymin, fmtNum(ymin, 2)], [ymax, fmtNum(ymax, 2)]];
      })()
    : niceTicks(0, hi, 5).map(v => [v, fmtNum(v, 3)]);

  drawFrame(ctx, { L, T, pw, ph, px: f => px(f), py },
    niceTicks(fmin, fmax, Math.max(3, Math.floor(pw / 90))).map(v => [v, fmtNum(v, 3)]),
    yticks, "주파수 (Hz)", log ? "진폭 (로그)" : "진폭", cfg.sTitle, th, cfg.grid);

  ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
  ctx.strokeStyle = ch.color; ctx.lineWidth = 1.3;
  ctx.lineJoin = "round";
  ctx.beginPath();
  const stride = Math.max(1, Math.floor((kmax - kmin) / (pw * 3)));
  let started = false;
  for (let k = kmin; k <= kmax; k += stride) {
    const X = px(freq[k]), Y = py(amp[k]);
    if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
  }
  ctx.stroke();

  /* 봉우리 표시 */
  ctx.font = "700 11px -apple-system,sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  for (const p of peaks) {
    if (p.freq > fmax || p.freq < fmin) continue;
    const X = px(p.freq), Y = py(p.amp);
    ctx.fillStyle = ch.color;
    ctx.beginPath(); ctx.arc(X, Y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = th.textNormal;
    ctx.fillText(fmtHz(p.freq), Math.max(L + 24, Math.min(L + pw - 24, X)), Y - 6);
  }
  ctx.restore();
  return { fmin, fmax, kmin, kmax };
}

function drawSP() {
  const card = $("spPlotCard");
  if (!card || card.hidden) return;
  computeSP();
  const a = setupCanvas($("spCv"), plotHeight($("spCv"), ui.cfg.sp.ratio));
  renderSPTime(a.ctx, a.w, a.h, themeNow());
  const b = setupCanvas($("spFCv"), plotHeight($("spFCv"), ui.cfg.sp.sRatio));
  renderSPFreq(b.ctx, b.w, b.h, themeNow());
  renderSPInfo();
}

function renderSPInfo() {
  const R0 = spResult;
  const tbl = $("spPeaks"), note = $("spNote");
  if (!R0) {
    tbl.innerHTML = ""; note.textContent = "";
    $("spCsv").disabled = true;
    return;
  }
  const { sp, peaks, fs, n, ms } = R0;
  tbl.innerHTML = peaks.length
    ? `<thead><tr><th>순위</th><th>주파수</th><th>주기</th><th>진폭</th></tr></thead><tbody>` +
      peaks.map((p, i) => `<tr><td>${i + 1}</td><td>${fmtHz(p.freq)}</td><td>${p.freq > 0 ? fmtNum(1 / p.freq, 4) + " s" : "—"}</td><td>${fmtNum(p.amp, 5)}</td></tr>`).join("") +
      `</tbody>`
    : "";
  const skip = Math.max(1, +ui.cfg.sp.skip || 1);
  note.innerHTML = [
    `샘플레이트 ${fmtHz(fs)} · 나이퀴스트 ${fmtHz(sp.nyquist)} · 분해능 ${fmtHz(sp.df)}`,
    `앞쪽 ${skip}개 빈 제외 (${fmtHz(skip * sp.df)} 미만은 표시·탐색에서 뺍니다)`,
    `구간 ${n.toLocaleString()}점 · 평균 조각 ${sp.segments}개 · 계산 ${ms.toFixed(0)}ms`,
    ...R0.notes
  ].join("<br>");
  $("spCsv").disabled = false;
}

function exportSpectrumCsv() {
  const R0 = spResult;
  if (!R0 || !R0.sp) return;
  const { freq, amp } = R0.sp;
  const lines = ["주파수(Hz),진폭"];
  for (let k = 0; k < freq.length; k++) lines.push(`${freq[k]},${amp[k]}`);
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `스펙트럼_${R0.ch.name}.csv`);
}

/* PNG — 화면 테마와 무관하게 라이트 고정 */
function saveSpPng(which) {
  const cfg = ui.cfg.sp;
  const isTime = which === "time";
  const src = $(isTime ? "spCv" : "spFCv");
  const w = src.clientWidth || 800, h = plotHeight(src, isTime ? cfg.ratio : cfg.sRatio), scale = 2;
  const off = document.createElement("canvas");
  off.width = w * scale; off.height = h * scale;
  const ctx = off.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  (isTime ? renderSPTime : renderSPFreq)(ctx, w, h, { ...LIGHT });
  off.toBlob(blob => {
    const base = (isTime ? cfg.title : cfg.sTitle) || (isTime ? "처리결과" : "스펙트럼");
    downloadBlob(blob, `${base.replace(/[\/\\:*?"<>|]/g, "_")}.png`);
  }, "image/png");
}
