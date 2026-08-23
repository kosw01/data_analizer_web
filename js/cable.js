"use strict";

/* 케이블 장력 (진동법)
   계산 부분은 화면을 전혀 모른다. 나중에 떼어내도 그대로 쓴다.

   단위 약속:  m [ton/m],  L [m],  fn [Hz]  →  T [kN]
   ton·m/s² = kN 이므로 4·m·L²·f² 가 그대로 kN이 된다 */

const MASS_UNITS = {
  ton: { label: "ton/m", toTon: 1 },
  kg:  { label: "kg/m",  toTon: 0.001 },
  kN:  { label: "kN/m",  toTon: 1 / 9.80665 }   // 단위중량 w → 단위질량 m
};
const G = 9.80665;

/* modes = [{ n, f }] 중 실제로 쓸 것만 넘긴다 */
function cableTension(modes, mTon, L) {
  if (!(mTon > 0) || !(L > 0) || !modes.length) return null;
  const k = 4 * mTon * L * L;

  const rows = modes.map(({ n, f }) => {
    const y = (f / n) * (f / n);
    return { n, f, n2: n * n, y, T: k * y };
  });

  const cnt = rows.length;
  const single = k * rows.reduce((a, r) => a + r.y, 0) / cnt;

  let multi = null, slope = null, intercept = null, corr = null, EI = null;
  if (cnt >= 2) {
    /* (fn/n)² 를 n² 에 회귀한다. 절편이 장력 항, 기울기가 휨강성 항이다 */
    const sx = rows.reduce((a, r) => a + r.n2, 0);
    const sy = rows.reduce((a, r) => a + r.y, 0);
    const sxx = rows.reduce((a, r) => a + r.n2 * r.n2, 0);
    const syy = rows.reduce((a, r) => a + r.y * r.y, 0);
    const sxy = rows.reduce((a, r) => a + r.n2 * r.y, 0);
    const den = cnt * sxx - sx * sx;
    if (den !== 0) {
      slope = (cnt * sxy - sx * sy) / den;
      intercept = (sy - slope * sx) / cnt;
      const rden = Math.sqrt(den * (cnt * syy - sy * sy));
      corr = rden ? (cnt * sxy - sx * sy) / rden : null;
      multi = k * intercept;
      EI = slope * 4 * mTon * Math.pow(L, 4) / (Math.PI * Math.PI);
    }
  }

  return {
    rows, k, count: cnt,
    single, singleTonf: single / G,
    multi, multiTonf: multi === null ? null : multi / G,
    slope, intercept, corr, EI,
    w: mTon * G
  };
}

/* ============================================================
   화면
   ============================================================ */

let cbResult = null;
let cbModesKey = "";
const MODE_ROWS = 16;

function cbChannel() {
  const ch = store.channels.find(c => c.id === ui.cbX);
  if (!ch) return null;
  return canProcess(ch).ok ? ch : null;
}

/* 검출한 봉우리를 차수 칸에 자동으로 채운다. 이후 사람이 켜고 끈다 */
function autoFillModes(peaks, f1) {
  const rows = [];
  for (let n = 1; n <= MODE_ROWS; n++) {
    let hit = null, best = Infinity;
    if (f1 > 0) {
      for (const p of peaks) {
        const d = Math.abs(p.freq - n * f1);
        if (d < best && d < f1 * 0.12) { best = d; hit = p.freq; }
      }
    }
    rows.push({ n, f: hit === null ? "" : +hit.toFixed(4), use: hit !== null });
  }
  ui.cbModes = rows;
}

function usedModes() {
  return (ui.cbModes || [])
    .filter(r => r.use && numOrNull(r.f) > 0)
    .map(r => ({ n: r.n, f: numOrNull(r.f) }));
}

