/* ============================================================
   创作者数据分析 · 时段预测视图 + AI 深度分析层
   ============================================================ */
'use strict';

/* ==================== XLSX 生成工具（无第三方依赖） ==================== */
function _colLetter(n) {
  let s = '';
  n = Number(n) || 0;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || 'A';
}
function _escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
function _crc32(bytes) {
  if (!_crc32._table) {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    _crc32._table = t;
  }
  const table = _crc32._table;
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function _zipBuild(files) {
  const enc = new TextEncoder();
  const parts = [];
  const cd = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = f.data instanceof Uint8Array ? f.data : enc.encode(String(f.data));
    const crc = _crc32(data);
    const size = data.length;

    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x21, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);
    parts.push(lh, data);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    cd.push(ch);

    offset += lh.length + size;
  }
  let cdSize = 0;
  for (const c of cd) cdSize += c.length;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, cd.length, true);
  ev.setUint16(10, cd.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);
  return new Blob([...parts, ...cd, eocd], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

const _XLSX_STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2">' +
      '<font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="2">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
    '</fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function _buildSheetXml(rows, opts) {
  opts = opts || {};
  const parts = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  ];
  if (opts.cols && opts.cols.length) {
    parts.push('<cols>');
    for (const c of opts.cols) {
      parts.push('<col min="' + c.min + '" max="' + c.max + '" width="' + c.width + '" customWidth="1"/>');
    }
    parts.push('</cols>');
  }
  parts.push('<sheetData>');
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    if (!row) continue;
    parts.push('<row r="' + (ri + 1) + '">');
    for (let ci = 0; ci < row.length; ci++) {
      const cell = row[ci];
      if (cell == null) continue;
      const ref = _colLetter(ci + 1) + (ri + 1);
      const s = cell.s != null ? cell.s : 0;
      if (cell.t === 'n' && cell.v !== '' && cell.v != null && isFinite(cell.v)) {
        parts.push('<c r="' + ref + '" s="' + s + '"><v>' + cell.v + '</v></c>');
      } else {
        const txt = cell.v == null ? '' : String(cell.v);
        if (txt === '') continue;
        parts.push('<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + _escXml(txt) + '</t></is></c>');
      }
    }
    parts.push('</row>');
  }
  parts.push('</sheetData>');
  if (opts.merges && opts.merges.length) {
    parts.push('<mergeCells count="' + opts.merges.length + '">');
    for (const m of opts.merges) parts.push('<mergeCell ref="' + m + '"/>');
    parts.push('</mergeCells>');
  }
  parts.push('</worksheet>');
  return parts.join('');
}

function buildXlsxBlob(sheetName, rows, opts) {
  opts = opts || {};
  const enc = new TextEncoder();
  const files = [];

  files.push({
    name: '[Content_Types].xml',
    data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>'
    )
  });
  files.push({
    name: '_rels/.rels',
    data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>'
    )
  });
  files.push({
    name: 'xl/workbook.xml',
    data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="' + _escXml(sheetName) + '" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>'
    )
  });
  files.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>'
    )
  });
  files.push({ name: 'xl/styles.xml', data: enc.encode(_XLSX_STYLES_XML) });
  files.push({ name: 'xl/worksheets/sheet1.xml', data: enc.encode(_buildSheetXml(rows, opts)) });
  return _zipBuild(files);
}

/* ★ 根据数据实际覆盖的时间范围，动态生成「样本周数」下拉选项。
   规则：
     · 基础候选：2 / 4 / 6 / 8 / 12 / 16 / 24 / 26 / 52 周
     · 只保留 <= 数据覆盖周数的项
     · 数据不足 2 周 → 只放「近 N 周（全部数据）」
     · 数据超过 52 周 → 追加「近 N 周（全部数据）」项
   调用时机：在 renderForecastConfig 开头调用，确保数据变化后选项同步刷新。 */
