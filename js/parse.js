"use strict";

/* 1층 — 파일을 테이블로
   인코딩·구분자·헤더·시간축 판별과 CSV/XLSX/JSON 파서 */

/* ============================================================
   1층 — 파일 → 테이블
   ============================================================ */

function decodeText(buf) {
  const u8 = new Uint8Array(buf);
  if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF)
    return { text: new TextDecoder("utf-8").decode(u8.subarray(3)), encoding: "UTF-8 (BOM)" };
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(u8), encoding: "UTF-8" }; }
  catch (e) {
    try { return { text: new TextDecoder("euc-kr").decode(u8), encoding: "CP949" }; }
    catch (e2) { return { text: new TextDecoder("utf-8").decode(u8), encoding: "UTF-8 (깨짐 가능)" }; }
  }
}
function detectDelimiter(lines) {
  let best = ",", bestScore = -1;
  for (const d of [",", "\t", ";", "|"]) {
    const counts = lines.map(l => l.split(d).length);
    if (counts[0] < 2) continue;
    const score = (counts.every(c => c === counts[0]) ? 1000 : 0) + counts[0];
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}
const DT_RE = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?)?/;
function parseDateTime(s) {
  if (!s) return NaN;
  const m = DT_RE.exec(String(s).trim());
  if (!m) return NaN;
  const ms = m[7] ? Math.round(parseFloat("0." + m[7]) * 1000) : 0;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), ms).getTime();
  return isNaN(t) ? NaN : t;
}
/* 빈칸·공백·NA 표기는 결측으로 본다. Number(" ")가 0이 되는 구멍을 막는다 */
const NA_WORDS = new Set(["", "na", "n/a", "nan", "null", "none", "-", "--"]);
function toNum(v) {
  if (typeof v === "number") return v;
  if (v === undefined || v === null) return NaN;
  const s = String(v).trim();
  if (NA_WORDS.has(s.toLowerCase())) return NaN;
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}

const isNumeric = s => s !== null && s !== undefined && String(s).trim() !== "" && isFinite(Number(s));
const looksLikeHeader = cells => cells.some(c => !isNumeric(c) && isNaN(parseDateTime(c)));

function splitLines(text) {
  const out = []; let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      let end = i;
      if (end > start && text.charCodeAt(end - 1) === 13) end--;
      if (end > start) out.push([start, end]);
      start = i + 1;
    }
  }
  if (start < text.length) out.push([start, text.length]);
  return out;
}

async function parseDelimited(text, fileName, onProgress) {
  const spans = splitLines(text);
  if (!spans.length) throw new Error("빈 파일입니다.");
  const peek = spans.slice(0, 5).map(([a, b]) => text.slice(a, b));
  const delim = detectDelimiter(peek);
  const firstCells = peek[0].split(delim).map(s => s.trim().replace(/^"|"$/g, ""));
  const hasHeader = looksLikeHeader(firstCells);
  const nCols = firstCells.length;
  const names = firstCells.map((c, i) => (hasHeader && c) ? c : `컬럼${i + 1}`);
  const dataStart = hasHeader ? 1 : 0;
  const nRows = spans.length - dataStart;
  if (nRows <= 0) throw new Error("데이터 행이 없습니다.");
  const probe = text.slice(spans[dataStart][0], spans[dataStart][1]).split(delim);
  const timeIsFirstCol = !isNaN(parseDateTime(probe[0])) && !isNumeric(probe[0]);
  const cols = [];
  for (let c = 0; c < nCols; c++) cols.push(new Float64Array(nRows));
  const times = timeIsFirstCol ? new Float64Array(nRows) : null;
  for (let r = 0; r < nRows; r++) {
    const [a, b] = spans[r + dataStart];
    const parts = text.slice(a, b).split(delim);
    if (timeIsFirstCol) times[r] = parseDateTime(parts[0]);
    for (let c = 0; c < nCols; c++) {
      cols[c][r] = toNum(parts[c]);
    }
    if ((r & 8191) === 0) { onProgress(r / nRows); await yieldTick(); }
  }
  return buildTable({ fileName, names, cols, times, timeIsFirstCol, nRows, hasHeader,
                      delimName: delim === "\t" ? "탭" : delim });
}

