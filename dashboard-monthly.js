/* ============================================================
   创作者数据分析 · 月报层（深度分析版）
   （核心指标 / 业务拆解 / 流量分布 / 效率归因 / SLA / 员工榜单 / 智能总结）
   ============================================================ */
'use strict';

/* ==================== 月报 · 工具与算法 ==================== */
function getPrevMonth(monthStr) {
  if (!monthStr) return '';
  const y = parseInt(monthStr.slice(0, 4), 10);
  const m = parseInt(monthStr.slice(5, 7), 10);
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  return prevY + '-' + pad2(prevM);
}

// 按一级打点拆解月数据
function monthlyBizBreakdown(src, month, prevMonth) {
  const map = new Map();
  for (const r of S.records) {
    if (r.src !== src) continue;
    if (r.month !== month && r.month !== prevMonth) continue;
    const l1 = r.l1 || '其他';
    if (!map.has(l1)) map.set(l1, { l1, curVol: 0, prevVol: 0, curAht: 0, prevAht: 0 });
    const o = map.get(l1);
    if (r.month === month) { o.curVol += r.volume; o.curAht += r.aht; }
    if (r.month === prevMonth) { o.prevVol += r.volume; o.prevAht += r.aht; }
  }
  return Array.from(map.values()).map(o => ({
    l1: o.l1,
    curVol: o.curVol,
    prevVol: o.prevVol,
    curAhtRate: o.curVol > 0 ? o.curAht / o.curVol : null,
    prevAhtRate: o.prevVol > 0 ? o.prevAht / o.prevVol : null
  })).sort((a, b) => b.curVol - a.curVol);
}

// 时段分布分析（9-23点）
function monthlyPeriodDistribution(biz, month) {
  const periodMap = new Map();
  let totalVol = 0;
  for (const r of S.records) {
    if (r.biz !== biz || r.month !== month) continue;
    const p = normPeriod(r.period);
    if (!p || !isPredictPeriod(p)) continue;
    if (!periodMap.has(p)) periodMap.set(p, 0);
    periodMap.set(p, periodMap.get(p) + r.volume);
    totalVol += r.volume;
  }
  const list = Array.from(periodMap.entries()).map(([period, vol]) => ({
    period, vol, share: totalVol > 0 ? vol / totalVol : 0
  })).sort((a, b) => parseInt(a.period) - parseInt(b.period));
  return { list, totalVol };
}

// AHT 二级打点归因
function monthlyAHTAttribution(biz, month, prevMonth) {
  const combos = new Map();
  for (const r of S.records) {
    if (r.biz2 !== biz) continue;
    if (r.month !== month && r.month !== prevMonth) continue;
    const key = r.l1 + '|' + r.l2;
    if (!combos.has(key)) combos.set(key, { l1: r.l1, l2: r.l2, curAht: 0, curVol: 0, prevAht: 0, prevVol: 0 });
    const o = combos.get(key);
    if (r.month === month) { o.curAht += r.aht || 0; o.curVol += r.volume || 0; }
    if (r.month === prevMonth) { o.prevAht += r.aht || 0; o.prevVol += r.volume || 0; }
  }
  let bizCurAht = 0, bizCurVol = 0;
  for (const o of combos.values()) { bizCurAht += o.curAht; bizCurVol += o.curVol; }
  const bizRate = bizCurVol > 0 ? bizCurAht / bizCurVol : null;

  const list = Array.from(combos.values()).map(o => {
    const curRate = o.curVol > 0 ? o.curAht / o.curVol : null;
    const prevRate = o.prevVol > 0 ? o.prevAht / o.prevVol : null;
    let impact = null;
    if (curRate != null && bizRate != null) {
      const newVolTotal = bizCurVol - o.curVol;
      if (newVolTotal > 0) impact = (bizCurAht - o.curAht) / newVolTotal - bizRate;
    }
    return { ...o, curRate, prevRate, impact };
  }).filter(o => o.curVol > 0 || o.prevVol > 0);
  
  list.sort((a, b) => Math.abs(b.impact || 0) - Math.abs(a.impact || 0));
  return list.slice(0, 5);
}