function computeCable() {
  cbResult = null;
  const ch = cbChannel();
  if (!ch) return null;
  const cfg = ui.cfg.cb;
  const fs = ch.sampleRate;
  if (!(fs > 0)) return null;

  const [i0, i1] = rangeBounds(ch);
  const n = i1 - i0;
  if (n < 64) return null;

  const notes = [];
  const zc = zeroCorrect(ch.values, i0, i1, "mean");
  if (zc.filled) notes.push(`결측 ${zc.filled.toLocaleString()}개를 0으로 채웠습니다`);

  const fMin = Math.max(0.05, +cfg.fMin || 0.4);
  const fMax = Math.min(+cfg.fMax || 20, fs / 2);
  let data = zc.data;
  if (fMin > 0.05 && fMin < fs / 2) data = filtfilt(data, "high", fMin * 0.6, fs);

  const N = +cfg.N;
  const sp = spectrum(data, fs, N, cfg.win, true);
  if (!sp) return null;
  if (n < N) notes.push(`구간이 ${n.toLocaleString()}점이라 윈도우 ${N.toLocaleString()}보다 짧습니다`);

  const peaks = findPeaks(sp, 20, cfg.win, {
    fMin, fMax, minSep: Math.max(sp.df * 4, +cfg.minSep || 0.1), prominence: 1.4
  });
  const est = estimateFundamental(peaks);

  /* 채널·구간·해석 설정이 바뀐 때만 차수 칸을 새로 채운다.
     안 그러면 사람이 켜고 끈 것이 매번 지워진다 */
  const key = [ui.cbX, ui.range.mode, ui.range.tStart, ui.range.tEnd,
               ui.range.sStart, ui.range.sEnd, N, cfg.win, fMin, fMax, cfg.minSep].join("|");
  if (key !== cbModesKey || !ui.cbModes || !ui.cbModes.length) {
    autoFillModes(peaks, est ? est.f1 : 0);
    cbModesKey = key;
  }

  if (est && est.extrapolated)
    notes.push(`1·2차가 보이지 않아 ${est.orders[0]}차 이상의 간격으로 역산했습니다`);

  const unit = MASS_UNITS[cfg.massUnit] || MASS_UNITS.ton;
  const mIn = numOrNull(cfg.m);
  const mTon = mIn === null ? null : mIn * unit.toTon;
  const L = numOrNull(cfg.L);
  const T = cableTension(usedModes(), mTon, L);

  if (T && T.EI !== null && T.EI < 0)
    notes.push("휨강성이 음수입니다. 회귀가 잘 맞지 않는다는 뜻이니 쓰는 차수를 조정해 보세요");
  if (T && T.corr !== null && Math.abs(T.corr) < 0.5 && T.count >= 3)
    notes.push(`상관계수 ${T.corr.toFixed(3)}로 낮습니다. 다중모드 값의 신뢰도가 떨어집니다`);

  cbResult = { ch, fs, n, sp, peaks, est, T, mTon, mIn, unit, L, fMin, fMax, notes };
  return cbResult;
}

/* ---- 스펙트럼 ---- */

