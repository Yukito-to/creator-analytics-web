/* ============================================================
   创作者数据分析 · 视图层（不含时段预测视图）
   （表格渲染 / 各 tab 视图 / 出勤 / 导出图片）
   ============================================================ */
'use strict';

/* 导出 PNG 的 blob URL 缓存 */
let _lastBlobUrl = null;

/* ==================== 表格行渲染辅助 ==================== */
function diffHTML(cur, prev, metric) {
  if (cur == null || prev == null || !isFinite(cur) || !isFinite(prev)) return '<span class="na">—</span>';
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return '<span class="delta-flat">0</span>';
  const up = d > 0;
  const good = metric.better === 'up' ? up : !up;
  const cls = good ? 'delta-up' : 'delta-down';
  const arrow = up ? '↑' : '↓';
  const s = metric.pct ? (Math.abs(d) * 100).toFixed(metric.digits) + '%' : Math.abs(d).toFixed(metric.digits);
  return '<span class="' + cls + '">' + arrow + ' ' + s + '</span>';
}
function diffInt(cur, prev) {
  if (cur == null || prev == null || !isFinite(cur) || !isFinite(prev)) return '<span class="na">—</span>';
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return '<span class="delta-flat">0</span>';
  const up = d > 0;
  const cls = up ? 'delta-up' : 'delta-down';
  const arrow = up ? '↑' : '↓';
  return '<span class="' + cls + '">' + arrow + ' ' + Math.abs(Math.round(d)) + '</span>';
}
function diffText(cur, prev, metric) {
  if (cur == null || prev == null || !isFinite(cur) || !isFinite(prev)) return '—';
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return '0';
  const arrow = d > 0 ? '↑' : '↓';
  const s = metric.pct ? (Math.abs(d) * 100).toFixed(metric.digits) + '%' : Math.abs(d).toFixed(metric.digits);
  return arrow + s;
}

function rowHTMLSrcToggle(label, src, metric, opts, rowBg, toggleKey, expanded, labelHtml) {
  const cols = timeCols();
  const m = calcBySrc(src, Object.assign({}, opts || {}, { monthSet: new Set([S.month]) }));
  const wkA = cols.wks.map(w => calcBySrc(src, Object.assign({}, opts || {}, { wkSet: new Set([w]) })));
  const dayA = cols.last7.map(d => calcBySrc(src, Object.assign({}, opts || {}, { dateSet: new Set([d]) })));
  const tdStyle = rowBg ? ' style="background:' + rowBg + '"' : '';
  const arrow = expanded ? '▼' : '▶';
  let firstTd;
  if (labelHtml != null) {
    firstTd = '<td' + tdStyle + '>' +
      '<div class="row-flex">' +
        '<span class="row-toggle" data-key="' + esc(toggleKey) + '">' + arrow + '</span>' +
        '<div class="row-label-stack">' + labelHtml + '</div>' +
      '</div>' +
    '</td>';
  } else {
    firstTd = '<td' + tdStyle + '><span class="row-toggle" data-key="' + esc(toggleKey) + '">' + arrow + '</span>' + esc(label) + '</td>';
  }
  const tds = [firstTd, '<td' + tdStyle + '>' + fmtVal(m[metric.key], metric) + '</td>'];
  for (const w of wkA) tds.push('<td' + tdStyle + '>' + fmtVal(w[metric.key], metric) + '</td>');
  tds.push('<td' + tdStyle + '>' + diffHTML(wkA[1][metric.key], wkA[0][metric.key], metric) + '</td>');
  tds.push('<td' + tdStyle + '>' + diffHTML(wkA[2][metric.key], wkA[1][metric.key], metric) + '</td>');
  for (const d of dayA) tds.push('<td' + tdStyle + '>' + fmtVal(d[metric.key], metric) + '</td>');
  return '<tr>' + tds.join('') + '</tr>';
}

function rowHTMLByL1(label, src, bizL1, metric, opts, rowBg) {
  const cols = timeCols();
  const m = calcBySrcAndL1(src, bizL1, Object.assign({}, opts || {}, { monthSet: new Set([S.month]) }));
  const wkA = cols.wks.map(w => calcBySrcAndL1(src, bizL1, Object.assign({}, opts || {}, { wkSet: new Set([w]) })));
  const dayA = cols.last7.map(d => calcBySrcAndL1(src, bizL1, Object.assign({}, opts || {}, { dateSet: new Set([d]) })));
  const tdStyle = rowBg ? ' style="background:' + rowBg + '"' : '';
  const tds = ['<td' + tdStyle + '>' + esc(label) + '</td>', '<td' + tdStyle + '>' + fmtVal(m[metric.key], metric) + '</td>'];
  for (const w of wkA) tds.push('<td' + tdStyle + '>' + fmtVal(w[metric.key], metric) + '</td>');
  tds.push('<td' + tdStyle + '>' + diffHTML(wkA[1][metric.key], wkA[0][metric.key], metric) + '</td>');
  tds.push('<td' + tdStyle + '>' + diffHTML(wkA[2][metric.key], wkA[1][metric.key], metric) + '</td>');
  for (const d of dayA) tds.push('<td' + tdStyle + '>' + fmtVal(d[metric.key], metric) + '</td>');
  return '<tr>' + tds.join('') + '</tr>';
}

function inspRowToggleHTML(label, src, opts, valueKey, toggleKey, expanded, rowBg) {
  const cols = timeCols();
  const queryOpts = Object.assign({}, opts || {}, { src });
  function pick(o) { return inspectionStats(Object.assign({}, queryOpts, o))[valueKey] || 0; }
  const m = pick({ monthSet: new Set([S.month]) });
  const wkA = cols.wks.map(w => pick({ wkSet: new Set([w]) }));
  const dayA = cols.last7.map(d => pick({ dateSet: new Set([d]) }));
  const tdStyle = rowBg ? ' style="background:' + rowBg + '"' : '';
  const arrow = expanded ? '▼' : '▶';
  const firstTd = '<td' + tdStyle + '><span class="row-toggle" data-key="' + esc(toggleKey) + '">' + arrow + '</span>' + esc(label) + '</td>';
  const tds = [firstTd, '<td' + tdStyle + '>' + fmtInt(m) + '</td>'];
  for (const w of wkA) tds.push('<td' + tdStyle + '>' + fmtInt(w) + '</td>');
  tds.push('<td' + tdStyle + '>' + diffInt(wkA[1], wkA[0]) + '</td>');
  tds.push('<td' + tdStyle + '>' + diffInt(wkA[2], wkA[1]) + '</td>');
  for (const d of dayA) tds.push('<td' + tdStyle + '>' + fmtInt(d) + '</td>');
  return '<tr>' + tds.join('') + '</tr>';
}

function inspRowByL1HTML(label, src, bizL1, opts, valueKey, rowBg) {
  const cols = timeCols();
  const queryOpts = Object.assign({}, opts || {}, { src, bizL1 });
  function pick(o) { return inspectionStats(Object.assign({}, queryOpts, o))[valueKey] || 0; }
  const m = pick({ monthSet: new Set([S.month]) });
  const wkA = cols.wks.map(w => pick({ wkSet: new Set([w]) }));
  const dayA = cols.last7.map(d => pick({ dateSet: new Set([d]) }));
  const tdStyle = rowBg ? ' style="background:' + rowBg + '"' : '';
  const tds = ['<td' + tdStyle + '>' + esc(label) + '</td>', '<td' + tdStyle + '>' + fmtInt(m) + '</td>'];
  for (const w of wkA) tds.push('<td' + tdStyle + '>' + fmtInt(w) + '</td>');
  tds.push('<td' + tdStyle + '>' + diffInt(wkA[1], wkA[0]) + '</td>');
  tds.push('<td' + tdStyle + '>' + diffInt(wkA[2], wkA[1]) + '</td>');
  for (const d of dayA) tds.push('<td' + tdStyle + '>' + fmtInt(d) + '</td>');
  return '<tr>' + tds.join('') + '</tr>';
}

