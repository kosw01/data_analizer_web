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
  const b = e.target.closest("button"); if (!b) return;
  ui.page = b.dataset.p;
  [...$("tabs").children].forEach(x => x.setAttribute("aria-selected", x === b));
  document.querySelectorAll("section[data-page]").forEach(s => s.hidden = s.dataset.page !== ui.page);
  if (ui.page === "ts") drawTS();
  if (ui.page === "xy") drawXY();
  if (ui.page === "ag") renderAgg();
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
});

/* 그래프 설정 */
document.addEventListener("input", e => {
  const key = e.target.dataset.cfg; if (!key) return;
  const [kind, field] = key.split(".");
  const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  ui.cfg[kind][field] = (field === "lineWidth" || field === "dot" || field === "height")
    ? (parseFloat(v) || ui.cfg[kind][field]) : v;
  kind === "ts" ? drawTS() : drawXY();
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

$("reset").onclick = () => {
  store.tables = []; store.channels = [];
  ui.tsSel.clear(); ui.xySel.clear(); ui.agSel.clear(); ui.xyX = null;
  renderFiles(); renderChannels();
};

let rt;
window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { drawTS(); drawXY(); }, 120); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { drawTS(); drawXY(); });
