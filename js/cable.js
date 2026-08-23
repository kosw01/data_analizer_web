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

/* modes = [{ n, f }] 중 실제로 쓸 것만 넘긴다.

   단위질량과 유효길이는 **장력 값에만** 필요하다.
   (fn/n)² 와 n² 회귀는 제원 없이도 성립하므로, 제원이 없다고 회귀까지
   막으면 안 된다. 실제로 그렇게 묶어놨다가 회귀 그래프가 안 그려졌다. */
function cableTension(modes, mTon, L) {
  if (!modes || !modes.length) return null;

  const hasProps = mTon > 0 && L > 0;
  const k = hasProps ? 4 * mTon * L * L : null;

  const rows = modes.map(({ n, f }) => {
    const y = (f / n) * (f / n);
    return { n, f, n2: n * n, y, T: k === null ? null : k * y };
  });

  const cnt = rows.length;
  const meanY = rows.reduce((a, r) => a + r.y, 0) / cnt;
  const single = k === null ? null : k * meanY;

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
      if (hasProps) {
        multi = k * intercept;
        EI = slope * 4 * mTon * Math.pow(L, 4) / (Math.PI * Math.PI);
      }
    }
  }

  return {
    rows, k, count: cnt, hasProps, meanY,
    single, singleTonf: single === null ? null : single / G,
    multi, multiTonf: multi === null ? null : multi / G,
    slope, intercept, corr, EI,
    w: hasProps ? mTon * G : null
  };
}

/* ============================================================
   화면
   ============================================================ */

let cbResult = null;
let cbModesKey = "";
const MODE_ROWS = 20;

function cbChannel() {
  const ch = store.channels.find(c => c.id === ui.cbX);
  if (!ch) return null;
  return canProcess(ch).ok ? ch : null;
}

/* 차수 칸 채우기.

   고차로 갈수록 실제 진동수는 f1의 정수배보다 조금씩 커진다(휨강성 때문).
   그래서 딱 n×f1 자리를 찾으면 고차에서 빗나간다.
   이미 맞춘 차수들로 (fn/n)² = a + b·n² 를 세워 다음 차수를 예측한 뒤,
   그 근처에 실제 봉우리가 있으면 그 값을 넣고 켠다. 없으면 예측값만 넣고 끈다. */
function fillModes(f1, peaks, df) {
  const rows = [];
  const got = [];                                  // 지금까지 맞춘 {n, f}
  const win0 = Math.max((df || 0.01) * 5, f1 * 0.07);

  for (let n = 1; n <= MODE_ROWS; n++) {
    let pred = n * f1;
    if (got.length >= 2) {
      /* (fn/n)² 를 n² 에 회귀해 다음 자리를 내다본다 */
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (const g of got) {
        const x = g.n * g.n, y = (g.f / g.n) * (g.f / g.n);
        sx += x; sy += y; sxx += x * x; sxy += x * y;
      }
      const m = got.length, den = m * sxx - sx * sx;
      if (den !== 0) {
        const b = (m * sxy - sx * sy) / den;
        const a = (sy - b * sx) / m;
        const yy = a + b * n * n;
        if (yy > 0) pred = n * Math.sqrt(yy);
      }
    } else if (got.length === 1) {
      pred = n * (got[0].f / got[0].n);
    }

    const win = win0 * (1 + 0.05 * n);             // 고차일수록 조금 넉넉하게
    let hit = null, best = Infinity;
    for (const p of peaks) {
      const d = Math.abs(p.freq - pred);
      if (d < best && d <= win) { best = d; hit = p.freq; }
    }
    if (hit !== null) {
      rows.push({ n, f: +hit.toFixed(4), use: true });
      got.push({ n, f: hit });
    } else {
      rows.push({ n, f: +pred.toFixed(4), use: false });
    }
  }
  ui.cbModes = rows;
}