function renderExpandRows(src, opts, metricKey, parentKey) {
  const rows = [];
  if (metricKey === 'qualityPassRate') {
    const inspSub = [
      { key: 'total', label: '　└ 抽检量', bg: '#F0E6F0' },
      { key: 'pass',  label: '　└ 合格量', bg: '#F0E6F0' },
      { key: 'fail',  label: '　└ 不合格量', bg: '#F0E6F0' }
    ];
    for (const ik of inspSub) {
      const subKey = parentKey + '|' + ik.key;
      const subExpanded = S.expandedRows.has(subKey);
      rows.push(inspRowToggleHTML(ik.label, src, opts, ik.key, subKey, subExpanded, ik.bg));
      if (subExpanded) {
        rows.push(inspRowByL1HTML('　　└ 买手合作', src, '买手合作', opts, ik.key, '#ECE6F5'));
        rows.push(inspRowByL1HTML('　　└ 博主合作', src, '博主合作', opts, ik.key, '#ECE6F5'));
      }
    }
  } else {
    const metric = METRIC_MAP[metricKey];
    rows.push(rowHTMLByL1('　└ 买手合作 CASE', src, '买手合作', metric, opts, '#E8EDF3'));
    rows.push(rowHTMLByL1('　└ 博主合作 CASE', src, '博主合作', metric, opts, '#F3EFE2'));
  }
  return rows;
}

function rateSpan(rate, biz) {
  if (rate == null || !isFinite(rate)) return '—';
  const th = s30Threshold(biz);
  const cls = rate >= th ? 'rate-ok' : 'rate-bad';
  return '<span class="' + cls + '">' + (rate * 100).toFixed(2) + '%</span>';
}
function rowHTMLS30(label, biz, metric) {
  const cols = timeCols();
  const calc = opts => calcByL1(biz, opts);
  const m = calc({ monthSet: new Set([S.month]) });
  const wkA = cols.wks.map(w => calc({ wkSet: new Set([w]) }));
  const dayA = cols.last7.map(d => calc({ dateSet: new Set([d]) }));
  const cell = v => (metric.key === 's30Rate') ? rateSpan(v, biz) : fmtVal(v, metric);
  const tds = ['<td>' + esc(label) + '</td>', '<td>' + cell(m[metric.key]) + '</td>'];
  for (const w of wkA) tds.push('<td>' + cell(w[metric.key]) + '</td>');
  tds.push('<td>' + diffHTML(wkA[1][metric.key], wkA[0][metric.key], metric) + '</td>');
  tds.push('<td>' + diffHTML(wkA[2][metric.key], wkA[1][metric.key], metric) + '</td>');
  for (const d of dayA) tds.push('<td>' + cell(d[metric.key]) + '</td>');
  return '<tr>' + tds.join('') + '</tr>';
}

/* ==================== 视图切换与刷新 ==================== */
function switchView(name) {
  $$('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + name);
  if (el) el.classList.add('active');
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
}
function afterLoad() {
  renderImportSummary();
  renderMapping();
  renderRoster();
  initSelects();
  refreshAll();
}
function refreshAll() {
  if (!S.records.length && !S.wtRecords.length && !S.inspections.length) return;
  renderOverview();
  renderPerson();
  renderTeam();
  renderS30();
  renderAHT2();
  renderSLA();
  renderAttendance();
  refreshExportOptions();
  renderReport();
  /* 时段预测若当前可见，也刷新（函数在 dashboard-forecast.js） */
  const fcView = document.getElementById('view-forecast');
  if (fcView && fcView.classList.contains('active') && typeof renderForecastConfig === 'function') {
    renderForecastConfig();
    if (typeof renderForecastResult === 'function') renderForecastResult();
  }
}

/* ==================== 导入摘要 & 字段映射 ==================== */
function renderImportSummary() {
  const el = $('#importSummary');
  if (!el) return;
  if (!S.records.length && !S.roster.length) { el.innerHTML = ''; return; }
  const volumeDays = (function() {
    let cnt = 0;
    for (const biz in S.volumeForecast) cnt += Object.keys(S.volumeForecast[biz] || {}).length;
    return cnt;
  })();
  const items = [
    ['花名册员工数', S.roster.length],
    ['买手员工数据行', S.records.filter(r => r.src === 'buyer').length],
    ['博主员工数据行', S.records.filter(r => r.src === 'blogger').length],
    ['买手员工质检行', S.inspections.filter(r => r.src === 'buyer').length],
    ['博主员工质检行', S.inspections.filter(r => r.src === 'blogger').length],
    ['工时数据行', S.wtRecords.length],
    ['班次数量', Object.keys(S.shiftMap).length],
    ['班表员工数', Object.keys(S.schedule).length],
    ['买手员工SLA组', S.slaBuyer.length],
    ['博主员工SLA组', S.slaBlogger.length],
    ['买手合作预测量', Object.keys(S.forecastBuyer).length],
    ['博主合作预测量', Object.keys(S.forecastBlogger).length],
    ['业务线映射', Object.keys(S.businessMap).length],
    ['二级打点映射', Object.keys(S.business2Map).length],
    ['预测量天数', volumeDays],
    ['数据主月份', S.month || '—'],
    ['最新日期', S.latestDate || '—'],
    ['最新 WK', 'WK' + (S.latestWK || '—')],
  ];
  el.innerHTML = items.map(([k,v]) =>
    '<div class="sum-item"><div class="k">' + esc(k) + '</div><div class="v">' + esc(String(v)) + '</div></div>'
  ).join('');
}

function renderMapping() {
  const el = $('#mappingBody');
  if (!el) return;
  const mods = ['buyer','blogger','inspectionBuyer','inspectionBlogger','worktime','business','business2'];
  const parts = [];
  for (const mod of mods) {
    if (!S.headers[mod]) continue;
    const headers = S.headers[mod];
    const cur = S.mapping[mod] || {};
    const rows = Object.keys(MAP_DEF[mod]).map(field => {
      const v = cur[field] || '';
      const opts = ['<option value="">— 未映射 —</option>']
        .concat(headers.map(h => '<option value="' + esc(h) + '"' + (h === v ? ' selected' : '') + '>' + esc(h) + '</option>'))
        .join('');
      return '<div class="map-row"><span class="label">' + esc(FIELD_LABEL[field] || field) + '</span><select data-mod="' + mod + '" data-field="' + field + '">' + opts + '</select></div>';
    }).join('');
    parts.push('<div class="map-block"><h3>' + esc(MAP_TITLE[mod]) + ' · ' + headers.length + ' 列</h3><div class="map-grid">' + rows + '</div></div>');
  }
  el.innerHTML = parts.join('') || '<p class="muted">尚未导入数据，请先导入表格。</p>';
  el.querySelectorAll('select').forEach(sel => {
    sel.addEventListener('change', () => {
      S.mapping[sel.dataset.mod][sel.dataset.field] = sel.value;
      parseRoster(); buildAll(); renderRoster(); refreshAll();
    });
  });
}

/* ==================== 花名册 ==================== */
function renderRoster() {
  const el = $('#rosterTable');
  if (!el) return;
  const search = $('#rosterSearch');
  const kw = ((search && search.value) || '').trim().toLowerCase();
  const list = S.roster
    .map((e, i) => ({ e, i }))
    .filter(x => {
      if (!kw) return true;
      const e = x.e;
      return (e.name + e.group + e.batch + e.attr + e.biz).toLowerCase().includes(kw);
    })
    .sort((a, b) => {
      const ar = a.e.resignDate || '';
      const br = b.e.resignDate || '';
      const aResigned = ar !== '';
      const bResigned = br !== '';
      if (aResigned !== bResigned) return aResigned ? 1 : -1;
      if (aResigned && bResigned) { if (ar !== br) return ar < br ? 1 : -1; return a.i - b.i; }
      return a.i - b.i;
    })
    .map(x => x.e);
  const head = '<tr>' + ['姓名','组别','批次','上线日期','业务线','属性','分类','离职日期'].map(h => '<th>' + h + '</th>').join('') + '</tr>';
  const body = list.map(e => {
    const cat = categoryOf(e, S.month);
    const dim = S.hidden && e.resignDate;
    return '<tr' + (dim ? ' style="opacity:.4"' : '') + '>' +
      '<td>' + esc(e.name) + '</td>' +
      '<td>' + esc(e.group || '—') + '</td>' +
      '<td>' + esc(e.batch || '—') + '</td>' +
      '<td>' + esc(e.onlineDate || '—') + '</td>' +
      '<td>' + esc(e.biz || '—') + '</td>' +
      '<td>' + esc(e.attr || '—') + '</td>' +
      '<td>' + esc(cat || '—') + '</td>' +
      '<td><input class="resign-input" type="date" data-name="' + esc(e.name) + '" value="' + esc(e.resignDate || '') + '"></td>' +
    '</tr>';
  }).join('');
  el.innerHTML = '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
  const cnt = $('#rosterCount');
  if (cnt) cnt.textContent = '共 ' + list.length + ' 人';
  el.querySelectorAll('.resign-input').forEach(inp => {
    inp.addEventListener('change', () => {
      const emp = S.roster.find(x => x.name === inp.dataset.name);
      if (!emp) return;
      emp.resignDate = inp.value || '';
      persistMemo(); renderRoster(); refreshAll();
    });
  });
}

/* ==================== 整体达成总览 ==================== */
function renderOverview() {
  const el = $('#ovBody');
  if (!el) return;
  const bizEl = $('#ovBiz');
  const biz = (bizEl && bizEl.value) || '买手合作';
  const src = bizToSrc(biz);
  if (!S.records.length) { el.innerHTML = '<p class="muted">尚未导入数据。</p>'; return; }

  const l1Sum = { '买手合作':0, '博主合作':0 };
  for (const r of S.records) if (l1Sum[r.biz] != null) l1Sum[r.biz] += r.volume;
  const empSum = { '买手合作':0, '博主合作':0 };
  for (const r of S.records) {
    const eb = (r.src === 'buyer') ? '买手合作' : '博主合作';
    if (empSum[eb] != null) empSum[eb] += r.volume;
  }
  const cross = { '买手合作': { '买手合作':0, '博主合作':0 }, '博主合作': { '买手合作':0, '博主合作':0 } };
  for (const r of S.records) {
    const srcKey = (r.src === 'buyer') ? '买手合作' : '博主合作';
    if (cross[srcKey] && cross[srcKey][r.biz] != null) cross[srcKey][r.biz] += r.volume;
  }
  const overview = '<div class="summary-grid" style="margin-bottom:16px">' +
    '<div class="sum-item"><div class="k">① 一级打点 · 买手合作 CASE</div><div class="v">' + Math.round(l1Sum['买手合作']) + '</div></div>' +
    '<div class="sum-item"><div class="k">① 一级打点 · 博主合作 CASE</div><div class="v">' + Math.round(l1Sum['博主合作']) + '</div></div>' +
    '<div class="sum-item"><div class="k">② 买手员工数据 · 总 CASE</div><div class="v">' + Math.round(empSum['买手合作']) + '</div></div>' +
    '<div class="sum-item"><div class="k">② 博主员工数据 · 总 CASE</div><div class="v">' + Math.round(empSum['博主合作']) + '</div></div>' +
    '<div class="sum-item"><div class="k">③ 买手员工数据中 · 买手合作 CASE</div><div class="v">' + Math.round(cross['买手合作']['买手合作']) + '</div></div>' +
    '<div class="sum-item"><div class="k">③ 买手员工数据中 · 博主合作 CASE</div><div class="v">' + Math.round(cross['买手合作']['博主合作']) + '</div></div>' +
    '<div class="sum-item"><div class="k">③ 博主员工数据中 · 买手合作 CASE</div><div class="v">' + Math.round(cross['博主合作']['买手合作']) + '</div></div>' +
    '<div class="sum-item"><div class="k">③ 博主员工数据中 · 博主合作 CASE</div><div class="v">' + Math.round(cross['博主合作']['博主合作']) + '</div></div>' +
    '</div>';
  const cols = timeCols();
  const rows = [];
  for (const m of METRICS) {
    const key = 'ov|' + m.key;
    const expanded = S.expandedRows.has(key);
    const bg = METRIC_BG[m.key] || '';
    rows.push(rowHTMLSrcToggle(metricLabel(m), src, m, null, bg, key, expanded));
    if (expanded) { const ex = renderExpandRows(src, null, m.key, key); for (const r of ex) rows.push(r); }
  }
  el.innerHTML = overview + '<div class="table-scroll"><table><thead><tr>' + buildHeaderHTML(cols) + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  el.querySelectorAll('.row-toggle').forEach(sp => {
    sp.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = sp.dataset.key;
      if (S.expandedRows.has(key)) S.expandedRows.delete(key); else S.expandedRows.add(key);
      renderOverview();
    });
  });
}

