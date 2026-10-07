/* ============================================================
   创作者数据分析 · 周报层
   （目标配置 / 30S 归因分析 / 周报 HTML 与 Markdown 组装）
   ============================================================ */
'use strict';

/* ==================== 周报 · 目标配置面板 ==================== */
function renderTargetConfig() {
  const grid = $('#targetGrid');
  if (!grid) return;
  const bizEl = $('#rpBiz');
  const biz = (bizEl && bizEl.value) || '买手合作';
  const manual = loadTargets()[biz] || {};
  const sla = slaTargets100(biz);
  const slaRawCount = (bizToSrc(biz) === 'buyer') ? S.slaBuyer.length : S.slaBlogger.length;
  const curMonth = S.month ? parseInt(S.month.slice(5,7), 10) : null;
  const slaMatchedCount = Object.keys(sla).length;

  let statusTip = '';
  if (!S.slaBuyer.length && !S.slaBlogger.length) {
    statusTip = '<span style="color:#C98383">⚠ 未检测到 SLA 数据（请确认导入文件中包含「买手员工SLA」/「博主员工SLA」sheet）</span>';
  } else if (slaRawCount === 0) {
    statusTip = '<span style="color:#C98383">⚠ 当前业务线（' + esc(biz) + '）无 SLA 数据</span>';
  } else if (curMonth == null) {
    statusTip = '<span style="color:#C98383">⚠ 无法确定数据月份（请检查 CASE 日期是否可解析）</span>';
  } else if (slaMatchedCount === 0) {
    statusTip = '<span style="color:#C98383">⚠ SLA 已加载 ' + slaRawCount + ' 组，但当前月份（' + curMonth + '月）未匹配到任何 100% 档位目标。请检查：① SLA 表头是否有「指标」「分类」列；② 是否有「' + curMonth + '月权重 / ' + curMonth + '月目标 / ' + curMonth + '月得分」列；③ 指标名是否可识别。</span>';
  } else {
    statusTip = '<span style="color:#6EA980">✓ SLA 已加载 ' + slaRawCount + ' 组，当前月份（' + curMonth + '月）匹配到 ' + slaMatchedCount + ' 个指标</span>';
  }

  const fmtDisp = (m, v) => (v == null) ? '' : (m.pct ? (v * 100).toFixed(2) : String(v));

  const hint = '<div style="grid-column:1/-1;font-size:11.5px;color:#77778A;line-height:1.7;margin:0 0 4px;padding:8px 10px;background:#FAF9F7;border-radius:8px;border-left:3px solid #98A8CE">' +
    statusTip + '<br>' +
    '目标值默认取 SLA 中该指标 <b style="color:#7B8FBF">「老人」分类 100% 得分档位</b>（无老人时回退到「整体」，再回退到其他分类）。' +
    '带 <span class="sla-tag sla" style="vertical-align:middle">SLA</span> 标记的为自动取值，<b>可手动覆盖</b>，修改前会二次确认；' +
    '带 <span class="sla-tag manual" style="vertical-align:middle">⚠ 已覆盖</span> 标记的为已手动覆盖 SLA 的值，<b>清空输入框并失焦可恢复为 SLA 值</b>。' +
    'SLA 中没有的指标才需手动填写。' +
  '</div>';

  grid.innerHTML = hint + METRICS.map(m => {
    const hasManual = manual[m.key] != null;
    const hasSla    = sla[m.key]    != null;
    let src, disp;
    if (hasManual)   { src = 'manual'; disp = fmtDisp(m, manual[m.key]); }
    else if (hasSla) { src = 'sla';    disp = fmtDisp(m, sla[m.key]);    }
    else             { src = 'none';   disp = ''; }

    let tag = '';
    if (src === 'manual' && hasSla) {
      tag = '<span class="sla-tag manual" title="已手动覆盖 SLA 100 分档（' + fmtDisp(m, sla[m.key]) + (m.pct ? '%' : '') + '）">⚠ 已覆盖</span>';
    } else if (src === 'manual') {
      tag = '<span class="sla-tag manual" title="SLA 中无该指标，值为手动设置">手动</span>';
    } else if (src === 'sla') {
      tag = '<span class="sla-tag sla" title="来自 SLA 老人分类 100% 得分档位，可手动覆盖">SLA</span>';
    } else {
      tag = '<span class="sla-tag none" title="SLA 中无该指标，请手动设置">未设置</span>';
    }

    return '<div class="target-row">' +
      '<span class="lb" title="' + esc(m.label) + '">' + esc(metricLabel(m)) + '</span>' +
      '<input type="text" inputmode="decimal" data-key="' + esc(m.key) + '" data-src="' + src + '" value="' + esc(disp) + '" placeholder="未设置">' +
      '<span class="unit">' + (m.pct ? '%' : '') + '</span>' +
      tag +
    '</div>';
  }).join('');

  grid.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      const key = inp.dataset.key;
      const m = METRIC_MAP[key];
      const raw = inp.value.trim();
      const src = inp.dataset.src;
      const slaVal = sla[key];
      const slaDisp = slaVal != null ? fmtDisp(m, slaVal) + (m.pct ? '%' : '') : null;

      if (src === 'sla' && slaVal != null && raw !== '') {
        const newDisp = raw + (m.pct ? '%' : '');
        const ok = confirm(
          '⚠ 强提醒\n\n' +
          '【' + m.label + '】当前目标来自 SLA 100% 得分档位：' + slaDisp + '\n' +
          '即将手动覆盖为：' + newDisp + '\n\n' +
          '确认覆盖吗？\n' +
          '（覆盖后该指标不再随 SLA 自动更新；清空输入框并失焦可恢复 SLA 值）'
        );
        if (!ok) {
          inp.value = fmtDisp(m, slaVal);
          inp.dataset.src = 'sla';
          return;
        }
      }

      const all = loadTargets();
      if (!all[biz]) all[biz] = {};
      if (raw === '') {
        delete all[biz][key];
      } else {
        const n = parseFloat(raw);
        if (isNaN(n)) delete all[biz][key];
        else all[biz][key] = m.pct ? n / 100 : n;
      }
      saveTargets(all);
      renderTargetConfig();
      renderReport();
    });
  });
}

/* ==================== 周报 · 指标行工具 ==================== */
function metricLineParts(curRaw, prevRaw, monthRaw, m, tgt, monthLabel) {
  const isPct = !!m.pct;
  const unit = isPct ? '%' : '';
  const curDisp = isPct ? pct2(curRaw) : num2(curRaw);
  const dd = (curRaw != null && prevRaw != null && isFinite(curRaw) && isFinite(prevRaw)) ? curRaw - prevRaw : null;
  const wowDisp = dd == null ? '—' : (isPct ? dPct(dd) : dStr(dd));
  const arrow = (dd == null || Math.abs(dd) < 1e-9) ? '' : (dd > 0 ? '🔺' : '🔻');
  const tw = (tgt && tgt[m.key] != null) ? Number(tgt[m.key]) : null;

  let weekHit = null, weekRate = null;
  if (tw != null && curRaw != null && isFinite(curRaw)) {
    weekHit = m.better === 'down' ? curRaw <= tw : curRaw >= tw;
    weekRate = m.better === 'down' ? (curRaw > 0 ? tw / curRaw : null) : (tw > 0 ? curRaw / tw : null);
  }
  let monthHit = null, monthRate = null;
  if (tw != null && monthRaw != null && isFinite(monthRaw)) {
    monthHit = m.better === 'down' ? monthRaw <= tw : monthRaw >= tw;
    monthRate = m.better === 'down' ? (monthRaw > 0 ? tw / monthRaw : null) : (tw > 0 ? monthRaw / tw : null);
  }
  const monthDisp = isPct ? pct2(monthRaw) : num2(monthRaw);
  const twDisp = tw == null ? '—' : (isPct ? (tw * 100).toFixed(2) : tw.toFixed(0));
  return { isPct, unit, curDisp, wowDisp, arrow, tw, twDisp, weekHit, weekRate, monthHit, monthRate, monthDisp, monthLabel };
}
function metricLineHTML(label, curRaw, prevRaw, monthRaw, m, tgt, monthLabel) {
  const p = metricLineParts(curRaw, prevRaw, monthRaw, m, tgt, monthLabel);
  let s = '<b>' + esc(label) + '</b><span class="rpt-v">' + p.curDisp + '</span>';
  s += '<span class="rpt-sep">|</span>周度WoW' + p.wowDisp + p.arrow;
  if (p.weekHit != null) s += (p.weekHit ? '' : '🔴') + '（' + (p.weekHit ? '已达成' : '未达成') + '）（周度达成率' + pct2(p.weekRate) + '）';
  s += '，';
  if (p.tw != null) {
    s += '<span class="rpt-sep">|</span>' + p.monthLabel + '目标：' + p.twDisp + p.unit;
    s += '，' + p.monthLabel + '达成：' + p.monthDisp;
    if (p.monthHit != null) s += '（月度达成率' + pct2(p.monthRate) + '）' + (p.monthHit ? '' : '🔴（未达成）');
  } else {
    s += '<span class="rpt-sep">|</span>' + p.monthLabel + '达成：' + p.monthDisp;
  }
  s += '<span class="rpt-sep">|</span>';
  return s;
}
function metricLineText(label, curRaw, prevRaw, monthRaw, m, tgt, monthLabel) {
  const p = metricLineParts(curRaw, prevRaw, monthRaw, m, tgt, monthLabel);
  let s = label + p.curDisp;
  s += ' | 周度WoW' + p.wowDisp + p.arrow;
  if (p.weekHit != null) s += (p.weekHit ? '' : '🔴') + '（' + (p.weekHit ? '已达成' : '未达成') + '）（周度达成率' + pct2(p.weekRate) + '）';
  s += '，';
  if (p.tw != null) {
    s += ' | ' + p.monthLabel + '目标：' + p.twDisp + p.unit;
    s += '，' + p.monthLabel + '达成：' + p.monthDisp;
    if (p.monthHit != null) s += '（月度达成率' + pct2(p.monthRate) + '）' + (p.monthHit ? '' : '🔴（未达成）');
  } else { s += ' | ' + p.monthLabel + '达成：' + p.monthDisp; }
  s += ' |';
  return s;
}
function catLineHTML(cat, curRaw, prevRaw, m) {
  if (curRaw == null || !isFinite(curRaw)) return '<div class="rpt-sub">' + cat + '达成：—</div>';
  const curDisp = m.pct ? pct2(curRaw) : num2(curRaw);
  if (prevRaw == null || !isFinite(prevRaw)) return '<div class="rpt-sub">' + cat + '达成：' + curDisp + '</div>';
  const dd = curRaw - prevRaw;
  const prevDisp = m.pct ? pct2(prevRaw) : num2(prevRaw);
  const dDisp = m.pct ? (Math.abs(dd) * 100).toFixed(2) + '%' : num2(Math.abs(dd));
  return '<div class="rpt-sub">' + cat + '达成：' + curDisp + '（' + prevDisp + '→' + curDisp + '，' + dArrow(dd) + dDisp + '）</div>';
}
function catLineText(cat, curRaw, prevRaw, m) {
  if (curRaw == null || !isFinite(curRaw)) return cat + '达成：—';
  const curDisp = m.pct ? pct2(curRaw) : num2(curRaw);
  if (prevRaw == null || !isFinite(prevRaw)) return cat + '达成：' + curDisp;
  const dd = curRaw - prevRaw;
  const prevDisp = m.pct ? pct2(prevRaw) : num2(prevRaw);
  const dDisp = m.pct ? (Math.abs(dd) * 100).toFixed(2) + '%' : num2(Math.abs(dd));
  return cat + '达成：' + curDisp + '（' + prevDisp + '→' + curDisp + '，' + dArrow(dd) + dDisp + '）';
}