function renderForecastSampleWeeksOptions() {
  const el = document.getElementById('fcSampleWeeks');
  if (!el) return;

  /* 1. 收集所有有日期的数据 */
  const dateSet = new Set();
  for (const r of S.records)     if (r.date) dateSet.add(r.date);
  for (const r of S.wtRecords)   if (r.date) dateSet.add(r.date);
  for (const r of S.inspections) if (r.date) dateSet.add(r.date);
  const dates = Array.from(dateSet).sort();
  if (!dates.length) return;   /* 无数据时保持原样 */

  /* 2. 计算覆盖天数与最大可选周数 */
  const earliest = dates[0];
  const latest   = dates[dates.length - 1];
  const days     = _dateDiffDays(earliest, latest) + 1;   /* 两端都算 */
  const maxWeeks = Math.max(1, Math.floor(days / 7));

  /* 3. 生成候选周数列表 */
  const baseList = [2, 4, 6, 8, 12, 16, 24, 26, 52];
  let options = baseList.filter(w => w <= maxWeeks);
  if (!options.length) {
    /* 数据不足 2 周 → 只放 maxWeeks 本身 */
    options = [maxWeeks];
  } else if (maxWeeks > options[options.length - 1]) {
    /* 数据比最大的基础选项还长 → 追加 maxWeeks（覆盖全部数据） */
    options.push(maxWeeks);
  }

  /* 4. 保留用户原选择（若仍可选），否则回退到 4 周或最大周 */
  const prev = el.value;
  el.innerHTML = options.map(w => {
    const isFullSpan = (w === maxWeeks && !baseList.includes(w));
    const label = isFullSpan
      ? '近 ' + w + ' 周（全部数据）'
      : '近 ' + w + ' 周';
    return '<option value="' + w + '">' + label + '</option>';
  }).join('');

  if (options.map(String).indexOf(prev) >= 0) {
    el.value = prev;
  } else if (options.indexOf(4) >= 0) {
    el.value = '4';
  } else {
    el.value = String(options[options.length - 1]);
  }
}