/* ==================== 员工看板 ==================== */
function refreshPersonOptions() {
  const em = ensureChipContainer('peMetric');
  if (!em) return;
  const personMetrics = METRICS.filter(m => m.key !== 's30Rate');
  const selected = new Set(getCheckedValues('#peMetric'));
  selected.delete('s30Rate');
  if (selected.size === 0 && personMetrics.length > 0) selected.add(personMetrics[0].key);

  em.innerHTML = personMetrics.map(m =>
    '<span class="chip' + (selected.has(m.key) ? ' on' : '') +
    '" data-val="' + esc(m.key) + '">' + esc(metricLabel(m)) + '</span>'
  ).join('');

  em.querySelectorAll('.chip').forEach(ch => {
    ch.addEventListener('click', () => {
      ch.classList.toggle('on');
      renderPerson();
    });
  });
}
function renderPerson() {
  const bizEl = $('#peBiz');
  const biz = (bizEl && bizEl.value) || '买手合作';
  const src = bizToSrc(biz);
  const body = $('#peBody');
  const names = $('#peNames');
  if (!body || !names) return;
  if (!S.records.length) { body.innerHTML = '<p class="muted">尚未导入数据。</p>'; names.innerHTML = ''; return; }
  const srcEmps = srcEmployeeSet(src);
  let emps = S.roster.filter(e => employeeVisible(e) && srcEmps.has(e.name) && /一线/.test(e.attr || ''));
  if (!emps.length) emps = S.roster.filter(e => employeeVisible(e) && srcEmps.has(e.name));
  names.innerHTML = emps.map(e =>
    '<span class="chip' + (S.personSel.has(e.name) ? ' on' : '') + '" data-name="' + esc(e.name) + '">' + esc(e.name) + '</span>'
  ).join('');
  names.querySelectorAll('.chip').forEach(ch => {
    ch.addEventListener('click', () => {
      const n = ch.dataset.name;
      if (S.personSel.has(n)) S.personSel.delete(n); else S.personSel.add(n);
      ch.classList.toggle('on');
      renderPersonBody(src, emps);
    });
  });
  renderPersonBody(src, emps);
}
function renderPersonBody(src, emps) {
  const el = $('#peBody');
  if (!el) return;
  const names = Array.from(S.personSel).filter(n => emps.some(e => e.name === n));
  if (!names.length) { el.innerHTML = '<p class="muted">请选择员工。</p>'; return; }
  const metricKeys = getCheckedValues('#peMetric').filter(k => k !== 's30Rate');
  if (!metricKeys.length) { el.innerHTML = '<p class="muted">请至少选择一个指标。</p>'; return; }
  const rows = [];
  for (const n of names) {
    for (const mk of metricKeys) {
      const metric = METRIC_MAP[mk];
      const bg = METRIC_BG[mk] || '';
      const key = 'pe|' + n + '|' + mk;
      const expanded = S.expandedRows.has(key);
      const opts = { nameSet: new Set([n]) };
      const labelHtml =
        '<span class="row-name">' + esc(n) + '</span>' +
        '<span class="row-metric">' + esc(metricLabel(metric)) + '</span>';
      rows.push(rowHTMLSrcToggle(n + ' · ' + metricLabel(metric), src, metric, opts, bg, key, expanded, labelHtml));
      if (expanded) { const ex = renderExpandRows(src, opts, mk, key); for (const r of ex) rows.push(r); }
    }
  }
  const cols = timeCols();
  el.innerHTML = '<table><thead><tr><th>员工 / 指标</th>' +
    buildHeaderHTML(cols).replace('<th>指标</th>', '') +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  el.querySelectorAll('.row-toggle').forEach(sp => {
    sp.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = sp.dataset.key;
      if (S.expandedRows.has(key)) S.expandedRows.delete(key); else S.expandedRows.add(key);
      renderPersonBody(src, emps);
    });
  });
}