/* ==================== 月报 · 数据组装 ==================== */
function buildMonthlyReport(biz, month) {
  if (!month) return null;
  const src = bizToSrc(biz);
  const prevMonth = getPrevMonth(month);
  const monthLabel = parseInt(month.slice(5, 7), 10) + '月';
  const prevMonthLabel = parseInt(prevMonth.slice(5, 7), 10) + '月';

  const cur = calcBySrc(src, { monthSet: new Set([month]) });
  const prev = calcBySrc(src, { monthSet: new Set([prevMonth]) });
  const s30Cur = calcByL1(biz, { monthSet: new Set([month]) });
  const s30Prev = calcByL1(biz, { monthSet: new Set([prevMonth]) });

  const srcEmps = srcEmployeeSet(src);
  const emps = S.roster.filter(e => srcEmps.has(e.name));
  
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

  const empRows = emps.map(e => {
    const nameSet = new Set([e.name]);
    return {
      name: e.name, group: e.group || '—',
      cur: calcBySrc(src, { monthSet: new Set([month]), nameSet }),
      prev: calcBySrc(src, { monthSet: new Set([prevMonth]), nameSet })
    };
  }).filter(x => x.cur.caseVolume > 0);

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

  const bizBreakdown = monthlyBizBreakdown(src, month, prevMonth);
  const periodDist = monthlyPeriodDistribution(biz, month);
  const ahtAttr = monthlyAHTAttribution(biz, month, prevMonth);

  return {
    biz, src, month, monthLabel, prevMonth, prevMonthLabel,
    cur, prev, s30Cur, s30Prev,
    byCat, dailyRows, emps: empRows, slaList,
    bizBreakdown, periodDist, ahtAttr
  };
}

/* ==================== 月报 · 智能总结 ==================== */
function generateMonthlySummary(d) {
  const { cur, prev, s30Cur, s30Prev, bizBreakdown, periodDist, ahtAttr } = d;
  const hasPrev = prev.caseVolume > 0;
  const S = [];

  if (cur.caseVolume > 0) {
    let s = '本月共处理 CASE <b>' + fmtInt(cur.caseVolume) + '</b> 单';
    if (hasPrev) {
      const dv = cur.caseVolume - prev.caseVolume;
      const pct = prev.caseVolume > 0 ? Math.abs(dv / prev.caseVolume * 100).toFixed(1) : '—';
      s += dv >= 0 ? '，环比上月增长 <span class="up">↑ ' + fmtInt(dv) + ' 单（' + pct + '%）</span>' : '，环比上月下降 <span class="down">↓ ' + fmtInt(Math.abs(dv)) + ' 单（' + pct + '%）</span>';
    }
    s += '。';
    S.push(s);
  }

  if (bizBreakdown && bizBreakdown.length > 0) {
    const topBiz = bizBreakdown[0];
    if (topBiz && topBiz.curVol > 0) {
      const share = (topBiz.curVol / cur.caseVolume * 100).toFixed(1);
      S.push('业务结构上，<b>' + esc(topBiz.l1) + '</b> 是核心进线来源，贡献了 ' + share + '% 的咨询量。');
    }
  }

  if (cur.aht != null && prev.aht != null) {
    const dv = cur.aht - prev.aht;
    if (Math.abs(dv) >= 0.05) {
      const trend = dv > 0 ? '有所拉长（变差）' : '有所缩短（优化）';
      S.push('整体 AHT 为 <b>' + cur.aht.toFixed(2) + '</b> 分钟，较上月' + trend + ' ' + Math.abs(dv).toFixed(2) + ' 分钟。');
    }
  }

  if (ahtAttr && ahtAttr.length > 0) {
    const topImp = ahtAttr.filter(x => x.impact != null && x.impact > 0)[0];
    if (topImp) {
      S.push('在 AHT 二级打点归因中，<b>' + esc(topImp.l2) + '</b> 的处理效率提升最为显著，若剔除该模块，整体 AHT 将上升 ' + topImp.impact.toFixed(2) + ' 分钟。');
    }
  }

  if (s30Cur && s30Cur.s30Den > 0) {
    const th = s30Threshold(d.biz);
    const rate = s30Cur.s30Rate;
    const ok = rate != null && rate >= th;
    let s = '30S 接起率为 <b>' + (rate * 100).toFixed(2) + '%</b>，' + (ok ? '<span class="up">已达标</span>' : '<span class="down">未达标（目标 ' + (th*100).toFixed(1) + '%）</span>');
    if (s30Prev && s30Prev.s30Den > 0 && rate != null) {
      const dv = rate - s30Prev.s30Rate;
      s += '，环比上月' + (dv >= 0 ? '提升 ' : '下降 ') + (Math.abs(dv) * 100).toFixed(2) + ' 个百分点。';
    }
    S.push(s);
  }

  if (periodDist && periodDist.list.length > 0) {
    const topP = periodDist.list.slice().sort((a, b) => b.vol - a.vol)[0];
    if (topP) {
      S.push('时段流量峰值出现在 <b>' + topP.period + ' 时</b>，占全月总进线的 ' + (topP.share * 100).toFixed(1) + '%，建议下月排班时重点倾斜该时段的人力。');
    }
  }

  return S;
}

