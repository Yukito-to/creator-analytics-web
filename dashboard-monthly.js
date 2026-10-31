/* ============================================================
   创作者数据分析 · 月报层
   （月度数据聚合 / 环比对比 / 每日趋势 / SLA 汇总 / Markdown 导出）
   ============================================================ */
'use strict';

/* ==================== 月报 · 数据构建 ==================== */
function getPrevMonth(monthStr) {
  if (!monthStr) return '';
  const y = parseInt(monthStr.slice(0, 4), 10);
  const m = parseInt(monthStr.slice(5, 7), 10);
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  return prevY + '-' + pad2(prevM);
}

function buildMonthlyReport(biz, month) {
  if (!month) return null;
  const src = bizToSrc(biz);
  const prevMonth = getPrevMonth(month);
  const monthLabel = parseInt(month.slice(5, 7), 10) + '月';
  const prevMonthLabel = parseInt(prevMonth.slice(5, 7), 10) + '月';

  // 核心指标
  const cur = calcBySrc(src, { monthSet: new Set([month]) });
  const prev = calcBySrc(src, { monthSet: new Set([prevMonth]) });
  const s30Cur = calcByL1(biz, { monthSet: new Set([month]) });
  const s30Prev = calcByL1(biz, { monthSet: new Set([prevMonth]) });

  const srcEmps = srcEmployeeSet(src);
  const emps = S.roster.filter(e => srcEmps.has(e.name));
  
  // 分类数据（老人/次月/首月）
  const byCat = {};
  for (const cat of ['首月','次月','老人']) {
    const names = emps.filter(e => (categoryOf(e, month) || '').includes(cat)).map(e => e.name);
    if (!names.length) { byCat[cat] = null; continue; }
    const nameSet = new Set(names);
    byCat[cat] = {
      count: names.length,
      cur: calcBySrc(src, { monthSet: new Set([month]), nameSet }),
      prev: calcBySrc(src, { monthSet: new Set([prevMonth]), nameSet })
    };
  }

  // 每日趋势（有数据的日期）
  const dailyRows = [];
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  for (let i = 1; i <= daysInMonth; i++) {
    const d = month + '-' + pad2(i);
    const c = calcBySrc(src, { dateSet: new Set([d]) });
    if (c.caseVolume > 0 || c.s30Den > 0) {
      dailyRows.push({ date: d, cur: c });
    }
  }

  // 员工排名
  const empRows = emps.map(e => {
    const nameSet = new Set([e.name]);
    return {
      name: e.name, group: e.group || '—',
      cur: calcBySrc(src, { monthSet: new Set([month]), nameSet }),
      prev: calcBySrc(src, { monthSet: new Set([prevMonth]), nameSet })
    };
  }).filter(x => x.cur.caseVolume > 0);

  // SLA 达成情况
  const slaList = [];
  const rawSla = (src === 'buyer') ? S.slaBuyer : S.slaBlogger;
  const curMonthNum = parseInt(month.slice(5, 7), 10);
  if (rawSla && rawSla.length) {
    const list = rawSla.filter(it => it.months[curMonthNum]);
    for (const it of list) {
      const key = matchMetricKey(it.metric);
      const cfg = it.months[curMonthNum];
      const actual = key ? slaAchieve(src, key, it.category) : null;
      const score = calcSlaScore(key, actual, cfg);
      slaList.push({ item: it, key, cfg, actual, score });
    }
  }

  return {
    biz, src, month, monthLabel, prevMonth, prevMonthLabel,
    cur, prev, s30Cur, s30Prev,
    byCat, dailyRows, emps: empRows, slaList
  };
}

