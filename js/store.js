"use strict";

/* 2층 — 채널 저장소
   등록된 채널과 화면 설정을 담는 곳. 모든 분석 화면이 여기서 꺼내 쓴다 */

/* ============================================================
   2층 — 채널 저장소 + 설정
   ============================================================ */

const store = { tables: [], channels: [] };

/* 진입점 — 파일을 나누는 게 아니라 "이번에 뭘 하려는지"를 담는다.
   탭 순서와 기본값만 달라지고 기능은 전부 살아 있다 */
const MODES = {
  raw: {
    label: "원시 데이터",
    desc: "진동·가속도 · FFT · 케이블 장력",
    hint: "등간격으로 촘촘히 수집된 신호",
    tabs: ["data", "sp", "cb", "ts", "xy", "ag"],
    landing: "sp",
    defaults: { agUnit: "hour", spN: 4096, cbN: 16384, tsYMode: "shared" }
  },
  stat: {
    label: "통계 데이터",
    desc: "장기 추이 · 상관 · 기간 통계",
    hint: "10분·1시간 간격으로 요약된 값",
    tabs: ["data", "ag", "ts", "xy", "sp", "cb"],
    landing: "ag",
    defaults: { agUnit: "day", spN: 4096, cbN: 16384, tsYMode: "norm" }
  }
};

/* 관리기준선 — 미리 저장하지 않고 그래프를 세팅하는 동안만 쓴다. 최대 4개 */
const LIMIT_TONES = {
  danger: { label:"위험", color:"#F04452" },
  warn:   { label:"주의", color:"#E08600" },
  base:   { label:"기준", color:"#0B6BCB" },
  gray:   { label:"보조", color:"#8B95A1" }
};
/* 상한 4개 + 하한 4개. 그리는 방식은 같고 묶어 보여주기 위해 side 를 둔다 */
const LIMIT_TONE_ORDER = ["danger", "warn", "base", "gray"];
function newLimits() {
  const make = side => LIMIT_TONE_ORDER.map((t, i) =>
    ({ v: "", label: "", tone: t, side, idx: i + 1 }));
  return [...make("upper"), ...make("lower")];
}

/* 구간 — 세 분석 화면이 공유한다.
   시간축이 있는 채널은 tStart~tEnd(epoch ms), 없는 채널은 sStart~sEnd(초)로 자른다. */
const ui = {
  page: "data", tsSel: new Set(), xyX: null, xySel: new Set(), agSel: new Set(),
  range: { mode: "all", tStart: null, tEnd: null, sStart: null, sEnd: null },
  spX: null, cbX: null, cbList: [], cbModes: [], rangeOpen: false,
  mode: null,          // "raw" | "stat" | null(아직 안 고름)

  cfg: {
    ts: { title:"", xLabel:"", yLabel:"", yMin:"", yMax:"", lineWidth:1.4, ratio:"4:3", grid:true, limits: newLimits() },
    xy: { title:"", xLabel:"", yLabel:"", yMin:"", yMax:"", dot:2.2, ratio:"4:3", grid:true, limits: newLimits() },
    sp: {
      zero:"mean", filter:"none", lowCut:10, highCut:1,
      N:4096, win:"hann", welch:true, log:false, fmax:"", skip:10,
      showRaw:true, ratio:"2:1", sRatio:"4:3",
      title:"", sTitle:"", grid:true, limits: newLimits()
    },
    ag: {
      ch:"", stat:"mean", title:"", xLabel:"", yLabel:"",
      yMin:"", yMax:"", ratio:"2:1", grid:true, limits: newLimits()
    },
    cb: {
      m:"", massUnit:"ton", L:"", fMin:0.4, fMax:20, minSep:0.1, f1Manual:"",
      N:16384, win:"hann",
      title:"", ratio:"4:3", grid:true
    }
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