async function parseXlsx(buf, fileName, onProgress) {
  onProgress(0.1); await yieldTick();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: false });
  if (!rows.length) throw new Error("빈 시트입니다.");
  onProgress(0.5); await yieldTick();
  const first = rows[0].map(c => (c instanceof Date ? c.toISOString() : String(c ?? "")).trim());
  const hasHeader = looksLikeHeader(first);
  const nCols = Math.max(...rows.slice(0, 20).map(r => r.length));
  const names = Array.from({ length: nCols }, (_, i) => (hasHeader && String(first[i] ?? "").trim()) || `컬럼${i + 1}`);
  const dataStart = hasHeader ? 1 : 0;
  const nRows = rows.length - dataStart;
  const probe = rows[dataStart] || [];
  const timeIsFirstCol = probe[0] instanceof Date || !isNaN(parseDateTime(String(probe[0] ?? "")));
  const cols = [];
  for (let c = 0; c < nCols; c++) cols.push(new Float64Array(nRows));
  const times = timeIsFirstCol ? new Float64Array(nRows) : null;
  for (let r = 0; r < nRows; r++) {
    const row = rows[r + dataStart];
    if (timeIsFirstCol) { const v = row[0]; times[r] = v instanceof Date ? v.getTime() : parseDateTime(String(v ?? "")); }
    for (let c = 0; c < nCols; c++) {
      cols[c][r] = toNum(row[c]);
    }
    if ((r & 8191) === 0) { onProgress(0.5 + 0.5 * r / nRows); await yieldTick(); }
  }
  return buildTable({ fileName, names, cols, times, timeIsFirstCol, nRows, hasHeader, delimName: "xlsx" });
}

async function parseJson(text, fileName) {
  const obj = JSON.parse(text);
  const recs = Array.isArray(obj) ? obj : (Array.isArray(obj.data) ? obj.data : null);
  if (!recs || !recs.length) throw new Error("배열 형태의 JSON만 지원합니다.");
  const names = Object.keys(recs[0]);
  const nRows = recs.length, nCols = names.length;
  const timeIsFirstCol = typeof recs[0][names[0]] === "string" && !isNaN(parseDateTime(recs[0][names[0]]));
  const cols = names.map(() => new Float64Array(nRows));
  const times = timeIsFirstCol ? new Float64Array(nRows) : null;
  for (let r = 0; r < nRows; r++) for (let c = 0; c < nCols; c++) {
    const v = recs[r][names[c]];
    if (c === 0 && timeIsFirstCol) times[r] = parseDateTime(String(v));
    cols[c][r] = toNum(v);
  }
  return buildTable({ fileName, names, cols, times, timeIsFirstCol, nRows, hasHeader: true, delimName: "JSON" });
}

function analyzeTime(times, n) {
  if (!times || n < 2) return { kind: "none" };
  const diffs = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) diffs[i] = times[i + 1] - times[i];
  const sorted = Float64Array.from(diffs).sort();
  const median = sorted[Math.floor(sorted.length / 2)];
  let dup = 0, gaps = 0, back = 0, maxGap = 0;
  for (let i = 0; i < diffs.length; i++) {
    const d = diffs[i];
    if (d === 0) dup++;
    else if (d < 0) back++;
    else if (d > median * 1.5) { gaps++; if (d > maxGap) maxGap = d; }
  }
  return { kind: (dup === 0 && gaps === 0 && back === 0 && median > 0) ? "uniform" : "irregular",
           median, dup, gaps, back, maxGap, sampleRate: median > 0 ? 1000 / median : 0 };
}

function buildTable(o) {
  return {
    id: "f" + Math.random().toString(36).slice(2, 9),
    fileName: o.fileName, names: o.names, cols: o.cols, times: o.times,
    nRows: o.nRows, hasHeader: o.hasHeader, delimName: o.delimName, encoding: o.encoding || "",
    time: analyzeTime(o.times, o.nRows), manualHz: o.timeIsFirstCol ? null : 100
  };
}