/* ==================== 时段预测视图配置 ==================== */
function renderForecastConfig() {
  const grid = $('#fcDailyGrid');
  if (!grid) return;

  /* ★ 动态刷新「样本周数」下拉：数据导入 / 变化后，选项自动扩展到最长可覆盖的周数 */
  renderForecastSampleWeeksOptions();

  const bizEl = $('#fcBiz');
  const biz = (bizEl && bizEl.value) || '买手合作';
  const startEl = $('#fcStartDate');
  const daysEl = $('#fcDays');
  const startDate = startEl ? startEl.value : (
    S.latestDate
      ? dateAdd(S.latestDate, 1)
      : (function () {
          const d = new Date();
          return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
        })()
  );
  const days = daysEl ? parseInt(daysEl.value, 10) : 7;

  if (!S.forecastInputs) S.forecastInputs = {};
  if (!S.forecastInputs[biz]) S.forecastInputs[biz] = {};
  if (!S.forecastHolidays) S.forecastHolidays = new Set();
  if (!S.forecastWorkdays) S.forecastWorkdays = new Set();

  const volumeMap = S.volumeForecast[biz] || {};
  let hasAutoData = false;

  /* 计算回归预测值，用于占位提示 */
  let regrPreview = null;
  try {
    const _swEl = document.getElementById('fcSampleWeeks');
    const _swVal = (_swEl && _swEl.value) || '4';
    const stats = calcPeriodStatsCached(biz, 'caseVolume', parseInt(_swVal, 10));
    if (stats && stats.totalRegression) regrPreview = stats;
  } catch (_) {}

  let html = '';
  for (let i = 0; i < days; i++) {
    const date = dateAdd(startDate, i);
    if (!date) continue;
    const wd = new Date(date + 'T00:00:00Z').getUTCDay();
    const dom = parseInt(date.slice(8, 10), 10);

    let val = S.forecastInputs[biz][date];
    let isAuto = false;
    /* ★ 行为-4：val === null 表示「用户主动清空」，此时不回填 volumeMap；
       val === undefined 才走自动填充逻辑 */
    if (val === undefined) {
      if (volumeMap[date] != null) { val = volumeMap[date]; isAuto = true; hasAutoData = true; }
      else { val = ''; }
    } else if (val === null) {
      val = '';
    } else if (val === '') {
      val = '';
    }

    let regrVal = '';
    if (regrPreview && regrPreview.dailyStats && regrPreview.dailyStats.length) {
      const useWeekend = shouldUseWeekendPattern(date);

      /* ★ 博主 25/28 日：走「特殊日模板」，把 dom 作为 specialKind 传进去，
           否则普通逻辑给出的预测值和实际生成结果不一致 */
      let specialKind = null;
      {
        const dom2 = parseInt(date.slice(8, 10), 10);
        const cls2 = classifyDate(date);
        const userHoliday2 = S.forecastHolidays && S.forecastHolidays.has(date);
        if (biz === '博主合作' && (dom2 === 25 || dom2 === 28)
            && cls2 !== 'holiday' && !userHoliday2) {
          const sd = regrPreview.specialDays && regrPreview.specialDays[String(dom2)];
          if (sd && sd.sampleCount >= 1) specialKind = dom2;
        }
      }

      let pr = null;
      try {
        pr = _predictDailyTotal(regrPreview, date, useWeekend, specialKind, biz);
      } catch (e) {
        console.warn('[renderForecastConfig] _predictDailyTotal 失败：', e);
      }
      if (pr && pr.value > 0) {
        const srcTag = pr.source === '近期均值+回归' ? '混合'
                     : pr.source === '近期同星均值' ? '同星'
                     : pr.source === 'special'      ? '特殊日'
                     : '均值';
        /* ★ 特殊日额外标注样本量，便于用户核对「历史 25/28 日量级」 */
        let sampleTip = '';
        if (pr.source === 'special' && specialKind != null) {
          const sd2 = regrPreview.specialDays && regrPreview.specialDays[String(specialKind)];
          sampleTip = '（历史 ' + specialKind + ' 日 ' + (sd2 ? sd2.sampleCount : 0) + ' 天样本）';
        }
        regrVal = '📈 ' + srcTag + ' ' + pr.value + sampleTip;
      }
    }

    const cls = classifyDate(date);
    const userHoliday = S.forecastHolidays.has(date);
    const isBloggerSpecial = (biz === '博主合作')
      && (dom === 25 || dom === 28)
      && cls !== 'holiday'
      && !userHoliday;

    const typeLabel = isBloggerSpecial ? ('博主' + dom + '日') : dateTypeLabel(date);
    const typeColor = typeLabel === '节假日' ? '#E8A33E'
                    : typeLabel === '调休上班' ? '#C75C5C'
                    : typeLabel === '周末' ? '#C4B0CE'
                    : typeLabel.indexOf('博主') === 0 ? '#C75C5C'
                    : typeLabel.indexOf('自定义') === 0 ? '#7B8FBF'
                    : '#77778A';

    const isWeekendRow = shouldUseWeekendPattern(date) || isBloggerSpecial;
    const rowClass = isWeekendRow ? 'fc-daily-row fc-weekend' : 'fc-daily-row';
    const autoTag = isAuto ? '<span class="fc-auto-tag">预测量</span>' : '';
    const regrTag = regrVal ? '<span style="font-size:10px;color:#C75C5C;margin-left:6px">' + regrVal + '</span>' : '';

    html += '<div class="' + rowClass + '" data-date="' + date + '">' +
      '<div class="fc-daily-date">' +
        date.slice(5) + ' 周' + WEEKDAY_CN[wd] +
        ' <span style="font-size:11px;color:' + typeColor + ';font-weight:600;margin-left:4px">[' + typeLabel + ']</span>' +
        autoTag + regrTag +
      '</div>' +
      '<input type="number" inputmode="decimal" step="1" min="0" value="' + esc(val) + '" data-date="' + date + '" placeholder="输入总量">' +
      '<label class="fc-holiday" title="勾选 = 按周末/节假日模板计算；取消 = 按工作日模板计算">' +
        '<input type="checkbox" data-date="' + date + '"' + (shouldUseWeekendPattern(date) ? ' checked' : '') + '> 按休日算' +
      '</label>' +
    '</div>';
  }

  grid.innerHTML = html || '<div class="muted">请选择日期范围。</div>';

  const tipEl = $('#fcAutoTip');
  if (tipEl) {
    const specialTip = (biz === '博主合作')
      ? '🎯 博主合作专属：每月 25 日、28 日自动使用该业务单独统计的历史模板（节假日除外）。'
      : '';
    const algoTip = '🧮 时段占比由 <b>线性回归</b>预测；总量优先使用你输入的值，留空则由回归自动外推。';
    const parts = [algoTip];
    if (hasAutoData) parts.push('已自动填充导入的「预测量」数据（可覆盖）。');
    if (specialTip) parts.push('<span style="color:#C75C5C">' + specialTip + '</span>');
    tipEl.style.display = 'block';
    tipEl.innerHTML = parts.join('<br>');
  }

  grid.querySelectorAll('input[type=number]').forEach(inp => {
    inp.addEventListener('input', () => {
      const v = inp.value;
      /* ★ 行为-4：空字符串时存 null（标记用户主动清空），避免被 volumeMap 回填 */
      S.forecastInputs[biz][inp.dataset.date] = (v === '') ? null : v;
    });
  });

  grid.querySelectorAll('input[type=checkbox]').forEach(chk => {
    chk.addEventListener('change', () => {
      const d = chk.dataset.date;
      if (chk.checked) {
        S.forecastHolidays.add(d);
        S.forecastWorkdays.delete(d);
      } else {
        S.forecastWorkdays.add(d);
        S.forecastHolidays.delete(d);
      }
      try {
        localStorage.setItem('creator_forecast_holidays', JSON.stringify([...S.forecastHolidays]));
        localStorage.setItem('creator_forecast_workdays', JSON.stringify([...S.forecastWorkdays]));
      } catch (_) {}
      renderForecastConfig();
    });
  });

  try { renderForecastResult(); } catch (e) { console.warn('[renderForecastResult]', e); }
}