/* ==================== 30S 归因分析 ==================== */
function s30AnalysisData(biz, wk) {
  const records = S.records.filter(r => r.biz === biz && r.wk === wk);
  if (!records.length) return null;

  const forecastMap = (biz === '买手合作') ? S.forecastBuyer : S.forecastBlogger;
  const hasFc = !!(forecastMap && Object.keys(forecastMap).length);

  const dpMap = new Map();
  for (const r of records) {
    const p = normPeriod(r.period) || '—';
    const key = r.date + '|' + p;
    if (!dpMap.has(key)) dpMap.set(key, { date: r.date, period: p, num: 0, den: 0, forecast: 0, hasFc: false });
    const o = dpMap.get(key);
    o.num += r.s30Num;
    o.den += r.s30Den;
  }
  if (hasFc) {
    for (const o of dpMap.values()) {
      const fc = forecastMap[o.date + '|' + o.period];
      if (fc != null && isFinite(fc) && fc > 0) { o.forecast = fc; o.hasFc = true; }
    }
  }
  const dpList = Array.from(dpMap.values());

  let totNum = 0, totDen = 0, totFc = 0, fcCover = 0;
  for (const o of dpList) {
    totNum += o.num; totDen += o.den;
    if (o.hasFc) { totFc += o.forecast; fcCover += o.den; }
  }
  if (totDen <= 0) return null;

  const totRate = totNum / totDen;
  const th = s30Threshold(biz);
  const hit = totRate >= th;
  const targetNum = th * totDen;
  const gapRaw = (th * totDen - totNum) / (1 - th);
  const gapNum = (!hit && th > 0 && th < 1 && isFinite(gapRaw))
    ? Math.max(0, Math.ceil(gapRaw - 1e-9))
    : null;
  const totBias = totFc > 0 ? totDen / totFc : null;
  const fcCoverRate = totDen > 0 ? fcCover / totDen : 0;

  const dayMap = new Map();
  for (const o of dpList) {
    if (!dayMap.has(o.date)) dayMap.set(o.date, { date: o.date, num: 0, den: 0, forecast: 0, hasFc: false });
    const d = dayMap.get(o.date);
    d.num += o.num; d.den += o.den;
    if (o.hasFc) { d.forecast += o.forecast; d.hasFc = true; }
  }
  const days = Array.from(dayMap.values()).map(o => {
    const rate = o.den > 0 ? o.num / o.den : null;
    const bias = (o.hasFc && o.forecast > 0) ? o.den / o.forecast : null;
    return { date: o.date, num: o.num, den: o.den, forecast: o.forecast, hasFc: o.hasFc,
      rate, miss: o.den - o.num, hit: rate != null && rate >= th, bias };
  }).sort((a, b) => a.date < b.date ? -1 : 1);

  const periodMap = new Map();
  for (const o of dpList) {
    const p = o.period;
    if (!periodMap.has(p)) periodMap.set(p, { period: p, num: 0, den: 0, forecast: 0, hasFc: false });
    const x = periodMap.get(p);
    x.num += o.num; x.den += o.den;
    if (o.hasFc) { x.forecast += o.forecast; x.hasFc = true; }
  }
  const periods = Array.from(periodMap.values()).map(o => {
    const rate = o.den > 0 ? o.num / o.den : null;
    const bias = (o.hasFc && o.forecast > 0) ? o.den / o.forecast : null;
    return { period: o.period, num: o.num, den: o.den, forecast: o.forecast, hasFc: o.hasFc,
      rate, miss: o.den - o.num, bias };
  }).filter(o => o.den > 0).sort((a, b) => {
    const ai = parseInt(a.period, 10), bi = parseInt(b.period, 10);
    if (isFinite(ai) && isFinite(bi) && ai !== bi) return ai - bi;
    return String(a.period).localeCompare(String(b.period));
  });

  const empMap = new Map();
  for (const r of records) {
    if (!r.name) continue;
    if (!empMap.has(r.name)) empMap.set(r.name, { name: r.name, num: 0, den: 0 });
    const o = empMap.get(r.name);
    o.num += r.s30Num; o.den += r.s30Den;
  }
  const emps = Array.from(empMap.values()).map(o => ({
    name: o.name, num: o.num, den: o.den,
    rate: o.den > 0 ? o.num / o.den : null, miss: o.den - o.num
  })).filter(o => o.den > 0).sort((a, b) => b.miss - a.miss);

  const fcSlices = dpList.filter(o => o.hasFc && o.forecast > 0);
  const fcBuckets = {
    over:   { label: '超预测（>120%）', den: 0, miss: 0, cnt: 0 },
    near:   { label: '接近预测（100%~120%）', den: 0, miss: 0, cnt: 0 },
    under:  { label: '低于预测（<100%）', den: 0, miss: 0, cnt: 0 }
  };
  for (const o of fcSlices) {
    const b = o.den / o.forecast;
    const miss = o.den - o.num;
    let k;
    if (b > 1.2) k = 'over';
    else if (b < 1.0) k = 'under';
    else k = 'near';
    fcBuckets[k].den += o.den;
    fcBuckets[k].miss += miss;
    fcBuckets[k].cnt += 1;
  }

  return {
    biz, wk, totNum, totDen, totRate, th, hit, targetNum, gapNum,
    hasFc, totFc, totBias, fcCover, fcCoverRate,
    days, periods, emps, fcSlices, fcBuckets, dpList
  };
}

function computeOverForecastImpactDetail(cur) {
  const th = cur.th;
  const totNum = cur.totNum, totDen = cur.totDen, totRate = cur.totRate;
  const dayMap = new Map();
  for (const d of cur.days) dayMap.set(d.date, d);

  const rows = [];
  for (const o of cur.fcSlices) {
    if (!o.hasFc || !o.forecast || o.forecast <= 0) continue;
    const bias = o.den / o.forecast;
    if (bias <= 1.2) continue;
    if (o.den <= 0) continue;
    const rate = o.num / o.den;
    if (rate >= th) continue;
    const miss = o.den - o.num;
    if (miss <= 0) continue;

    const day = dayMap.get(o.date);
    if (!day || day.den <= 0) continue;

    const newDayRate = (day.num + miss) / day.den;
    const dayImpact = newDayRate - day.rate;
    const newWeekRate = (totNum + miss) / totDen;
    const weekImpact = newWeekRate - totRate;

    rows.push({
      date: o.date, period: o.period,
      forecast: o.forecast, den: o.den, num: o.num,
      miss, bias, rate, dayImpact, weekImpact
    });
  }
  rows.sort((a, b) => a.weekImpact - b.weekImpact);
  return rows;
}

