"use strict";

/* 화면 그리기
   파일·채널 목록과 공용 채널 선택 필드 */

/* ============================================================
   데이터 페이지
   ============================================================ */

function renderFiles() {
  $("filesCard").hidden = !store.tables.length;
  $("fileCount").textContent = store.tables.length ? store.tables.length + "개" : "";
  $("nData").textContent = store.tables.length ? `${store.tables.length}·${store.channels.length}` : "";
  const box = $("files"); box.innerHTML = "";
  store.tables.forEach(t => {
    const taken = new Set(store.channels.filter(c => c.tableId === t.id).map(c => c.colIndex));
    let chips = `<span class="chip"><span class="k">인코딩</span>${t.encoding}</span>`;
    chips += `<span class="chip"><span class="k">구분자</span>${t.delimName}</span>`;
    chips += `<span class="chip ${t.hasHeader ? "ok" : "warn"}">${t.hasHeader ? "헤더 있음" : "헤더 없음 · 이름 자동"}</span>`;
    if (t.times) {
      const tm = t.time;
      if (tm.kind === "uniform")
        chips += `<span class="chip ok">시간축 등간격</span><span class="chip hz"><span class="k">추정</span>${fmtNum(tm.sampleRate, 3)} Hz</span>`;
      else {
        chips += `<span class="chip bad">시간축 불규칙</span>`;
        if (tm.dup) chips += `<span class="chip warn">중복 ${tm.dup}건</span>`;
        if (tm.gaps) chips += `<span class="chip warn">결측 ${tm.gaps}구간 · 최대 ${fmtDur(tm.maxGap)}</span>`;
        if (tm.back) chips += `<span class="chip bad">시간 역행 ${tm.back}건</span>`;
        chips += `<span class="chip"><span class="k">주기(중앙값)</span>${fmtDur(tm.median)}</span>`;
      }
    } else {
      chips += `<span class="chip warn">시간축 없음</span><span class="chip hz"><span class="k">샘플레이트</span><input type="number" min="0.001" step="1" value="${t.manualHz}" data-hz="${t.id}"> Hz</span>`;
    }
    const cols = t.names.map((nm, i) => (t.times && i === 0) ? "" :
      `<label class="pick"><input type="checkbox" data-tid="${t.id}" data-ci="${i}" ${taken.has(i) ? "disabled" : ""}>
       <span title="${nm}"><em>${nm}</em></span></label>`).join("");
    const el = document.createElement("div");
    el.className = "file";
    el.innerHTML = `
      <div class="file-name">${t.fileName}</div>
      <div class="file-meta">${t.nRows.toLocaleString()}행 · ${t.names.length}컬럼${t.times ? ` (시간 1 + 데이터 ${t.names.length - 1})` : ""}</div>
      <div class="chips">${chips}</div><div class="cols">${cols}</div>
      <div class="row">
        <button class="b btn-primary btn-sm" data-add="${t.id}">선택한 컬럼 등록</button>
        <button class="b btn-ghost btn-sm" data-all="${t.id}">전부 선택</button>
        <div class="spacer"></div>
        <button class="b btn-ghost btn-sm" data-del="${t.id}">파일 닫기</button>
      </div>`;
    box.appendChild(el);
  });
}

function renderChannels() {
  $("chCard").hidden = !store.channels.length;
  $("chCount").textContent = store.channels.length ? store.channels.length + "개" : "";
  const box = $("chList"); box.innerHTML = "";
  store.channels.forEach(ch => {
    const p = canProcess(ch);
    const kind = ch.timeKind === "index" ? `${ch.sampleRate} Hz 지정`
      : ch.timeKind === "uniform" ? `등간격 ${fmtNum(ch.sampleRate, 3)} Hz` : "불규칙 시간축";
    const el = document.createElement("div");
    el.className = "ch";
    el.innerHTML = `
      <span class="dot" style="background:${ch.color}"></span>
      <div class="info"><div class="nm">${ch.name}</div>
        <div class="src">${ch.source} · ${ch.n.toLocaleString()}점 · ${kind} · ${fmtNum(ch.min, 3)} ~ ${fmtNum(ch.max, 3)}</div></div>
      <span class="chip ${p.ok ? "ok" : "bad"}" title="${p.why}">${p.ok ? "FFT·필터 가능" : "FFT·필터 불가"}</span>
      <button class="b btn-ghost btn-sm" data-chdel="${ch.id}">제거</button>`;
    box.appendChild(el);
  });
  renderSelectors();
}

function pickHTML(ch, group, checked, disabled) {
  return `<label class="pick"><input type="${group === "xyX" ? "radio" : "checkbox"}" name="${group}"
    data-g="${group}" data-cid="${ch.id}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
    <span title="${ch.name} — ${ch.source}"><i class="dot" style="background:${ch.color}"></i><em>${ch.name}</em></span></label>`;
}

function renderSelectors() {
  const has = store.channels.length > 0;
  ["ts", "xy"].forEach(p => { $(p + "Empty").hidden = has; $(p + "Main").hidden = !has; $(p + "PlotCard").hidden = !has; });
  $("agEmpty").hidden = has; $("agMain").hidden = !has; $("agTblCard").hidden = !has;

  const ids = new Set(store.channels.map(c => c.id));
  [ui.tsSel, ui.xySel, ui.agSel].forEach(s => [...s].forEach(id => { if (!ids.has(id)) s.delete(id); }));
  if (ui.xyX && !ids.has(ui.xyX)) ui.xyX = null;
  if (has && !ui.tsSel.size) ui.tsSel.add(store.channels[0].id);
  if (has && !ui.agSel.size) ui.agSel.add(store.channels[0].id);
  if (has && !ui.xyX) ui.xyX = store.channels[0].id;

  $("tsPicks").innerHTML = store.channels.map(c => pickHTML(c, "ts", ui.tsSel.has(c.id))).join("");
  $("xyX").innerHTML = store.channels.map(c => pickHTML(c, "xyX", ui.xyX === c.id)).join("");
  $("xyY").innerHTML = store.channels.map(c => pickHTML(c, "xyY", ui.xySel.has(c.id), c.id === ui.xyX)).join("");
  $("agPicks").innerHTML = store.channels.map(c => pickHTML(c, "ag", ui.agSel.has(c.id))).join("");

  drawTS(); drawXY(); renderAgg();
}
