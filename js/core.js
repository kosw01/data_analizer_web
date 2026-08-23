"use strict";

/* 공통 상수와 도우미
   색 팔레트, DOM 접근, 테마, 숫자·시간 포맷 */

const PALETTE = ["#0B6BCB","#00A05B","#F04452","#B26B00","#7A4BC4","#0E8A8A","#C43B7A","#4A6B2A"];
const $ = id => document.getElementById(id);
const yieldTick = () => new Promise(r => setTimeout(r, 0));

/* 출력물(PNG)은 테마와 무관하게 항상 라이트 고정 */
const LIGHT = { divider:"#E5E8EB", textDim:"#8B95A1", textNormal:"#4E5968", textStrong:"#191F28", bg:"#FFFFFF" };
const themeNow = () => {
  const g = k => getComputedStyle(document.documentElement).getPropertyValue("--" + k).trim();
  return { divider:g("divider"), textDim:g("textDim"), textNormal:g("textNormal"), textStrong:g("textStrong"), bg:null };
};

/* ============================================================
   포맷
   ============================================================ */

function fmtNum(v, d = 4) {
  if (!isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(2);
  return v.toFixed(d).replace(/\.?0+$/, "");
}
function fmtDur(ms) {
  if (ms < 1000) return ms.toFixed(0) + "ms";
  const s = ms / 1000; if (s < 60) return fmtNum(s, 2) + "초";
  const m = s / 60; if (m < 60) return fmtNum(m, 1) + "분";
  const h = m / 60; if (h < 48) return fmtNum(h, 1) + "시간";
  return fmtNum(h / 24, 1) + "일";
}
function fmtTime(ms, span) {
  const d = new Date(ms), p = n => String(n).padStart(2, "0");
  if (span > 86400000 * 3) return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (span > 3600000) return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  if (span > 60000) return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return `${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/* 파일 내려받기 — PNG·CSV 공용 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---- datetime-local 입력값 ↔ epoch ms ---- */
function toLocalInput(ms) {
  if (ms === null || !isFinite(ms)) return "";
  const d = new Date(ms), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function fromLocalInput(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
}
