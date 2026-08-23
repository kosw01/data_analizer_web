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