/* ==================== 月报 · HTML 渲染 ==================== */
function monthlyReportHTML(d) {
  const { biz, monthLabel, prevMonthLabel, cur, prev, byCat, dailyRows, emps, slaList } = d;
  const hasPrev = prev.caseVolume > 0;
  const P = [];

  P.push('<div class="rp-wrap"><div class="rp-head"><h2>📅 ' + esc(biz) + ' · ' + monthLabel + '月度分析报告</h2><div class="rp-meta">' +
    '<span>数据周期：<b>' + d.month + '</b></span>' +
    '<span>对比周期：<b>' + d.prevMonth + '（' + prevMonthLabel + '）</b></span>' +
    '<span>生成时间：' + new Date().toLocaleString('zh-CN') + '</span>' +
  '</div></div>');

  // 一、核心指标概览
  P.push('<div class="rp-section"><h3>一、月度核心指标</h3><div class="rpt-body">');
  {
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
  P.push('</div></div>');

  // 二、分类与团队表现
  P.push('<div class="rp-section"><h3>二、分类表现</h3><div class="rpt-body">');
  P.push('<div class="table-scroll-x"><table class="rp-table"><thead><tr><th>分类</th><th>人数</th><th>CASE 量</th><th>CPD</th><th>AHT</th><th>解决率</th><th>满意度</th><th>质检合格率</th></tr></thead><tbody>');
  for (const cat of ['老人','次月','首月']) {
    const b = byCat[cat];
    if (!b) continue;
    const c = b.cur;
    P.push('<tr><td>' + cat + '</td><td>' + b.count + '</td><td>' + fmtInt(c.caseVolume) + '</td><td>' + fmtVal(c.cpd, METRIC_MAP.cpd) + '</td><td>' + fmtVal(c.aht, METRIC_MAP.aht) + '</td><td>' + fmtVal(c.solveRate, METRIC_MAP.solveRate) + '</td><td>' + fmtVal(c.satisfaction, METRIC_MAP.satisfaction) + '</td><td>' + fmtVal(c.qualityPassRate, METRIC_MAP.qualityPassRate) + '</td></tr>');
  }
  P.push('</tbody></table></div></div></div>');

  // 三、SLA 达成情况
  if (slaList && slaList.length) {
    P.push('<div class="rp-section"><h3>三、SLA 达成情况</h3><div class="rpt-body">');
    P.push('<div class="table-scroll-x"><table class="rp-table"><thead><tr><th>指标</th><th>分类</th><th>权重</th><th>目标</th><th>实际</th><th>最终得分</th><th>达成状态</th></tr></thead><tbody>');
    for (const c of slaList) {
      const sc = c.score;
      const isPct = sc.isPct;
      let tDisp = '—', aDisp = '—', rateDisp = '—';
      if (sc.threshold != null) tDisp = isPct ? (sc.threshold * 100).toFixed(2) + '%' : sc.threshold.toFixed(2);
      if (sc.actualDisp != null) aDisp = isPct ? (sc.actualDisp * 100).toFixed(2) + '%' : sc.actualDisp.toFixed(2);
      if (sc.achieveRate != null) rateDisp = (sc.achieveRate * 100).toFixed(2) + '%';
      
      const pointsDisp = sc.points != null ? sc.points.toFixed(2) : '—';
      const scoreDisp = sc.finalScore != null ? sc.finalScore.toFixed(2) : '—';
      const status = sc.points != null ? (sc.hitTierIndex === 0 ? '🟢 满档' : '🟡 达成') : '🔴 未达标';

      P.push('<tr><td>' + esc(c.item.metric) + '</td><td>' + esc(c.item.category) + '</td><td>' + (c.cfg.weight != null ? (c.cfg.weight*100).toFixed(1)+'%' : '—') + '</td><td>' + tDisp + '</td><td>' + aDisp + '</td><td>' + scoreDisp + '</td><td>' + status + '</td></tr>');
    }
    P.push('</tbody></table></div></div></div>');
  }

  // 四、每日趋势
  P.push('<div class="rp-section"><h3>四、每日趋势明细</h3><div class="rpt-body">');
  if (dailyRows.length) {
    P.push('<div class="table-scroll-x"><table class="rp-table"><thead><tr><th>日期</th><th>CASE 量</th><th>CPD</th><th>AHT</th><th>30S 接起率</th></tr></thead><tbody>');
    for (const x of dailyRows) {
      const c = x.cur;
      let s30Str = c.s30Rate != null ? (c.s30Rate * 100).toFixed(2) + '%' : '—';
      if (c.s30Rate != null && c.s30Rate < s30Threshold(biz)) s30Str = '<span class="rate-bad">' + s30Str + '</span>';
      P.push('<tr><td>' + x.date.slice(5) + '</td><td>' + fmtInt(c.caseVolume) + '</td><td>' + fmtVal(c.cpd, METRIC_MAP.cpd) + '</td><td>' + fmtVal(c.aht, METRIC_MAP.aht) + '</td><td>' + s30Str + '</td></tr>');
    }
    P.push('</tbody></table></div>');
  } else {
    P.push('<p class="muted">本月暂无每日数据。</p>');
  }
  P.push('</div></div>');

  // 五、员工表现
  P.push('<div class="rp-section"><h3>五、员工榜单</h3><div class="rpt-body">');
  if (emps.length) {
    const topCase = emps.slice().sort((a, b) => b.cur.caseVolume - a.cur.caseVolume).slice(0, 5);
    const watch = emps.filter(e => e.prev.caseVolume > 0).map(e => ({ e, dv: e.cur.caseVolume - e.prev.caseVolume })).filter(x => x.dv < 0).sort((a, b) => a.dv - b.dv).slice(0, 3);
    P.push('<div class="rp-rank">');
    P.push('<div class="rp-rank-box"><h4>🏆 CASE 处理量 TOP5</h4><ol>' + topCase.map(e => '<li><b>' + esc(e.name) + '</b><span class="g">' + esc(e.group) + '</span> · ' + fmtInt(e.cur.caseVolume) + ' 单</li>').join('') + '</ol></div>');
    P.push('<div class="rp-rank-box"><h4>⚠️ CASE 环比降幅 TOP3</h4><ol>' + watch.map(x => '<li><b>' + esc(x.e.name) + '</b><span class="g">' + esc(x.e.group) + '</span> · <span class="down">↓ ' + fmtInt(Math.abs(x.dv)) + ' 单</span></li>').join('') + '</ol></div>');
    P.push('</div>');
  }
  P.push('</div></div>');

  P.push('</div>'); // .rp-wrap end
  return P.join('');
}

/* ==================== 月报 · Markdown 导出 ==================== */
function monthlyReportToText(d) {
  const { biz, monthLabel, prevMonthLabel, cur, prev, byCat, dailyRows, emps, slaList } = d;
  const hasPrev = prev.caseVolume > 0;
  const L = [];

  L.push('# 📅 ' + biz + ' · ' + monthLabel + '月度分析报告'); L.push('');
  L.push('- 数据周期：**' + d.month + '**');
  L.push('- 对比周期：**' + d.prevMonth + '（' + prevMonthLabel + '）**');
  L.push('- 生成时间：' + new Date().toLocaleString('zh-CN')); L.push('');

  L.push('## 一、月度核心指标'); L.push('');
  L.push('| 指标 | 本月 | 环比（MoM） | 趋势 |');
  L.push('| --- | ---: | ---: | :---: |');
  for (const m of METRICS) {
    const v = cur[m.key];
    const p = hasPrev ? prev[m.key] : null;
    let diffTxt = '—', trendTxt = '⚪ 持平';
    if (v != null && p != null && isFinite(v) && isFinite(p)) {
      const dv = v - p;
      if (Math.abs(dv) < 1e-9) { diffTxt = '0'; }
      else {
        const up = dv > 0;
        const good = m.better === 'up' ? up : !up;
        const s = m.pct ? (Math.abs(dv) * 100).toFixed(m.digits) + '%' : Math.abs(dv).toFixed(m.digits);
        diffTxt = (up ? '↑ ' : '↓ ') + s;
        trendTxt = good ? '🟢 向好' : '🔴 走弱';
      }
    }
    L.push('| ' + m.label + ' | ' + fmtVal(v, m) + ' | ' + diffTxt + ' | ' + trendTxt + ' |');
  }
  L.push('');

  L.push('## 二、分类表现'); L.push('');
  L.push('| 分类 | 人数 | CASE 量 | CPD | AHT | 解决率 | 满意度 | 质检合格率 |');
  L.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const cat of ['老人','次月','首月']) {
    const b = byCat[cat];
    if (!b) continue;
    const c = b.cur;
    L.push('| ' + cat + ' | ' + b.count + ' | ' + fmtInt(c.caseVolume) + ' | ' + fmtVal(c.cpd, METRIC_MAP.cpd) + ' | ' + fmtVal(c.aht, METRIC_MAP.aht) + ' | ' + fmtVal(c.solveRate, METRIC_MAP.solveRate) + ' | ' + fmtVal(c.satisfaction, METRIC_MAP.satisfaction) + ' | ' + fmtVal(c.qualityPassRate, METRIC_MAP.qualityPassRate) + ' |');
  }
  L.push('');

  if (slaList && slaList.length) {
    L.push('## 三、SLA 达成情况'); L.push('');
    L.push('| 指标 | 分类 | 权重 | 目标 | 实际 | 最终得分 | 达成状态 |');
    L.push('| --- | --- | ---: | ---: | ---: | ---: | :---: |');
    for (const c of slaList) {
      const sc = c.score;
      const isPct = sc.isPct;
      let tDisp = sc.threshold != null ? (isPct ? (sc.threshold * 100).toFixed(2) + '%' : sc.threshold.toFixed(2)) : '—';
      let aDisp = sc.actualDisp != null ? (isPct ? (sc.actualDisp * 100).toFixed(2) + '%' : sc.actualDisp.toFixed(2)) : '—';
      let scoreDisp = sc.finalScore != null ? sc.finalScore.toFixed(2) : '—';
      let status = sc.points != null ? (sc.hitTierIndex === 0 ? '🟢 满档' : '🟡 达成') : '🔴 未达标';
      L.push('| ' + c.item.metric + ' | ' + c.item.category + ' | ' + (c.cfg.weight != null ? (c.cfg.weight*100).toFixed(1)+'%' : '—') + ' | ' + tDisp + ' | ' + aDisp + ' | ' + scoreDisp + ' | ' + status + ' |');
    }
    L.push('');
  }

  L.push('## 四、每日趋势明细'); L.push('');
  if (dailyRows.length) {
    L.push('| 日期 | CASE 量 | CPD | AHT | 30S 接起率 |');
    L.push('| --- | ---: | ---: | ---: | ---: |');
    for (const x of dailyRows) {
      const c = x.cur;
      let s30Str = c.s30Rate != null ? (c.s30Rate * 100).toFixed(2) + '%' : '—';
      L.push('| ' + x.date.slice(5) + ' | ' + fmtInt(c.caseVolume) + ' | ' + fmtVal(c.cpd, METRIC_MAP.cpd) + ' | ' + fmtVal(c.aht, METRIC_MAP.aht) + ' | ' + s30Str + ' |');
    }
  } else {
    L.push('本月暂无每日数据。');
  }
  L.push('');

  L.push('## 五、员工榜单'); L.push('');
  if (emps.length) {
    const topCase = emps.slice().sort((a, b) => b.cur.caseVolume - a.cur.caseVolume).slice(0, 5);
    const watch = emps.filter(e => e.prev.caseVolume > 0).map(e => ({ e, dv: e.cur.caseVolume - e.prev.caseVolume })).filter(x => x.dv < 0).sort((a, b) => a.dv - b.dv).slice(0, 3);
    L.push('**🏆 CASE 处理量 TOP5**'); L.push('');
    topCase.forEach((e, i) => L.push((i + 1) + '. ' + e.name + '（' + e.group + '）— ' + fmtInt(e.cur.caseVolume) + ' 单'));
    L.push('');
    L.push('**⚠️ CASE 环比降幅 TOP3**'); L.push('');
    watch.forEach((x, i) => L.push((i + 1) + '. ' + x.e.name + '（' + x.e.group + '）— ↓ ' + fmtInt(Math.abs(x.dv)) + ' 单'));
    L.push('');
  }

  return L.join('\n');
}