/* ==================== 团队看板 ==================== */
function buildGroups(allEmps) {
  const { group: sg, batch: sb, category: sc } = S.teamSel;
  const hasSel = sg.size || sb.size || sc.size;
  if (!hasSel) return [];
  const match = e => {
    if (sg.size && !sg.has(e.group || '—')) return false;
    if (sb.size && !sb.has(e.batch || '—')) return false;
    if (sc.size && !sc.has(categoryOf(e, S.month) || '—')) return false;
    return true;
  };
  const groups = [];
  if (allEmps.length) {
    if (sg.size) for (const g of Array.from(sg).sort()) groups.push({ label: '组别 · ' + g, names: allEmps.filter(e => (e.group||'—') === g && match(e)).map(e => e.name) });
    if (sb.size) for (const b of Array.from(sb).sort()) groups.push({ label: '批次 · ' + b, names: allEmps.filter(e => (e.batch||'—') === b && match(e)).map(e => e.name) });
    if (sc.size) for (const c of Array.from(sc).sort((a,b) => catSortKey(a)-catSortKey(b))) groups.push({ label: '分类 · ' + c, names: allEmps.filter(e => (categoryOf(e, S.month)||'—') === c && match(e)).map(e => e.name) });
  }
  return groups;
}
function renderTeam() {
  const bizEl = $('#tmBiz');
  const biz = (bizEl && bizEl.value) || '买手合作';
  const src = bizToSrc(biz);
  const dimsEl = $('#tmDims');
  const bodyEl = $('#tmBody');
  if (!dimsEl || !bodyEl) return;
  if (!S.records.length) { dimsEl.innerHTML = ''; bodyEl.innerHTML = '<p class="muted">尚未导入数据。</p>'; return; }
  const srcEmps = srcEmployeeSet(src);
  const allEmps = S.roster.filter(e => employeeVisible(e) && srcEmps.has(e.name));
  const dims = ['group','batch','category'];
  const dimLabel = { group:'组别', batch:'批次', category:'分类' };
  const dimHTML = dims.map(dim => {
    let vals;
    if (dim === 'category') {
      const set = new Set();
      for (const e of allEmps) set.add(categoryOf(e, S.month) || '—');
      vals = Array.from(set).sort((a,b) => catSortKey(a) - catSortKey(b));
    } else {
      const set = new Set();
      for (const e of allEmps) set.add(e[dim] || '—');
      vals = Array.from(set).sort();
    }
    const chips = vals.map(v => {
      const on = S.teamSel[dim].has(v);
      return '<span class="chip' + (on ? ' on' : '') + '" data-dim="' + dim + '" data-val="' + esc(v) + '">' + esc(v) + '</span>';
    }).join('');
    return '<div class="dim-row"><span class="dim-label">' + dimLabel[dim] + '</span><div class="chips" style="margin:0">' + chips + '</div></div>';
  }).join('');
  dimsEl.innerHTML = dimHTML;
  dimsEl.querySelectorAll('.chip').forEach(ch => {
    ch.addEventListener('click', () => {
      const dim = ch.dataset.dim, val = ch.dataset.val;
      const set = S.teamSel[dim];
      if (set.has(val)) set.delete(val); else set.add(val);
      ch.classList.toggle('on');
      renderTeamBody(src, allEmps);
    });
  });
  renderTeamBody(src, allEmps);
}
function renderTeamBody(src, allEmps) {
  const el = $('#tmBody');
  if (!el) return;
  const metricKeys = getCheckedValues('#tmMetric').filter(k => k !== 's30Rate');
  if (!metricKeys.length) { el.innerHTML = '<p class="muted">请至少选择一个指标。</p>'; return; }
  const groups = buildGroups(allEmps);
  const rows = [];
  for (const mk of metricKeys) {
    const metric = METRIC_MAP[mk];
    const bg = METRIC_BG[mk] || '';
    const overallKey = 'team|整体|' + mk;
    const overallExpanded = S.expandedRows.has(overallKey);
    const overallLabelHtml =
      '<span class="row-name">整体</span>' +
      '<span class="row-metric">' + esc(metricLabel(metric)) + '</span>';
    rows.push(rowHTMLSrcToggle('整体 · ' + metricLabel(metric), src, metric, null, bg, overallKey, overallExpanded, overallLabelHtml));
    if (overallExpanded) { const ex = renderExpandRows(src, null, mk, overallKey); for (const r of ex) rows.push(r); }
    for (const gr of groups) {
      if (!gr.names.length) continue;
      const key = 'team|' + gr.label + '|' + mk;
      const expanded = S.expandedRows.has(key);
      const opts = { nameSet: new Set(gr.names) };
      const grLabelHtml =
        '<span class="row-name">' + esc(gr.label) + '</span>' +
        '<span class="row-metric">' + esc(metricLabel(metric)) + '</span>';
      rows.push(rowHTMLSrcToggle(gr.label + ' · ' + metricLabel(metric), src, metric, opts, bg, key, expanded, grLabelHtml));
      if (expanded) { const ex = renderExpandRows(src, opts, mk, key); for (const r of ex) rows.push(r); }
    }
  }
  const cols = timeCols();
  el.innerHTML = '<table><thead><tr><th>维度 / 指标</th>' +
    buildHeaderHTML(cols).replace('<th>指标</th>', '') +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  el.querySelectorAll('.row-toggle').forEach(sp => {
    sp.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = sp.dataset.key;
      if (S.expandedRows.has(key)) S.expandedRows.delete(key); else S.expandedRows.add(key);
      renderTeamBody(src, allEmps);
    });
  });
}
function refreshTeamOptions() {
  const em = ensureChipContainer('tmMetric');
  if (!em) return;
  const teamMetrics = METRICS.filter(m => m.key !== 's30Rate');
  const selected = new Set(getCheckedValues('#tmMetric'));
  selected.delete('s30Rate');
  if (selected.size === 0 && teamMetrics.length > 0) selected.add(teamMetrics[0].key);

  em.innerHTML = teamMetrics.map(m =>
    '<span class="chip' + (selected.has(m.key) ? ' on' : '') +
    '" data-val="' + esc(m.key) + '">' + esc(metricLabel(m)) + '</span>'
  ).join('');

  em.querySelectorAll('.chip').forEach(ch => {
    ch.addEventListener('click', () => {
      ch.classList.toggle('on');
      renderTeam();
    });
  });
}

/* ==================== 30S 接起 ==================== */
function renderS30() {
  const bizEl = $('#s30Biz');
  const biz = (bizEl && bizEl.value) || '买手合作';
  const top = $('#s30Top');
  const dates = $('#s30Dates');
  const body = $('#s30Body');
  if (!top) return;
  if (!S.records.length) {
    top.innerHTML = '<p class="muted">尚未导入数据。</p>';
    if (dates) dates.innerHTML = '';
    if (body) body.innerHTML = '';
    return;
  }
  const cols = timeCols();
  const subMetrics = [
    { key:'s30Rate', label:'30s接起率', digits:2, pct:true, better:'up' },
    { key:'s30Num', label:'30S接起率-分子', digits:0, pct:false, better:'up' },
    { key:'s30Den', label:'30S接起率-分母', digits:0, pct:false, better:'up' },
    { key:'s30Miss', label:'30sMiss量', digits:0, pct:false, better:'down' },
  ];
  top.innerHTML = '<div class="table-scroll"><table><thead><tr>' + buildHeaderHTML(cols) + '</tr></thead><tbody>' +
    subMetrics.map(m => rowHTMLS30(m.label, biz, m)).join('') + '</tbody></table></div>';

  const dateSet = new Set();
  for (const r of S.records) if (r.biz === biz) dateSet.add(r.date);
  const allDates = Array.from(dateSet).sort();
  if (!allDates.length) {
    if (dates) dates.innerHTML = '';
    if (body) body.innerHTML = '';
    return;
  }
  if (dates) {
    renderS30DateSelector(dates, allDates, biz);
  }
  renderS30Body(biz);
}