function s30AnalysisHTML(biz, wk, prevWk) {
  const cur = s30AnalysisData(biz, wk);
  if (!cur) return '';
  const th = cur.th;
  const thPct = (th * 100).toFixed(2);
  const P = [];

  P.push('<h4 class="sub-title">🔍 30S 接起率 多维度归因分析</h4>');

  if (cur.hit) {
    P.push('<div class="rpt-sub">本周 30S 接起率 <b>' + (cur.totRate * 100).toFixed(2) + '%</b> 已达标（目标 ≥ ' + thPct + '%），无缺口。</div>');
  } else {
    const gapPp = (th - cur.totRate) * 100;
    const gapTxt = (cur.gapNum != null)
      ? '；按「（接起量 + 缺口）/（服务量 + 缺口）= ' + thPct + '%」测算，接起率缺口为 <b>' + cur.gapNum + ' 单</b>才能达标'
      : '；目标值 ≥ 100%，无法通过增加接起量达成';
    P.push('<div class="rpt-sub" style="color:#D9363E;font-weight:600">⚠ 本周 30S 接起率 <b>' + (cur.totRate * 100).toFixed(2) + '%</b> 低于目标 <b>' + thPct + '%</b>，差距 <b>' + gapPp.toFixed(2) + 'pp</b>' + gapTxt + '。</div>');
  }

  if (cur.hasFc && cur.totFc > 0) {
    P.push('<div class="rpt-sub" style="margin-top:8px">📊 <b>预测量级维度</b></div>');
    const biasTxt = cur.totBias != null ? (cur.totBias * 100).toFixed(2) + '%' : '—';
    const biasColor = (cur.totBias != null && cur.totBias > 1.2) ? '#D9363E' : '#4A4A56';
    P.push('<div class="rpt-sub">本周预测量合计 <b>' + fmtInt(cur.totFc) + '</b> 单，实际人工服务量 <b>' + fmtInt(cur.totDen) + '</b> 单，' +
      '预测偏差 <b style="color:' + biasColor + '">' + biasTxt + '</b>' +
      (cur.totBias != null && cur.totBias > 1.2 ? '（实际量已明显超出预测）' : cur.totBias != null && cur.totBias < 1.0 ? '（实际量低于预测）' : '（实际量与预测接近）') +
      '；预测覆盖率 <b>' + (cur.fcCoverRate * 100).toFixed(1) + '%</b>。</div>');

    const bk = cur.fcBuckets;
    const totalMissFc = bk.over.miss + bk.near.miss + bk.under.miss;
    P.push('<div class="rpt-sub" style="line-height:2.2">' +
      '<span style="display:inline-block;padding:2px 8px;margin:2px;border-radius:6px;background:#FDF0F0;font-size:11.5px;color:#B33">' +
        '超预测 >120% · <b>' + bk.over.cnt + '</b> 段 · Miss <b>' + bk.over.miss + '</b>（占比 ' + (totalMissFc > 0 ? (bk.over.miss / totalMissFc * 100).toFixed(1) : '0') + '%）</span>' +
      '<span style="display:inline-block;padding:2px 8px;margin:2px;border-radius:6px;background:#F8F7F4;font-size:11.5px;color:#4A4A56">' +
        '接近预测 100%~120% · <b>' + bk.near.cnt + '</b> 段 · Miss <b>' + bk.near.miss + '</b>（占比 ' + (totalMissFc > 0 ? (bk.near.miss / totalMissFc * 100).toFixed(1) : '0') + '%）</span>' +
      '<span style="display:inline-block;padding:2px 8px;margin:2px;border-radius:6px;background:#F0F7F2;font-size:11.5px;color:#3D7A52">' +
        '低于预测 <100% · <b>' + bk.under.cnt + '</b> 段 · Miss <b>' + bk.under.miss + '</b>（占比 ' + (totalMissFc > 0 ? (bk.under.miss / totalMissFc * 100).toFixed(1) : '0') + '%）</span>' +
    '</div>');

    const overSlices = cur.fcSlices
      .map(o => Object.assign({}, o, { bias: o.den / o.forecast, miss: o.den - o.num }))
      .filter(o => o.bias > 1.2 && o.miss > 0)
      .sort((a, b) => b.miss - a.miss).slice(0, 3);
    if (overSlices.length) {
      const html = overSlices.map(o =>
        '<span style="display:inline-block;padding:2px 8px;margin:2px;border-radius:6px;background:#FDF0F0;font-size:11.5px;color:#B33">' +
        esc(o.date.slice(5)) + ' ' + esc(o.period) + '时 · 预测 ' + Math.round(o.forecast) + ' / 实际 ' + Math.round(o.den) +
        '（偏差 ' + (o.bias * 100).toFixed(0) + '%）· Miss ' + o.miss + '</span>'
      ).join('');
      P.push('<div class="rpt-sub">超预测且 Miss>0 的日期×时段 TOP3：' + html + '</div>');
    }

    const overShare = totalMissFc > 0 ? bk.over.miss / totalMissFc : 0;
    const nearShare = totalMissFc > 0 ? bk.near.miss / totalMissFc : 0;
    const badFc = (cur.totBias != null && cur.totBias > 1.2);
    let insight;
    if (badFc && overShare >= 0.5) {
      insight = '🔎 <b>推断：量级超预测是主因。</b>本周实际服务量超预测量 ' + ((cur.totBias - 1) * 100).toFixed(1) + '%，' +
        'Miss 的 <b>' + (overShare * 100).toFixed(1) + '%</b> 集中在超预测时段，说明预测偏低、排班未能弹性覆盖突发增量。';
    } else if (!badFc && nearShare >= 0.5) {
      insight = '🔎 <b>推断：接起能力（非量级）是主因。</b>实际服务量与预测量基本吻合，' +
        '但 Miss 的 <b>' + (nearShare * 100).toFixed(1) + '%</b> 集中在与预测一致的时段，说明排班匹配度尚可，问题更可能出在话务技能、系统稳定性或短时并发上。';
    } else if (badFc) {
      insight = '🔎 <b>推断：量级与能力双重因素。</b>实际服务量超预测 ' + ((cur.totBias - 1) * 100).toFixed(1) + '%，' +
        'Miss 在超预测时段占 ' + (overShare * 100).toFixed(1) + '%、在与预测一致时段占 ' + (nearShare * 100).toFixed(1) + '%，需同时评估预测模型与接起能力。';
    } else {
      insight = '🔎 <b>推断：量级正常，需关注能力侧。</b>实际服务量 ' + (cur.totBias != null ? (cur.totBias * 100).toFixed(0) + '%' : '—') + ' 于预测，' +
        'Miss 分布未见明显的量级集中特征。';
    }
    P.push('<div class="rpt-sub">' + insight + '</div>');
  }

  if (cur.hasFc && cur.fcSlices && cur.fcSlices.length) {
    const impacts = computeOverForecastImpactDetail(cur);
    if (impacts.length) {
      const totalMiss = impacts.reduce((s, x) => s + x.miss, 0);
      P.push('<div class="rpt-sub" style="margin-top:8px">🎯 <b>日度时段超预测影响值</b>（仅统计超预测 &gt;120% 且时段接起率不达标的切片；将 Miss 回补至 30S 接起量后重算日 / 周接起率，影响值 = 回补后接起率 − 实际接起率）</div>');
      P.push('<div class="rpt-sub">符合条件时段共 <b>' + impacts.length + '</b> 个，累计 Miss <b>' + totalMiss + '</b> 单。负值表示该时段拉低整体接起率。</div>');

      const rows = impacts.map((x, i) => {
        const dayColor = x.dayImpact < 0 ? '#D9363E' : '#6EA980';
        const weekColor = x.weekImpact < 0 ? '#D9363E' : '#6EA980';
        const dayDisp = (x.dayImpact >= 0 ? '+' : '') + (x.dayImpact * 100).toFixed(2) + 'pp';
        const weekDisp = (x.weekImpact >= 0 ? '+' : '') + (x.weekImpact * 100).toFixed(2) + 'pp';
        return '<tr>' +
          '<td class="c-rank">' + (i + 1) + '</td>' +
          '<td class="c-fix">' + esc(x.date.slice(5)) + ' ' + esc(x.period) + '时</td>' +
          '<td style="text-align:center">' + Math.round(x.forecast) + '</td>' +
          '<td style="text-align:center">' + Math.round(x.den) + '</td>' +
          '<td style="text-align:center">' + (x.bias * 100).toFixed(1) + '%</td>' +
          '<td style="text-align:center">' + x.miss + '</td>' +
          '<td style="text-align:center;color:#D9363E;font-weight:600">' + (x.rate * 100).toFixed(2) + '%</td>' +
          '<td style="text-align:center;color:' + dayColor + ';font-weight:600">' + dayDisp + '</td>' +
          '<td style="text-align:center;color:' + weekColor + ';font-weight:600">' + weekDisp + '</td>' +
        '</tr>';
      }).join('');
      P.push('<div class="table-scroll-x"><table class="rp-table rp-sticky2"><thead><tr>' +
        '<th class="c-rank">排名</th><th class="c-fix">日期 × 时段</th><th>预测量</th><th>实际量</th><th>超预测率</th><th>Miss</th><th>时段接起率</th><th>日度影响值</th><th>周度影响值</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>');

      const totalMissAll = impacts.reduce((s, x) => s + x.miss, 0);
      const newWeekRate  = (cur.totNum + totalMissAll) / cur.totDen;
      const totalImpact  = newWeekRate - cur.totRate;
      const worst        = impacts[0];
      const top3Miss     = impacts.slice(0, 3).reduce((s, x) => s + x.miss, 0);
      const top3Pct      = totalMissAll > 0 ? (top3Miss / totalMissAll * 100).toFixed(1) : '0';
      P.push('<div class="rpt-sub" style="margin-top:8px;padding:10px 14px;background:#FAF9F7;border-radius:8px;border-left:3px solid #98A8CE;line-height:1.9">' +
        '📌 <b>一句话总结：</b>本周共 <b>' + impacts.length + '</b> 个「超预测且接起不达标」的时段（累计 Miss <b>' + totalMissAll + '</b> 单，其中 TOP3 时段贡献 <b>' + top3Pct + '%</b>）；' +
        '若将这些 Miss 全部回补至接起量，周度 30S 接起率将从 <b>' + (cur.totRate * 100).toFixed(2) + '%</b> 提升至 <b>' + (newWeekRate * 100).toFixed(2) + '%</b>，' +
        '即超预测对周度接起率的拖累约 <b style="color:#D9363E">' + (totalImpact * 100).toFixed(2) + 'pp</b>；' +
        '影响最大的时段为 <b>' + esc(worst.date.slice(5)) + ' ' + esc(worst.period) + '时</b>' +
        '（偏差 ' + (worst.bias * 100).toFixed(0) + '%，Miss ' + worst.miss + '，周度影响 <b style="color:#D9363E">' + (worst.weekImpact * 100).toFixed(2) + 'pp</b>）。' +
      '</div>');
    }
  }

  if (cur.days.length) {
    P.push('<div class="rpt-sub" style="margin-top:8px">📅 <b>日期维度</b></div>');
    const cells = cur.days.map(d => {
      const color = d.hit ? '#6EA980' : '#D9363E';
      const fcTxt = (d.hasFc && d.forecast > 0) ? ' · 预测 ' + Math.round(d.forecast) : '';
      return '<span style="display:inline-block;padding:2px 8px;margin:2px;border-radius:6px;background:#F8F7F4;font-size:11.5px;color:' + color + ';' + (d.hit ? '' : 'font-weight:600') + '">' +
        '<b>' + d.date.slice(5) + '</b> ' + (d.rate != null ? (d.rate * 100).toFixed(2) + '%' : '—') + ' · Miss ' + d.miss + fcTxt + '</span>';
    }).join('');
    P.push('<div class="rpt-sub" style="line-height:2.2">' + cells + '</div>');
    const badDays = cur.days.filter(d => !d.hit);
    if (badDays.length) {
      const worstDay = cur.days.filter(d => d.rate != null).sort((a, b) => a.rate - b.rate)[0];
      const missDay = cur.days.slice().sort((a, b) => b.miss - a.miss)[0];
      P.push('<div class="rpt-sub">→ 未达标 <b>' + badDays.length + '/' + cur.days.length + '</b> 天，接起率最低为 <b>' + worstDay.date + '</b>（' + (worstDay.rate * 100).toFixed(2) + '%）；Miss 量最大为 <b>' + missDay.date + '</b>（Miss ' + missDay.miss + '）。</div>');
    }
  }

  if (cur.periods.length) {
    P.push('<div class="rpt-sub" style="margin-top:8px">⏰ <b>时段维度</b></div>');
    const missTotal = cur.periods.reduce((s, p) => s + p.miss, 0);
    const topMiss = cur.periods.slice().sort((a, b) => b.miss - a.miss).slice(0, 3);
    const topMissSum = topMiss.reduce((s, p) => s + p.miss, 0);
    const topPct = missTotal > 0 ? (topMissSum / missTotal * 100).toFixed(1) : '0';
    const cells = topMiss.map(p => {
      const fcTxt = (p.hasFc && p.forecast > 0) ? ' · 预测 ' + Math.round(p.forecast) : '';
      return '<span style="display:inline-block;padding:2px 8px;margin:2px;border-radius:6px;background:#FDF0F0;font-size:11.5px;color:#B33">' +
        p.period + ' 时 · Miss ' + p.miss + fcTxt + '（接起率 ' + (p.rate * 100).toFixed(2) + '%）</span>';
    }).join('');
    P.push('<div class="rpt-sub" style="line-height:2.2">Miss 量 TOP3 时段：' + cells + '</div>');
    P.push('<div class="rpt-sub">→ 前三时段贡献了 <b>' + topPct + '%</b> 的 Miss 量（' + topMissSum + '/' + missTotal + ' 单）。</div>');
    const lowRate = cur.periods.filter(p => p.den >= 20).sort((a, b) => a.rate - b.rate).slice(0, 3);
    if (lowRate.length) {
      const lc = lowRate.map(p =>
        '<span style="display:inline-block;padding:2px 8px;margin:2px;border-radius:6px;background:#FDF0F0;font-size:11.5px;color:#B33">' +
        p.period + ' 时 · ' + (p.rate * 100).toFixed(2) + '%（服务量 ' + p.den + '）</span>'
      ).join('');
      P.push('<div class="rpt-sub">接起率最低时段（服务量 ≥20）：' + lc + '</div>');
    }
  }

  if (cur.emps.length) {
    P.push('<div class="rpt-sub" style="margin-top:8px">👤 <b>员工维度</b>（按 Miss 量降序 TOP5）</div>');
    const totalMiss = cur.emps.reduce((s, e) => s + e.miss, 0);
    const top5 = cur.emps.slice(0, 5);
    const top5Miss = top5.reduce((s, e) => s + e.miss, 0);
    const top5Pct = totalMiss > 0 ? (top5Miss / totalMiss * 100).toFixed(1) : '0';
    const rows = top5.map((e, i) => {
      const emp = getEmp(e.name);
      const grp = emp ? (emp.group || '—') : '—';
      const color = e.rate >= th ? '#6EA980' : '#D9363E';
      const weight = e.rate >= th ? '400' : '600';
      return '<tr>' +
        '<td class="c-rank">' + (i + 1) + '</td>' +
        '<td class="c-fix">' + esc(e.name) + ' <span style="color:#A0A0AE;font-size:11px">' + esc(grp) + '</span></td>' +
        '<td style="text-align:center">' + fmtInt(e.den) + '</td>' +
        '<td style="text-align:center">' + fmtInt(e.miss) + '</td>' +
        '<td style="text-align:center;color:' + color + ';font-weight:' + weight + '">' + (e.rate * 100).toFixed(2) + '%</td>' +
      '</tr>';
    }).join('');
    P.push('<div class="table-scroll-x"><table class="rp-table rp-sticky2"><thead><tr>' +
      '<th class="c-rank">排名</th><th class="c-fix">员工</th><th>人工服务量</th><th>Miss 量</th><th>接起率</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>');
    P.push('<div class="rpt-sub">→ TOP5 员工贡献了 <b>' + top5Pct + '%</b> 的 Miss 量（' + top5Miss + '/' + totalMiss + ' 单）。</div>');
    const lowEmps = cur.emps.filter(e => e.den >= 30 && e.rate < th).sort((a, b) => a.rate - b.rate).slice(0, 5);
    if (lowEmps.length) {
      P.push('<div class="rpt-sub">服务量 ≥30 单且未达标员工：' +
        lowEmps.map(e => esc(e.name) + '（' + (e.rate * 100).toFixed(2) + '%）').join('、') + '</div>');
    }
  }

  const prev = s30AnalysisData(biz, prevWk);
  if (prev && prev.totDen > 0) {
    const dRate = cur.totRate - prev.totRate;
    const dMiss = (cur.totDen - cur.totNum) - (prev.totDen - prev.totNum);
    const dDen = cur.totDen - prev.totDen;
    const rateColor = dRate >= 0 ? '#6EA980' : '#D9363E';
    P.push('<div class="rpt-sub" style="margin-top:8px">📈 <b>环比维度</b>（vs WK' + prevWk + '）</div>');
    P.push('<div class="rpt-sub">' +
      '接起率 ' + (prev.totRate * 100).toFixed(2) + '% → <b>' + (cur.totRate * 100).toFixed(2) + '%</b>' +
      '（<span style="color:' + rateColor + ';font-weight:600">' + (dRate >= 0 ? '↑' : '↓') + ' ' + (Math.abs(dRate) * 100).toFixed(2) + 'pp</span>）；' +
      'Miss 量 ' + (prev.totDen - prev.totNum) + ' → <b>' + (cur.totDen - cur.totNum) + '</b>（' + (dMiss >= 0 ? '↑' : '↓') + ' ' + Math.abs(dMiss) + '）；' +
      '人工服务量 ' + prev.totDen + ' → <b>' + cur.totDen + '</b>（' + (dDen >= 0 ? '↑' : '↓') + ' ' + Math.abs(dDen) + '）。' +
    '</div>');
    if (cur.hasFc && prev.hasFc && prev.totFc > 0 && cur.totFc > 0) {
      P.push('<div class="rpt-sub">预测量 ' + fmtInt(prev.totFc) + ' → <b>' + fmtInt(cur.totFc) + '</b>（' + ((cur.totFc - prev.totFc) >= 0 ? '↑ ' : '↓ ') + Math.abs(cur.totFc - prev.totFc) + '）；' +
        '预测偏差 ' + (prev.totBias != null ? (prev.totBias * 100).toFixed(1) + '%' : '—') + ' → <b>' + (cur.totBias != null ? (cur.totBias * 100).toFixed(1) + '%' : '—') + '</b>。</div>');
    }
  }

  if (!cur.hit) {
    P.push('<div class="rpt-sub" style="margin-top:8px">💡 <b>改进建议</b></div>');
    const sg = [];
    const badFc = (cur.totBias != null && cur.totBias > 1.2);

    if (badFc) {
      sg.push('<b>【预测与容量】</b>本周实际服务量超预测量 <b>' + ((cur.totBias - 1) * 100).toFixed(1) + '%</b>，' +
        '建议：① 复核预测模型近期是否有结构性偏差（活动、季节性、投放）；' +
        '② 建立「预测偏差 > 120%」的自动预警，提前 1~2 天触发排班弹性加人。');
    }
    if (cur.periods.length) {
      const top3 = cur.periods.slice().sort((a, b) => b.miss - a.miss).slice(0, 3).filter(p => p.den >= 30);
      if (top3.length) {
        const overInTop = top3.filter(p => p.bias != null && p.bias > 1.2).map(p => p.period + '时');
        let s = '重点时段【' + top3.map(p => p.period + '时').join('、') + '】Miss 量最高，建议加强排班密度、预留应急坐席，并检查该时段是否存在系统/网络异常。';
        if (overInTop.length) s += ' 其中【' + overInTop.join('、') + '】属超预测时段，应优先纳入弹性排班名单。';
        sg.push(s);
      }
    }
    if (cur.days.length) {
      const worstDay = cur.days.filter(d => d.rate != null).sort((a, b) => a.rate - b.rate)[0];
      if (worstDay && !worstDay.hit) {
        let s = '【' + worstDay.date + '（周' + weekdayOf(worstDay.date) + '）】接起率最低（' + (worstDay.rate * 100).toFixed(2) + '%），需复盘当日排班、突发量或系统稳定性。';
        if (worstDay.bias != null && worstDay.bias > 1.2) s += ' 当日整体偏差 ' + (worstDay.bias * 100).toFixed(0) + '%，属量超预期情形。';
        sg.push(s);
      }
    }
    if (cur.emps.length) {
      const low = cur.emps.filter(e => e.den >= 20 && e.rate < th - 0.02).sort((a, b) => a.rate - b.rate).slice(0, 3);
      if (low.length) sg.push('【' + low.map(e => e.name).join('、') + '】等员工接起率明显低于目标，建议针对性话术/系统操作培训，必要时一对一辅导。');
    }
    if (cur.gapNum != null && cur.gapNum > 0) {
      let s = '按「（接起量 + 缺口）/（服务量 + 缺口）= ' + thPct + '%」测算，需至少多接起 <b>' + cur.gapNum + ' 单</b>才能达标；若服务量继续增长，需同步扩大接起能力。';
      if (badFc) s += '（本周已出现超预测，扩容需以偏差率为基准，避免按预测值安排。）';
      sg.push(s);
    }
    sg.forEach((s, i) => P.push('<div class="rpt-sub">' + (i + 1) + '. ' + s + '</div>'));
  }

  return P.join('');
}