/* ==================== 月报 · 渲染入口与事件 ==================== */
function renderMonthlyReport() {
  const el = $('#mrBody');
  if (!el) return;
  const bizEl = $('#mrBiz');
  const monthEl = $('#mrMonth');
  const copyBtn = $('#btnMrCopy');

  const biz = (bizEl && bizEl.value) || '买手合作';
  const month = monthEl ? monthEl.value : '';
  
  if (!month) {
    el.innerHTML = '<p class="muted">暂无可用月份，请先导入数据。</p>';
    if (copyBtn) copyBtn.disabled = true;
    return;
  }

  try {
    const d = buildMonthlyReport(biz, month);
    if (!d) throw new Error('数据解析失败');
    
    if (!d.cur.caseVolume && !d.s30Cur.s30Den) {
      el.innerHTML = '<p class="muted">' + month + ' 暂无数据。</p>';
      if (copyBtn) copyBtn.disabled = true;
      return;
    }

    el.innerHTML = monthlyReportHTML(d);
    if (copyBtn) copyBtn.disabled = false;
  } catch (err) {
    console.error('月报渲染异常:', err);
    el.innerHTML = '<div style="padding:16px;background:#FDF0F0;color:#B33;border-radius:8px;">生成月报失败：' + esc(err.message) + '</div>';
    if (copyBtn) copyBtn.disabled = true;
  }
}