/* ==================== 收集每日总量 ==================== */
function collectDailyTotals() {
  const bizEl = $('#fcBiz');
  const biz = (bizEl && bizEl.value) || '买手合作';
  const grid = $('#fcDailyGrid');
  const totals = {};
  if (!grid) return totals;
  grid.querySelectorAll('input[type=number]').forEach(inp => {
    const d = inp.dataset.date;
    const v = parseFloat(inp.value);
    if (!isNaN(v) && v > 0) totals[d] = v;
  });
  return totals;
}

/* ==================== 渲染预测结果表格（时段为行 · 日期为列） ==================== */
function renderForecastResult() {
  const el = $('#fcResult');
  const notesEl = $('#fcNotes');
  if (!el) return;

  const bizEl = $('#fcBiz');
  const biz = (bizEl && bizEl.value) || '买手合作';
  const startEl = $('#fcStartDate');
  const daysEl = $('#fcDays');
  const weeksEl = $('#fcSampleWeeks');

  const startDate = startEl ? startEl.value : '';
  const days = daysEl ? parseInt(daysEl.value, 10) : 7;
  const sampleWeeks = weeksEl ? parseInt(weeksEl.value, 10) : 4;

  if (!startDate) {
    el.innerHTML = '<p class="muted">请选择起始日期。</p>';
    if (notesEl) notesEl.innerHTML = '';
    return;
  }

  const dailyTotals = collectDailyTotals();
  const holidays = S.forecastHolidays || new Set();
  const forecast = generateForecast(biz, 'caseVolume', sampleWeeks, startDate, days, dailyTotals, holidays);

  if (!forecast) {
    el.innerHTML = '<p class="muted">无法生成预测，请检查历史数据是否充足。</p>';
    if (notesEl) notesEl.innerHTML = '';
    return;
  }

  const { stats, results, periods } = forecast;
  const periodList = (periods && periods.length) ? periods : PREDICT_PERIODS;
  const diag = stats.diagnostic || {};

  if (!stats.dailyStats || stats.dailyStats.length === 0) {
    const detected = (diag.periodsDetected && diag.periodsDetected.length)
      ? diag.periodsDetected.join('、') : '（无）';
    const used = (diag.periodsUsed && diag.periodsUsed.length)
      ? diag.periodsUsed.join('、') : '（无）';
    el.innerHTML =
      '<div style="padding:14px 16px;background:#FFF7E6;border-radius:10px;border-left:3px solid #E8A33E;line-height:1.9;font-size:13px">' +
      '<div style="font-weight:700;color:#B36A00;margin-bottom:6px">⚠ 未能从历史数据中提取 9-23 时段占比</div>' +
      '<div>扫描数据行：<b>' + (diag.scanned || 0) + '</b> 条（样本周期 ' +
        (diag.sampleRange ? diag.sampleRange.start + ' ~ ' + diag.sampleRange.end : '—') + '）</div>' +
      '<div>有效天数：<b>' + (diag.matchedDays || 0) + '</b> 天</div>' +
      '<div>含时段的明细行：<b>' + (diag.rowsWithPeriod || 0) + '</b> 条，其中落在 9-23 范围内：<b>' + (diag.rowsInRange || 0) + '</b> 条</div>' +
      '<div>CASE 处理量合计（仅 9-23）：<b>' + (diag.sumVolume || 0) + '</b></div>' +
      '<div>全部检测到的时段：<b>' + detected + '</b></div>' +
      '<div>用于计算的时段：<b>' + used + '</b></div>' +
      (diag.hint ? '<div style="margin-top:8px;color:#B36A00">' + esc(diag.hint) + '</div>' : '') +
      '</div>';
    if (notesEl) notesEl.innerHTML = '';
    return;
  }

  /* 双行表头 */
  let thead = '<tr>';
  thead += '<th rowspan="2" style="vertical-align:middle;text-align:center;min-width:70px">时段 <span class="help" data-tip="9-23 时，基于历史时段占比回归预测">?</span></th>';
  for (const r of results) {
    const wd = new Date(r.date + 'T00:00:00Z').getUTCDay();
    thead += '<th style="text-align:center;min-width:78px">' + r.date.slice(5) + ' 周' + WEEKDAY_CN[wd] + '</th>';
  }
  thead += '<th rowspan="2" style="vertical-align:middle;text-align:center;min-width:70px">合计 <span class="help" data-tip="所有时段预测值加总">?</span></th>';
  thead += '</tr>';

  thead += '<tr>';
  for (const r of results) {
    const label = r.typeLabel || '';
    const color = label === '节假日' ? '#E8A33E'
                : label === '调休上班' ? '#C75C5C'
                : label === '周末' ? '#C4B0CE'
                : label.indexOf('博主') === 0 ? '#C75C5C'
                : label.indexOf('自定义') === 0 ? '#7B8FBF'
                : '#77778A';
    const srcTag = FORECAST_SOURCE_LABEL[r.totalSource] || '—';   // ★ BUG-FIX P2：统一来源标签
    thead += '<th style="text-align:center;vertical-align:middle;color:' + color + ';font-weight:500;font-size:11px;padding-top:4px;padding-bottom:5px">' + label +
      '<br><span style="font-size:9px;color:#A0A0AE;font-weight:400">' + srcTag + '</span></th>';
  }
  thead += '</tr>';

  let tbody = '';
  for (const p of periodList) {
    tbody += '<tr>' +
      '<td style="font-weight:600;text-align:center;vertical-align:middle;position:sticky;left:0;background:#FFFFFF;box-shadow:inset -1px 0 0 #F0EEE9">' + esc(p) + '时</td>';
    let sum = 0;
    for (const r of results) {
      const v = r.periods[p] || 0;
      sum += v;
      tbody += '<td style="text-align:center">' + (r.total > 0 ? Math.round(v) : '—') + '</td>';
    }
    tbody += '<td style="font-weight:600;text-align:center;background:#F4F3EF">' + Math.round(sum) + '</td>';
    tbody += '</tr>';
  }

  tbody += '<tr style="background:#F4F3EF;font-weight:600">' +
    '<td style="text-align:center;position:sticky;left:0;background:#F4F3EF;box-shadow:inset -1px 0 0 #E7E5DE">总量</td>';
  for (const r of results) {
    tbody += '<td style="text-align:center">' + Math.round(r.total) + '</td>';
  }
  tbody += '<td style="text-align:center;background:#E8EDF3">' + Math.round(results.reduce((s, r) => s + r.total, 0)) + '</td></tr>';

  el.innerHTML = '<div class="table-scroll-x"><table class="rp-table"><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table></div>';

  if (notesEl) {
    const weightTag = stats.usedRowCount
      ? '（⚠ 未检测到「CASE处理量」，已改用明细行数作为权重）'
      : '（按 CASE 处理量加权）';
    let noteHtml = '<div style="margin-bottom:6px">📊 <b>样本统计：</b>近 ' + sampleWeeks + ' 周，工作日 ' + stats.weekdayCount + ' 天 / 周末 ' + stats.weekendCount + ' 天，样本范围 ' + stats.sampleRange.start + ' ~ ' + stats.sampleRange.end + ' ' + weightTag + '。</div>';

    // 算法说明 + 趋势
    if (stats.totalRegression && stats.totalRegression.all && stats.totalRegression.all.n >= 3) {
      const tr = stats.totalRegression.all;
      const dir = tr.slope > 0.5 ? '上升' : (tr.slope < -0.5 ? '下降' : '平稳');
      const color = tr.slope > 0.5 ? '#C75C5C' : (tr.slope < -0.5 ? '#6EA980' : '#77778A');
      noteHtml += '<div style="color:' + color + ';margin-top:4px">📈 <b>日度总量趋势：</b>斜率 ' + tr.slope.toFixed(2) + ' 单/天，R² = ' + tr.r2.toFixed(3) + '（' + dir + '）；<b>时段占比：</b>线性回归预测</div>';
    } else {
      noteHtml += '<div style="color:#77778A;margin-top:4px">📈 <b>算法：</b>时段占比线性回归；日总量 = max(同周加权均值, P60分位) × 趋势修正 × 1.10 排班 buffer，回归仅做微调</div>';
    }
    noteHtml += '<div style="color:#77778A;font-size:11.5px;margin-top:2px">🧮 <b>总量算法：</b>锚点 = max(同周加权均值, P60分位)，趋势修正 ±35%（负趋势减半），回归权重 0.7→50%/0.6→40%/0.5→30%/0.4→15%，最终值 × 1.10 排班 buffer，clamp 至 [P10×0.85, max×1.30]；博主 25/28 日走特殊日模板 × 1.10。</div>';
    const holidayTag =
      (_cnHolidayVersion.indexOf('不可用') >= 0) ? '<span style="color:#C98383">' + _cnHolidayVersion + '</span>'
      : (_cnHolidayVersion.indexOf('异常') >= 0 || _cnHolidayVersion.indexOf('未刷新') >= 0)
          ? '<span style="color:#B36A00">' + _cnHolidayVersion + '</span>'
          : _cnHolidayVersion;
    noteHtml += '<div style="color:#77778A;font-size:11.5px;margin-top:2px">🗓 节假日识别：' + holidayTag + '；时段仅统计 9-23；勾选/取消「按休日算」可手动覆盖。</div>';

    if (biz === '博主合作' && stats.specialDays) {
      const s25 = stats.specialDays['25'];
      const s28 = stats.specialDays['28'];
      const tips = [];
      if (s25) tips.push('25 日（' + s25.sampleCount + ' 天样本）');
      if (s28) tips.push('28 日（' + s28.sampleCount + ' 天样本）');
      if (tips.length) {
        noteHtml += '<div style="color:#C75C5C;margin-top:4px">🎯 <b>博主特殊日模板：</b>' + tips.join('、') + ' 已单独统计历史时段占比。</div>';
      } else {
        noteHtml += '<div style="color:#77778A;margin-top:4px">🎯 <b>博主特殊日：</b>25/28 日暂无足够历史样本，本期按常规模板。</div>';
      }
    }

    if (stats.abnormalDays && stats.abnormalDays.length) {
      noteHtml += '<div style="color:#C98383;margin-top:4px">⚠ <b>疑似异常天：</b>' + stats.abnormalDays.map(d => d.date + '（偏差' + d.totalDevPct + '%）').join('、') + '。</div>';
    }
    notesEl.innerHTML = noteHtml;
  }
}