/* ==================== 30S 接起 · 日期选择器（按月度折叠） ==================== */
function renderS30DateSelector(container, allDates, biz) {
  if (!S.s30MonthOpen) S.s30MonthOpen = new Set();

  const byMonth = new Map();
  for (const d of allDates) {
    const m = d.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(d);
  }
  const months = Array.from(byMonth.keys()).sort().reverse();

  for (const m of Array.from(S.s30MonthOpen)) if (!byMonth.has(m)) S.s30MonthOpen.delete(m);
  if (S.s30MonthOpen.size === 0 && months.length) S.s30MonthOpen.add(months[0]);

  const headBase = 'display:flex;align-items:center;gap:8px;padding:6px 10px;background:#F4F3EF;border-radius:8px;cursor:pointer;user-select:none;margin-bottom:6px;font-size:12.5px;';
  const btnBase  = 'font-size:11px;padding:1px 8px;border:1px solid #E5E1DA;background:#FFFFFF;border-radius:6px;cursor:pointer;color:#77778A;font-family:inherit;line-height:1.6;';

  let html = '';
  for (const m of months) {
    const list = byMonth.get(m).sort();
    const open = S.s30MonthOpen.has(m);
    const selCount = list.filter(d => S.s30Dates.has(d)).length;
    html += '<div style="margin-bottom:10px">';
    html += '<div class="s30-month-head" data-month="' + esc(m) + '" style="' + headBase + '">' +
      '<span style="color:#7B8FBF;font-size:10px;width:12px;display:inline-block;text-align:center">' + (open ? '▼' : '▶') + '</span>' +
      '<span style="font-weight:600;color:#33333D">📅 ' + esc(m) + '</span>' +
      '<span class="s30-month-meta" style="color:#77778A;font-size:11.5px">共 ' + list.length + ' 天，已选 ' + selCount + ' 天</span>' +
      '<span style="margin-left:auto;display:flex;gap:4px">' +
        '<button type="button" class="btn-mini" style="' + btnBase + '" data-act="all" data-month="' + esc(m) + '">全选</button>' +
        '<button type="button" class="btn-mini" style="' + btnBase + '" data-act="none" data-month="' + esc(m) + '">清空</button>' +
      '</span>' +
    '</div>';
    if (open) {
      html += '<div class="chips" style="margin:0">' + list.map(d => {
        const on = S.s30Dates.has(d);
        return '<span class="chip' + (on ? ' on' : '') + '" data-d="' + d + '">' + esc(d.slice(5)) + '</span>';
      }).join('') + '</div>';
    }
    html += '</div>';
  }
  container.innerHTML = html;

  container.querySelectorAll('.s30-month-head').forEach(head => {
    head.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const m = head.dataset.month;
      if (S.s30MonthOpen.has(m)) S.s30MonthOpen.delete(m);
      else S.s30MonthOpen.add(m);
      renderS30DateSelector(container, allDates, biz);
      renderS30Body(biz);
    });
  });

  container.querySelectorAll('button.btn-mini').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const m = btn.dataset.month;
      const act = btn.dataset.act;
      const list = byMonth.get(m) || [];
      if (act === 'all') list.forEach(d => S.s30Dates.add(d));
      else list.forEach(d => S.s30Dates.delete(d));

      const head = container.querySelector('.s30-month-head[data-month="' + m + '"]');
      if (head) {
        const meta = head.querySelector('.s30-month-meta');
        const selCount = list.filter(x => S.s30Dates.has(x)).length;
        if (meta) meta.textContent = '共 ' + list.length + ' 天，已选 ' + selCount + ' 天';
        const block = head.parentNode;
        if (block) {
          block.querySelectorAll('.chip').forEach(ch => {
            ch.classList.toggle('on', S.s30Dates.has(ch.dataset.d));
          });
        }
      }
      renderS30Body(biz);
    });
  });

  container.querySelectorAll('.chip').forEach(ch => {
    ch.addEventListener('click', () => {
      const d = ch.dataset.d;
      if (S.s30Dates.has(d)) S.s30Dates.delete(d);
      else S.s30Dates.add(d);
      ch.classList.toggle('on');

      const m = d.slice(0, 7);
      const list = byMonth.get(m) || [];
      const selCount = list.filter(x => S.s30Dates.has(x)).length;
      const meta = container.querySelector('.s30-month-head[data-month="' + m + '"] .s30-month-meta');
      if (meta) meta.textContent = '共 ' + list.length + ' 天，已选 ' + selCount + ' 天';

      renderS30Body(biz);
    });
  });
}

function renderS30Body(biz) {
  const el = $('#s30Body');
  if (!el) return;

  const btnSum = $('#btnS30Sum');
  if (btnSum) {
    btnSum.textContent = S.s30ShowSummary ? '隐藏日汇总' : '显示日汇总';
    btnSum.onclick = () => {
      S.s30ShowSummary = !S.s30ShowSummary;
      btnSum.textContent = S.s30ShowSummary ? '隐藏日汇总' : '显示日汇总';
      renderS30Body(biz);
    };
  }

  const dates = Array.from(S.s30Dates).sort();
  if (!dates.length) { el.innerHTML = '<p class="muted">请选择日期。</p>'; return; }

  const bgMap = {};
  dates.forEach((d, i) => bgMap[d] = DATE_BG[i % DATE_BG.length]);
  const forecastMap = (biz === '买手合作') ? S.forecastBuyer : S.forecastBlogger;
  const hasFc = !!(forecastMap && Object.keys(forecastMap).length);

  const map = {};
  for (const r of S.records) {
    if (r.biz !== biz) continue;
    if (!S.s30Dates.has(r.date)) continue;
    const key = r.date + '|' + (r.period || '—');
    if (!map[key]) map[key] = { date: r.date, period: r.period || '—', num: 0, den: 0 };
    map[key].num += r.s30Num;
    map[key].den += r.s30Den;
  }
  const list = Object.values(map).sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return String(a.period).localeCompare(String(b.period));
  });

  const groups = [];
  const gIdx = new Map();
  for (const x of list) {
    let g = gIdx.get(x.date);
    if (!g) {
      g = { date: x.date, rows: [], num: 0, den: 0, forecast: 0, hasFc: false };
      gIdx.set(x.date, g);
      groups.push(g);
    }
    g.rows.push(x);
    g.num += x.num;
    g.den += x.den;
    if (hasFc) {
      const fc = forecastMap[x.date + '|' + normPeriod(x.period)];
      if (fc != null && isFinite(fc) && fc > 0) { g.forecast += fc; g.hasFc = true; }
    }
  }

  const head = '<tr><th>日期 | 时段</th><th>30s接起率</th><th>30S接起率-分子</th><th>30S接起率-分母</th><th>30sMiss量</th>' +
    (hasFc ? '<th>时段预测量</th><th>预测偏差</th>' : '') + '</tr>';

  const renderFc = (forecast, den) => {
    let fcDisp = '—', biasDisp = '—', biasCls = '';
    if (forecast != null && isFinite(forecast) && forecast > 0) {
      fcDisp = String(Math.round(forecast * 100) / 100);
      const bias = (den / forecast) * 100;
      if (isFinite(bias)) {
        biasDisp = bias.toFixed(2) + '%';
        if (bias > 120) biasCls = 'bias-over';
      }
    }
    return {
      fc: fcDisp,
      bias: biasCls ? '<span class="' + biasCls + '">' + biasDisp + '</span>' : biasDisp
    };
  };

  const showSum = S.s30ShowSummary !== false;
  const bodyParts = [];
  for (const g of groups) {
    const bg = bgMap[g.date] || '#fff';
    const darkBg = darkenColor(bg, 0.86);

    if (showSum) {
      const sumStyle = ' style="background:' + darkBg +
        ';font-weight:700;font-size:14px;' +
        'border-top:2px solid #B0ADA4;border-bottom:1px solid #C9C6BE"';
      const sumRate = g.den > 0 ? g.num / g.den : null;
      const sumMiss = g.den - g.num;
      let sumExtra = '';
      if (hasFc) {
        const f = renderFc(g.hasFc ? g.forecast : null, g.den);
        sumExtra = '<td' + sumStyle + '>' + f.fc + '</td><td' + sumStyle + '>' + f.bias + '</td>';
      }
      bodyParts.push(
        '<tr>' +
          '<td' + sumStyle + '>📅 ' + esc(g.date) + ' 当日汇总</td>' +
          '<td' + sumStyle + '>' + rateSpan(sumRate, biz) + '</td>' +
          '<td' + sumStyle + '>' + Math.round(g.num) + '</td>' +
          '<td' + sumStyle + '>' + Math.round(g.den) + '</td>' +
          '<td' + sumStyle + '>' + Math.round(sumMiss) + '</td>' +
          sumExtra +
        '</tr>'
      );
    }

    for (const x of g.rows) {
      const r = x.den > 0 ? x.num / x.den : null;
      const m = x.den - x.num;
      const style = ' style="background:' + bg + '"';
      let extra = '';
      if (hasFc) {
        const fc = forecastMap[x.date + '|' + normPeriod(x.period)];
        const f = renderFc(fc, x.den);
        extra = '<td' + style + '>' + f.fc + '</td><td' + style + '>' + f.bias + '</td>';
      }
      bodyParts.push(
        '<tr>' +
          '<td' + style + '>' + esc(x.date) + ' | ' + esc(x.period) + '</td>' +
          '<td' + style + '>' + rateSpan(r, biz) + '</td>' +
          '<td' + style + '>' + Math.round(x.num) + '</td>' +
          '<td' + style + '>' + Math.round(x.den) + '</td>' +
          '<td' + style + '>' + Math.round(m) + '</td>' +
          extra +
        '</tr>'
      );
    }
  }

  el.innerHTML = '<table><thead>' + head + '</thead><tbody>' + bodyParts.join('') + '</tbody></table>';
}

