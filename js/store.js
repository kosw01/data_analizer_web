"use strict";

/* 2층 — 채널 저장소
   등록된 채널과 화면 설정을 담는 곳. 모든 분석 화면이 여기서 꺼내 쓴다 */

/* ============================================================
   2층 — 채널 저장소 + 설정
   ============================================================ */

const store = { tables: [], channels: [] };

/* 구간 — 세 분석 화면이 공유한다.
   시간축이 있는 채널은 tStart~tEnd(epoch ms), 없는 채널은 sStart~sEnd(초)로 자른다. */
const ui = {
  page: "data", tsSel: new Set(), xyX: null, xySel: new Set(), agSel: new Set(),
  range: { mode: "all", tStart: null, tEnd: null, sStart: null, sEnd: null },
  cfg: {
    ts: { title:"", xLabel:"", yLabel:"", yMin:"", yMax:"", lineWidth:1.4, height:430, grid:true },
    xy: { title:"", xLabel:"", yLabel:"", yMin:"", yMax:"", dot:2.2, height:470, grid:true }
  }
};

function registerChannel(table, colIndex) {
  const ch = {
    id: "c" + Math.random().toString(36).slice(2, 9),
    name: table.names[colIndex], source: table.fileName,
    values: table.cols[colIndex], n: table.nRows, times: table.times,
    timeKind: table.times ? table.time.kind : "index",
    sampleRate: table.times ? table.time.sampleRate : table.manualHz,
    color: PALETTE[store.channels.length % PALETTE.length],
    tableId: table.id, colIndex
  };
  let mn = Infinity, mx = -Infinity, sum = 0, cnt = 0, nan = 0;
  for (let i = 0; i < ch.n; i++) {
    const v = ch.values[i];
    if (!isFinite(v)) { nan++; continue; }
    if (v < mn) mn = v; if (v > mx) mx = v; sum += v; cnt++;
  }
  ch.min = mn; ch.max = mx; ch.mean = sum / cnt; ch.nan = nan;
  store.channels.push(ch);
  return ch;
}

const canProcess = ch =>
  ch.timeKind === "index" ? { ok: true, why: `지정한 ${ch.sampleRate} Hz 기준` }
  : ch.timeKind === "uniform" ? { ok: true, why: "등간격 확인됨" }
  : { ok: false, why: "시간축이 불규칙해 주파수 해석 불가" };