/* ==================== 导出 XLSX ==================== */
function exportForecastXlsx() {
  const bizEl = $('#fcBiz');
  const biz = (bizEl && bizEl.value) || '买手合作';
  const startEl = $('#fcStartDate');
  const daysEl = $('#fcDays');
  const weeksEl = $('#fcSampleWeeks');

  const startDate = startEl ? startEl.value : '';
  const days = daysEl ? parseInt(daysEl.value, 10) : 7;
  const sampleWeeks = weeksEl ? parseInt(weeksEl.value, 10) : 4;

  if (!startDate) { toast('❌ 请先选择起始日期'); return; }

  const dailyTotals = collectDailyTotals();
  const holidays = S.forecastHolidays || new Set();
  const forecast = generateForecast(biz, 'caseVolume', sampleWeeks, startDate, days, dailyTotals, holidays);
  if (!forecast) { toast('❌ 无法生成预测数据'); return; }
  if (!forecast.stats.dailyStats || forecast.stats.dailyStats.length === 0) {
    toast('❌ 历史数据中没有可用的时段占比');
    return;
  }

  const { results, periods } = forecast;
  const periodList = (periods && periods.length) ? periods : PREDICT_PERIODS;

  const rows = [];

  const header1 = [{ v: '时段', t: 's', s: 1 }];
  const header2 = [{ v: '', t: 's', s: 1 }];
  for (const r of results) {
    const wd = new Date(r.date + 'T00:00:00Z').getUTCDay();
    header1.push({ v: r.date.slice(5) + ' 周' + WEEKDAY_CN[wd], t: 's', s: 1 });
    header2.push({ v: r.typeLabel || '', t: 's', s: 1 });
  }
  header1.push({ v: '合计', t: 's', s: 1 });
  header2.push({ v: '', t: 's', s: 1 });
  rows.push(header1, header2);

  for (const p of periodList) {
    const row = [{ v: p + '时', t: 's', s: 0 }];
    let sum = 0;
    for (const r of results) {
      const v = r.periods[p] || 0;
      sum += v;
      row.push({ v: Math.round(v), t: 'n', s: 0 });
    }
    row.push({ v: Math.round(sum), t: 'n', s: 1 });
    rows.push(row);
  }

  const totalRow = [{ v: '总量', t: 's', s: 1 }];
  let grand = 0;
  for (const r of results) {
    totalRow.push({ v: Math.round(r.total), t: 'n', s: 0 });
    grand += r.total;
  }
  totalRow.push({ v: Math.round(grand), t: 'n', s: 1 });
  rows.push(totalRow);

  const lastCol = results.length + 2;
  const merges = ['A1:A2', _colLetter(lastCol) + '1:' + _colLetter(lastCol) + '2'];

  const cols = [{ min: 1, max: 1, width: 10 }];
  for (let i = 0; i < results.length; i++) cols.push({ min: i + 2, max: i + 2, width: 13 });
  cols.push({ min: lastCol, max: lastCol, width: 12 });

  const sheetName = '时段预测-' + biz.replace(/[\\\/\?\*\[\]:]/g, '');
  const blob = buildXlsxBlob(sheetName, rows, { merges, cols });

  const fname = '时段预测-' + biz + '-' + startDate + '-' + days + '天.xlsx';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('⬇ 已导出 ' + fname);
}