/* ==================== 二级打点 AHT ==================== */
function renderAHT2() {
  const el = $('#a2Body');
  if (!el) return;
  el.classList.remove('table-scroll');
  el.style.overflow = 'visible';
  el.style.maxHeight = 'none';
  el.style.border = 'none';
  el.style.borderRadius = '0';
  el.style.background = 'transparent';
  el.style.position = 'static';

  const bizEl = $('#a2Biz');
  const biz = (bizEl && bizEl.value) || '买手合作';
  if (!S.records.length) { el.innerHTML = '<p class="muted">尚未导入数据。</p>'; return; }
  const wkNow = S.latestWK || 1;
  const wkPrev = wkNow - 1;

  function bizAHT(wk) {
    const recs = S.records.filter(r => r.biz2 === biz && r.wk === wk);
    let aht = 0, volume = 0;
    for (const r of recs) { aht += r.aht || 0; volume += r.volume || 0; }
    return { aht, volume, ahtRate: volume > 0 ? aht / volume : null };
  }

  const combos = new Map();
  for (const r of S.records) {
    if (r.biz2 !== biz) continue;
    if (r.wk !== wkNow && r.wk !== wkPrev) continue;
    const l1 = r.l1 || '';
    const l2 = r.l2 || '';
    if (!l1 && !l2) continue;
    const key = l1 + '|' + l2;
    if (!combos.has(key)) combos.set(key, { l1, l2, ahtNow:0, volumeNow:0, ahtPrev:0, volumePrev:0 });
    const o = combos.get(key);
    if (r.wk === wkNow) { o.ahtNow += r.aht || 0; o.volumeNow += r.volume || 0; }
    if (r.wk === wkPrev) { o.ahtPrev += r.aht || 0; o.volumePrev += r.volume || 0; }
  }
  const fixedOrder = biz === '买手合作' ? BUYER_AHT2_ORDER : biz === '博主合作' ? BLOGGER_AHT2_ORDER : null;
  if (fixedOrder) {
    const have = new Set(Array.from(combos.values()).map(o => aht2Key(o.l1, o.l2)));
    for (const [l1, l2] of fixedOrder) {
      const k = aht2Key(l1, l2);
      if (have.has(k)) continue;
      have.add(k);
      combos.set(l1 + '|' + l2, { l1, l2, ahtNow:0, volumeNow:0, ahtPrev:0, volumePrev:0 });
    }
  }
  const bizNow = bizAHT(wkNow);
  const bizPrev = bizAHT(wkPrev);
  const summary = '<div class="summary-grid" style="margin-bottom:14px">' +
    '<div class="sum-item"><div class="k">业务线 · WK' + wkPrev + ' AHT</div><div class="v">' + (bizPrev.ahtRate == null ? '—' : bizPrev.ahtRate.toFixed(2)) + '</div></div>' +
    '<div class="sum-item"><div class="k">业务线 · WK' + wkNow + ' AHT</div><div class="v">' + (bizNow.ahtRate == null ? '—' : bizNow.ahtRate.toFixed(2)) + '</div></div>' +
    '<div class="sum-item"><div class="k">业务线 · WK' + wkPrev + ' 服务量</div><div class="v">' + Math.round(bizPrev.volume) + '</div></div>' +
    '<div class="sum-item"><div class="k">业务线 · WK' + wkNow + ' 服务量</div><div class="v">' + Math.round(bizNow.volume) + '</div></div>' +
    '</div>';
  const header = '<tr><th>二级打点</th>' +
    '<th>WK' + wkPrev + ' 处理时长</th><th>WK' + wkNow + ' 处理时长</th>' +
    '<th>WK' + wkPrev + ' 服务量</th><th>WK' + wkNow + ' 服务量</th>' +
    '<th>WK' + wkPrev + ' AHT</th><th>WK' + wkNow + ' AHT</th>' +
    '<th>AHT 环比</th><th>服务量 环比</th><th>影响值</th></tr>';
  const list = Array.from(combos.values());
  if (fixedOrder) {
    const orderIdx = new Map(fixedOrder.map(([l1, l2], i) => [aht2Key(l1, l2), i]));
    list.sort((a, b) => {
      const ai = orderIdx.get(aht2Key(a.l1, a.l2));
      const bi = orderIdx.get(aht2Key(b.l1, b.l2));
      if (ai != null && bi != null) return ai - bi;
      if (ai != null) return -1;
      if (bi != null) return 1;
      return (b.ahtNow + b.ahtPrev) - (a.ahtNow + a.ahtPrev);
    });
  } else list.sort((a, b) => (b.ahtNow + b.ahtPrev) - (a.ahtNow + a.ahtPrev));

  const rows = list.map(o => {
    const ahtNow = o.volumeNow > 0 ? o.ahtNow / o.volumeNow : null;
    const ahtPrev = o.volumePrev > 0 ? o.ahtPrev / o.volumePrev : null;
    let dAHTHtml = '—';
    if (ahtNow != null && ahtPrev != null) {
      const d = ahtNow - ahtPrev;
      const cls = d > 0 ? 'delta-down' : (d < 0 ? 'delta-up' : 'delta-flat');
      const arrow = d > 0 ? '↑' : (d < 0 ? '↓' : '');
      dAHTHtml = '<span class="' + cls + '">' + arrow + ' ' + Math.abs(d).toFixed(2) + '</span>';
    }
    const dVol = o.volumeNow - o.volumePrev;
    let dVolHtml;
    if (Math.abs(dVol) < 1e-9) dVolHtml = '<span class="delta-flat">0</span>';
    else {
      const clsV = dVol > 0 ? 'delta-up' : 'delta-down';
      const arrowV = dVol > 0 ? '↑' : '↓';
      dVolHtml = '<span class="' + clsV + '">' + arrowV + ' ' + Math.abs(Math.round(dVol)) + '</span>';
    }
    let impactHtml = '—';
    if (ahtNow != null && bizNow.ahtRate != null) {
      const newAhtTotal = bizNow.aht - o.ahtNow;
      const newVolTotal = bizNow.volume - o.volumeNow;
      if (newVolTotal > 0) {
        const newRate = newAhtTotal / newVolTotal;
        const impact = newRate - bizNow.ahtRate;
        const cls = impact > 0 ? 'delta-up' : (impact < 0 ? 'delta-down' : 'delta-flat');
        const arrow = impact > 0 ? '↑' : (impact < 0 ? '↓' : '');
        impactHtml = '<span class="' + cls + '">' + arrow + ' ' + Math.abs(impact).toFixed(2) + '</span>';
      }
    }
    const l2Cell =
      '<td>' +
        '<div class="aht2-l2">' + esc(o.l2 || '—') + '</div>' +
        (o.l1 ? '<div class="aht2-l1">' + esc(o.l1) + '</div>' : '') +
      '</td>';
    return '<tr>' + l2Cell +
      '<td>' + (o.ahtPrev === 0 ? '—' : o.ahtPrev.toFixed(2)) + '</td>' +
      '<td>' + (o.ahtNow === 0 ? '—' : o.ahtNow.toFixed(2)) + '</td>' +
      '<td>' + fmtInt(o.volumePrev) + '</td>' +
      '<td>' + fmtInt(o.volumeNow) + '</td>' +
      '<td>' + (ahtPrev == null ? '—' : ahtPrev.toFixed(2)) + '</td>' +
      '<td>' + (ahtNow == null ? '—' : ahtNow.toFixed(2)) + '</td>' +
      '<td>' + dAHTHtml + '</td>' +
      '<td>' + dVolHtml + '</td>' +
      '<td>' + impactHtml + '</td>' +
    '</tr>';
  }).join('');
  el.innerHTML = summary + '<div class="table-scroll"><table><thead>' + header + '</thead><tbody>' + rows + '</tbody></table></div>';
}