/* ==================== 月报 · HTML 渲染 ==================== */
function monthlyReportHTML(d) {
  const { biz, monthLabel, prevMonthLabel, cur, prev, byCat, dailyRows, emps, slaList, bizBreakdown, periodDist, ahtAttr } = d;
  const hasPrev = prev.caseVolume > 0;
  const P = [];

  P.push('<div class="rp-wrap"><div class="rp-head"><h2>📅 ' + esc(biz) + ' · ' + monthLabel + '月度分析报告</h2><div class="rp-meta">' +
    '<span>数据周期：<b>' + d.month + '</b></span>' +
    '<span>对比周期：<b>' + d.prevMonth + '（' + prevMonthLabel + '）</b></span>' +
    '<span>生成时间：' + new Date().toLocaleString('zh-CN') + '</span>' +
  '</div></div>');

  const summary = generateMonthlySummary(d);
  if (summary.length) {
    P.push('<div class="rp-section"><h3>💡 月度业务摘要</h3><div class="rp-text">');
    summary.forEach(s => P.push('<p>' + s + '</p>'));
    P.push('</div></div>');
  }

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

  P.push('<div class="rp-section"><h3>二、业务结构与流量分布</h3><div class="rpt-body">');
  P.push('<h4 class="sub-title">🔗 一级打点表现</h4>');
  P.push('<div class="table-scroll-x"><table class="rp-table"><thead><tr><th>一级打点</th><th>CASE 量</th><th>量占比</th><th>上月量</th><th>量环比</th><th>本月 AHT</th><th>AHT 环比</th></tr></thead><tbody>');
  for (const x of bizBreakdown) {
    const share = cur.caseVolume > 0 ? (x.curVol / cur.caseVolume * 100).toFixed(1) + '%' : '—';
    const dvVol = x.curVol - x.prevVol;
    const volTrend = dvVol >= 0 ? '<span class="delta-up">↑ ' + fmtInt(dvVol) + '</span>' : '<span class="delta-down">↓ ' + fmtInt(Math.abs(dvVol)) + '</span>';
    const dvAht = x.curAhtRate != null && x.prevAhtRate != null ? x.curAhtRate - x.prevAhtRate : null;
    const ahtTrend = dvAht == null ? '—' : (dvAht > 0 ? '<span class="delta-down">↑ ' + dvAht.toFixed(2) + '</span>' : '<span class="delta-up">↓ ' + Math.abs(dvAht).toFixed(2) + '</span>');
    P.push('<tr><td>' + esc(x.l1) + '</td><td>' + fmtInt(x.curVol) + '</td><td>' + share + '</td><td>' + fmtInt(x.prevVol) + '</td><td>' + volTrend + '</td><td>' + (x.curAhtRate || '—') + '</td><td>' + ahtTrend + '</td></tr>');
  }
  P.push('</tbody></table></div>');

  P.push('<h4 class="sub-title">⏰ 时段流量分布（9-23 时）</h4>');
  P.push('<div class="table-scroll-x"><table class="rp-table"><thead><tr><th>时段</th><th>月累计进线量</th><th>流量占比</th><th>分布</th></tr></thead><tbody>');
  for (const p of periodDist.list) {
    const barWidth = Math.min(100, p.share * 300);
    const bar = '<div style="background:#E7ECF5;height:8px;width:100%;border-radius:4px;display:flex;align-items:center"><div style="background:#7B8FBF;height:8px;width:' + barWidth + '%;border-radius:4px"></div></div>';
    P.push('<tr><td>' + p.period + ' 时</td><td>' + fmtInt(p.vol) + '</td><td>' + (p.share * 100).toFixed(2) + '%</td><td>' + bar + '</td></tr>');
  }
  P.push('</tbody></table></div></div></div>');

  P.push('<div class="rp-section"><h3>三、分类表现与 AHT 归因</h3><div class="rpt-body">');
  P.push('<h4 class="sub-title">👥 员工分类表现</h4>');
  P.push('<div class="table-scroll-x"><table class="rp-table"><thead><tr><th>分类</th><th>人数</th><th>CASE 量</th><th>CPD</th><th>AHT</th><th>解决率</th><th>满意度</th><th>质检合格率</th></tr></thead><tbody>');
  for (const cat of ['老人','次月','首月']) {
    const b = byCat[cat];
    if (!b) continue;
    const c = b.cur;
    P.push('<tr><td>' + cat + '</td><td>' + b.count + '</td><td>' + fmtInt(c.caseVolume) + '</td><td>' + fmtVal(c.cpd, METRIC_MAP.cpd) + '</td><td>' + fmtVal(c.aht, METRIC_MAP.aht) + '</td><td>' + fmtVal(c.solveRate, METRIC_MAP.solveRate) + '</td><td>' + fmtVal(c.satisfaction, METRIC_MAP.satisfaction) + '</td><td>' + fmtVal(c.qualityPassRate, METRIC_MAP.qualityPassRate) + '</td></tr>');
  }
  P.push('</tbody></table></div>');

  if (ahtAttr && ahtAttr.length) {
    P.push('<h4 class="sub-title">📈 二级打点 AHT 影响值 TOP5</h4>');
    P.push('<div class="table-scroll-x"><table class="rp-table"><thead><tr><th>二级打点</th><th>本月 AHT</th><th>上月 AHT</th><th>本月服务量</th><th>影响值</th></tr></thead><tbody>');
    for (const x of ahtAttr) {
      const impCls = x.impact > 0 ? 'delta-up' : (x.impact < 0 ? 'delta-down' : 'delta-flat');
      const impStr = x.impact == null ? '—' : (x.impact > 0 ? '+' : '') + x.impact.toFixed(2);
      P.push('<tr><td>' + esc(x.l2) + '<div class="aht2-l1">' + esc(x.l1) + '</div></td><td>' + (x.curRate || '—') + '</td><td>' + (x.prevRate || '—') + '</td><td>' + fmtInt(x.curVol) + '</td><td class="' + impCls + '">' + impStr + '</td></tr>');
    }
    P.push('</tbody></table></div>');
  }
  P.push('</div></div>');

  // ★ 预先过滤一次，如果有有效数据才渲染标题
  const validSlaList = (slaList || []).filter(c => {
    if (c.score.threshold == null && c.score.actualDisp == null) return false;
    const cat = String(c.item.category || '').trim();
    const isOverall = !cat || /^(整体|全部|合计|总计|平均|总体)$/.test(cat);
    if (!isOverall && S.roster.length > 0) {
      const srcEmps = srcEmployeeSet(d.src);
      const matched = S.roster.filter(e => srcEmps.has(e.name) && (categoryOf(e, d.month) || '').includes(cat));
      if (!matched.length) return false;
    }
    return true;
  });

  if (validSlaList.length > 0) {
    P.push('<div class="rp-section"><h3>四、SLA 达成情况</h3><div class="rpt-body">');
    P.push('<div class="table-scroll-x"><table class="rp-table"><thead><tr><th>指标</th><th>分类</th><th>权重</th><th>目标</th><th>实际</th><th>最终得分</th><th>达成状态</th></tr></thead><tbody>');
    for (const c of validSlaList) {
      const sc = c.score;
      const isPct = sc.isPct;
      let tDisp = '—', aDisp = '—', rateDisp = '—';
      if (sc.threshold != null) tDisp = isPct ? (sc.threshold * 100).toFixed(2) + '%' : sc.threshold.toFixed(2);
      if (sc.actualDisp != null) aDisp = isPct ? (sc.actualDisp * 100).toFixed(2) + '%' : sc.actualDisp.toFixed(2);
      if (sc.achieveRate != null) rateDisp = (sc.achieveRate * 100).toFixed(2) + '%';
      
      const scoreDisp = sc.finalScore != null ? sc.finalScore.toFixed(2) : '—';
      const status = sc.points != null ? (sc.hitTierIndex === 0 ? '🟢 满档' : '🟡 达成') : '🔴 未达标';

      P.push('<tr><td>' + esc(c.item.metric) + '</td><td>' + esc(c.item.category) + '</td><td>' + (c.cfg.weight != null ? (c.cfg.weight*100).toFixed(1)+'%' : '—') + '</td><td>' + tDisp + '</td><td>' + aDisp + '</td><td>' + scoreDisp + '</td><td>' + status + '</td></tr>');
    }
    P.push('</tbody></table></div></div></div>');
  }

  P.push('<div class="rp-section"><h3>五、每日趋势明细</h3><div class="rpt-body">');
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

  P.push('<div class="rp-section"><h3>六、员工榜单</h3><div class="rpt-body">');
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
  const { biz, monthLabel, prevMonthLabel, cur, prev, byCat, dailyRows, emps, slaList, bizBreakdown, periodDist, ahtAttr } = d;
  const hasPrev = prev.caseVolume > 0;
  const L = [];

  L.push('# 📅 ' + biz + ' · ' + monthLabel + '月度分析报告'); L.push('');
  L.push('- 数据周期：**' + d.month + '**');
  L.push('- 对比周期：**' + d.prevMonth + '（' + prevMonthLabel + '）**');
  L.push('- 生成时间：' + new Date().toLocaleString('zh-CN')); L.push('');

  const summary = generateMonthlySummary(d);
  if (summary.length) {
    L.push('## 💡 月度业务摘要');
    summary.forEach(s => L.push('- ' + s.replace(/<[^>]+>/g, '').trim()));
    L.push('');
  }

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

  L.push('## 二、业务结构与流量分布'); L.push('');
  L.push('### 🔗 一级打点表现'); L.push('');
  L.push('| 一级打点 | CASE 量 | 量占比 | 上月量 | 量环比 | 本月 AHT | AHT 环比 |');
  L.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const x of bizBreakdown) {
    const share = cur.caseVolume > 0 ? (x.curVol / cur.caseVolume * 100).toFixed(1) + '%' : '—';
    const dvVol = x.curVol - x.prevVol;
    const volTrend = dvVol >= 0 ? '↑ ' + fmtInt(dvVol) : '↓ ' + fmtInt(Math.abs(dvVol));
    const dvAht = x.curAhtRate != null && x.prevAhtRate != null ? x.curAhtRate - x.prevAhtRate : null;
    const ahtTrend = dvAht == null ? '—' : (dvAht > 0 ? '↑ ' + dvAht.toFixed(2) : '↓ ' + Math.abs(dvAht).toFixed(2));
    L.push('| ' + x.l1 + ' | ' + fmtInt(x.curVol) + ' | ' + share + ' | ' + fmtInt(x.prevVol) + ' | ' + volTrend + ' | ' + (x.curAhtRate || '—') + ' | ' + ahtTrend + ' |');
  }
  L.push('');

  L.push('### ⏰ 时段流量分布（9-23 时）'); L.push('');
  L.push('| 时段 | 月累计进线量 | 流量占比 |');
  L.push('| --- | ---: | ---: |');
  for (const p of periodDist.list) {
    L.push('| ' + p.period + ' 时 | ' + fmtInt(p.vol) + ' | ' + (p.share * 100).toFixed(2) + '% |');
  }
  L.push('');

  L.push('## 三、分类表现与 AHT 归因'); L.push('');
  L.push('### 👥 员工分类表现'); L.push('');
  L.push('| 分类 | 人数 | CASE 量 | CPD | AHT | 解决率 | 满意度 | 质检合格率 |');
  L.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const cat of ['老人','次月','首月']) {
    const b = byCat[cat];
    if (!b) continue;
    const c = b.cur;
    L.push('| ' + cat + ' | ' + b.count + ' | ' + fmtInt(c.caseVolume) + ' | ' + fmtVal(c.cpd, METRIC_MAP.cpd) + ' | ' + fmtVal(c.aht, METRIC_MAP.aht) + ' | ' + fmtVal(c.solveRate, METRIC_MAP.solveRate) + ' | ' + fmtVal(c.satisfaction, METRIC_MAP.satisfaction) + ' | ' + fmtVal(c.qualityPassRate, METRIC_MAP.qualityPassRate) + ' |');
  }
  L.push('');

  if (ahtAttr && ahtAttr.length) {
    L.push('### 📈 二级打点 AHT 影响值 TOP5'); L.push('');
    L.push('| 二级打点 | 本月 AHT | 上月 AHT | 本月服务量 | 影响值 |');
    L.push('| --- | ---: | ---: | ---: | ---: |');
    for (const x of ahtAttr) {
      const impStr = x.impact == null ? '—' : (x.impact > 0 ? '+' : '') + x.impact.toFixed(2);
      L.push('| ' + x.l2 + '（' + x.l1 + '） | ' + (x.curRate || '—') + ' | ' + (x.prevRate || '—') + ' | ' + fmtInt(x.curVol) + ' | ' + impStr + ' |');
    }
    L.push('');
  }

  if (slaList && slaList.length) {
    L.push('## 四、SLA 达成情况'); L.push('');
    L.push('| 指标 | 分类 | 权重 | 目标 | 实际 | 最终得分 | 达成状态 |');
    L.push('| --- | --- | ---: | ---: | ---: | ---: | :---: |');
    for (const c of slaList) {
      const sc = c.score;
      
      /* ★ 过滤：无目标且无实际值时不展示 */
      if (sc.threshold == null && sc.actualDisp == null) continue;

      /* ★ 过滤：如果是特定分类，但花名册里根本没匹配到员工 */
      const cat = String(c.item.category || '').trim();
      const isOverall = !cat || /^(整体|全部|合计|总计|平均|总体)$/.test(cat);
      if (!isOverall && S.roster.length > 0) {
        const srcEmps = srcEmployeeSet(d.src);
        const matched = S.roster.filter(e => srcEmps.has(e.name) && (categoryOf(e, d.month) || '').includes(cat));
        if (!matched.length) continue;
      }

      const isPct = sc.isPct;
      let tDisp = sc.threshold != null ? (isPct ? (sc.threshold * 100).toFixed(2) + '%' : sc.threshold.toFixed(2)) : '—';
      let aDisp = sc.actualDisp != null ? (isPct ? (sc.actualDisp * 100).toFixed(2) + '%' : sc.actualDisp.toFixed(2)) : '—';
      let scoreDisp = sc.finalScore != null ? sc.finalScore.toFixed(2) : '—';
      let status = sc.points != null ? (sc.hitTierIndex === 0 ? '🟢 满档' : '🟡 达成') : '🔴 未达标';
      L.push('| ' + c.item.metric + ' | ' + c.item.category + ' | ' + (c.cfg.weight != null ? (c.cfg.weight*100).toFixed(1)+'%' : '—') + ' | ' + tDisp + ' | ' + aDisp + ' | ' + scoreDisp + ' | ' + status + ' |');
    }
    L.push('');
  }

  L.push('## 五、每日趋势明细'); L.push('');
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

  L.push('## 六、员工榜单'); L.push('');
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

  const curBiz = bizEl.value;
  bizEl.innerHTML = BIZ_LIST.map(b => '<option>' + b + '</option>').join('');
  if (BIZ_LIST.includes(curBiz)) bizEl.value = curBiz;

  const monthsSet = new Set();
  for (const r of S.records) if (r.month) monthsSet.add(r.month);
  const months = Array.from(monthsSet).sort().reverse();

  const curMonth = monthEl.value;
  monthEl.innerHTML = months.map(m => '<option value="' + m + '">' + m + '</option>').join('') || '<option value="">暂无月份</option>';
  if (months.includes(curMonth)) monthEl.value = curMonth;
  else if (months.length) monthEl.value = months[0];

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