function s30AnalysisText(biz, wk, prevWk) {
  const cur = s30AnalysisData(biz, wk);
  if (!cur) return [];
  const th = cur.th;
  const thPct = (th * 100).toFixed(2);
  const L = [];

  L.push('### 🔍 30S 接起率 多维度归因分析');
  L.push('');

  if (cur.hit) {
    L.push('- 本周 30S 接起率 **' + (cur.totRate * 100).toFixed(2) + '%** 已达标（目标 ≥ ' + thPct + '%）。');
  } else {
    const gapPp = (th - cur.totRate) * 100;
    const gapTxt = (cur.gapNum != null)
      ? '；按「（接起量 + 缺口）/（服务量 + 缺口）= ' + thPct + '%」测算，接起率缺口为 **' + cur.gapNum + ' 单**才能达标'
      : '；目标值 ≥ 100%，无法通过增加接起量达成';
    L.push('- ⚠ 本周 30S 接起率 **' + (cur.totRate * 100).toFixed(2) + '%** 低于目标 **' + thPct + '%**，差距 **' + gapPp.toFixed(2) + 'pp**' + gapTxt + '。');
  }
  L.push('');

  if (cur.hasFc && cur.totFc > 0) {
    L.push('**📊 预测量级维度**'); L.push('');
    L.push('- 预测量合计：**' + cur.totFc + '** 单');
    L.push('- 实际人工服务量：**' + cur.totDen + '** 单');
    L.push('- 预测偏差（实际/预测）：**' + (cur.totBias != null ? (cur.totBias * 100).toFixed(2) + '%' : '—') + '**' +
      (cur.totBias != null && cur.totBias > 1.2 ? '（超出预测）' : cur.totBias != null && cur.totBias < 1.0 ? '（低于预测）' : '（接近预测）'));
    L.push('- 预测覆盖率：**' + (cur.fcCoverRate * 100).toFixed(1) + '%**');
    L.push('');
    const bk = cur.fcBuckets;
    const totalMissFc = bk.over.miss + bk.near.miss + bk.under.miss;
    L.push('| 偏差分档 | 切片数 | Miss 量 | Miss 占比 |');
    L.push('| --- | ---: | ---: | ---: |');
    L.push('| 超预测（>120%） | ' + bk.over.cnt + ' | ' + bk.over.miss + ' | ' + (totalMissFc > 0 ? (bk.over.miss / totalMissFc * 100).toFixed(1) + '%' : '—') + ' |');
    L.push('| 接近预测（100% ~ 120%） | ' + bk.near.cnt + ' | ' + bk.near.miss + ' | ' + (totalMissFc > 0 ? (bk.near.miss / totalMissFc * 100).toFixed(1) + '%' : '—') + ' |');
    L.push('| 低于预测（<100%） | ' + bk.under.cnt + ' | ' + bk.under.miss + ' | ' + (totalMissFc > 0 ? (bk.under.miss / totalMissFc * 100).toFixed(1) + '%' : '—') + ' |');
    L.push('');
    const overSlices = cur.fcSlices
      .map(o => Object.assign({}, o, { bias: o.den / o.forecast, miss: o.den - o.num }))
      .filter(o => o.bias > 1.2 && o.miss > 0)
      .sort((a, b) => b.miss - a.miss).slice(0, 3);
    if (overSlices.length) {
      L.push('超预测且 Miss>0 的日期×时段 TOP3：');
      for (const o of overSlices) {
        L.push('- ' + o.date.slice(5) + ' ' + o.period + ' 时 · 预测 ' + Math.round(o.forecast) + ' / 实际 ' + Math.round(o.den) +
          '（偏差 ' + (o.bias * 100).toFixed(0) + '%）· Miss ' + o.miss);
      }
      L.push('');
    }
    const overShare = totalMissFc > 0 ? bk.over.miss / totalMissFc : 0;
    const nearShare = totalMissFc > 0 ? bk.near.miss / totalMissFc : 0;
    const badFc = (cur.totBias != null && cur.totBias > 1.2);
    let insight;
    if (badFc && overShare >= 0.5) {
      insight = '🔎 **推断：量级超预测是主因。**本周实际服务量超预测量 ' + ((cur.totBias - 1) * 100).toFixed(1) + '%，Miss 的 ' + (overShare * 100).toFixed(1) + '% 集中在超预测时段。';
    } else if (!badFc && nearShare >= 0.5) {
      insight = '🔎 **推断：接起能力（非量级）是主因。**实际服务量与预测量基本吻合，但 Miss 的 ' + (nearShare * 100).toFixed(1) + '% 集中在与预测一致的时段。';
    } else if (badFc) {
      insight = '🔎 **推断：量级与能力双重因素。**实际服务量超预测 ' + ((cur.totBias - 1) * 100).toFixed(1) + '%，Miss 分布同时受量级和能力影响。';
    } else {
      insight = '🔎 **推断：量级正常，需关注能力侧。**实际服务量 ' + (cur.totBias != null ? (cur.totBias * 100).toFixed(0) + '%' : '—') + ' 于预测。';
    }
    L.push(insight);
    L.push('');
  }

  if (cur.hasFc && cur.fcSlices && cur.fcSlices.length) {
    const impacts = computeOverForecastImpactDetail(cur);
    if (impacts.length) {
      const totalMiss = impacts.reduce((s, x) => s + x.miss, 0);
      L.push('**🎯 日度时段超预测影响值**（仅统计超预测 >120% 且时段接起率不达标的切片；将 Miss 回补至 30S 接起量后重算日 / 周接起率，影响值 = 回补后接起率 − 实际接起率）');
      L.push('');
      L.push('- 符合条件时段共 **' + impacts.length + '** 个，累计 Miss **' + totalMiss + '** 单');
      L.push('- 负值表示该时段拉低整体接起率');
      L.push('');
      L.push('| 排名 | 日期 × 时段 | 预测量 | 实际量 | 超预测率 | Miss | 时段接起率 | 日度影响值 | 周度影响值 |');
      L.push('| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
      for (let i = 0; i < impacts.length; i++) {
        const x = impacts[i];
        const dayDisp = (x.dayImpact >= 0 ? '+' : '') + (x.dayImpact * 100).toFixed(2) + 'pp';
        const weekDisp = (x.weekImpact >= 0 ? '+' : '') + (x.weekImpact * 100).toFixed(2) + 'pp';
        L.push('| ' + (i + 1) + ' | ' + x.date.slice(5) + ' ' + x.period + '时 | ' + Math.round(x.forecast) +
          ' | ' + Math.round(x.den) + ' | ' + (x.bias * 100).toFixed(1) + '% | ' + x.miss +
          ' | ' + (x.rate * 100).toFixed(2) + '% | ' + dayDisp + ' | ' + weekDisp + ' |');
      }
      L.push('');

      const totalMissAll = impacts.reduce((s, x) => s + x.miss, 0);
      const newWeekRate  = (cur.totNum + totalMissAll) / cur.totDen;
      const totalImpact  = newWeekRate - cur.totRate;
      const worst        = impacts[0];
      const top3Miss     = impacts.slice(0, 3).reduce((s, x) => s + x.miss, 0);
      const top3Pct      = totalMissAll > 0 ? (top3Miss / totalMissAll * 100).toFixed(1) : '0';
      L.push('📌 **一句话总结：** 本周共 **' + impacts.length + '** 个「超预测且接起不达标」的时段（累计 Miss **' + totalMissAll + '** 单，其中 TOP3 时段贡献 **' + top3Pct + '%**）；若将这些 Miss 全部回补至接起量，周度 30S 接起率将从 **' + (cur.totRate * 100).toFixed(2) + '%** 提升至 **' + (newWeekRate * 100).toFixed(2) + '%**，即超预测对周度接起率的拖累约 **' + (totalImpact * 100).toFixed(2) + 'pp**；影响最大的时段为 **' + worst.date.slice(5) + ' ' + worst.period + '时**（偏差 ' + (worst.bias * 100).toFixed(0) + '%，Miss ' + worst.miss + '，周度影响 **' + (worst.weekImpact * 100).toFixed(2) + 'pp**）。');
      L.push('');
    }
  }

  if (cur.days.length) {
    L.push('**📅 日期维度**'); L.push('');
    L.push('| 日期 | 接起率 | Miss 量 | 预测量 | 预测偏差 | 是否达标 |');
    L.push('| --- | ---: | ---: | ---: | ---: | :---: |');
    for (const d of cur.days) {
      L.push('| ' + d.date.slice(5) + ' 周' + weekdayOf(d.date) + ' | ' + (d.rate != null ? (d.rate * 100).toFixed(2) + '%' : '—') +
        ' | ' + d.miss +
        ' | ' + (d.hasFc ? Math.round(d.forecast) : '—') +
        ' | ' + (d.bias != null ? (d.bias * 100).toFixed(0) + '%' : '—') +
        ' | ' + (d.hit ? '✅' : '❌') + ' |');
    }
    L.push('');
  }

  if (cur.periods.length) {
    L.push('**⏰ 时段维度**（按 Miss 量降序 TOP5）'); L.push('');
    L.push('| 时段 | 人工服务量 | Miss 量 | 接起率 | 预测量 | 预测偏差 |');
    L.push('| --- | ---: | ---: | ---: | ---: | ---: |');
    const sortedP = cur.periods.slice().sort((a, b) => b.miss - a.miss).slice(0, 5);
    for (const p of sortedP) {
      L.push('| ' + p.period + ' 时 | ' + p.den + ' | ' + p.miss + ' | ' + (p.rate * 100).toFixed(2) + '%' +
        ' | ' + (p.hasFc ? Math.round(p.forecast) : '—') +
        ' | ' + (p.bias != null ? (p.bias * 100).toFixed(0) + '%' : '—') + ' |');
    }
    L.push('');
  }

  if (cur.emps.length) {
    L.push('**👤 员工维度**（按 Miss 量降序 TOP5）'); L.push('');
    L.push('| 排名 | 员工 | 人工服务量 | Miss 量 | 接起率 |');
    L.push('| ---: | --- | ---: | ---: | ---: |');
    cur.emps.slice(0, 5).forEach((e, i) => {
      const emp = getEmp(e.name);
      const grp = emp ? (emp.group || '—') : '—';
      L.push('| ' + (i + 1) + ' | ' + e.name + '（' + grp + '） | ' + e.den + ' | ' + e.miss + ' | ' + (e.rate * 100).toFixed(2) + '% |');
    });
    L.push('');
  }

  const prev = s30AnalysisData(biz, prevWk);
  if (prev && prev.totDen > 0) {
    const dRate = cur.totRate - prev.totRate;
    const dMiss = (cur.totDen - cur.totNum) - (prev.totDen - prev.totNum);
    const dDen = cur.totDen - prev.totDen;
    L.push('**📈 环比维度**（vs WK' + prevWk + '）'); L.push('');
    L.push('- 接起率：' + (prev.totRate * 100).toFixed(2) + '% → **' + (cur.totRate * 100).toFixed(2) + '%**（' + (dRate >= 0 ? '↑' : '↓') + ' ' + (Math.abs(dRate) * 100).toFixed(2) + 'pp）');
    L.push('- Miss 量：' + (prev.totDen - prev.totNum) + ' → **' + (cur.totDen - cur.totNum) + '**（' + (dMiss >= 0 ? '↑' : '↓') + ' ' + Math.abs(dMiss) + '）');
    L.push('- 人工服务量：' + prev.totDen + ' → **' + cur.totDen + '**（' + (dDen >= 0 ? '↑' : '↓') + ' ' + Math.abs(dDen) + '）');
    if (cur.hasFc && prev.hasFc && prev.totFc > 0 && cur.totFc > 0) {
      L.push('- 预测量：' + prev.totFc + ' → **' + cur.totFc + '**（' + ((cur.totFc - prev.totFc) >= 0 ? '↑ ' : '↓ ') + Math.abs(cur.totFc - prev.totFc) + '）');
      L.push('- 预测偏差：' + (prev.totBias != null ? (prev.totBias * 100).toFixed(1) + '%' : '—') + ' → **' + (cur.totBias != null ? (cur.totBias * 100).toFixed(1) + '%' : '—') + '**');
    }
    L.push('');
  }

  if (!cur.hit) {
    L.push('**💡 改进建议**'); L.push('');
    const sg = [];
    const badFc = (cur.totBias != null && cur.totBias > 1.2);

    if (badFc) {
      sg.push('【预测与容量】本周实际服务量超预测量 **' + ((cur.totBias - 1) * 100).toFixed(1) + '%**，' +
        '建议：① 复核预测模型近期是否有结构性偏差（活动、季节性、投放）；' +
        '② 建立「预测偏差 > 120%」的自动预警，提前 1~2 天触发排班弹性加人。');
    }
    if (cur.periods.length) {
      const top3 = cur.periods.slice().sort((a, b) => b.miss - a.miss).slice(0, 3).filter(p => p.den >= 30);
      if (top3.length) {
        const overInTop = top3.filter(p => p.bias != null && p.bias > 1.2).map(p => p.period + '时');
        let s = '重点时段【' + top3.map(p => p.period + '时').join('、') + '】Miss 量最高，建议加强排班密度、预留应急坐席，并检查该时段是否存在系统/网络异常。';
        if (overInTop.length) s += ' 其中【' + overInTop.join('、') + '】属超预测时段，应优先纳入弹性排班名单。';
        sg.push(s);
      }
    }
    if (cur.days.length) {
      const worstDay = cur.days.filter(d => d.rate != null).sort((a, b) => a.rate - b.rate)[0];
      if (worstDay && !worstDay.hit) {
        let s = '【' + worstDay.date + '（周' + weekdayOf(worstDay.date) + '）】接起率最低（' + (worstDay.rate * 100).toFixed(2) + '%），需复盘当日排班、突发量或系统稳定性。';
        if (worstDay.bias != null && worstDay.bias > 1.2) s += ' 当日整体偏差 ' + (worstDay.bias * 100).toFixed(0) + '%，属量超预期情形。';
        sg.push(s);
      }
    }
    if (cur.emps.length) {
      const low = cur.emps.filter(e => e.den >= 20 && e.rate < th - 0.02).sort((a, b) => a.rate - b.rate).slice(0, 3);
      if (low.length) sg.push('【' + low.map(e => e.name).join('、') + '】等员工接起率明显低于目标，建议针对性话术/系统操作培训，必要时一对一辅导。');
    }
    if (cur.gapNum != null && cur.gapNum > 0) {
      let s = '按「（接起量 + 缺口）/（服务量 + 缺口）= ' + thPct + '%」测算，需至少多接起 **' + cur.gapNum + ' 单**才能达标；若服务量继续增长，需同步扩大接起能力。';
      if (badFc) s += '（本周已出现超预测，扩容需以偏差率为基准，避免按预测值安排。）';
      sg.push(s);
    }
    sg.forEach((s, i) => L.push((i + 1) + '. ' + s));
    L.push('');
  }

  return L;
}

/* ==================== 周报 · 结论 ==================== */
function reportConclusion(d) {
  const { biz, cur, prev, s30Cur, s30Prev, groups, aht2, att } = d;
  const hasPrev = prev.caseVolume > 0;
  const out = [];
  if (cur.caseVolume > 0) {
    let s = '本周 <b>' + esc(biz) + '</b> 共处理 CASE <b>' + fmtInt(cur.caseVolume) + '</b> 单';
    if (hasPrev) {
      const dv = cur.caseVolume - prev.caseVolume;
      if (Math.abs(dv) < 1) s += '，与上周基本持平';
      else {
        const pct = prev.caseVolume > 0 ? Math.abs(dv / prev.caseVolume * 100).toFixed(1) : '—';
        s += '，较上周 <span class="' + (dv > 0 ? 'up' : 'down') + '">' + (dv > 0 ? '↑' : '↓') + ' ' + fmtInt(Math.abs(dv)) + ' 单（' + pct + '%）</span>';
      }
    }
    s += '。'; out.push(s);
  }
  const parts2 = [];
  if (cur.cpd != null) { let t = '人均 CPD <b>' + cur.cpd.toFixed(2) + '</b>'; if (hasPrev && prev.cpd != null) { const dv = cur.cpd - prev.cpd; if (Math.abs(dv) >= 0.01) t += '（<span class="' + (dv > 0 ? 'up' : 'down') + '">' + (dv > 0 ? '↑' : '↓') + ' ' + Math.abs(dv).toFixed(2) + '</span>）'; } parts2.push(t); }
  if (cur.aht != null) { let t = 'AHT <b>' + cur.aht.toFixed(2) + '</b> 分钟'; if (hasPrev && prev.aht != null) { const dv = cur.aht - prev.aht; if (Math.abs(dv) >= 0.01) t += '（<span class="' + (dv < 0 ? 'up' : 'down') + '">' + (dv > 0 ? '↑' : '↓') + ' ' + Math.abs(dv).toFixed(2) + '</span>）'; } parts2.push(t); }
  if (parts2.length) out.push(parts2.join('，') + '。');
  const parts3 = [];
  if (cur.solveRate != null) parts3.push('解决率 <b>' + (cur.solveRate * 100).toFixed(2) + '%</b>');
  if (cur.satisfaction != null) parts3.push('满意度 <b>' + (cur.satisfaction * 100).toFixed(2) + '%</b>');
  if (cur.qualityPassRate != null) parts3.push('质检合格率 <b>' + (cur.qualityPassRate * 100).toFixed(2) + '%</b>');
  if (parts3.length) out.push(parts3.join('，') + '。');
  if (s30Cur && s30Cur.s30Den > 0) {
    const th = s30Threshold(biz);
    const rate = s30Cur.s30Rate;
    const ok = rate != null && rate >= th;
    let s = '30S 接起率 <b>' + (rate != null ? (rate * 100).toFixed(2) + '%' : '—') + '</b>（目标 ≥ ' + (th * 100).toFixed(2) + '%），' + (ok ? '<span class="up">已达标</span>' : '<span class="down">未达标</span>') + '，Miss 量 ' + fmtInt(s30Cur.s30Miss) + ' 单';
    if (s30Prev && s30Prev.s30Den > 0 && s30Prev.s30Rate != null && rate != null) {
      const dv = rate - s30Prev.s30Rate;
      if (Math.abs(dv) >= 0.0001) s += '，环比 ' + (dv > 0 ? '<span class="up">↑ ' : '<span class="down">↓ ') + (Math.abs(dv) * 100).toFixed(2) + '%</span>';
    }
    s += '。'; out.push(s);
  }
  if (groups && groups.length >= 2) {
    const sorted = groups.slice().sort((a, b) => (b.cur.cpd || 0) - (a.cur.cpd || 0));
    const best = sorted[0], worst = sorted[sorted.length - 1];
    if (best.cur.cpd != null && worst.cur.cpd != null && best.cur.cpd > worst.cur.cpd) {
      out.push('组别 CPD 表现：<b>' + esc(best.name) + '</b> 最高（' + best.cur.cpd.toFixed(2) + '），<b>' + esc(worst.name) + '</b> 最低（' + worst.cur.cpd.toFixed(2) + '），差距 ' + (best.cur.cpd - worst.cur.cpd).toFixed(2) + '。');
    }
  }
  if (aht2) {
    const topImpact = aht2.list.filter(o => o.impact != null && o.volNow > 0).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 3);
    if (topImpact.length) {
      const seg = topImpact.map(o => {
        const good = o.impact < 0;
        return '<b>' + esc(o.l1) + ' / ' + esc(o.l2) + '</b>（<span class="' + (good ? 'up' : 'down') + '">' + (o.impact > 0 ? '+' : '') + o.impact.toFixed(2) + '</span>）';
      }).join('、');
      out.push('AHT 影响值最大的二级打点：' + seg + '。');
    }
  }
  if (att && att.sum > 0) out.push('本周出勤合计 <b>' + att.sum.toFixed(2) + '</b> 天，人均 <b>' + att.avg.toFixed(2) + '</b> 天。');
  return out;
}