/* ==================== SLA 达成 ==================== */
function renderSLA() {
  const el = $('#slaBody');
  if (!el) return;
  const bizEl = $('#slaBiz');
  const biz = (bizEl && bizEl.value) || '买手合作';
  const src = bizToSrc(biz);
  const rawList = (src === 'buyer') ? S.slaBuyer : S.slaBlogger;
  if (!rawList || !rawList.length) {
    el.innerHTML = '<p class="muted">尚未导入「' + (src === 'buyer' ? '买手' : '博主') + '员工SLA」数据，或该 sheet 为空。</p>';
    return;
  }

  const curMonth = S.month ? parseInt(S.month.slice(5,7), 10) : null;
  const monthLabel = curMonth != null ? curMonth + '月' : '—';
  const list = rawList.filter(it => curMonth != null && it.months[curMonth]);

  const headInfo = '<p class="muted" style="margin-bottom:8px">当前数据月份：<b>' + monthLabel +
    '</b>，自动读取对应月份的权重 / 目标 / 得分。未达最低档位时按最低档位保底计算。</p>';

  if (!list.length) {
    el.innerHTML = headInfo + '<p class="muted">当前月份没有匹配的 SLA 数据。</p>';
    return;
  }

  const computed = list.map(item => {
    const key = matchMetricKey(item.metric);
    const cfg = item.months[curMonth];
    const actual = key ? slaAchieve(src, key, item.category) : null;
    const score = calcSlaScore(key, actual, cfg);
    return { item, key, cfg, actual, score };
  });

  let totalScore = 0, totalWeight = 0, scored = 0, maxPossible = 0;
  for (const c of computed) {
    if (c.score.finalScore != null) { totalScore += c.score.finalScore; scored++; }
    if (c.score.weight != null) totalWeight += c.score.weight;
    if (c.cfg.tiers.length && c.cfg.weight != null) {
      const maxPts = Math.max.apply(null, c.cfg.tiers.map(t => t.points));
      maxPossible += maxPts * c.cfg.weight;
    }
  }

  const hasScore = scored > 0;
  const scoreCard = hasScore
    ? '<div class="rp-kpis" style="margin-bottom:14px">' +
        '<div class="rp-kpi" style="border-left-color:#7B8FBF"><div class="k">SLA 总分</div><div class="v">' + totalScore.toFixed(2) + '</div>' +
          '<div class="d">满分 ' + maxPossible.toFixed(2) + '</div></div>' +
        '<div class="rp-kpi" style="border-left-color:#7CAE8B"><div class="k">达成率</div><div class="v">' +
          (maxPossible > 0 ? (totalScore / maxPossible * 100).toFixed(1) + '%' : '—') + '</div>' +
          '<div class="d">得分 / 满分</div></div>' +
        '<div class="rp-kpi"><div class="k">权重合计</div><div class="v">' + (totalWeight * 100).toFixed(2) + '%</div>' +
          '<div class="d">' + scored + ' / ' + computed.length + ' 项已计分</div></div>' +
      '</div>'
    : '';

  const rows = computed.map(c => {
    const it = c.item;
    const sc = c.score;
    const isPct = sc.isPct;
    const wDisp = c.cfg.weight != null ? (c.cfg.weight * 100).toFixed(2) + '%' : '—';

    let tDisp = '—';
    if (sc.threshold != null) tDisp = isPct ? (sc.threshold * 100).toFixed(2) + '%' : sc.threshold.toFixed(2);

    let aDisp = '—';
    if (sc.actualDisp != null) aDisp = isPct ? (sc.actualDisp * 100).toFixed(2) + '%' : sc.actualDisp.toFixed(2);

    let rateDisp = '—';
    if (sc.achieveRate != null) rateDisp = (sc.achieveRate * 100).toFixed(2) + '%';

    const pointsDisp = sc.points != null ? sc.points.toFixed(2) : '—';
    const scoreDisp = sc.finalScore != null ? sc.finalScore.toFixed(2) : '—';

    let statusBadge = '<span class="delta-flat">—</span>';
    if (sc.points != null) {
      if (sc.belowLowest) {
        statusBadge = '<span class="rp-badge warn">未达最低档（按最低档计）</span>';
      } else {
        const tiers = c.cfg.tiers;
        const maxPts = Math.max.apply(null, tiers.map(t => t.points));
        const isTop = tiers.length && sc.points === maxPts;
        statusBadge = isTop ? '<span class="rp-badge ok">满档</span>' : '<span class="rp-badge flat">档位</span>';
      }
    }
    const metricDisp = esc(it.metric) + (c.key ? '' : '<span class="sla-unknown">（未识别）</span>');

    return '<tr>' +
      '<td>' + metricDisp + '</td>' +
      '<td>' + esc(it.category) + '</td>' +
      '<td>' + wDisp + '</td>' +
      '<td>' + tDisp + '</td>' +
      '<td>' + aDisp + '</td>' +
      '<td>' + rateDisp + '</td>' +
      '<td>' + pointsDisp + '</td>' +
      '<td>' + scoreDisp + '</td>' +
      '<td>' + statusBadge + '</td>' +
    '</tr>';
  }).join('');

  el.innerHTML = headInfo + scoreCard +
    '<div class="table-scroll"><table class="rp-table"><thead><tr>' +
      '<th>指标</th><th>分类</th><th>权重</th>' +
      '<th>目标</th><th>实际</th><th>达成率</th>' +
      '<th>档位分</th><th>最终得分</th><th>状态</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

/* ==================== 出勤看板 ==================== */
function renderAttendance() {
  const el = $('#attBody');
  if (!el) return;
  const nameEl = $('#attName');
  const name = nameEl && nameEl.value;
  if (!name) { el.innerHTML = '<p class="muted">请选择员工。</p>'; return; }
  if (!S.month) { el.innerHTML = '<p class="muted">尚未导入数据。</p>'; return; }
  const emp = getEmp(name);
  if (!emp) { el.innerHTML = '<p class="muted">未在花名册中找到此员工。</p>'; return; }
  const [y, m] = S.month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const days = [];
  for (let i = 1; i <= daysInMonth; i++) days.push(S.month + '-' + pad2(i));
  let monthTotal = 0;
  for (const d of days) monthTotal += attOf(name, d);
  const lastWK = S.latestWK || 1;
  const wkList = [lastWK-2, lastWK-1, lastWK];
  const wkDates = {};
  for (const w of wkList) wkDates[w] = [];
  for (const d of days) { const w = wkOf(d); if (wkDates[w]) wkDates[w].push(d); }
  const wkTotals = wkList.map(w => ({ w, total: wkDates[w].reduce((s, d) => s + attOf(name, d), 0) }));
  const cols = timeCols();
  const last7 = cols.last7.map(d => ({ d, v: attOf(name, d) }));

  const dayCards = days.map(d => {
    const v = attOf(name, d);
    const shift = (S.schedule[name] || {})[d] || '';
    const ov = S.attOverride[name] && S.attOverride[name][d] !== undefined;
    return '<div class="att-day"><div class="d">' + d.slice(5) + '</div>' +
      '<input type="number" inputmode="decimal" step="0.01" min="0" max="1" value="' + v.toFixed(2) + '" data-d="' + d + '">' +
      '<div class="shift">' + esc(shift) + (ov ? ' ✎' : '') + '</div></div>';
  }).join('');

  el.innerHTML = '<div class="att-stat">' +
    '<div class="item"><div class="k">月度出勤天数</div><div class="v">' + monthTotal.toFixed(2) + '</div></div>' +
    wkTotals.map(x => '<div class="item"><div class="k">WK' + x.w + ' 出勤天数</div><div class="v">' + x.total.toFixed(2) + '</div></div>').join('') +
    '</div><h3 class="sub-title">近 7 天每日出勤</h3><div class="att-stat">' +
    last7.map(x => '<div class="item"><div class="k">' + x.d.slice(5) + '</div><div class="v">' + x.v.toFixed(2) + '</div></div>').join('') +
    '</div><h3 class="sub-title">当月每日出勤（可手动调整 0~1）</h3><div class="att-day-grid">' + dayCards + '</div>';

  el.querySelectorAll('.att-day input').forEach(inp => {
    inp.addEventListener('change', () => {
      const d = inp.dataset.d;
      let v = parseFloat(inp.value);
      if (isNaN(v)) v = 0;
      v = Math.max(0, Math.min(1, v));
      v = Math.round(v * 100) / 100;
      inp.value = v.toFixed(2);
      if (!S.attOverride[name]) S.attOverride[name] = {};
      S.attOverride[name][d] = v;
      persistMemo();
      renderAttendance();
      refreshAll();
    });
  });
}

/* ==================== 导出图片 ==================== */
function refreshExportOptions() {
  const em = ensureChipContainer('exMetric');
  if (em) {
    const selectedMetrics = new Set(getCheckedValues('#exMetric'));
    if (selectedMetrics.size === 0 && METRICS.length > 0) selectedMetrics.add(METRICS[0].key);
    em.innerHTML = METRICS.map(m =>
      '<span class="chip' + (selectedMetrics.has(m.key) ? ' on' : '') + '" data-val="' + esc(m.key) + '">' + esc(metricLabel(m)) + '</span>'
    ).join('');
  }
  const fillChips = (id, values, sortFn) => {
    const sel = ensureChipContainer(id);
    if (!sel) return;
    const current = new Set(getCheckedValues('#' + id));
    const uniq = Array.from(new Set(values)).filter(Boolean);
    if (sortFn) uniq.sort(sortFn); else uniq.sort();
    sel.innerHTML = uniq.map(v =>
      '<span class="chip' + (current.has(v) ? ' on' : '') + '" data-val="' + esc(v) + '">' + esc(v) + '</span>'
    ).join('');
  };
  const bizEl = $('#exBiz');
  const biz = (bizEl && bizEl.value) || '买手合作';
  const src = bizToSrc(biz);
  const srcEmps = srcEmployeeSet(src);
  const empsForChips = S.roster.filter(e => srcEmps.has(e.name));
  fillChips('exGroup', empsForChips.map(e => e.group || '—'));
  fillChips('exBatch', empsForChips.map(e => e.batch || '—'));
  fillChips('exCategory', empsForChips.map(e => categoryOf(e, S.month) || '—'), (a, b) => catSortKey(a) - catSortKey(b));
  for (const id of ['exMetric','exGroup','exBatch','exCategory']) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    sel.querySelectorAll('.chip').forEach(ch => { ch.addEventListener('click', () => ch.classList.toggle('on')); });
  }
}