/* "이 값으로 차수 채우기" 버튼이 부른다 */
function refillModes(f1) {
  const R0 = cbResult;
  if (!R0 || !(f1 > 0)) return;
  fillModes(f1, R0.peaks, R0.sp.df);
  drawCable();
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
  if (n < N) {
    /* 2의 거듭제곱 중 구간에 들어가는 가장 큰 값 */
    let fit = 1024;
    for (const w of WINDOW_SIZES) if (w <= n) fit = w;
    notes.push(`구간이 ${n.toLocaleString()}점(${fmtNum(n / fs, 1)}초)이라 윈도우 ${N.toLocaleString()}보다 짧습니다. `
      + `뒤를 0으로 채웁니다 — 윈도우를 ${fit.toLocaleString()}로 낮추면 겹쳐 평균이 됩니다`);
  }

  const peaks = findPeaks(sp, 30, cfg.win, {
    fMin, fMax, minSep: Math.max(sp.df * 4, +cfg.minSep || 0.1), prominence: 1.4
  });
  const est = estimateFundamental(peaks);

  /* 채널·구간·해석 설정이 바뀐 때만 차수 칸을 새로 채운다.
     안 그러면 사람이 켜고 끈 것이 매번 지워진다 */
  const key = [ui.cbX, ui.range.mode, ui.range.tStart, ui.range.tEnd,
               ui.range.sStart, ui.range.sEnd, N, cfg.win, fMin, fMax, cfg.minSep].join("|");
  if (key !== cbModesKey || !ui.cbModes || !ui.cbModes.length) {
    const seed = numOrNull(cfg.f1Manual) > 0 ? numOrNull(cfg.f1Manual) : (est ? est.f1 : 0);
    if (seed > 0) fillModes(seed, peaks, sp.df); else ui.cbModes = [];
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

/* ---- 세로 스펙트럼 ----
   주파수를 위에서 아래로 흐르게 해서 차수 표(1차가 맨 위)와 나란히 읽히게 한다.
   drawFrame 은 축을 값으로만 다루므로 x에 진폭, y에 주파수를 넣으면 그대로 쓰인다 */

function renderCableVertical(ctx, w, h, th) {
  if (th.bg) { ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h); }
  const R0 = cbResult;
  if (!R0) return null;
  const { sp, peaks, ch, fMax } = R0;
  const { freq, amp } = sp;
  const kmax = Math.max(2, Math.min(amp.length - 1, Math.ceil(fMax / sp.df)));
  const kmin = Math.max(1, Math.ceil(R0.fMin / sp.df));

  let hi = 0;
  for (let k = kmin; k <= kmax; k++) if (amp[k] > hi) hi = amp[k];
  if (!(hi > 0)) hi = 1;
  hi *= 1.16;

  const fLo = freq[kmin], fHi = fMax;
  const L = 46, Rr = 10, T = 10, B = 34;
  const pw = w - L - Rr, ph = h - T - B;
  const px = a => L + a / hi * pw;
  const py = f => T + (f - fLo) / ((fHi - fLo) || 1) * ph;    // 아래로 갈수록 고주파

  drawFrame(ctx, { L, T, pw, ph, px, py },
    niceTicks(0, hi, 3).map(v => [v, fmtNum(v, 2)]),
    niceTicks(fLo, fHi, 10).map(v => [v, fmtNum(v, 2)]),
    "진폭", "주파수 (Hz)", "", th, true);

  ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();

  for (const r of usedModes()) {
    if (r.f > fHi || r.f < fLo) continue;
    const Y = py(r.f);
    ctx.strokeStyle = th.textDim; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, Y); ctx.lineTo(L + pw, Y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = th.textDim; ctx.font = "700 10px -apple-system,sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "bottom";
    ctx.fillText(r.n, L + 3, Y - 2);
  }

  ctx.strokeStyle = ch.color; ctx.lineWidth = 1.1; ctx.lineJoin = "round";
  ctx.beginPath();
  const stride = Math.max(1, Math.floor((kmax - kmin) / (ph * 3)));
  let started = false;
  for (let k = kmin; k <= kmax; k += stride) {
    const X = px(amp[k]), Y = py(freq[k]);
    if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
  }
  ctx.stroke();

  /* 봉우리 값은 점 오른쪽에 쓰되, 오른쪽이 좁으면 왼쪽으로 넘긴다 */
  ctx.font = "700 9px -apple-system,sans-serif";
  ctx.textBaseline = "middle";
  for (const p of peaks) {
    if (p.freq > fHi || p.freq < fLo) continue;
    const X = px(p.amp), Y = py(p.freq);
    ctx.fillStyle = ch.color;
    ctx.beginPath(); ctx.arc(X, Y, 2.2, 0, Math.PI * 2); ctx.fill();
    const label = p.freq.toFixed(3);
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = th.textNormal;
    if (X + 5 + tw <= L + pw - 2) { ctx.textAlign = "left"; ctx.fillText(label, X + 5, Y); }
    else { ctx.textAlign = "right"; ctx.fillText(label, X - 5, Y); }
  }
  ctx.restore();
  return true;
}

/* ---- 회귀 그래프: (fn/n)² 대 n² ---- */

function renderRegression(ctx, w, h, th, res) {
  const T = res || (cbResult && cbResult.T);
  if (th.bg) { ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h); }
  if (!T || T.count < 2 || T.intercept === null) {
    ctx.fillStyle = th.textDim; ctx.font = "13px -apple-system,sans-serif"; ctx.textAlign = "center";
    ctx.fillText(!T ? "사용할 차수를 체크하세요."
                    : "차수를 두 개 이상 체크하면 회귀선이 그려집니다.", w / 2, h / 2);
    return null;
  }
  const xs = T.rows.map(r => r.n2), ys = T.rows.map(r => r.y);
  const xmin = 0, xmax = Math.max.apply(null, xs) * 1.1;
  let ymin = Math.min(Math.min.apply(null, ys), T.intercept);
  let ymax = Math.max(Math.max.apply(null, ys), T.intercept);
  const pad = (ymax - ymin) * 0.2 || Math.abs(ymax) * 0.05 || 0.05;
  ymin -= pad; ymax += pad;

  const L = 78, Rr = 26, Tp = 16, B = 44;
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
  const card = $("cbPlotCard");
  if (!card || card.hidden) return;
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
  if (!tbl) return;                       // 화면과 코드가 어긋나도 뒤 단계가 멈추지 않게
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
  if (!box || !note || !props) return;
  if (!R0) { box.innerHTML = ""; note.textContent = ""; props.innerHTML = ""; $("cbAdd").disabled = true; return; }
  const { est, T, mTon, L } = R0;

  $("cbF1Est").textContent = est
    ? `${est.f1.toFixed(4)} Hz (차수 ${est.orders.join(",")} 인식${est.extrapolated ? " · 역산" : ""})`
    : "추정 실패";

  /* 장력은 샘플레이트의 제곱에 비례한다. 지금 몇 Hz로 계산 중인지 늘 보이게 둔다 */
  const sp = R0.sp;
  const chips = [
    `<span class="chip hz"><span class="k">샘플레이트</span>` +
      `<input type="number" step="any" min="0.001" value="${R0.fs}" data-fs="${R0.ch.id}"> Hz</span>`,
    `<span class="chip"><span class="k">나이퀴스트</span>${fmtHz(sp.nyquist)}</span>`,
    `<span class="chip"><span class="k">분해능</span>${fmtHz(sp.df)}</span>`,
    `<span class="chip"><span class="k">창 길이</span>${fmtNum(+ui.cfg.cb.N / R0.fs, 1)}초</span>`
  ];
  if (mTon > 0 && L > 0) {
    chips.push(`<span class="chip">w ${(mTon * G).toFixed(5)} kN/m</span>`);
    chips.push(`<span class="chip">m ${mTon.toFixed(5)} ton/m</span>`);
    chips.push(`<span class="chip">Leff ${L} m</span>`);
    chips.push(`<span class="chip">4mL² ${(4 * mTon * L * L).toFixed(4)}</span>`);
  } else {
    chips.push(`<span class="chip warn">단위질량과 유효길이를 입력하세요</span>`);
  }
  props.innerHTML = chips.join("");

  if (!T) {
    box.innerHTML = "";
    note.innerHTML = ["사용할 차수를 하나 이상 체크하세요", ...R0.notes].join("<br>");
    $("cbAdd").disabled = true;
    return;
  }

  const c = [];
  if (T.hasProps) {
    c.push(`<span class="b"><b>${T.single.toFixed(2)} kN</b>Single Mode · ${T.singleTonf.toFixed(2)} tonf</span>`);
    c.push(T.multi !== null
      ? `<span class="b"><b>${T.multi.toFixed(2)} kN</b>Multi-Mode · ${T.multiTonf.toFixed(2)} tonf</span>`
      : `<span class="b" style="background:var(--warnBg);color:var(--warn)"><b>차수 2개 필요</b>다중모드 회귀</span>`);
  } else {
    c.push(`<span class="b" style="background:var(--warnBg);color:var(--warn)"><b>제원 입력 필요</b>단위질량과 유효길이를 넣으면 장력이 나옵니다</span>`);
  }
  box.innerHTML = c.join("");

  note.innerHTML = [
    T.count >= 2 && T.intercept !== null
      ? `y-절편 ${T.intercept.toFixed(5)} · 기울기 ${T.slope.toExponential(4)} · 상관계수 ${T.corr.toFixed(5)}`
        + (T.EI !== null ? ` · 휨강성 ${T.EI.toFixed(3)} kN·m²` : " · 휨강성은 제원을 넣어야 나옵니다")
      : "차수를 두 개 이상 체크하면 회귀값이 나옵니다",
    `사용 차수 ${T.count}개`,
    ...R0.notes
  ].filter(Boolean).join("<br>");

  $("cbAdd").disabled = !T.hasProps;
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

/* 보고서 지면 규격 (px). A4 세로 210×297mm 에서 여백 12mm 를 뺀 186×273mm 를
   96dpi 기준 px 로 환산한 값이다. 화면과 인쇄가 같은 비율을 쓰게 하려고 한곳에 모아둔다 */
const RP = {
  pageW: 703, pageH: 1028,     // 186 x 272mm. 인쇄 영역(273mm)보다 1mm 작게 —
  midH: 578, botH: 298,        // 딱 맞추면 반올림으로 넘쳐 빈 페이지가 생긴다
  specW: 232, specH: 578,
  regW: 372, regH: 298
};

/* 크기를 직접 정해 그린다. 보고서 칸 모양에 맞춰야 해서 비율만으로는 부족하다 */
function snapshotSize(renderFn, w, h, extra) {
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
    /* 지면 칸 크기와 같은 비율로 그린다. 늘이거나 줄이면 글자가 뭉개진다 */
    verticalPng: snapshotSize(renderCableVertical, RP.specW, RP.specH),
    regPng: snapshotSize(renderRegression, RP.regW, RP.regH, R0.T)
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
      <td>${r.T.single === null ? "—" : r.T.single.toFixed(1)}</td>
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
    lines.push([r.bridge, r.name, r.source, r.mIn, r.unitLabel, r.mTon, T.w === null ? "" : T.w, r.L, T.count,
      T.intercept === null ? "" : T.intercept, T.slope === null ? "" : T.slope,
      T.corr === null ? "" : T.corr, T.EI === null ? "" : T.EI,
      T.single === null ? "" : T.single, T.singleTonf === null ? "" : T.singleTonf,
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
        <div class="rp-t1">Estimation for Cable Tension</div>
        <div class="rp-t2">by Vibration Method</div>
        <table class="rp-id">
          <tr>
            <th>Bridge</th><td>${r.bridge || "—"}</td>
            <th>Cable No.</th><td>${r.name}</td>
            <th>Leff</th><td>${r.L} m</td>
            <th>m</th><td>${r.mIn} ${r.unitLabel}</td>
          </tr>
        </table>
      </div>

      <div class="rp-props">
        <span><b>w</b> ${T.w === null ? "—" : T.w.toFixed(5)} kN/m</span>
        <span><b>m</b> ${r.mTon === null ? "—" : r.mTon.toFixed(5)} ton/m</span>
        <span><b>Leff</b> ${r.L} m</span>
        <span><b>사용 차수</b> ${T.count}개</span>
        <span><b>출처</b> ${r.source}</span>
      </div>

      <div class="rp-cols rp-mid">
        <div class="rp-left">
          <h3>□ Vibration Method</h3>
          <div class="rp-tblbox">
            <table class="rp-tbl">
              <thead><tr><th>n</th><th>fn [Hz]</th><th>n²</th><th>(fn/n)²</th><th>T [kN]</th></tr></thead>
              <tbody>${(() => {
                /* 차수 칸을 20개로 고정한다. 쓰지 않은 차수는 비워 둔다 —
                   표 높이가 늘 같아야 옆 그래프와 나란히 맞는다 */
                const byN = new Map(T.rows.map(x => [x.n, x]));
                const out = [];
                for (let n = 1; n <= 20; n++) {
                  const x = byN.get(n);
                  out.push(x
                    ? `<tr><td>${n}</td><td>${x.f.toFixed(4)}</td><td>${x.n2}</td><td>${x.y.toFixed(5)}</td><td>${x.T === null ? "—" : x.T.toFixed(2)}</td></tr>`
                    : `<tr class="void"><td>${n}</td><td></td><td></td><td></td><td></td></tr>`);
                }
                return out.join("");
              })()}</tbody>
            </table>
          </div>
        </div>
        <figure class="rp-right">
          <img src="${r.verticalPng}" alt="스펙트럼">
          <figcaption>FFT 스펙트럼 · 사용 차수 표시</figcaption>
        </figure>
      </div>

      <div class="rp-cols rp-bottom">
        <div class="rp-left">
          <h3>□ Estimation for Cable Tension</h3>
          <table class="rp-kv">
            <tr><th>y-Intercept</th><td>${T.intercept === null ? "—" : T.intercept.toFixed(5)}</td><td></td></tr>
            <tr><th>Slope</th><td>${T.slope === null ? "—" : T.slope.toExponential(5)}</td><td></td></tr>
            <tr><th>Correlation Coefficient</th><td>${T.corr === null ? "—" : T.corr.toFixed(5)}</td><td></td></tr>
            <tr><th>Flexural Rigidity</th><td>${T.EI === null ? "—" : T.EI.toFixed(3)}</td><td>[kN·m²]</td></tr>
            <tr class="hl"><th>Tension by Single Mode</th><td>${T.single === null ? "—" : T.single.toFixed(3)}</td><td>[kN]</td></tr>
            <tr class="hl"><th>Tension by Multi-Mode</th><td>${T.multi === null ? "—" : T.multi.toFixed(3)}</td><td>[kN]</td></tr>
            <tr class="hl"><th>Tension by Multi-Mode</th><td>${T.multiTonf === null ? "—" : T.multiTonf.toFixed(3)}</td><td>[Tonf]</td></tr>
          </table>
          <div class="rp-eq">
            <div><span class="lab">차수별</span> T<sub>n</sub> = 4 m L² (f<sub>n</sub>/n)²</div>
            <div><span class="lab">Single Mode</span> T = 4 m L² · mean[(f<sub>n</sub>/n)²]</div>
            <div><span class="lab">회귀</span> (f<sub>n</sub>/n)² = a + b·n²</div>
            <div><span class="lab">Multi-Mode</span> T = 4 m L² · a</div>
            <div><span class="lab">휨강성</span> EI = b · 4 m L⁴ / π²</div>
            <div class="unit">m [ton/m] · L [m] · f [Hz] → T [kN] · 1 Tonf = 9.80665 kN</div>
          </div>
        </div>
        <figure class="rp-right2">
          <img src="${r.regPng}" alt="회귀">
          <figcaption>(fn/n)² – n² 회귀</figcaption>
        </figure>
      </div>

      <div class="rp-foot">작성 ${stamp}</div>
    </article>`;
  }).join("");
}