function renderCable(ctx, w, h, th) {
  const cfg = ui.cfg.cb;
  if (th.bg) { ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h); }
  const R0 = cbResult;
  if (!R0) {
    ctx.fillStyle = th.textDim; ctx.font = "14px -apple-system,sans-serif"; ctx.textAlign = "center";
    ctx.fillText("등간격 시간축을 가진 채널을 고르세요.", w / 2, h / 2);
    return null;
  }
  const { sp, peaks, ch, fMax } = R0;
  const { freq, amp } = sp;
  const kmax = Math.max(2, Math.min(amp.length - 1, Math.ceil(fMax / sp.df)));

  let ymax = 0;
  for (let k = 1; k <= kmax; k++) if (amp[k] > ymax) ymax = amp[k];
  if (!(ymax > 0)) ymax = 1;
  const hi = ymax * 1.24;

  const L = 74, Rr = 18, T = cfg.title ? 34 : 16, B = 46;
  const pw = w - L - Rr, ph = h - T - B;
  const px = f => L + f / fMax * pw;
  const py = v => T + (1 - v / hi) * ph;

  drawFrame(ctx, { L, T, pw, ph, px, py },
    niceTicks(0, fMax, Math.max(3, Math.floor(pw / 80))).map(v => [v, fmtNum(v, 3)]),
    niceTicks(0, hi, 5).map(v => [v, fmtNum(v, 3)]),
    "주파수 (Hz)", "진폭", cfg.title, th, cfg.grid);

  ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();

  /* 쓰기로 체크한 차수 자리에 세로선 — 봉우리가 그 위에 앉는지 눈으로 본다 */
  for (const r of usedModes()) {
    if (r.f > fMax) continue;
    const X = px(r.f);
    ctx.strokeStyle = th.textDim; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X, T); ctx.lineTo(X, T + ph); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = th.textDim; ctx.font = "10px -apple-system,sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(r.n, X, T + 3);
  }

  ctx.strokeStyle = ch.color; ctx.lineWidth = 1.3; ctx.lineJoin = "round";
  ctx.beginPath();
  const stride = Math.max(1, Math.floor(kmax / (pw * 3)));
  let started = false;
  for (let k = 1; k <= kmax; k += stride) {
    const X = px(freq[k]), Y = py(amp[k]);
    if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
  }
  ctx.stroke();

  ctx.font = "700 11px -apple-system,sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  for (const p of peaks) {
    if (p.freq > fMax) continue;
    const X = px(p.freq), Y = py(p.amp);
    ctx.fillStyle = ch.color;
    ctx.beginPath(); ctx.arc(X, Y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = th.textNormal;
    ctx.fillText(p.freq.toFixed(3), Math.max(L + 22, Math.min(L + pw - 22, X)), Y - 6);
  }
  ctx.restore();
  return true;
}

/* ---- 회귀 그래프: (fn/n)² 대 n² ---- */

function renderRegression(ctx, w, h, th, res) {
  const T = res || (cbResult && cbResult.T);
  if (th.bg) { ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h); }
  if (!T || T.count < 2) {
    ctx.fillStyle = th.textDim; ctx.font = "13px -apple-system,sans-serif"; ctx.textAlign = "center";
    ctx.fillText("차수를 두 개 이상 선택하면 회귀선이 그려집니다.", w / 2, h / 2);
    return null;
  }
  const xs = T.rows.map(r => r.n2), ys = T.rows.map(r => r.y);
  const xmin = 0, xmax = Math.max.apply(null, xs) * 1.1;
  let ymin = Math.min(Math.min.apply(null, ys), T.intercept);
  let ymax = Math.max(Math.max.apply(null, ys), T.intercept);
  const pad = (ymax - ymin) * 0.2 || Math.abs(ymax) * 0.05 || 0.05;
  ymin -= pad; ymax += pad;

  const L = 76, Rr = 16, Tp = 14, B = 42;
  const pw = w - L - Rr, ph = h - Tp - B;
  const px = x => L + (x - xmin) / (xmax - xmin) * pw;
  const py = y => Tp + (1 - (y - ymin) / (ymax - ymin)) * ph;

  drawFrame(ctx, { L, T: Tp, pw, ph, px, py },
    niceTicks(xmin, xmax, 5).map(v => [v, fmtNum(v, 0)]),
    niceTicks(ymin, ymax, 5).map(v => [v, fmtNum(v, 4)]),
    "n²", "(fn/n)²", "", th, true);

  ctx.save(); ctx.beginPath(); ctx.rect(L, Tp, pw, ph); ctx.clip();
  ctx.strokeStyle = "#0B6BCB"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(px(xmin), py(T.intercept + T.slope * xmin));
  ctx.lineTo(px(xmax), py(T.intercept + T.slope * xmax));
  ctx.stroke(); ctx.setLineDash([]);

  for (const r of T.rows) {
    ctx.fillStyle = "#F04452";
    ctx.beginPath(); ctx.arc(px(r.n2), py(r.y), 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = th.textNormal; ctx.font = "10px -apple-system,sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(String(r.n), px(r.n2), py(r.y) - 7);
  }
  ctx.restore();
  return true;
}