/* ==================== 周报 · 构建 ==================== */
function buildReport(biz, wk) {
  const src = bizToSrc(biz);
  const prevWk = wk - 1;
  const month = S.month;
  const monthLabel = month ? parseInt(month.slice(5,7),10) + '月' : '月度';
  const targets = getTargets(biz);
  const wkSet = new Set([wk]);
  const prevSet = new Set([prevWk]);
  const monthSet = new Set([month]);
  const weekCur  = calcBySrc(src, { wkSet });
  const weekPrev = calcBySrc(src, { wkSet: prevSet });
  const monthCur = calcBySrc(src, { monthSet });
  const s30wCur  = calcByL1(biz, { wkSet });
  const s30wPrev = calcByL1(biz, { wkSet: prevSet });
  const s30mCur  = calcByL1(biz, { monthSet });
  const srcEmps = srcEmployeeSet(src);
  const emps = S.roster.filter(e => srcEmps.has(e.name));
  const byCat = {};
  for (const cat of ['首月','次月','老人']) {
    const names = emps.filter(e => (categoryOf(e, month) || '').includes(cat)).map(e => e.name);
    if (!names.length) { byCat[cat] = null; continue; }
    const nameSet = new Set(names);
    byCat[cat] = {
      count: names.length,
      weekCur: calcBySrc(src, { wkSet, nameSet }),
      weekPrev: calcBySrc(src, { wkSet: prevSet, nameSet })
    };
  }
  const dayRows = [];
  for (let i = 0; i < 7; i++) {
    const day = dateAdd(wkStartDate(wk), i);
    if (!day) continue;
    dayRows.push({ day, cur: calcBySrc(src, { dateSet: new Set([day]) }) });
  }
  const allEmps = S.roster.filter(e => employeeVisible(e) && srcEmps.has(e.name));
  const groupMap = {};
  for (const e of allEmps) {
    const g = e.group || '—';
    (groupMap[g] = groupMap[g] || []).push(e.name);
  }
  const groups = Object.keys(groupMap).sort().map(g => {
    const nameSet = new Set(groupMap[g]);
    const c = calcBySrc(src, { nameSet, wkSet });
    if (c.caseVolume === 0) return null;
    return { name: g, count: nameSet.size, cur: c, prev: calcBySrc(src, { nameSet, wkSet: prevSet }) };
  }).filter(Boolean);
  const empRows = allEmps.map(e => {
    const nameSet = new Set([e.name]);
    return {
      name: e.name, group: e.group || '—',
      cur: calcBySrc(src, { nameSet, wkSet }),
      prev: calcBySrc(src, { nameSet, wkSet: prevSet })
    };
  }).filter(x => x.cur.caseVolume > 0);
  const att = attendanceByWeek(allEmps, wk);
  return {
    biz, src, wk, prevWk, month, monthLabel,
    week:  { cur: weekCur,  prev: weekPrev },
    month: { cur: monthCur },
    s30:   { week: { cur: s30wCur, prev: s30wPrev }, month: { cur: s30mCur } },
    byCat,
    schedule: { week: bizAttendanceCount(biz, wk), prev: bizAttendanceCount(biz, prevWk) },
    aht2: aht2ByWeek(biz, wk),
    targets,
    range: [wkStartDate(wk), wkEndDate(wk)],
    dayRows, groups, emps: empRows, att,
    cur: weekCur, prev: weekPrev,
    s30Cur: s30wCur, s30Prev: s30wPrev,
  };
}