/* ==================== 复制 Markdown ==================== */
function copyForecastMd() {
  const bizEl = $('#fcBiz');
  const biz = (bizEl && bizEl.value) || '买手合作';
  const startEl = $('#fcStartDate');
  const daysEl = $('#fcDays');
  const weeksEl = $('#fcSampleWeeks');
  const startDate = startEl ? startEl.value : '';
  const days = daysEl ? parseInt(daysEl.value, 10) : 7;
  const sampleWeeks = weeksEl ? parseInt(weeksEl.value, 10) : 4;

  const dailyTotals = collectDailyTotals();
  const holidays = S.forecastHolidays || new Set();
  const forecast = generateForecast(biz, 'caseVolume', sampleWeeks, startDate, days, dailyTotals, holidays);
  if (!forecast) { toast('❌ 无法生成预测数据'); return; }

  const md = forecastToMarkdown(biz, 'caseVolume', sampleWeeks, forecast);
  navigator.clipboard.writeText(md).then(() => {
    toast('✅ Markdown 已复制到剪贴板');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = md;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('✅ Markdown 已复制到剪贴板'); }
    catch (e) { toast('❌ 复制失败，请手动选择文本'); }
    document.body.removeChild(ta);
  });
}

/* ==================== 清空输入 ==================== */
function clearForecastInputs() {
  const bizEl = $('#fcBiz');
  const biz = (bizEl && bizEl.value) || '买手合作';
  if (S.forecastInputs && S.forecastInputs[biz]) S.forecastInputs[biz] = {};
  if (S.forecastHolidays) S.forecastHolidays.clear();
  if (S.forecastWorkdays) S.forecastWorkdays.clear();
  try {
    localStorage.removeItem('creator_forecast_holidays');
    localStorage.removeItem('creator_forecast_workdays');
  } catch (_) {}
  renderForecastConfig();
  renderForecastResult();
  toast('已清空输入与手动覆盖的节假日');
}