function drawCable() {
  if ($("cbPlotCard").hidden) return;
  computeCable();
  const c = setupCanvas($("cbCv"), plotHeight($("cbCv"), ui.cfg.cb.ratio));
  renderCable(c.ctx, c.w, c.h, themeNow());
  const g = setupCanvas($("cbRegCv"), plotHeight($("cbRegCv"), "2:1"));
  renderRegression(g.ctx, g.w, g.h, themeNow());
  renderModeTable();
  renderCableInfo();
}

function renderModeTable() {
  const R0 = cbResult;
  const tbl = $("cbModeTbl");
  if (!R0 || !ui.cbModes) { tbl.innerHTML = ""; return; }
  const k = R0.T ? R0.T.k : null;
  tbl.innerHTML =
    `<thead><tr><th>사용</th><th>n</th><th>fn [Hz]</th><th>n²</th><th>(fn/n)²</th><th>T [kN]</th></tr></thead><tbody>` +
    ui.cbModes.map((r, i) => {
      const f = numOrNull(r.f);
      const y = f > 0 ? (f / r.n) * (f / r.n) : null;
      return `<tr class="${r.use ? "" : "off"}">
        <td style="text-align:center"><input type="checkbox" data-mode="${i}.use" ${r.use ? "checked" : ""}></td>
        <td>${r.n}</td>
        <td><input class="box mini" type="number" step="any" data-mode="${i}.f" value="${r.f}"></td>
        <td>${r.n * r.n}</td>
        <td>${y === null ? "—" : y.toFixed(5)}</td>
        <td>${y === null || k === null ? "—" : (k * y).toFixed(2)}</td></tr>`;
    }).join("") + `</tbody>`;
}

function renderCableInfo() {
  const R0 = cbResult;
  const box = $("cbOut"), note = $("cbNote"), props = $("cbProps");
  if (!R0) { box.innerHTML = ""; note.textContent = ""; props.innerHTML = ""; $("cbAdd").disabled = true; return; }
  const { est, T, mTon, L } = R0;

  $("cbF1Est").textContent = est
    ? `${est.f1.toFixed(4)} Hz (차수 ${est.orders.join(",")} 인식${est.extrapolated ? " · 역산" : ""})`
    : "추정 실패";

  props.innerHTML = (mTon > 0 && L > 0)
    ? `<span class="chip">w ${(mTon * G).toFixed(5)} kN/m</span>
       <span class="chip">m ${mTon.toFixed(5)} ton/m</span>
       <span class="chip">Leff ${L} m</span>
       <span class="chip">4mL² ${(4 * mTon * L * L).toFixed(4)}</span>`
    : `<span class="chip warn">단위질량과 유효길이를 입력하세요</span>`;

  if (!T) { box.innerHTML = ""; note.innerHTML = R0.notes.join("<br>"); $("cbAdd").disabled = true; return; }

  const c = [`<span class="b"><b>${T.single.toFixed(2)} kN</b>Single Mode · ${T.singleTonf.toFixed(2)} tonf</span>`];
  c.push(T.multi !== null
    ? `<span class="b"><b>${T.multi.toFixed(2)} kN</b>Multi-Mode · ${T.multiTonf.toFixed(2)} tonf</span>`
    : `<span class="b" style="background:var(--warnBg);color:var(--warn)"><b>차수 2개 필요</b>다중모드 회귀</span>`);
  box.innerHTML = c.join("");

  note.innerHTML = [
    T.multi !== null
      ? `y-절편 ${T.intercept.toFixed(5)} · 기울기 ${T.slope.toExponential(4)} · 상관계수 ${T.corr.toFixed(5)} · 휨강성 ${T.EI.toFixed(3)} kN·m²`
      : "",
    `사용 차수 ${T.count}개`,
    ...R0.notes
  ].filter(Boolean).join("<br>");

  $("cbAdd").disabled = false;
}