/* ==================== 周报 · HTML ==================== */
function reportHTML(d) {
  const { biz, wk, prevWk, monthLabel, week, s30, byCat, schedule, aht2, targets, range, dayRows, groups, emps, att } = d;
  const cur = week.cur, prev = week.prev, mCur = d.month.cur;
  const tgt = targets || {};
  const reasons = JSON.parse(localStorage.getItem('creator_aht2_reason') || '{}');
  const src = d.src;
  const P = [];

  P.push('<div class="rp-wrap"><div class="rp-head"><h2>📄 ' + esc(biz) + ' · 数据周报</h2><div class="rp-meta">' +
    '<span>周次：<b>WK' + wk + '</b>（' + range[0] + ' ~ ' + range[1] + '）</span>' +
    '<span>对比：<b>WK' + prevWk + '</b></span>' +
    '<span>生成：' + new Date().toLocaleString('zh-CN') + '</span>' +
  '</div></div>');

  P.push('<div class="rp-section"><h3>一、周报数据汇报</h3><div class="rpt-body">');
  P.push('<h4 class="sub-title">📊 核心指标</h4>');
  {
    const hasPrev = prev.caseVolume > 0;
    const cards = METRICS.map(m => {
      const v = cur[m.key];
      const p = hasPrev ? prev[m.key] : null;
      let dHtml = '<span class="delta-flat">—</span>';
      let badge = '<span class="rp-badge flat">—</span>';
      if (v != null && p != null && isFinite(v) && isFinite(p)) {
        const dv = v - p;
        if (Math.abs(dv) < 1e-9) { dHtml = '<span class="delta-flat">0</span>'; badge = '<span class="rp-badge flat">持平</span>'; }
        else {
          const up = dv > 0;
          const good = m.better === 'up' ? up : !up;
          const s = m.pct ? (Math.abs(dv) * 100).toFixed(m.digits) + '%' : Math.abs(dv).toFixed(m.digits);
          dHtml = '<span class="' + (good ? 'delta-up' : 'delta-down') + '">' + (up ? '↑' : '↓') + ' ' + s + '</span>';
          badge = good ? '<span class="rp-badge ok">向好</span>' : '<span class="rp-badge warn">走弱</span>';
        }
      }
      return '<div class="rp-kpi"><div class="k">' + esc(metricLabel(m)) + '</div><div class="v">' + fmtVal(v, m) + '</div><div class="d">' + dHtml + ' ' + badge + '</div></div>';
    }).join('');
    P.push('<div class="rp-kpis">' + cards + '</div>');
  }
  if (dayRows && dayRows.length) {
    P.push('<h4 class="sub-title">📅 本周每日趋势</h4>');
    const rows = dayRows.map(x => {
      const c = x.cur;
      return '<tr><td>' + x.day.slice(5) + ' 周' + weekdayOf(x.day) + '</td><td>' + fmtInt(c.caseVolume) + '</td><td>' + fmtVal(c.cpd, METRIC_MAP.cpd) + '</td><td>' + fmtVal(c.aht, METRIC_MAP.aht) + '</td><td>' + fmtVal(c.solveRate, METRIC_MAP.solveRate) + '</td><td>' + fmtVal(c.satisfaction, METRIC_MAP.satisfaction) + '</td></tr>';
    }).join('');
    P.push('<div class="table-scroll-x"><table class="rp-table"><thead><tr><th>日期</th><th>CASE</th><th>CPD</th><th>AHT</th><th>解决率</th><th>满意度</th></tr></thead><tbody>' + rows + '</tbody></table></div>');
  }
  if (groups && groups.length) {
    P.push('<h4 class="sub-title">👥 团队表现</h4>');
    const rows = groups.map(g => {
      const c = g.cur;
      return '<tr><td>' + esc(g.name) + '</td><td>' + g.count + '</td><td>' + fmtInt(c.caseVolume) + '</td><td>' + fmtVal(c.cpd, METRIC_MAP.cpd) + '</td><td>' + fmtVal(c.aht, METRIC_MAP.aht) + '</td><td>' + fmtVal(c.concurrency, METRIC_MAP.concurrency) + '</td><td>' + fmtVal(c.solveRate, METRIC_MAP.solveRate) + '</td><td>' + fmtVal(c.satisfaction, METRIC_MAP.satisfaction) + '</td><td>' + fmtVal(c.qualityPassRate, METRIC_MAP.qualityPassRate) + '</td></tr>';
    }).join('');
    P.push('<div class="table-scroll-x"><table class="rp-table"><thead><tr><th>组别</th><th>人数</th><th>CASE</th><th>CPD</th><th>AHT</th><th>并发</th><th>解决率</th><th>满意度</th><th>质检合格率</th></tr></thead><tbody>' + rows + '</tbody></table></div>');
  }
  if (emps && emps.length) {
    P.push('<h4 class="sub-title">🏆 员工榜单</h4>');
    const topCase = emps.slice().sort((a, b) => b.cur.caseVolume - a.cur.caseVolume).slice(0, 5);
    const topQual = emps.filter(e => e.cur.qualityPassRate != null && e.cur.qualityPassRate > 0).sort((a, b) => b.cur.qualityPassRate - a.cur.qualityPassRate).slice(0, 5);
    const watch = emps.filter(e => e.prev.caseVolume > 0).map(e => ({ e, dv: e.cur.caseVolume - e.prev.caseVolume })).filter(x => x.dv < 0).sort((a, b) => a.dv - b.dv).slice(0, 3);
    const listHTML = (arr, render) => arr.length ? '<ol>' + arr.map(render).join('') + '</ol>' : '<div class="empty">暂无数据</div>';
    P.push('<div class="rp-rank">' +
      '<div class="rp-rank-box"><h4>🏆 CASE 处理量 TOP5</h4>' + listHTML(topCase, e => '<li><b>' + esc(e.name) + '</b><span class="g">' + esc(e.group) + '</span> · ' + fmtInt(e.cur.caseVolume) + ' 单</li>') + '</div>' +
      '<div class="rp-rank-box"><h4>⭐ 质检合格率 TOP5</h4>' + listHTML(topQual, e => '<li><b>' + esc(e.name) + '</b><span class="g">' + esc(e.group) + '</span> · ' + (e.cur.qualityPassRate * 100).toFixed(2) + '%</li>') + '</div>' +
      '<div class="rp-rank-box"><h4>⚠️ CASE 环比降幅 TOP3</h4>' + listHTML(watch, x => '<li><b>' + esc(x.e.name) + '</b><span class="g">' + esc(x.e.group) + '</span> · <span class="down">↓ ' + fmtInt(Math.abs(x.dv)) + ' 单</span></li>') + '</div>' +
    '</div>');
  }

  if (s30.week.cur.s30Den > 0) {
    P.push('<h4 class="sub-title">📞 30S 接起</h4>');
    const th = s30Threshold(biz);
    const rate = s30.week.cur.s30Rate;
    const ok = rate != null && rate >= th;
    const prevRate = s30.week.prev.s30Den > 0 ? s30.week.prev.s30Rate : null;
    let rateD = '<span class="delta-flat">—</span>';
    if (rate != null && prevRate != null) {
      const dv = rate - prevRate;
      if (Math.abs(dv) < 1e-9) rateD = '<span class="delta-flat">持平</span>';
      else rateD = '<span class="' + (dv > 0 ? 'delta-up' : 'delta-down') + '">' + (dv > 0 ? '↑' : '↓') + ' ' + (Math.abs(dv) * 100).toFixed(2) + '%</span>';
    }
    const rateDisp = (rate != null ? (rate * 100).toFixed(2) + '%' : '—');
    const rateHtml = (rate != null && !ok) ? '<span class="rate-bad">' + rateDisp + '</span>' : rateDisp;
    P.push('<div class="rp-kpis">' +
      '<div class="rp-kpi"><div class="k">30S 接起率</div><div class="v">' + rateHtml + '</div><div class="d">' + rateD + ' ' + (ok ? '<span class="rp-badge ok">达标</span>' : '<span class="rp-badge warn">未达标</span>') + '</div></div>' +
      '<div class="rp-kpi"><div class="k">30S 接起量</div><div class="v">' + fmtInt(s30.week.cur.s30Num) + '</div></div>' +
      '<div class="rp-kpi"><div class="k">人工服务量</div><div class="v">' + fmtInt(s30.week.cur.s30Den) + '</div></div>' +
      '<div class="rp-kpi"><div class="k">30S Miss 量</div><div class="v">' + fmtInt(s30.week.cur.s30Miss) + '</div></div>' +
      '<div class="rp-kpi"><div class="k">达标阈值</div><div class="v">≥ ' + (th * 100).toFixed(2) + '%</div></div>' +
    '</div>');
    P.push(s30AnalysisHTML(biz, wk, prevWk));
  }

  if (att && att.sum > 0) {
    P.push('<h4 class="sub-title">🗓 出勤概况</h4>');
    const zeroCount = att.rows.filter(r => r.total === 0).length;
    const lowList = att.rows.filter(r => r.total > 0 && r.total < 3).sort((a, b) => a.total - b.total);
    P.push('<div class="rp-kpis">' +
      '<div class="rp-kpi"><div class="k">周出勤合计</div><div class="v">' + att.sum.toFixed(2) + ' 天</div></div>' +
      '<div class="rp-kpi"><div class="k">人均出勤</div><div class="v">' + att.avg.toFixed(2) + ' 天</div></div>' +
      '<div class="rp-kpi"><div class="k">全勤人数（≥7天）</div><div class="v">' + att.rows.filter(r => r.total >= 7).length + '</div></div>' +
      '<div class="rp-kpi"><div class="k">零出勤人数</div><div class="v">' + zeroCount + '</div></div>' +
    '</div>');
    if (lowList.length) {
      P.push('<p class="muted" style="margin-top:12px">出勤偏低（&lt; 3 天）：' + lowList.slice(0, 10).map(r => esc(r.name) + '（' + r.total.toFixed(2) + '）').join('、') + (lowList.length > 10 ? ' 等 ' + lowList.length + ' 人' : '') + '</p>');
    }
  }
  {
    P.push('<h4 class="sub-title">💡 本周结论</h4>');
    const concl = reportConclusion(d);
    P.push('<div class="rp-text">' + (concl.length ? concl.map(p => '<p>' + p + '</p>').join('') : '<p>本周暂无足够数据生成结论。</p>') + '</div>');
  }
  P.push('</div></div>');

  P.push('<div class="rp-section"><h3>二、人效部分</h3><div class="rpt-body">');

  {
    const c = cur.cpd, cp = prev.cpd, cm = mCur.cpd;
    const cpdTgt = (tgt && tgt.cpd != null) ? Number(tgt.cpd) : null;
    const dd = (c != null && cp != null) ? c - cp : null;
    const arrow = (dd == null || Math.abs(dd) < 1e-9) ? '' : (dd > 0 ? '🔺' : '🔻');
    let s = '<b>①CPD：</b>' + num2(c) + '，<span class="rpt-sep">|</span> 周度WoW：' + num2(dd) + arrow;
    if (cpdTgt != null && c != null) {
      const rate = c / cpdTgt;
      const hit = c >= cpdTgt;
      s += '（周度达成率：' + pct2(rate) + '）' + (hit ? '' : '🔴（未达成）');
    }
    s += ' <span class="rpt-sep">|</span> ' + monthLabel + '目标：' + (cpdTgt != null ? num2(cpdTgt, 0) : '—') + '，' + monthLabel + '达成：' + num2(cm);
    if (cpdTgt != null && cm != null) {
      const mr = cm / cpdTgt;
      const mhit = cm >= cpdTgt;
      s += '（月度达成率：' + pct2(mr) + '）' + (mhit ? '' : '🔴（未达成）');
    }
    s += '；';
    P.push('<div class="rpt-line">' + s + '</div>');
  }

  {
    const bizShort = (biz === '博主合作') ? '博主' : '买手';
    const dv = cur.caseVolume - prev.caseVolume;
    P.push('<div class="rpt-line">本周' + bizShort + '接线量：' + fmtInt(cur.caseVolume) + '（' + fmtInt(prev.caseVolume) + '→' + fmtInt(cur.caseVolume) + '，' + dArrow(dv) + fmtInt(Math.abs(dv)) + '）</div>');

    const cBuyerN = calcBySrcAndL1(src, '买手合作', { wkSet: new Set([wk]) });
    const cBuyerP = calcBySrcAndL1(src, '买手合作', { wkSet: new Set([prevWk]) });
    const dvB = cBuyerN.caseVolume - cBuyerP.caseVolume;
    P.push('<div class="rpt-line">其中买手合作接线量：' + fmtInt(cBuyerN.caseVolume) + '（' + fmtInt(cBuyerP.caseVolume) + '→' + fmtInt(cBuyerN.caseVolume) + '，' + dArrow(dvB) + fmtInt(Math.abs(dvB)) + '）</div>');

    const cBlogN = calcBySrcAndL1(src, '博主合作', { wkSet: new Set([wk]) });
    const cBlogP = calcBySrcAndL1(src, '博主合作', { wkSet: new Set([prevWk]) });
    const dvBl = cBlogN.caseVolume - cBlogP.caseVolume;
    P.push('<div class="rpt-line">其中博主合作接线量：' + fmtInt(cBlogN.caseVolume) + '（' + fmtInt(cBlogP.caseVolume) + '→' + fmtInt(cBlogN.caseVolume) + '，' + dArrow(dvBl) + fmtInt(Math.abs(dvBl)) + '）</div>');

    const schWk = Math.round(schedule.week * 100) / 100;
    const schPrev = Math.round(schedule.prev * 100) / 100;
    const dmp = Math.round((schWk - schPrev) * 100) / 100;
    P.push('<div class="rpt-line">本周' + bizShort + '排班人力：' + schWk.toFixed(2) + '（' + schPrev.toFixed(2) + '→' + schWk.toFixed(2) + '，' + dArrow(dmp) + Math.abs(dmp).toFixed(2) + '）</div>');
  }

  for (const cat of ['老人','次月','首月']) {
    const b = byCat[cat];
    if (!b) continue;
    const cc = b.weekCur.cpd, pc = b.weekPrev.cpd;
    const dd = (cc != null && pc != null) ? cc - pc : null;
    const arrow = (dd == null || Math.abs(dd) < 1e-9) ? '' : (dd > 0 ? '↑' : '↓');
    P.push('<div class="rpt-line">' + cat + 'CPD：' + num2(cc) + '（' + num2(pc) + '→' + num2(cc) + '，' + arrow + num2(Math.abs(dd || 0)) + '）</div>');
  }

  {
    const a = cur.aht, ap = prev.aht, am = mCur.aht;
    const dd = (a != null && ap != null) ? a - ap : null;
    const arrow = (dd == null || Math.abs(dd) < 1e-9) ? '' : (dd > 0 ? '🔺' : '🔻');
    P.push('<div class="rpt-line"><b>②AHT：</b>' + num2(a) + '，<span class="rpt-sep">|</span> 周度WoW：' + num2(dd) + arrow + ' <span class="rpt-sep">|</span> ' + monthLabel + '达成：' + num2(am) + '；</div>');
  }

  {
    const c = cur.concurrency, cp = prev.concurrency, cm = mCur.concurrency;
    const dd = (c != null && cp != null) ? c - cp : null;
    const arrow = (dd == null || Math.abs(dd) < 1e-9) ? '' : (dd > 0 ? '🔺' : '🔻');
    P.push('<div class="rpt-line"><b>③并发：</b>' + num2(c) + '，<span class="rpt-sep">|</span> 周度WoW：' + num2(dd) + arrow + ' <span class="rpt-sep">|</span> ' + monthLabel + '达成：' + num2(cm) + '；</div>');
  }

  for (const cat of ['老人','次月','首月']) {
    const b = byCat[cat];
    if (!b) continue;
    const cc = b.weekCur.concurrency, pc = b.weekPrev.concurrency;
    const dd = (cc != null && pc != null) ? cc - pc : null;
    const arrow = (dd == null || Math.abs(dd) < 1e-9) ? '' : (dd > 0 ? '↑' : '↓');
    P.push('<div class="rpt-line">' + cat + '并发：' + num2(cc) + '（' + num2(pc) + '→' + num2(cc) + '，' + arrow + num2(Math.abs(dd || 0)) + '）</div>');
  }

  {
    const r = s30.week.cur.s30Rate, rp = s30.week.prev.s30Rate, rm = s30.month.cur.s30Rate;
    const dd = (r != null && rp != null) ? r - rp : null;
    const arrow = (dd == null || Math.abs(dd) < 1e-9) ? '' : (dd > 0 ? '🔺' : '🔻');
    const s30Tgt = s30TargetPct(biz);
    const ddPct = (v) => v == null ? '—' : ((v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%');
    const disp = (v) => v == null ? '—' : (v * 100).toFixed(2) + '%';
    let s = '<b>④30s接起率：</b>' + disp(r) + '，<span class="rpt-sep">|</span> 周度WoW：' + ddPct(dd) + arrow;
    if (s30Tgt != null && r != null) {
      const rate = r * 100 / s30Tgt;
      const hit = rate >= 100;
      s += '（周度达成率：' + rate.toFixed(2) + '%）' + (hit ? '' : '🔴（未达成）');
    }
    s += ' <span class="rpt-sep">|</span> ' + monthLabel + '目标：' + (s30Tgt != null ? (s30Tgt * 100).toFixed(2) + '%' : '—') + '，' + monthLabel + '达成：' + disp(rm);
    if (s30Tgt != null && rm != null) {
      const mr = rm * 100 / s30Tgt;
      const mhit = mr >= 100;
      s += '（月度达成率：' + mr.toFixed(2) + '%）' + (mhit ? '' : '🔴（未达成）');
    }
    s += '；';
    P.push('<div class="rpt-line">' + s + '</div>');
  }

  {
    const c = cur.cpd, cp = prev.cpd;
    const dd = (c != null && cp != null) ? c - cp : null;
    P.push('<div class="rpt-line"><b>⑤周度：</b>' + num2(c) + '，【' + (dd == null ? '—' : (dd > 0 ? '+' : '') + dd.toFixed(2)) + '】</div>');
  }

  {
    const u = cur.utilization, up = prev.utilization;
    const du = (u != null && up != null) ? u - up : null;
    const arrow = (du == null || Math.abs(du) < 1e-9) ? '' : (du > 0 ? '↑' : '↓');
    P.push('<div class="rpt-line">本周工时利用率：' + (u != null ? (u*100).toFixed(2) + '%' : '—') + '（' + (up != null ? (up*100).toFixed(2) + '%' : '—') + '→' + (u != null ? (u*100).toFixed(2) + '%' : '—') + '，' + arrow + (du != null ? (Math.abs(du)*100).toFixed(2) + '%' : '—') + '）</div>');
  }

  {
    const aNow = cur.aht, aPrev = prev.aht;
    const ahtRose = (aNow != null && aPrev != null && aNow > aPrev);
    const ahtFell = (aNow != null && aPrev != null && aNow < aPrev);
    const list = aht2.list.filter(o => o.volNow > 0 || o.volPrev > 0);
    let top3 = [];
    if (ahtRose) {
      top3 = list.filter(o =>
        o.impact != null && o.impact < 0 &&
        o.ahtNow != null && o.ahtPrev != null && o.ahtNow > o.ahtPrev
      ).sort((x, y) => x.impact - y.impact).slice(0, 3);
    } else if (ahtFell) {
      top3 = list.filter(o =>
        o.impact != null && o.impact > 0 &&
        o.ahtNow != null && o.ahtPrev != null && o.ahtNow < o.ahtPrev
      ).sort((x, y) => y.impact - x.impact).slice(0, 3);
    } else {
      top3 = list.filter(o => o.impact != null)
        .sort((x, y) => Math.abs(y.impact) - Math.abs(x.impact)).slice(0, 3);
    }
    const tag = ahtRose ? '负贡献' : (ahtFell ? '正贡献' : '影响值');
    P.push('<div class="rpt-line"><b>⑥二级AHT</b>（按影响值大小排序：当周度 AHT 上升时，展示负贡献且自身 AHT 上升的二级AHT；当周度 AHT 下降时，展示正贡献且自身 AHT 下降的二级AHT；当周度 AHT 持平，则展示影响值绝对值前三的二级AHT）</div>');
    if (!top3.length) P.push('<div class="rpt-sub">暂无数据</div>');
    else for (const o of top3) {
      const key = 'aht2r|' + wk + '|' + o.l1 + '|' + o.l2;
      const reason = reasons[key] || '';
      const dv2 = o.volNow - o.volPrev;
      const da = (o.ahtNow != null && o.ahtPrev != null) ? o.ahtNow - o.ahtPrev : null;
      const imp = o.impact;
      const impStr = imp == null ? '—' : Math.abs(imp).toFixed(2);
      P.push('<div class="rpt-sub">【' + esc(o.l2) + '】AHT达成：' + num2(o.ahtNow) + '，周度WOW：' + (da == null ? '—' : dStr(da)) + '，咨询量：(' + fmtInt(o.volPrev) + '→' + fmtInt(o.volNow) + '，' + (dv2 > 0 ? '+' : '') + fmtInt(dv2) + ')，原因：<input class="rpt-input" type="text" data-key="' + esc(key) + '" value="' + esc(reason) + '" placeholder="填写原因">，' + tag + '：' + impStr + '；</div>');
    }
  }

  P.push('</div></div>');

  P.push('<div class="rp-section"><h3>三、质量部分</h3><div class="rpt-body">');
  P.push('<div class="rpt-line">' + metricLineHTML('① 解决率：', cur.solveRate, prev.solveRate, mCur.solveRate, METRIC_MAP.solveRate, tgt, monthLabel) + '</div>');
  for (const cat of ['首月','次月','老人']) {
    const b = byCat[cat];
    if (!b) { P.push('<div class="rpt-sub">' + cat + '解决率：—</div>'); continue; }
    P.push(catLineHTML(cat + '解决率', b.weekCur.solveRate, b.weekPrev.solveRate, METRIC_MAP.solveRate));
  }
  P.push('<div class="rpt-line">' + metricLineHTML('② 满意度：', cur.satisfaction, prev.satisfaction, mCur.satisfaction, METRIC_MAP.satisfaction, tgt, monthLabel) + '</div>');
  for (const cat of ['首月','次月','老人']) {
    const b = byCat[cat];
    if (!b) { P.push('<div class="rpt-sub">' + cat + '满意度：—</div>'); continue; }
    P.push(catLineHTML(cat + '满意度', b.weekCur.satisfaction, b.weekPrev.satisfaction, METRIC_MAP.satisfaction));
  }
  P.push('<div class="rpt-line">' + metricLineHTML('③ 质检合格率：', cur.qualityPassRate, prev.qualityPassRate, mCur.qualityPassRate, METRIC_MAP.qualityPassRate, tgt, monthLabel) + '</div>');
  {
    const inspNow  = inspectionStats({ src, wkSet: new Set([wk]) });
    const inspPrev = inspectionStats({ src, wkSet: new Set([prevWk]) });
    const dTotal = inspNow.total - inspPrev.total;
    const dPass  = inspNow.pass - inspPrev.pass;
    const dFail  = inspNow.fail - inspPrev.fail;
    P.push('<div class="rpt-sub">本周抽检量：' + fmtInt(inspNow.total) + '，（' + fmtInt(inspPrev.total) + '→' + fmtInt(inspNow.total) + '，' + dArrow(dTotal) + fmtInt(Math.abs(dTotal)) + '）</div>');
    P.push('<div class="rpt-sub">合格量：' + fmtInt(inspNow.pass) + '，（' + fmtInt(inspPrev.pass) + '→' + fmtInt(inspNow.pass) + '，' + dArrow(dPass) + fmtInt(Math.abs(dPass)) + '）</div>');
    P.push('<div class="rpt-sub">不合格量：' + fmtInt(inspNow.fail) + '，（' + fmtInt(inspPrev.fail) + '→' + fmtInt(inspNow.fail) + '，' + dArrow(dFail) + fmtInt(Math.abs(dFail)) + '）</div>');
  }
  for (const cat of ['首月','次月','老人']) {
    const b = byCat[cat];
    if (!b) { P.push('<div class="rpt-sub">' + cat + '质检合格率：—</div>'); continue; }
    P.push(catLineHTML(cat + '质检合格率', b.weekCur.qualityPassRate, b.weekPrev.qualityPassRate, METRIC_MAP.qualityPassRate));
  }
  P.push('</div></div>');
  P.push('</div>');
  return P.join('');
}

/* ==================== 周报 · Markdown 文本 ==================== */
function reportToText(d) {
  const { biz, wk, prevWk, monthLabel, week, s30, byCat, schedule, aht2, targets, range, dayRows, groups, emps, att } = d;
  const cur = week.cur, prev = week.prev, mCur = d.month.cur;
  const tgt = targets || {};
  const reasons = JSON.parse(localStorage.getItem('creator_aht2_reason') || '{}');
  const src = d.src;
  const L = [];

  L.push('# ' + biz + ' 数据周报'); L.push('');
  L.push('周次：WK' + wk + '（' + range[0] + ' ~ ' + range[1] + '），对比：WK' + prevWk);
  L.push('生成时间：' + new Date().toLocaleString('zh-CN')); L.push('');

  L.push('## 一、周报数据汇报'); L.push('');
  L.push('### 📊 核心指标'); L.push('');
  L.push('| 指标 | 本周 | 上周 | 环比 |');
  L.push('| --- | ---: | ---: | ---: |');
  {
    const hasPrev = prev.caseVolume > 0;
    for (const m of METRICS) {
      const v = cur[m.key];
      const p = hasPrev ? prev[m.key] : null;
      L.push('| ' + m.label + ' | ' + fmtVal(v, m) + ' | ' + (p != null ? fmtVal(p, m) : '—') + ' | ' + diffText(v, p, m) + ' |');
    }
  }
  L.push('');
  if (dayRows && dayRows.length) {
    L.push('### 📅 本周每日趋势'); L.push('');
    L.push('| 日期 | CASE | CPD | AHT | 解决率 | 满意度 |');
    L.push('| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const x of dayRows) {
      const c = x.cur;
      L.push('| ' + x.day.slice(5) + ' 周' + weekdayOf(x.day) + ' | ' + fmtInt(c.caseVolume) + ' | ' + fmtVal(c.cpd, METRIC_MAP.cpd) + ' | ' + fmtVal(c.aht, METRIC_MAP.aht) + ' | ' + fmtVal(c.solveRate, METRIC_MAP.solveRate) + ' | ' + fmtVal(c.satisfaction, METRIC_MAP.satisfaction) + ' |');
    }
    L.push('');
  }
  if (groups && groups.length) {
    L.push('### 👥 团队表现'); L.push('');
    L.push('| 组别 | 人数 | CASE | CPD | AHT | 并发 | 解决率 | 满意度 | 质检合格率 |');
    L.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const g of groups) {
      const c = g.cur;
      L.push('| ' + g.name + ' | ' + g.count + ' | ' + fmtInt(c.caseVolume) + ' | ' + fmtVal(c.cpd, METRIC_MAP.cpd) + ' | ' + fmtVal(c.aht, METRIC_MAP.aht) + ' | ' + fmtVal(c.concurrency, METRIC_MAP.concurrency) + ' | ' + fmtVal(c.solveRate, METRIC_MAP.solveRate) + ' | ' + fmtVal(c.satisfaction, METRIC_MAP.satisfaction) + ' | ' + fmtVal(c.qualityPassRate, METRIC_MAP.qualityPassRate) + ' |');
    }
    L.push('');
  }
  if (emps && emps.length) {
    L.push('### 🏆 员工榜单'); L.push('');
    const topCase = emps.slice().sort((a, b) => b.cur.caseVolume - a.cur.caseVolume).slice(0, 5);
    const topQual = emps.filter(e => e.cur.qualityPassRate != null && e.cur.qualityPassRate > 0).sort((a, b) => b.cur.qualityPassRate - a.cur.qualityPassRate).slice(0, 5);
    const watch = emps.filter(e => e.prev.caseVolume > 0).map(e => ({ e, dv: e.cur.caseVolume - e.prev.caseVolume })).filter(x => x.dv < 0).sort((a, b) => a.dv - b.dv).slice(0, 3);
    L.push('**🏆 CASE 处理量 TOP5**'); L.push('');
    if (topCase.length) topCase.forEach((e, i) => L.push((i + 1) + '. ' + e.name + '（' + e.group + '）— ' + fmtInt(e.cur.caseVolume) + ' 单'));
    else L.push('暂无数据');
    L.push('');
    L.push('**⭐ 质检合格率 TOP5**'); L.push('');
    if (topQual.length) topQual.forEach((e, i) => L.push((i + 1) + '. ' + e.name + '（' + e.group + '）— ' + (e.cur.qualityPassRate * 100).toFixed(2) + '%'));
    else L.push('暂无数据');
    L.push('');
    L.push('**⚠️ CASE 环比降幅 TOP3**'); L.push('');
    if (watch.length) watch.forEach((x, i) => L.push((i + 1) + '. ' + x.e.name + '（' + x.e.group + '）— ↓ ' + fmtInt(Math.abs(x.dv)) + ' 单'));
    else L.push('暂无数据');
    L.push('');
  }
  if (s30.week.cur.s30Den > 0) {
    L.push('### 📞 30S 接起'); L.push('');
    const th = s30Threshold(biz);
    const rate = s30.week.cur.s30Rate;
    L.push('- 30S 接起率：' + (rate != null ? (rate * 100).toFixed(2) + '%' : '—') + '（阈值 ≥ ' + (th * 100).toFixed(2) + '%，' + (rate != null && rate >= th ? '达标' : '未达标') + '）');
    L.push('- 30S 接起量：' + fmtInt(s30.week.cur.s30Num));
    L.push('- 人工服务量：' + fmtInt(s30.week.cur.s30Den));
    L.push('- 30S Miss 量：' + fmtInt(s30.week.cur.s30Miss));
    L.push('');
    const anal = s30AnalysisText(biz, wk, prevWk);
    if (anal.length) { for (const ln of anal) L.push(ln); }
    L.push('');
  }
  if (att && att.sum > 0) {
    L.push('### 🗓 出勤概况'); L.push('');
    L.push('- 周出勤合计：' + att.sum.toFixed(2) + ' 天');
    L.push('- 人均出勤：' + att.avg.toFixed(2) + ' 天');
    L.push('- 全勤人数（≥7天）：' + att.rows.filter(r => r.total >= 7).length);
    L.push('- 零出勤人数：' + att.rows.filter(r => r.total === 0).length);
    const lowList = att.rows.filter(r => r.total > 0 && r.total < 3).sort((a, b) => a.total - b.total);
    if (lowList.length) L.push('- 出勤偏低（< 3 天）：' + lowList.slice(0, 10).map(r => r.name + '（' + r.total.toFixed(2) + '）').join('、') + (lowList.length > 10 ? ' 等 ' + lowList.length + ' 人' : ''));
    L.push('');
  }
  {
    L.push('### 💡 本周结论'); L.push('');
    const concl = reportConclusion(d);
    if (concl.length) { for (const p of concl) L.push('- ' + p.replace(/<[^>]+>/g, '')); }
    else L.push('本周暂无足够数据生成结论。');
    L.push('');
  }

  L.push('## 二、人效部分'); L.push('');

  {
    const c = cur.cpd, cp = prev.cpd, cm = mCur.cpd;
    const cpdTgt = (tgt && tgt.cpd != null) ? Number(tgt.cpd) : null;
    const dd = (c != null && cp != null) ? c - cp : null;
    const arrow = (dd == null || Math.abs(dd) < 1e-9) ? '' : (dd > 0 ? '🔺' : '🔻');
    let s = '①CPD：' + num2(c) + '，| 周度WoW：' + num2(dd) + arrow;
    if (cpdTgt != null && c != null) {
      const rate = c / cpdTgt;
      s += '（周度达成率：' + pct2(rate) + '）' + (c >= cpdTgt ? '' : '🔴（未达成）');
    }
    s += ' | ' + monthLabel + '目标：' + (cpdTgt != null ? num2(cpdTgt, 0) : '—') + '，' + monthLabel + '达成：' + num2(cm);
    if (cpdTgt != null && cm != null) {
      const mr = cm / cpdTgt;
      s += '（月度达成率：' + pct2(mr) + '）' + (cm >= cpdTgt ? '' : '🔴（未达成）');
    }
    s += '；';
    L.push(s);
  }

  {
    const bizShort = (biz === '博主合作') ? '博主' : '买手';
    const dv = cur.caseVolume - prev.caseVolume;
    L.push('本周' + bizShort + '接线量：' + fmtInt(cur.caseVolume) + '（' + fmtInt(prev.caseVolume) + '→' + fmtInt(cur.caseVolume) + '，' + dArrow(dv) + fmtInt(Math.abs(dv)) + '）');
    const cBuyerN = calcBySrcAndL1(src, '买手合作', { wkSet: new Set([wk]) });
    const cBuyerP = calcBySrcAndL1(src, '买手合作', { wkSet: new Set([prevWk]) });
    const dvB = cBuyerN.caseVolume - cBuyerP.caseVolume;
    L.push('其中买手合作接线量：' + fmtInt(cBuyerN.caseVolume) + '（' + fmtInt(cBuyerP.caseVolume) + '→' + fmtInt(cBuyerN.caseVolume) + '，' + dArrow(dvB) + fmtInt(Math.abs(dvB)) + '）');
    const cBlogN = calcBySrcAndL1(src, '博主合作', { wkSet: new Set([wk]) });
    const cBlogP = calcBySrcAndL1(src, '博主合作', { wkSet: new Set([prevWk]) });
    const dvBl = cBlogN.caseVolume - cBlogP.caseVolume;
    L.push('其中博主合作接线量：' + fmtInt(cBlogN.caseVolume) + '（' + fmtInt(cBlogP.caseVolume) + '→' + fmtInt(cBlogN.caseVolume) + '，' + dArrow(dvBl) + fmtInt(Math.abs(dvBl)) + '）');
    const schWk = Math.round(schedule.week * 100) / 100;
    const schPrev = Math.round(schedule.prev * 100) / 100;
    const dmp = Math.round((schWk - schPrev) * 100) / 100;
    L.push('本周' + bizShort + '排班人力：' + schWk.toFixed(2) + '（' + schPrev.toFixed(2) + '→' + schWk.toFixed(2) + '，' + dArrow(dmp) + Math.abs(dmp).toFixed(2) + '）');
  }

  for (const cat of ['老人','次月','首月']) {
    const b = byCat[cat];
    if (!b) continue;
    const cc = b.weekCur.cpd, pc = b.weekPrev.cpd;
    const dd = (cc != null && pc != null) ? cc - pc : null;
    const arrow = (dd == null || Math.abs(dd) < 1e-9) ? '' : (dd > 0 ? '↑' : '↓');
    L.push(cat + 'CPD：' + num2(cc) + '（' + num2(pc) + '→' + num2(cc) + '，' + arrow + num2(Math.abs(dd || 0)) + '）');
  }

  {
    const a = cur.aht, ap = prev.aht, am = mCur.aht;
    const dd = (a != null && ap != null) ? a - ap : null;
    const arrow = (dd == null || Math.abs(dd) < 1e-9) ? '' : (dd > 0 ? '🔺' : '🔻');
    L.push('②AHT：' + num2(a) + '，| 周度WoW：' + num2(dd) + arrow + ' | ' + monthLabel + '达成：' + num2(am) + '；');
  }

  {
    const c = cur.concurrency, cp = prev.concurrency, cm = mCur.concurrency;
    const dd = (c != null && cp != null) ? c - cp : null;
    const arrow = (dd == null || Math.abs(dd) < 1e-9) ? '' : (dd > 0 ? '🔺' : '🔻');
    L.push('③并发：' + num2(c) + '，| 周度WoW：' + num2(dd) + arrow + ' | ' + monthLabel + '达成：' + num2(cm) + '；');
  }

  for (const cat of ['老人','次月','首月']) {
    const b = byCat[cat];
    if (!b) continue;
    const cc = b.weekCur.concurrency, pc = b.weekPrev.concurrency;
    const dd = (cc != null && pc != null) ? cc - pc : null;
    const arrow = (dd == null || Math.abs(dd) < 1e-9) ? '' : (dd > 0 ? '↑' : '↓');
    L.push(cat + '并发：' + num2(cc) + '（' + num2(pc) + '→' + num2(cc) + '，' + arrow + num2(Math.abs(dd || 0)) + '）');
  }

  {
    const r = s30.week.cur.s30Rate, rp = s30.week.prev.s30Rate, rm = s30.month.cur.s30Rate;
    const dd = (r != null && rp != null) ? r - rp : null;
    const arrow = (dd == null || Math.abs(dd) < 1e-9) ? '' : (dd > 0 ? '🔺' : '🔻');
    const s30Tgt = s30TargetPct(biz);
    const ddPct = (v) => v == null ? '—' : ((v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%');
    const disp = (v) => v == null ? '—' : (v * 100).toFixed(2) + '%';
    let s = '④30s接起率：' + disp(r) + '，| 周度WoW：' + ddPct(dd) + arrow;
    if (s30Tgt != null && r != null) {
      const rate = r * 100 / s30Tgt;
      s += '（周度达成率：' + rate.toFixed(2) + '%）' + (rate >= 100 ? '' : '🔴（未达成）');
    }
    s += ' | ' + monthLabel + '目标：' + (s30Tgt != null ? (s30Tgt * 100).toFixed(2) + '%' : '—') + '，' + monthLabel + '达成：' + disp(rm);
    if (s30Tgt != null && rm != null) {
      const mr = rm * 100 / s30Tgt;
      s += '（月度达成率：' + mr.toFixed(2) + '%）' + (mr >= 100 ? '' : '🔴（未达成）');
    }
    s += '；';
    L.push(s);
  }

  {
    const c = cur.cpd, cp = prev.cpd;
    const dd = (c != null && cp != null) ? c - cp : null;
    L.push('⑤周度：' + num2(c) + '，【' + (dd == null ? '—' : (dd > 0 ? '+' : '') + dd.toFixed(2)) + '】');
  }

  {
    const u = cur.utilization, up = prev.utilization;
    const du = (u != null && up != null) ? u - up : null;
    const arrow = (du == null || Math.abs(du) < 1e-9) ? '' : (du > 0 ? '↑' : '↓');
    L.push('本周工时利用率：' + (u != null ? (u*100).toFixed(2) + '%' : '—') + '（' + (up != null ? (up*100).toFixed(2) + '%' : '—') + '→' + (u != null ? (u*100).toFixed(2) + '%' : '—') + '，' + arrow + (du != null ? (Math.abs(du)*100).toFixed(2) + '%' : '—') + '）');
  }

  {
    const aNow = cur.aht, aPrev = prev.aht;
    const ahtRose = (aNow != null && aPrev != null && aNow > aPrev);
    const ahtFell = (aNow != null && aPrev != null && aNow < aPrev);
    const list = aht2.list.filter(o => o.volNow > 0 || o.volPrev > 0);
    let top3 = [];
    if (ahtRose) top3 = list.filter(o => o.impact != null && o.impact < 0 && o.ahtNow != null && o.ahtPrev != null && o.ahtNow > o.ahtPrev).sort((x, y) => x.impact - y.impact).slice(0, 3);
    else if (ahtFell) top3 = list.filter(o => o.impact != null && o.impact > 0 && o.ahtNow != null && o.ahtPrev != null && o.ahtNow < o.ahtPrev).sort((x, y) => y.impact - x.impact).slice(0, 3);
    else top3 = list.filter(o => o.impact != null).sort((x, y) => Math.abs(y.impact) - Math.abs(x.impact)).slice(0, 3);
    const tag = ahtRose ? '负贡献' : (ahtFell ? '正贡献' : '影响值');
    L.push('⑥二级AHT（按影响值大小排序：当周度 AHT 上升时，展示负贡献且自身 AHT 上升的二级AHT；当周度 AHT 下降时，展示正贡献且自身 AHT 下降的二级AHT；当周度 AHT 持平，则展示影响值绝对值前三的二级AHT）');
    if (!top3.length) L.push('暂无数据');
    else for (const o of top3) {
      const key = 'aht2r|' + wk + '|' + o.l1 + '|' + o.l2;
      const reason = reasons[key] || '（待填写）';
      const dv2 = o.volNow - o.volPrev;
      const da = (o.ahtNow != null && o.ahtPrev != null) ? o.ahtNow - o.ahtPrev : null;
      const imp = o.impact;
      const impStr = imp == null ? '—' : Math.abs(imp).toFixed(2);
      L.push('- 【' + o.l2 + '】AHT达成：' + num2(o.ahtNow) + '，周度WOW：' + (da == null ? '—' : dStr(da)) + '，咨询量：(' + fmtInt(o.volPrev) + '→' + fmtInt(o.volNow) + '，' + (dv2 > 0 ? '+' : '') + fmtInt(dv2) + ')，原因：' + reason + '，' + tag + '：' + impStr + '；');
    }
  }
  L.push('');

  L.push('## 三、质量部分'); L.push('');
  L.push(metricLineText('① 解决率：', cur.solveRate, prev.solveRate, mCur.solveRate, METRIC_MAP.solveRate, tgt, monthLabel));
  for (const cat of ['首月','次月','老人']) {
    const b = byCat[cat];
    if (!b) { L.push(cat + '解决率：—'); continue; }
    L.push(catLineText(cat + '解决率', b.weekCur.solveRate, b.weekPrev.solveRate, METRIC_MAP.solveRate));
  }
  L.push('');
  L.push(metricLineText('② 满意度：', cur.satisfaction, prev.satisfaction, mCur.satisfaction, METRIC_MAP.satisfaction, tgt, monthLabel));
  for (const cat of ['首月','次月','老人']) {
    const b = byCat[cat];
    if (!b) { L.push(cat + '满意度：—'); continue; }
    L.push(catLineText(cat + '满意度', b.weekCur.satisfaction, b.weekPrev.satisfaction, METRIC_MAP.satisfaction));
  }
  L.push('');
  L.push(metricLineText('③ 质检合格率：', cur.qualityPassRate, prev.qualityPassRate, mCur.qualityPassRate, METRIC_MAP.qualityPassRate, tgt, monthLabel));
  {
    const inspNow  = inspectionStats({ src, wkSet: new Set([wk]) });
    const inspPrev = inspectionStats({ src, wkSet: new Set([prevWk]) });
    const dTotal = inspNow.total - inspPrev.total;
    const dPass  = inspNow.pass - inspPrev.pass;
    const dFail  = inspNow.fail - inspPrev.fail;
    L.push('本周抽检量：' + fmtInt(inspNow.total) + '，（' + fmtInt(inspPrev.total) + '→' + fmtInt(inspNow.total) + '，' + dArrow(dTotal) + fmtInt(Math.abs(dTotal)) + '）');
    L.push('合格量：' + fmtInt(inspNow.pass) + '，（' + fmtInt(inspPrev.pass) + '→' + fmtInt(inspNow.pass) + '，' + dArrow(dPass) + fmtInt(Math.abs(dPass)) + '）');
    L.push('不合格量：' + fmtInt(inspNow.fail) + '，（' + fmtInt(inspPrev.fail) + '→' + fmtInt(inspNow.fail) + '，' + dArrow(dFail) + fmtInt(Math.abs(dFail)) + '）');
  }
  for (const cat of ['首月','次月','老人']) {
    const b = byCat[cat];
    if (!b) { L.push(cat + '质检合格率：—'); continue; }
    L.push(catLineText(cat + '质检合格率', b.weekCur.qualityPassRate, b.weekPrev.qualityPassRate, METRIC_MAP.qualityPassRate));
  }
  L.push('');
  return L.join('\n');
}

/* ==================== 周报 · 渲染入口 ==================== */
function renderReport() {
  const el = $('#rpBody');
  if (!el) return;
  const copyBtn = $('#btnRpCopy');
  const mdBtn = $('#btnRpMd');
  if (!S.records.length && !S.wtRecords.length) {
    el.innerHTML = '<p class="muted">尚未导入数据。</p>';
    if (copyBtn) copyBtn.disabled = true;
    if (mdBtn) mdBtn.disabled = true;
    return;
  }
  const bizEl = $('#rpBiz');
  const wkEl = $('#rpWK');
  const biz = (bizEl && bizEl.value) || '买手合作';
  const wkVal = wkEl ? wkEl.value : '';
  if (!wkVal) {
    el.innerHTML = '<p class="muted">暂无可用周次，请先导入含日期的数据。</p>';
    if (copyBtn) copyBtn.disabled = true;
    if (mdBtn) mdBtn.disabled = true;
    return;
  }
  const wk = parseInt(wkVal, 10) || S.latestWK;
  const d = buildReport(biz, wk);
  if (!d.week.cur.caseVolume && !d.s30.week.cur.s30Den) {
    el.innerHTML = '<p class="muted">WK' + wk + ' 暂无数据，请选择其他周次。</p>';
    if (copyBtn) copyBtn.disabled = true;
    if (mdBtn) mdBtn.disabled = true;
    return;
  }
  el.innerHTML = reportHTML(d);
  bindReportInputs();
  if (copyBtn) copyBtn.disabled = false;
  if (mdBtn) mdBtn.disabled = false;
}
function bindReportInputs() {
  const el = $('#rpBody');
  if (!el) return;
  el.querySelectorAll('.rpt-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const all = JSON.parse(localStorage.getItem('creator_aht2_reason') || '{}');
      all[inp.dataset.key] = inp.value;
      localStorage.setItem('creator_aht2_reason', JSON.stringify(all));
    });
  });
}
async function copyReport() {
  const bizEl = $('#rpBiz');
  const wkEl = $('#rpWK');
  const biz = (bizEl && bizEl.value) || '买手合作';
  const wk = parseInt(wkEl && wkEl.value, 10) || S.latestWK;
  const text = reportToText(buildReport(biz, wk));
  try { await navigator.clipboard.writeText(text); toast('✅ 周报已复制到剪贴板'); }
  catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('✅ 周报已复制到剪贴板'); }
    catch (e) { toast('❌ 复制失败，请手动选择文本'); }
    document.body.removeChild(ta);
  }
}
function downloadReportMd() {
  const bizEl = $('#rpBiz');
  const wkEl = $('#rpWK');
  const biz = (bizEl && bizEl.value) || '买手合作';
  const wk = parseInt(wkEl && wkEl.value, 10) || S.latestWK;
  const text = reportToText(buildReport(biz, wk));
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '周报-' + biz + '-WK' + wk + '.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('⬇ 已下载 Markdown 文件');
}

/* ============================================================
   END OF dashboard-report.js
   ============================================================ */