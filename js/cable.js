"use strict";

/* 케이블 장력 (진동법 · 현이론)
   화면과 계산을 나눠 둔다. 아래 tensionByString 하나만 있으면
   나중에 이 기능을 따로 떼어내도 그대로 쓸 수 있다 */

/* 현이론:  T = 4 · m · L² · f₁²
     m  단위질량 (kg/m)
     L  유효길이 (m)
     f₁ 1차 고유진동수 (Hz)
   결과는 N. 휨강성과 새그(현수선) 효과는 무시하므로
   짧고 굵은 케이블일수록 실제보다 작게 나온다 */
function tensionByString(m, L, f1) {
  if (!(m > 0) || !(L > 0) || !(f1 > 0)) return null;
  const N = 4 * m * L * L * f1 * f1;
  return { N, kN: N / 1000, tonf: N / 9806.65 };
}

/* 화면 상태 */
let cbResult = null;

function cbChannel() {
  const ch = store.channels.find(c => c.id === ui.cbX);
  if (!ch) return null;
  return canProcess(ch).ok ? ch : null;
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

  /* 탐색 하한 아래는 드리프트라 미리 잘라낸다 */
  const fMin = Math.max(0.05, +cfg.fMin || 0.4);
  const fMax = Math.min(+cfg.fMax || 20, fs / 2);
  let data = zc.data;
  if (fMin > 0.05 && fMin < fs / 2) data = filtfilt(data, "high", fMin * 0.6, fs);

  const N = +cfg.N;
  const sp = spectrum(data, fs, N, cfg.win, true);
  if (!sp) return null;
  if (n < N) notes.push(`구간이 ${n.toLocaleString()}점이라 윈도우 ${N.toLocaleString()}보다 짧습니다`);

  const peaks = findPeaks(sp, 10, cfg.win, {
    fMin, fMax, minSep: Math.max(sp.df * 4, +cfg.minSep || 0.1), prominence: 1.4
  });

  const est = estimateFundamental(peaks);
  const manual = numOrNull(cfg.f1Manual);
  const f1 = manual !== null && manual > 0 ? manual : (est ? est.f1 : null);
  const table = f1 ? harmonicTable(peaks, f1) : [];

  /* 진동법에서 가장 위험한 실수는 배음을 1차로 잘못 잡는 것이다.
     f1이 2배면 장력이 4배가 되므로 확신 정도를 반드시 드러낸다 */
  if (est) {
    if (est.matched < 2)
      notes.push("배음이 확인되지 않았습니다. 잡은 봉우리가 1차가 아닐 수 있습니다. 차수 표를 보고 직접 지정하세요");
    else if (est.extrapolated)
      notes.push(`1·2차가 보이지 않아 ${est.orders[0]}차 이상의 간격으로 역산했습니다. 차수 표의 편차를 확인하세요`);
    if (est.meanErr > 0.02)
      notes.push(`차수 간 편차가 ${(est.meanErr * 100).toFixed(1)}%로 큽니다. 케이블 신호가 아니거나 잡음이 섞였을 수 있습니다`);
  } else {
    notes.push("봉우리를 찾지 못했습니다. 탐색 범위나 최소 봉우리 간격을 조정해 보세요");
  }

  const m = numOrNull(cfg.m), L = numOrNull(cfg.L);
  const T = f1 ? tensionByString(m, L, f1) : null;

  cbResult = { ch, fs, n, sp, peaks, est, f1, manual: manual !== null && manual > 0, table, T, m, L, fMin, fMax, notes };
  return cbResult;
}

/* ---- 스펙트럼 + 차수 표시 ---- */

