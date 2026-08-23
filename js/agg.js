"use strict";

/* 분석 화면
   기간 단위 집계 통계와 CSV 내보내기 */

/* ============================================================
   분석 — 기간 집계
   ============================================================ */

const UNIT_LABEL = { hour:"시간", day:"일", week:"주", month:"월", year:"연" };
const STAT_LABEL = { count:"개수", mean:"평균", std:"표준편차", min:"최소", med:"중앙값", max:"최대" };

function bucketKey(ms, unit) {
  const d = new Date(ms), p = n => String(n).padStart(2, "0");
  if (unit === "hour")  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}시`;
  if (unit === "day")   return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (unit === "month") return `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
  if (unit === "year")  return `${d.getFullYear()}`;
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));   // 월요일 시작
  return `${m.getFullYear()}-${p(m.getMonth() + 1)}-${p(m.getDate())} 주`;
}

function aggregate(ch, unit) {
  if (!ch.times) return null;
  const [i0, i1] = rangeBounds(ch);
  const map = new Map();
  for (let i = i0; i < i1; i++) {
    const v = ch.values[i];
    if (!isFinite(v)) continue;
    const k = bucketKey(ch.times[i], unit);
    let a = map.get(k);
    if (!a) { a = []; map.set(k, a); }
    a.push(v);
  }
  const out = new Map();
  for (const [k, arr] of map) {
    arr.sort((x, y) => x - y);
    const n = arr.length;
    let sum = 0;
    for (const v of arr) sum += v;
    const mean = sum / n;
    let ss = 0;
    for (const v of arr) ss += (v - mean) * (v - mean);
    out.set(k, {
      count: n, mean, std: n > 1 ? Math.sqrt(ss / (n - 1)) : 0,
      min: arr[0], max: arr[n - 1],
      med: n % 2 ? arr[(n - 1) / 2] : (arr[n / 2 - 1] + arr[n / 2]) / 2
    });
  }
  return out;
}

let agData = null;

function renderAgg() {
  if ($("agTblCard").hidden) return;
  const chs = store.channels.filter(c => ui.agSel.has(c.id));
  const unit = $("agUnit").value;
  const stats = [...document.querySelectorAll(".agStat:checked")].map(e => e.value);
  const tbl = $("agTbl");
  tbl.innerHTML = ""; agData = null;
  $("agNote").textContent = ""; $("agSummary").textContent = "";
  $("agCsv").disabled = true;

  const usable = chs.filter(c => c.times);
  const skipped = chs.filter(c => !c.times);
  if (!usable.length || !stats.length) {
    $("agNote").textContent = !stats.length
      ? "통계량을 하나 이상 선택하세요."
      : "시간축이 있는 채널만 기간 집계를 할 수 있습니다.";
    $("agBarCard").hidden = true;
    return;
  }

  const t0 = performance.now();
  const aggs = usable.map(c => ({ ch: c, m: aggregate(c, unit) }));
  const keys = [...new Set(aggs.flatMap(a => [...a.m.keys()]))].sort();

  const header = ["기간"];
  for (const a of aggs) for (const s of stats)
    header.push(usable.length > 1 || stats.length > 1 ? `${a.ch.name}_${STAT_LABEL[s]}` : a.ch.name);

  const rows = keys.map(k => {
    const row = [k];
    for (const a of aggs) {
      const b = a.m.get(k);
      for (const s of stats) row.push(b ? b[s] : null);
    }
    return row;
  });
  agData = { header, rows, unit };

  const CAP = 400;
  const shown = rows.slice(0, CAP);
  tbl.innerHTML =
    `<thead><tr>${header.map(h => `<th>${h}</th>`).join("")}</tr></thead>` +
    `<tbody>${shown.map(r => `<tr>${r.map((v, i) =>
      `<td>${i === 0 ? v : (v === null ? "—" : fmtNum(v, 4))}</td>`).join("")}</tr>`).join("")}</tbody>`;

  $("agSummary").textContent =
    `${UNIT_LABEL[unit]} 단위 · ${keys.length.toLocaleString()}개 구간 · ${usable.length}개 채널`;
  $("agNote").textContent =
    `집계 ${(performance.now() - t0).toFixed(0)}ms`
    + (rows.length > CAP ? ` · 화면에는 처음 ${CAP}개만 표시 (CSV에는 전부 포함)` : "")
    + (skipped.length ? ` · 시간축이 없어 제외: ${skipped.map(c => c.name).join(", ")}` : "");
  $("agCsv").disabled = false;
  syncBarSelects();
  drawBars();
}