/* ---- 결과 모으기: 보고서 한 장이 여기서 만들어진다 ----
   그림도 이때 함께 저장한다. 채널을 바꾼 뒤에는 다시 그릴 수 없다 */

function snapshot(renderFn, ratio, extra) {
  const w = 760, h = Math.round(w / (RATIOS[ratio] || 2));
  const off = document.createElement("canvas");
  off.width = w * 2; off.height = h * 2;
  const ctx = off.getContext("2d");
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  renderFn(ctx, w, h, { ...LIGHT }, extra);
  return off.toDataURL("image/png");
}

function addCableResult() {
  const R0 = cbResult;
  if (!R0 || !R0.T) return;
  ui.cbList.push({
    bridge: $("cbBridge").value.trim(),
    name: $("cbName").value.trim() || R0.ch.name,
    source: R0.ch.source,
    mIn: R0.mIn, unitLabel: R0.unit.label, mTon: R0.mTon, L: R0.L,
    T: R0.T,
    spectrumPng: snapshot(renderCable, ui.cfg.cb.ratio),
    regPng: snapshot(renderRegression, "2:1", R0.T)
  });
  $("cbName").value = "";
  renderCableList();
  renderReport();
}

function renderCableList() {
  const rows = ui.cbList;
  $("cbListCard").hidden = !rows.length;
  $("cbReportCard").hidden = !rows.length;
  if (!rows.length) return;
  $("cbList").innerHTML =
    `<thead><tr><th>케이블</th><th>단위질량</th><th>유효길이</th><th>차수</th>
      <th>Single (kN)</th><th>Multi (kN)</th><th>Multi (tonf)</th><th>상관계수</th><th></th></tr></thead><tbody>` +
    rows.map((r, i) => `<tr>
      <td>${r.name}</td><td>${r.mIn} ${r.unitLabel}</td><td>${r.L} m</td><td>${r.T.count}</td>
      <td>${r.T.single.toFixed(1)}</td>
      <td>${r.T.multi === null ? "—" : r.T.multi.toFixed(1)}</td>
      <td>${r.T.multiTonf === null ? "—" : r.T.multiTonf.toFixed(2)}</td>
      <td>${r.T.corr === null ? "—" : r.T.corr.toFixed(3)}</td>
      <td><button class="b btn-ghost btn-sm" data-cbdel="${i}">삭제</button></td></tr>`).join("") +
    `</tbody>`;
}

function exportCableCsv() {
  const rows = ui.cbList;
  if (!rows.length) return;
  const esc = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const head = ["교량", "케이블", "출처파일", "단위질량입력", "단위", "단위질량(ton/m)", "단위중량(kN/m)",
                "유효길이(m)", "사용차수", "y절편", "기울기", "상관계수", "휨강성(kNm2)",
                "SingleMode(kN)", "SingleMode(tonf)", "MultiMode(kN)", "MultiMode(tonf)"];
  const lines = [head.join(",")];
  for (const r of rows) {
    const T = r.T;
    lines.push([r.bridge, r.name, r.source, r.mIn, r.unitLabel, r.mTon, T.w, r.L, T.count,
      T.intercept === null ? "" : T.intercept, T.slope === null ? "" : T.slope,
      T.corr === null ? "" : T.corr, T.EI === null ? "" : T.EI,
      T.single, T.singleTonf,
      T.multi === null ? "" : T.multi, T.multiTonf === null ? "" : T.multiTonf
    ].map(esc).join(","));
  }
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, "케이블_장력.csv");
}