function buildExportCanvas() {
  const bizEl = $('#exBiz');
  const biz = (bizEl && bizEl.value) || '买手合作';
  const src = bizToSrc(biz);
  const metricKeys = getCheckedValues('#exMetric');
  const groups = getCheckedValues('#exGroup');
  const batches = getCheckedValues('#exBatch');
  const cats = getCheckedValues('#exCategory');
  if (!metricKeys.length) { alert('请至少选择一个指标'); return null; }
  const srcEmps = srcEmployeeSet(src);
  const allEmps = S.roster.filter(e => employeeVisible(e) && srcEmps.has(e.name));
  const groupRows = [];
  if (groups.length || batches.length || cats.length) {
    for (const g of groups) {
      const names = allEmps.filter(e => (e.group || '—') === g).map(e => e.name);
      if (names.length) groupRows.push({ label: '组别 · ' + g, names });
    }
    for (const b of batches) {
      const names = allEmps.filter(e => (e.batch || '—') === b).map(e => e.name);
      if (names.length) groupRows.push({ label: '批次 · ' + b, names });
    }
    for (const c of cats) {
      const names = allEmps.filter(e => (categoryOf(e, S.month) || '—') === c).map(e => e.name);
      if (names.length) groupRows.push({ label: '分类 · ' + c, names });
    }
  } else {
    for (const e of allEmps) groupRows.push({ label: e.name, names: [e.name] });
  }
  const cols = timeCols();
  const header = ['指标', cols.monthLabel];
  for (const w of cols.wks) header.push('WK' + w);
  header.push('WK' + cols.wks[1] + '−WK' + cols.wks[0]);
  header.push('WK' + cols.wks[2] + '−WK' + cols.wks[1]);
  for (const d of cols.last7) header.push(d.slice(5));

  const rows = [{ cells: header, bg: '#E8EDF3' }];
  for (const mk of metricKeys) {
    const metric = METRIC_MAP[mk];
    const bg = METRIC_BG[mk] || '#ffffff';
    const m = calcBySrc(src, { monthSet: new Set([S.month]) });
    const wkA = cols.wks.map(w => calcBySrc(src, { wkSet: new Set([w]) }));
    const dayA = cols.last7.map(d => calcBySrc(src, { dateSet: new Set([d]) }));
    const row = ['整体 · ' + metricLabel(metric), fmtVal(m[mk], metric)];
    for (const w of wkA) row.push(fmtVal(w[mk], metric));
    row.push(diffText(wkA[1][mk], wkA[0][mk], metric));
    row.push(diffText(wkA[2][mk], wkA[1][mk], metric));
    for (const d of dayA) row.push(fmtVal(d[mk], metric));
    rows.push({ cells: row, bg });
  }
  rows.push({ cells: new Array(header.length).fill(''), bg: '#ffffff' });
  for (const mk of metricKeys) {
    const metric = METRIC_MAP[mk];
    const bg = METRIC_BG[mk] || '#ffffff';
    for (const gr of groupRows) {
      const nameSet = new Set(gr.names);
      const m = calcBySrc(src, { nameSet, monthSet: new Set([S.month]) });
      const wkA = cols.wks.map(w => calcBySrc(src, { nameSet, wkSet: new Set([w]) }));
      const dayA = cols.last7.map(d => calcBySrc(src, { nameSet, dateSet: new Set([d]) }));
      const row = [gr.label + ' · ' + metricLabel(metric), fmtVal(m[mk], metric)];
      for (const w of wkA) row.push(fmtVal(w[mk], metric));
      row.push(diffText(wkA[1][mk], wkA[0][mk], metric));
      row.push(diffText(wkA[2][mk], wkA[1][mk], metric));
      for (const d of dayA) row.push(fmtVal(d[mk], metric));
      rows.push({ cells: row, bg });
    }
    rows.push({ cells: new Array(header.length).fill(''), bg: '#ffffff' });
  }

  const scale = 2, pad = 24, titleH = 50, cellH = 30, firstW = 220, cellW = 115;
  const totalW = pad * 2 + firstW + (header.length - 1) * cellW;
  const totalH = pad * 2 + titleH + rows.length * cellH;
  const cv = document.createElement('canvas');
  cv.width = totalW * scale;
  cv.height = totalH * scale;
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, totalW, totalH);
  ctx.fillStyle = '#7B8FBF';
  ctx.font = 'bold 16px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('创作者数据分析 · ' + biz + ' · ' + S.month, pad, pad + 18);
  const y0 = pad + titleH;
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  for (let c = 0; c < header.length; c++) {
    const x = pad + (c === 0 ? 0 : firstW + (c-1) * cellW);
    const w = c === 0 ? firstW : cellW;
    ctx.fillStyle = '#F5F4F0';
    ctx.fillRect(x, y0, w, cellH);
    ctx.strokeStyle = '#E5E1DA';
    ctx.strokeRect(x, y0, w, cellH);
    ctx.fillStyle = '#7A7A87';
    ctx.fillText(String(header[c]), x + w / 2, y0 + cellH / 2);
  }
  ctx.font = '12px sans-serif';
  for (let r = 1; r < rows.length; r++) {
    const rowObj = rows[r];
    const row = rowObj.cells;
    const rowBg = rowObj.bg || '#ffffff';
    const y = y0 + r * cellH;
    for (let c = 0; c < header.length; c++) {
      const x = pad + (c === 0 ? 0 : firstW + (c-1) * cellW);
      const w = c === 0 ? firstW : cellW;
      ctx.fillStyle = rowBg;
      ctx.fillRect(x, y, w, cellH);
      ctx.strokeStyle = '#EBE8E1';
      ctx.strokeRect(x, y, w, cellH);
      const txt = row[c] == null ? '' : String(row[c]);
      ctx.fillStyle = '#3A3A44';
      ctx.textAlign = 'center';
      if (txt.startsWith('↑')) ctx.fillStyle = '#7CAE8B';
      else if (txt.startsWith('↓')) ctx.fillStyle = '#D48A8A';
      ctx.fillText(txt, x + w / 2, y + cellH / 2);
    }
  }
  return cv;
}
function previewExport() {
  const cv = buildExportCanvas();
  if (!cv) return;
  const box = $('#exPreview');
  if (!box) return;
  box.innerHTML = '';
  if (_lastBlobUrl) { URL.revokeObjectURL(_lastBlobUrl); _lastBlobUrl = null; }
  cv.toBlob(blob => {
    _lastBlobUrl = URL.createObjectURL(blob);
    const img = document.createElement('img');
    img.src = _lastBlobUrl;
    box.appendChild(img);
    const btn = $('#btnExport');
    if (btn) btn.disabled = false;
  }, 'image/png');
}
function downloadExport() {
  if (!_lastBlobUrl) { alert('请先生成预览'); return; }
  const bizEl = $('#exBiz');
  const biz = (bizEl && bizEl.value) || '买手合作';
  const a = document.createElement('a');
  a.href = _lastBlobUrl;
  a.download = 'creator-analytics-' + biz + '-' + S.month + '.png';
  a.click();
}

/* ============================================================
   END OF dashboard-views.js
   ============================================================ */