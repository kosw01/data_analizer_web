"use strict";

/* 진입점
   파일 불러오기와 모든 이벤트 연결 */

/* ============================================================
   불러오기 · 이벤트
   ============================================================ */

function setProgress(text, ratio) {
  $("prog").hidden = false;
  $("progText").textContent = text;
  $("progBar").style.width = Math.round(ratio * 100) + "%";
}

async function loadFiles(fileList) {
  const files = Array.from(fileList);
  for (let k = 0; k < files.length; k++) {
    const f = files[k];
    const head = `(${k + 1}/${files.length}) ${f.name}`;
    setProgress(head + " 읽는 중…", 0); await yieldTick();
    try {
      const buf = await f.arrayBuffer();
      const ext = f.name.split(".").pop().toLowerCase();
      let table;
      if (ext === "xlsx" || ext === "xls") {
        table = await parseXlsx(buf, f.name, r => setProgress(head + " 해석 중…", r));
        table.encoding = "—";
      } else {
        const { text, encoding } = decodeText(buf);
        table = ext === "json" ? await parseJson(text, f.name)
                               : await parseDelimited(text, f.name, r => setProgress(head + " 해석 중…", r));
        table.encoding = encoding;
      }
      store.tables.push(table);
    } catch (e) { alert(`${f.name} 을 읽지 못했습니다.\n${e.message}`); }
  }
  $("prog").hidden = true;
  renderFiles(); renderChannels();
}

$("pick").onclick = () => $("file").click();
$("file").onchange = e => { loadFiles(e.target.files); e.target.value = ""; };

const drop = $("drop");
["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => { if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files); });

$("tabs").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (b) gotoTab(b.dataset.p);
});

$("files").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.add) {
    const t = store.tables.find(x => x.id === b.dataset.add);
    document.querySelectorAll(`input[data-tid="${t.id}"]:checked`).forEach(cb => registerChannel(t, +cb.dataset.ci));
    renderFiles(); renderChannels();
  }
  if (b.dataset.all)
    document.querySelectorAll(`input[data-tid="${b.dataset.all}"]:not(:disabled)`).forEach(cb => cb.checked = true);
  if (b.dataset.del) {
    store.channels = store.channels.filter(c => c.tableId !== b.dataset.del);
    store.tables = store.tables.filter(t => t.id !== b.dataset.del);
    renderFiles(); renderChannels();
  }
});

$("files").addEventListener("input", e => {
  const id = e.target.dataset.hz; if (!id) return;
  const t = store.tables.find(x => x.id === id);
  const v = parseFloat(e.target.value);
  if (v > 0) {
    t.manualHz = v;
    store.channels.filter(c => c.tableId === t.id).forEach(c => c.sampleRate = v);
    renderChannels();
  }
});

$("chList").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (b && b.dataset.chdel) {
    store.channels = store.channels.filter(c => c.id !== b.dataset.chdel);
    renderFiles(); renderChannels();
  }
});

/* 채널 선택 */
document.addEventListener("change", e => {
  const g = e.target.dataset.g; if (!g) return;
  const cid = e.target.dataset.cid;
  if (g === "ts") { e.target.checked ? ui.tsSel.add(cid) : ui.tsSel.delete(cid); drawTS(); }
  if (g === "xyX") { ui.xyX = cid; ui.xySel.delete(cid); renderSelectors(); }
  if (g === "xyY") { e.target.checked ? ui.xySel.add(cid) : ui.xySel.delete(cid); drawXY(); }
  if (g === "ag") { e.target.checked ? ui.agSel.add(cid) : ui.agSel.delete(cid); renderAgg(); }
  if (g === "sp") { ui.spX = cid; drawSP(); }
  if (g === "cb") { ui.cbX = cid; drawCable(); }
});

/* 그래프 설정 */
document.addEventListener("input", e => {
  const key = e.target.dataset.cfg; if (!key) return;
  const [kind, field] = key.split(".");
  const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  const NUMERIC = ["lineWidth", "dot", "lowCut", "highCut", "fMin", "fMax", "minSep", "skip"];
  ui.cfg[kind][field] = NUMERIC.includes(field) ? (parseFloat(v) || ui.cfg[kind][field]) : v;
  redraw(kind);
});