function renderCable(ctx, w, h, th) {
  const cfg = ui.cfg.cb;
  if (th.bg) { ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h); }
  const R0 = cbResult;
  if (!R0) {
    ctx.fillStyle = th.textDim; ctx.font = "14px -apple-system,sans-serif"; ctx.textAlign = "center";
    ctx.fillText("등간격 시간축을 가진 채널을 고르세요.", w / 2, h / 2);
    return null;
  }
  const { sp, peaks, f1, ch, fMax } = R0;
  const { freq, amp } = sp;
  const kmax = Math.max(2, Math.min(amp.length - 1, Math.ceil(fMax / sp.df)));

  let ymax = 0;
  for (let k = 1; k <= kmax; k++) if (amp[k] > ymax) ymax = amp[k];
  if (!(ymax > 0)) ymax = 1;
  const hi = ymax * 1.22;

  const L = 74, Rr = 18, T = cfg.title ? 36 : 16, B = 46;
  const pw = w - L - Rr, ph = h - T - B;
  const px = f => L + f / fMax * pw;
  const py = v => T + (1 - v / hi) * ph;

  drawFrame(ctx, { L, T, pw, ph, px, py },
    niceTicks(0, fMax, Math.max(3, Math.floor(pw / 80))).map(v => [v, fmtNum(v, 3)]),
    niceTicks(0, hi, 5).map(v => [v, fmtNum(v, 3)]),
    "주파수 (Hz)", "진폭", cfg.title, th, cfg.grid);

  ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();

  /* 추정한 f1의 정수배 자리에 옅은 세로선 — 봉우리가 그 위에 앉는지 눈으로 본다 */
  if (f1 > 0) {
    ctx.strokeStyle = th.textDim; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
    for (let k = 1; k * f1 <= fMax; k++) {
      const X = px(k * f1);
      ctx.beginPath(); ctx.moveTo(X, T); ctx.lineTo(X, T + ph); ctx.stroke();
      ctx.fillStyle = th.textDim; ctx.font = "10px -apple-system,sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(k + "차", X, T + 3);
    }
    ctx.setLineDash([]);
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

function drawCable() {
  if ($("cbPlotCard").hidden) return;
  computeCable();
  const c = setupCanvas($("cbCv"), plotHeight($("cbCv"), ui.cfg.cb.ratio));
  renderCable(c.ctx, c.w, c.h, themeNow());
  renderCableInfo();
}

function renderCableInfo() {
  const R0 = cbResult;
  const box = $("cbOut"), tbl = $("cbTable"), note = $("cbNote");
  if (!R0) { box.innerHTML = ""; tbl.innerHTML = ""; note.textContent = ""; $("cbAdd").disabled = true; return; }

  const { est, f1, manual, table, T, m, L } = R0;

  $("cbF1Est").textContent = est
    ? `${est.f1.toFixed(4)} Hz (차수 ${est.orders.join(",")} 인식${est.extrapolated ? " · 역산" : ""})`
    : "추정 실패";

  const cards = [];
  if (f1) cards.push(`<span class="b"><b>${f1.toFixed(4)} Hz</b>${manual ? "직접 지정한" : "추정한"} 1차 진동수</span>`);
  if (T) {
    cards.push(`<span class="b"><b>${T.kN.toFixed(1)} kN</b>장력</span>`);
    cards.push(`<span class="b"><b>${T.tonf.toFixed(2)} tonf</b>장력</span>`);
  } else if (f1) {
    cards.push(`<span class="b" style="background:var(--warnBg);color:var(--warn)"><b>입력 필요</b>단위질량과 유효길이</span>`);
  }
  box.innerHTML = cards.join("");

  tbl.innerHTML = table.length
    ? `<thead><tr><th>차수</th><th>측정 주파수</th><th>÷ 차수</th><th>1차 대비 편차</th><th>진폭</th></tr></thead><tbody>` +
      table.map(r => {
        const dev = (r.implied - f1) / f1 * 100;
        const bad = Math.abs(dev) > 5;
        return `<tr><td>${r.n}차</td><td>${r.freq.toFixed(4)} Hz</td><td>${r.implied.toFixed(4)} Hz</td>` +
               `<td style="color:${bad ? "var(--danger)" : "var(--success)"}">${dev >= 0 ? "+" : ""}${dev.toFixed(2)}%</td>` +
               `<td>${fmtNum(r.amp, 4)}</td></tr>`;
      }).join("") + `</tbody>`
    : "";

  note.innerHTML = [
    `현이론 T = 4 m L² f₁²  ·  m ${m ?? "?"} kg/m  ·  L ${L ?? "?"} m`,
    "휨강성과 새그를 무시한 식입니다. 짧고 굵은 케이블에서는 실제보다 작게 나옵니다",
    ...R0.notes
  ].join("<br>");

  $("cbAdd").disabled = !T;
}

/* ---- 결과 모으기 (보고서용) ---- */

function addCableResult() {
  const R0 = cbResult;
  if (!R0 || !R0.T) return;
  ui.cbList.push({
    name: $("cbName").value.trim() || R0.ch.name,
    source: R0.ch.source,
    m: R0.m, L: R0.L, f1: R0.f1,
    orders: R0.est ? R0.est.orders.join(",") : "",
    manual: R0.manual,
    kN: R0.T.kN, tonf: R0.T.tonf
  });
  $("cbName").value = "";
  renderCableList();
}

function renderCableList() {
  const rows = ui.cbList;
  $("cbListCard").hidden = !rows.length;
  if (!rows.length) return;
  $("cbList").innerHTML =
    `<thead><tr><th>이름</th><th>단위질량</th><th>유효길이</th><th>f₁</th><th>차수</th><th>장력 (kN)</th><th>장력 (tonf)</th><th></th></tr></thead><tbody>` +
    rows.map((r, i) => `<tr>
      <td>${r.name}</td><td>${r.m} kg/m</td><td>${r.L} m</td>
      <td>${r.f1.toFixed(4)} Hz${r.manual ? " (지정)" : ""}</td><td>${r.orders || "—"}</td>
      <td>${r.kN.toFixed(1)}</td><td>${r.tonf.toFixed(2)}</td>
      <td><button class="b btn-ghost btn-sm" data-cbdel="${i}">삭제</button></td></tr>`).join("") +
    `</tbody>`;
}

function exportCableCsv() {
  const rows = ui.cbList;
  if (!rows.length) return;
  const esc = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const lines = ["이름,출처파일,단위질량(kg/m),유효길이(m),1차진동수(Hz),인식차수,진동수지정,장력(kN),장력(tonf)"];
  for (const r of rows)
    lines.push([r.name, r.source, r.m, r.L, r.f1.toFixed(5), r.orders, r.manual ? "직접" : "자동",
                r.kN.toFixed(2), r.tonf.toFixed(3)].map(esc).join(","));
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, "케이블_장력.csv");
}

function saveCablePng() {
  const cfg = ui.cfg.cb;
  const src = $("cbCv");
  const w = src.clientWidth || 800, h = plotHeight(src, cfg.ratio), scale = 2;
  const off = document.createElement("canvas");
  off.width = w * scale; off.height = h * scale;
  const ctx = off.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  renderCable(ctx, w, h, { ...LIGHT });
  off.toBlob(b => downloadBlob(b, `${(cfg.title || "케이블_스펙트럼").replace(/[\/\\:*?"<>|]/g, "_")}.png`), "image/png");
}
