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
        <div class="src">${ch.source} · ${ch.n.toLocaleString()}점 · ${kind} · ${fmtNum(ch.min, 3)} ~ ${fmtNum(ch.max, 3)}${ch.nan ? ` · 결측 ${ch.nan.toLocaleString()}개` : ""}</div></div>
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
  ["ts", "xy", "sp"].forEach(p => { $(p + "Empty").hidden = has; $(p + "Main").hidden = !has; $(p + "PlotCard").hidden = !has; });
  $("agEmpty").hidden = has; $("agMain").hidden = !has; $("agTblCard").hidden = !has;

  const ids = new Set(store.channels.map(c => c.id));
  [ui.tsSel, ui.xySel, ui.agSel].forEach(s => [...s].forEach(id => { if (!ids.has(id)) s.delete(id); }));
  if (ui.xyX && !ids.has(ui.xyX)) ui.xyX = null;
  if (has && !ui.tsSel.size) ui.tsSel.add(store.channels[0].id);
  if (has && !ui.agSel.size) ui.agSel.add(store.channels[0].id);
  if (has && !ui.xyX) ui.xyX = store.channels[0].id;
  if (ui.spX && !ids.has(ui.spX)) ui.spX = null;
  if (has && !ui.spX) {
    const first = store.channels.find(c => canProcess(c).ok);
    ui.spX = first ? first.id : null;
  }

  $("tsPicks").innerHTML = store.channels.map(c => pickHTML(c, "ts", ui.tsSel.has(c.id))).join("");
  $("xyX").innerHTML = store.channels.map(c => pickHTML(c, "xyX", ui.xyX === c.id)).join("");
  $("xyY").innerHTML = store.channels.map(c => pickHTML(c, "xyY", ui.xySel.has(c.id), c.id === ui.xyX)).join("");
  $("agPicks").innerHTML = store.channels.map(c => pickHTML(c, "ag", ui.agSel.has(c.id))).join("");

  ["ts", "xy", "sp"].forEach(renderLimitFields);
  renderSPControls();
  drawTS(); drawXY(); drawSP(); renderAgg(); renderRangeBar();
}

/* ============================================================
   구간 막대 — 세 분석 화면이 공유한다
   ============================================================ */

/* 등록된 채널들이 어떤 시간 성격인지 (시각 기반 / 인덱스 기반 / 둘 다) */
function rangeKinds() {
  return {
    timed: store.channels.some(c => c.times),
    indexed: store.channels.some(c => !c.times)
  };
}

/* 전체 채널을 아우르는 시각 범위 */
function fullTimeSpan() {
  let a = Infinity, b = -Infinity;
  for (const c of store.channels) {
    if (!c.times || !c.n) continue;
    if (c.times[0] < a) a = c.times[0];
    if (c.times[c.n - 1] > b) b = c.times[c.n - 1];
  }
  return isFinite(a) ? [a, b] : null;
}

function renderRangeBar() {
  const bar = $("rangeBar");
  const show = store.channels.length > 0 && ui.page !== "data";
  bar.hidden = !show;
  if (!show) return;

  const r = ui.range;
  const k = rangeKinds();
  [...document.querySelectorAll('input[name="rmode"]')].forEach(e => e.checked = (e.value === r.mode));
  $("rangeFields").hidden = r.mode !== "range";
  $("fldT").hidden = $("fldT2").hidden = !k.timed;
  $("fldS").hidden = $("fldS2").hidden = !k.indexed;

  if (document.activeElement !== $("rTStart")) $("rTStart").value = toLocalInput(r.tStart);
  if (document.activeElement !== $("rTEnd")) $("rTEnd").value = toLocalInput(r.tEnd);
  if (document.activeElement !== $("rSStart")) $("rSStart").value = r.sStart === null ? "" : r.sStart;
  if (document.activeElement !== $("rSEnd")) $("rSEnd").value = r.sEnd === null ? "" : r.sEnd;

  let info = "";
  if (r.mode === "all") {
    const sp = fullTimeSpan();
    info = sp ? `${fmtTime(sp[0], 1e12)} ~ ${fmtTime(sp[1], 1e12)} 전부` : "전체";
  } else {
    const parts = [];
    if (k.timed && (r.tStart !== null || r.tEnd !== null))
      parts.push(`${fmtDur((r.tEnd ?? 0) - (r.tStart ?? 0))} 구간`);
    let used = 0, total = 0;
    for (const c of store.channels) {
      const [i0, i1] = rangeBounds(c);
      used += i1 - i0; total += c.n;
    }
    parts.push(`${used.toLocaleString()} / ${total.toLocaleString()}점`);
    info = `<span class="on">${parts.join(" · ")}</span>`;
  }
  $("rangeInfo").innerHTML = info;
}

/* 구간이 바뀌면 세 화면을 함께 다시 그린다 */
function applyRange() {
  renderRangeBar();
  drawTS(); drawXY(); drawSP(); renderAgg();
}

/* ============================================================
   관리기준선 입력 — 세 그래프가 같은 모양을 쓴다
   ============================================================ */

function renderLimitFields(kind) {
  const box = $(kind + "Limits");
  if (!box) return;
  const lims = ui.cfg[kind].limits;
  const opts = Object.entries(LIMIT_TONES)
    .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
  box.innerHTML =
    `<div class="hd">관리기준선 · 최대 4개 · 값을 비우면 그리지 않습니다</div>` +
    lims.map((l, i) => `
      <div class="lrow">
        <span class="swatch" style="background:${LIMIT_TONES[l.tone].color}"></span>
        <input class="box v" type="number" step="any" placeholder="값" data-lim="${kind}.${i}.v" value="${l.v}">
        <input class="box t" placeholder="이름 (예: 상한)" data-lim="${kind}.${i}.label" value="${l.label}">
        <select data-lim="${kind}.${i}.tone">${opts}</select>
      </div>`).join("");
  lims.forEach((l, i) => {
    const sel = box.querySelector(`select[data-lim="${kind}.${i}.tone"]`);
    if (sel) sel.value = l.tone;
  });
}

/* ============================================================
   신호처리 화면의 선택 항목
   ============================================================ */

function fillSelect(el, entries, current) {
  if (!el) return;
  el.innerHTML = entries.map(([v, label]) => `<option value="${v}">${label}</option>`).join("");
  el.value = current;
}

function renderSPControls() {
  const cfg = ui.cfg.sp;
  fillSelect($("spZero"), Object.entries(ZERO_MODES), cfg.zero);
  fillSelect($("spFilter"), Object.entries(FILTER_MODES), cfg.filter);
  fillSelect($("spN"), WINDOW_SIZES.map(n => [n, n.toLocaleString()]), String(cfg.N));
  fillSelect($("spWin"), Object.entries(WINDOWS).map(([k, v]) => [k, v.label]), cfg.win);
  $("spLowWrap").hidden = !(cfg.filter === "low" || cfg.filter === "band");
  $("spHighWrap").hidden = !(cfg.filter === "high" || cfg.filter === "band");

  /* 등간격이 아닌 채널은 고를 수 없게 막고 이유를 붙인다 */
  $("spPicks").innerHTML = store.channels.map(c => {
    const p = canProcess(c);
    return `<label class="pick" title="${p.ok ? p.why : p.why}">
      <input type="radio" name="sp" data-g="sp" data-cid="${c.id}"
        ${ui.spX === c.id ? "checked" : ""} ${p.ok ? "" : "disabled"}>
      <span><i class="dot" style="background:${c.color}"></i><em>${c.name}</em></span></label>`;
  }).join("");
}