$("tsYMode").onchange = drawTS;
$("tsPoints").onchange = drawTS;
$("tsNone").onclick = () => { ui.tsSel.clear(); renderSelectors(); };
$("tsPng").onclick = () => savePng("ts");
$("xyYMode").onchange = drawXY;
$("xyFit").onchange = drawXY;
$("xyTime").onchange = drawXY;
$("xyPng").onclick = () => savePng("xy");
$("agUnit").onchange = renderAgg;
document.querySelectorAll(".agStat").forEach(e => e.onchange = renderAgg);
$("agCsv").onclick = exportCsv;
$("agBarCh").onchange = e => { ui.cfg.ag.ch = e.target.value; drawBars(); };
$("agBarStat").onchange = e => { ui.cfg.ag.stat = e.target.value; drawBars(); };
$("agBarPng").onclick = saveBarPng;

$("reset").onclick = () => {
  store.tables = []; store.channels = [];
  ui.tsSel.clear(); ui.xySel.clear(); ui.agSel.clear(); ui.xyX = null; ui.spX = null; ui.cbX = null; ui.cbList = []; ui.cbModes = []; cbModesKey = "";
  ui.range = { mode: "all", tStart: null, tEnd: null, sStart: null, sEnd: null };
  landed = false;
  renderFiles(); renderChannels(); renderRangeBar();
  gotoTab("data");
};

let rt;
window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { drawTS(); drawXY(); drawSP(); drawCable(); drawBars(); }, 120); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { drawTS(); drawXY(); drawSP(); drawCable(); drawBars(); });

/* ============================================================
   구간 조작
   ============================================================ */

document.querySelectorAll('input[name="rmode"]').forEach(e => e.onchange = () => {
  ui.range.mode = e.value;
  ui.rangeOpen = e.value === "range";
  applyRange();
});

$("rFull").onclick = () => {
  ui.range = { mode: "all", tStart: null, tEnd: null, sStart: null, sEnd: null };
  applyRange();
};

$("rToggle").onclick = () => {
  ui.rangeOpen = !ui.rangeOpen;
  if (ui.rangeOpen && ui.range.mode !== "range") { ui.range.mode = "range"; applyRange(); }
  else renderRangeBar();
};

$("rTStart").oninput = () => { ui.range.tStart = fromLocalInput($("rTStart").value); applyRange(); };
$("rTEnd").oninput   = () => { ui.range.tEnd   = fromLocalInput($("rTEnd").value);   applyRange(); };
$("rSStart").oninput = () => { ui.range.sStart = numOrNull($("rSStart").value); applyRange(); };
$("rSEnd").oninput   = () => { ui.range.sEnd   = numOrNull($("rSEnd").value);   applyRange(); };

/* 시계열 그래프를 좌우로 끌어 구간 잡기 */
(() => {
  const cv = $("tsCv");
  const localX = e => e.clientX - cv.getBoundingClientRect().left;

  cv.addEventListener("pointerdown", e => {
    if (!tsBox) return;
    const x = localX(e);
    if (x < tsBox.L || x > tsBox.L + tsBox.pw) return;
    cv.setPointerCapture(e.pointerId);
    tsDrag = { x0: x, x1: x };
    drawTS();
  });

  cv.addEventListener("pointermove", e => {
    if (!tsDrag) return;
    tsDrag.x1 = Math.max(tsBox.L, Math.min(tsBox.L + tsBox.pw, localX(e)));
    drawTS();
  });

  const finish = () => {
    if (!tsDrag || !tsBox) { tsDrag = null; return; }
    const a = Math.min(tsDrag.x0, tsDrag.x1), b = Math.max(tsDrag.x0, tsDrag.x1);
    const box = tsBox;
    tsDrag = null;
    /* 손이 미끄러진 정도(6px 미만)는 선택으로 보지 않는다 */
    if (b - a < 6) { drawTS(); return; }
    const v0 = tsPxToVal(a), v1 = tsPxToVal(b);
    if (box.allTimed) { ui.range.tStart = v0; ui.range.tEnd = v1; }
    else { ui.range.sStart = +(v0 / 1000).toFixed(3); ui.range.sEnd = +(v1 / 1000).toFixed(3); }
    ui.range.mode = "range";
    applyRange();
  };
  cv.addEventListener("pointerup", finish);
  cv.addEventListener("pointercancel", () => { tsDrag = null; drawTS(); });

  /* 더블클릭하면 전체로 돌아간다 */
  cv.addEventListener("dblclick", () => {
    ui.range = { mode: "all", tStart: null, tEnd: null, sStart: null, sEnd: null };
    applyRange();
  });
})();