function saveCablePng() {
  const src = $("cbCv");
  const w = src.clientWidth || 800, h = plotHeight(src, ui.cfg.cb.ratio);
  const off = document.createElement("canvas");
  off.width = w * 2; off.height = h * 2;
  const ctx = off.getContext("2d");
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  renderCable(ctx, w, h, { ...LIGHT });
  off.toBlob(b => downloadBlob(b, `${(ui.cfg.cb.title || "케이블_스펙트럼").replace(/[\/\\:*?"<>|]/g, "_")}.png`), "image/png");
}

/* ---- 보고서: 케이블 한 가닥에 한 쪽 ---- */

function renderReport() {
  const rows = ui.cbList;
  const box = $("cbReport");
  if (!rows.length) { box.innerHTML = ""; return; }
  const d = new Date(), p = n => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;

  box.innerHTML = rows.map(r => {
    const T = r.T;
    return `<article class="rp">
      <div class="rp-head">
        <div>
          <div class="rp-t1">Estimation for Cable Tension</div>
          <div class="rp-t2">by Vibration Method</div>
        </div>
        <table class="rp-id">
          <tr><th>Bridge</th><td>${r.bridge || "—"}</td><th>유효길이</th><td>${r.L} m</td></tr>
          <tr><th>Cable No.</th><td>${r.name}</td><th>단위질량</th><td>${r.mIn} ${r.unitLabel}</td></tr>
        </table>
      </div>

      <h3>□ Cable Properties</h3>
      <table class="rp-kv">
        <tr><th>w (weight per unit length)</th><td>${T.w.toFixed(5)}</td><td>[kN/m]</td></tr>
        <tr><th>m (mass per unit length)</th><td>${r.mTon.toFixed(5)}</td><td>[ton/m]</td></tr>
        <tr><th>Leff (effective length)</th><td>${r.L}</td><td>[m]</td></tr>
      </table>

      <h3>□ Vibration Method</h3>
      <table class="rp-tbl">
        <thead><tr><th>n</th><th>fn [Hz]</th><th>n²</th><th>(fn/n)²</th><th>T [kN]</th></tr></thead>
        <tbody>${T.rows.map(x =>
          `<tr><td>${x.n}</td><td>${x.f.toFixed(5)}</td><td>${x.n2}</td><td>${x.y.toFixed(5)}</td><td>${x.T.toFixed(5)}</td></tr>`
        ).join("")}</tbody>
      </table>

      <h3>□ Estimation for Cable Tension</h3>
      <table class="rp-kv">
        <tr><th>y-Intercept</th><td>${T.intercept === null ? "—" : T.intercept.toFixed(5)}</td><td></td></tr>
        <tr><th>Slope</th><td>${T.slope === null ? "—" : T.slope.toExponential(5)}</td><td></td></tr>
        <tr><th>Correlation Coefficient</th><td>${T.corr === null ? "—" : T.corr.toFixed(5)}</td><td></td></tr>
        <tr><th>Flexural Rigidity for Cable</th><td>${T.EI === null ? "—" : T.EI.toFixed(5)}</td><td>[kN·m²]</td></tr>
        <tr class="hl"><th>Tension by Single Mode</th><td>${T.single.toFixed(5)}</td><td>[kN]</td></tr>
        <tr class="hl"><th>Tension by Multi-Mode</th><td>${T.multi === null ? "—" : T.multi.toFixed(5)}</td><td>[kN]</td></tr>
        <tr class="hl"><th>Tension by Multi-Mode</th><td>${T.multiTonf === null ? "—" : T.multiTonf.toFixed(5)}</td><td>[Tonf]</td></tr>
      </table>

      <div class="rp-figs">
        <figure><img src="${r.spectrumPng}" alt="스펙트럼"><figcaption>FFT 스펙트럼 · 사용 차수 표시</figcaption></figure>
        <figure><img src="${r.regPng}" alt="회귀"><figcaption>(fn/n)² – n² 회귀</figcaption></figure>
      </div>
      <div class="rp-foot">${r.source} · 작성 ${stamp}</div>
    </article>`;
  }).join("");
}