/* ==================== 启动引导：加载节假日 + 注入 XLSX 按钮 ==================== */
(function bootstrapForecast() {
  const run = () => {
    try {
      if (!S.forecastHolidays) S.forecastHolidays = new Set();
      if (!S.forecastWorkdays) S.forecastWorkdays = new Set();
      JSON.parse(localStorage.getItem('creator_forecast_holidays') || '[]')
        .forEach(d => S.forecastHolidays.add(d));
      JSON.parse(localStorage.getItem('creator_forecast_workdays') || '[]')
        .forEach(d => S.forecastWorkdays.add(d));
    } catch (_) {}

    if (typeof initHolidayData === 'function') {
      initHolidayData().catch(err => {
        console.warn('[节假日API] 初始化失败：', err);
      });
    }

    // 动态注入「导出 XLSX」按钮（在「清空输入」之后）
    const clearBtn = document.getElementById('btnFcClear');
    if (clearBtn && clearBtn.parentNode && !document.getElementById('btnFcXlsx')) {
      const xlsxBtn = document.createElement('button');
      xlsxBtn.id = 'btnFcXlsx';
      xlsxBtn.className = 'btn sm';
      xlsxBtn.textContent = '📥 导出 XLSX';
      xlsxBtn.addEventListener('click', exportForecastXlsx);
      clearBtn.parentNode.appendChild(xlsxBtn);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();

/* ============================================================
   END OF dashboard-forecast.js
   ============================================================ */