/* ============================================================
   관리기준선 입력
   ============================================================ */

document.addEventListener("input", e => {
  const key = e.target.dataset.lim; if (!key) return;
  applyLimitEdit(key, e.target.value);
});
document.addEventListener("change", e => {
  const key = e.target.dataset.lim;
  if (key && e.target.tagName === "SELECT") applyLimitEdit(key, e.target.value, true);
});

function applyLimitEdit(key, value, redrawFields) {
  const [kind, idx, field] = key.split(".");
  ui.cfg[kind].limits[+idx][field] = value;
  if (redrawFields) renderLimitFields(kind);
  redraw(kind);
}

function redraw(kind) {
  if (kind === "ts") drawTS();
  else if (kind === "xy") drawXY();
  else if (kind === "sp") drawSP();
  else if (kind === "cb") drawCable();
  else if (kind === "ag") drawBars();
}

/* ============================================================
   신호처리
   ============================================================ */

$("spZero").onchange   = e => { ui.cfg.sp.zero = e.target.value; drawSP(); };
$("spFilter").onchange = e => {
  ui.cfg.sp.filter = e.target.value;
  $("spLowWrap").hidden  = !(ui.cfg.sp.filter === "low"  || ui.cfg.sp.filter === "band");
  $("spHighWrap").hidden = !(ui.cfg.sp.filter === "high" || ui.cfg.sp.filter === "band");
  drawSP();
};
$("spN").onchange   = e => { ui.cfg.sp.N = +e.target.value; drawSP(); };
$("spWin").onchange = e => { ui.cfg.sp.win = e.target.value; drawSP(); };
$("spPng").onclick  = () => saveSpPng("time");
$("spFPng").onclick = () => saveSpPng("freq");
$("spCsv").onclick  = exportSpectrumCsv;

/* 그래프 비율 */
document.addEventListener("change", e => {
  const key = e.target.dataset.ratio; if (!key) return;
  const [kind, field] = key.split(".");
  ui.cfg[kind][field] = e.target.value;
  redraw(kind);
});

/* 샘플레이트 재지정 — 어느 화면에서든 통한다.
   타임스탬프가 잘못 찍힌 파일도 여기서 바로잡는다 */
document.addEventListener("input", e => {
  const cid = e.target.dataset.fs; if (!cid) return;
  const v = parseFloat(e.target.value);
  if (!(v > 0)) return;
  const ch = store.channels.find(c => c.id === cid);
  if (!ch) return;
  ch.sampleRate = v;
  ch.rateOverride = true;
  cbModesKey = "";                       // 주파수가 통째로 달라지므로 차수를 다시 잡는다
  renderChannels();
});

/* ============================================================
   케이블 장력
   ============================================================ */

$("cbN").onchange    = e => { ui.cfg.cb.N = +e.target.value; drawCable(); };
$("cbUnit").onchange = e => { ui.cfg.cb.massUnit = e.target.value; drawCable(); };
$("cbBridge").oninput = () => {};
$("cbRefill").onclick = () => { ui.cfg.cb.f1Manual = ""; cbModesKey = ""; drawCable(); };
$("cbFill").onclick   = () => refillModes(numOrNull(ui.cfg.cb.f1Manual));
$("cbPrint").onclick  = () => window.print();

/* 차수 표 편집 */
$("cbModeTbl").addEventListener("input", e => {
  const key = e.target.dataset.mode; if (!key) return;
  const [i, field] = key.split(".");
  ui.cbModes[+i][field] = field === "use" ? e.target.checked : e.target.value;
  drawCable();
});
$("cbModeTbl").addEventListener("change", e => {
  const key = e.target.dataset.mode;
  if (key && e.target.type === "checkbox") {
    const [i] = key.split(".");
    ui.cbModes[+i].use = e.target.checked;
    drawCable();
  }
});
$("cbAdd").onclick = addCableResult;
$("cbCsv").onclick = exportCableCsv;
$("cbPng").onclick = saveCablePng;
$("cbList").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (b && b.dataset.cbdel !== undefined) {
    ui.cbList.splice(+b.dataset.cbdel, 1);
    renderCableList(); renderReport();
  }
});

/* 시작 */
gotoTab("data");