function initMonthlyReportOptions() {
  const bizEl = $('#mrBiz');
  const monthEl = $('#mrMonth');
  if (!bizEl || !monthEl) return;

  // 初始化业务线
  const curBiz = bizEl.value;
  bizEl.innerHTML = BIZ_LIST.map(b => '<option>' + b + '</option>').join('');
  if (BIZ_LIST.includes(curBiz)) bizEl.value = curBiz;

  // 初始化月份列表
  const monthsSet = new Set();
  for (const r of S.records) if (r.month) monthsSet.add(r.month);
  const months = Array.from(monthsSet).sort().reverse(); // 倒序，最新月份在最上面

  const curMonth = monthEl.value;
  monthEl.innerHTML = months.map(m => '<option value="' + m + '">' + m + '</option>').join('') || '<option value="">暂无月份</option>';
  if (months.includes(curMonth)) monthEl.value = curMonth;
  else if (months.length) monthEl.value = months[0];

  // 绑定事件（防重复绑定）
  if (!bizEl._mrBound) {
    bizEl._mrBound = true;
    bizEl.addEventListener('change', renderMonthlyReport);
  }
  if (!monthEl._mrBound) {
    monthEl._mrBound = true;
    monthEl.addEventListener('change', renderMonthlyReport);
  }

  const copyBtn = $('#btnMrCopy');
  if (copyBtn && !copyBtn._mrBound) {
    copyBtn._mrBound = true;
    copyBtn.addEventListener('click', async () => {
      try {
        const biz = bizEl.value;
        const month = monthEl.value;
        if (!month) return;
        const d = buildMonthlyReport(biz, month);
        if (!d) return;
        const text = monthlyReportToText(d);
        await navigator.clipboard.writeText(text);
        toast('✅ 月报已复制到剪贴板');
      } catch (err) {
        toast('❌ 复制失败：' + err.message);
      }
    });
  }
}