/* 막대그래프 선택칸을 지금 고른 채널·통계량으로 맞춘다 */
function syncBarSelects() {
  const cfg = ui.cfg.ag;
  const chs = store.channels.filter(c => ui.agSel.has(c.id) && c.times);
  const stats = [...document.querySelectorAll(".agStat:checked")].map(e => e.value);
  $("agBarCard").hidden = !(chs.length && stats.length);
  if ($("agBarCard").hidden) return;
  if (!chs.some(c => c.id === cfg.ch)) cfg.ch = chs[0].id;
  if (!stats.includes(cfg.stat)) cfg.stat = stats[0];
  fillSelect($("agBarCh"), chs.map(c => [c.id, c.name]), cfg.ch);
  fillSelect($("agBarStat"), stats.map(s => [s, STAT_LABEL[s]]), cfg.stat);
}

function exportCsv() {
  if (!agData) return;
  const esc = v => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [agData.header.map(esc).join(",")];
  for (const r of agData.rows)
    lines.push(r.map((v, i) => i === 0 ? esc(v) : (v === null ? "" : v)).join(","));
  // 엑셀이 한글을 깨뜨리지 않도록 BOM을 붙인다
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `집계_${UNIT_LABEL[agData.unit]}단위.csv`);
}

/* ============================================================
   막대그래프 — 채널 하나, 통계량 하나
   ============================================================ */

const BAR_MAX = 400;   // 막대가 이보다 많으면 1px도 안 되어 읽을 수 없다

function barData() {
  const cfg = ui.cfg.ag;
  const ch = store.channels.find(c => c.id === cfg.ch && c.times);
  if (!ch || !agData) return null;
  const m = aggregate(ch, $("agUnit").value);
  if (!m || !m.size) return null;
  const keys = [...m.keys()].sort();
  const stat = cfg.stat;
  const counts = keys.map(k => m.get(k).count);
  /* 결측이 많아 표본이 확 적은 구간은 막대를 흐리게 그린다.
     평균이 다른 달과 비슷해 보여도 근거가 얇을 수 있다 */
  const sorted = [...counts].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  return {
    ch, keys, stat, counts, median,
    values: keys.map(k => m.get(k)[stat]),
    thin: counts.map(c => c < median * 0.7)
  };
}

function renderBars(ctx, w, h, th) {
  const cfg = ui.cfg.ag;
  if (th.bg) { ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h); }
  const d = barData();
  const say = msg => {
    ctx.fillStyle = th.textDim; ctx.font = "14px -apple-system,sans-serif";
    ctx.textAlign = "center"; ctx.fillText(msg, w / 2, h / 2);
    return null;
  };
  if (!d) return say("시간축이 있는 채널을 고르세요.");
  if (d.keys.length > BAR_MAX)
    return say(`구간이 ${d.keys.length.toLocaleString()}개라 막대가 너무 얇습니다. 단위를 키우거나 기간을 좁히세요.`);

  const vals = d.values.filter(v => isFinite(v));
  if (!vals.length) return say("그릴 값이 없습니다.");

  /* 막대는 0에서 시작하는 것이 원칙이지만, 값이 0에서 멀면
     차이가 안 보인다. 값 폭이 평균의 20% 미만이면 바닥을 올린다 */
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const spread = hi - lo, center = (hi + lo) / 2;
  let base = 0;
  if (lo > 0 && spread < Math.abs(center) * 0.2) base = lo - spread * 0.6;
  else if (lo >= 0) base = 0;
  else base = lo - spread * 0.1;

  let ymin = Math.min(base, lo), ymax = hi + spread * 0.12 || hi + 1;
  [ymin, ymax] = expandForLimits(ymin, ymax, cfg.limits);
  const uMin = numOrNull(cfg.yMin), uMax = numOrNull(cfg.yMax);
  if (uMin !== null) { ymin = uMin; base = Math.max(base, uMin); }
  if (uMax !== null) ymax = uMax;
  if (!(ymax > ymin)) ymax = ymin + 1;

  const L = 76, R = 18, T = cfg.title ? 34 : 16, B = 62;
  const pw = w - L - R, ph = h - T - B;
  const py = v => T + (1 - (v - ymin) / (ymax - ymin)) * ph;
  const n = d.keys.length;
  const slot = pw / n;
  const bw = Math.max(1, Math.min(slot * 0.72, 46));

  /* 축 — x는 구간 이름이라 값 눈금을 쓰지 않는다 */
  ctx.strokeStyle = th.divider; ctx.lineWidth = 1;
  ctx.font = "11px -apple-system,sans-serif";
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (const v of niceTicks(ymin, ymax, 5)) {
    const y = Math.round(py(v)) + 0.5;
    if (y < T - 1 || y > T + ph + 1) continue;
    if (cfg.grid) { ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); }
    ctx.fillStyle = th.textDim; ctx.fillText(fmtNum(v, 3), L - 8, y);
  }
  ctx.strokeStyle = th.divider; ctx.strokeRect(L + 0.5, T + 0.5, pw, ph);

  /* 막대 */
  const y0 = py(Math.max(ymin, Math.min(base, ymax)));
  d.values.forEach((v, i) => {
    if (!isFinite(v)) return;
    const x = L + slot * i + (slot - bw) / 2;
    const y = py(Math.max(ymin, Math.min(v, ymax)));
    ctx.fillStyle = d.ch.color;
    ctx.globalAlpha = d.thin[i] ? 0.32 : 0.88;
    ctx.fillRect(x, Math.min(y, y0), bw, Math.max(1, Math.abs(y0 - y)));
    ctx.globalAlpha = 1;
  });

  /* x 라벨 — 다 쓰면 겹치므로 건너뛰며 쓴다 */
  const step = Math.max(1, Math.ceil(n / Math.floor(pw / 56)));
  ctx.fillStyle = th.textDim; ctx.font = "10px -apple-system,sans-serif";
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  d.keys.forEach((k, i) => {
    if (i % step) return;
    const x = L + slot * i + slot / 2;
    ctx.save();
    ctx.translate(x, T + ph + 8);
    ctx.rotate(-Math.PI / 4);
    ctx.fillText(k, 0, 0);
    ctx.restore();
  });

  ctx.fillStyle = th.textNormal; ctx.font = "600 12px -apple-system,sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  if (cfg.xLabel) ctx.fillText(cfg.xLabel, L + pw / 2, T + ph + 46);
  ctx.save(); ctx.translate(16, T + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(cfg.yLabel || `${d.ch.name} ${STAT_LABEL[d.stat]}`, 0, 0); ctx.restore();
  if (cfg.title) {
    ctx.fillStyle = th.textStrong; ctx.font = "700 15px -apple-system,sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(cfg.title, L, 8);
  }

  drawLimits(ctx, { L, T, pw, ph, py }, cfg.limits, th, ymin, ymax);
  return { n, base };
}

function drawBars() {
  const card = $("agBarCard");
  if (!card || card.hidden) return;
  const cv = $("agBarCv");
  const { ctx, w, h } = setupCanvas(cv, plotHeight(cv, ui.cfg.ag.ratio));
  const r = renderBars(ctx, w, h, themeNow());
  const note = $("agBarNote");
  const d = barData();
  const thin = d ? d.thin.filter(Boolean).length : 0;
  note.textContent = r && d
    ? `${d.ch.name} · ${STAT_LABEL[d.stat]} · ${UNIT_LABEL[$("agUnit").value]} 단위 ${r.n.toLocaleString()}개 구간`
      + (r.base !== 0 ? " · 값 폭이 좁아 세로축 바닥을 올렸습니다" : "")
      + (thin ? ` · 표본이 적은 ${thin}개 구간은 흐리게 그렸습니다` : "")
    : "";
}

function saveBarPng() {
  const cv = $("agBarCv");
  const w = cv.clientWidth || 800, h = plotHeight(cv, ui.cfg.ag.ratio);
  const off = document.createElement("canvas");
  off.width = w * 2; off.height = h * 2;
  const ctx = off.getContext("2d");
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  renderBars(ctx, w, h, { ...LIGHT });
  off.toBlob(b => downloadBlob(b, `${(ui.cfg.ag.title || "막대그래프").replace(/[\/\\:*?"<>|]/g, "_")}.png`), "image/png");
}
