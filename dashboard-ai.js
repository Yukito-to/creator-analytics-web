/* ============================================================
   创作者数据分析 · AI 分析层 + 全局初始化引导
   ============================================================ */
'use strict';

/* ==================== AI 常量与配置 ==================== */
const AI_KEY_STORE = 'creator_ai_zhipu_key';
const AI_MODEL_STORE = 'creator_ai_zhipu_model';
let _aiAbort = null;
let _aiStreaming = false;

function loadAiConfig() {
  return {
    key: localStorage.getItem(AI_KEY_STORE) || '',
    model: localStorage.getItem(AI_MODEL_STORE) || 'glm-5.3-flash',
  };
}
function saveAiConfig(key, model) {
  if (key != null) localStorage.setItem(AI_KEY_STORE, key);
  if (model != null) localStorage.setItem(AI_MODEL_STORE, model);
}

/* ==================== Markdown 渲染 ==================== */
function renderAiMarkdown(md) {
  if (!md) return '';
  let s = String(md);
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/```([\s\S]*?)```/g, (m, code) => '<pre><code>' + code.replace(/^\n+|\n+$/g, '') + '</code></pre>');
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  s = s.replace(/^###\s+(.+)$/gm, '<h4>$1</h4>');
  s = s.replace(/^##\s+(.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^#\s+(.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  /* 列表：使用 Unicode 私用区占位符，避免与正文冲突 */
  const UL_MARK = '\uE001LI\uE001';
  const OL_MARK = '\uE002LI\uE002';
  s = s.replace(/^[\-\*\+]\s+(.+)$/gm, UL_MARK + '$1');
  s = s.replace(new RegExp('(?:' + UL_MARK + '[^\\n]*(?:\\n|$))+', 'g'), (m) => {
    const items = m.trim().split('\n').map(x => '<li>' + x.replace(UL_MARK, '') + '</li>').join('');
    return '<ul>' + items + '</ul>';
  });
  s = s.replace(/^\d+\.\s+(.+)$/gm, OL_MARK + '$1');
  s = s.replace(new RegExp('(?:' + OL_MARK + '[^\\n]*(?:\\n|$))+', 'g'), (m) => {
    const items = m.trim().split('\n').map(x => '<li>' + x.replace(OL_MARK, '') + '</li>').join('');
    return '<ol>' + items + '</ol>';
  });

  /* 表格：逐行扫描（修复行尾漏匹配 & 表格与其他内容相邻的边界问题） */
  const tables = [];
  const lines = s.split('\n');
  const outLines = [];
  let i = 0;
  while (i < lines.length) {
    const cur = lines[i].trim();
    const nxt = (i + 1 < lines.length) ? lines[i + 1].trim() : '';
    const isTbl = /^\|.+\|$/.test(cur);
    const isSep = /^\|[\s\-:|]+\|$/.test(nxt) && nxt.indexOf('-') >= 0;
    if (isTbl && isSep) {
      const tblLines = [cur, nxt];
      i += 2;
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        tblLines.push(lines[i].trim());
        i++;
      }
      const header = tblLines[0].split('|').slice(1, -1).map(x => x.trim());
      const body = tblLines.slice(2).map(l => l.split('|').slice(1, -1).map(x => x.trim()));
      let html = '<table class="rp-table"><thead><tr>' + header.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>';
      html += body.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('');
      html += '</tbody></table>';
      const key = '\uE003TBL' + tables.length + '\uE003';
      tables.push(html);
      outLines.push(key);
    } else {
      outLines.push(lines[i]);
      i++;
    }
  }
  s = outLines.join('\n');

  s = s.split(/\n{2,}/).map(p => {
    const t = p.trim();
    if (!t) return '';
    if (/^\uE003TBL\d+\uE003$/.test(t)) return t;
    if (/^<(h\d|ul|ol|pre|table|blockquote)/.test(t)) return t;
    return '<p>' + t.replace(/\n/g, '<br>') + '</p>';
  }).join('');

  /* 还原表格 */
  s = s.replace(/\uE003TBL(\d+)\uE003/g, (_, k) => tables[+k]);
  return s;
}

/* ==================== 智谱 API 调用（SSE 流式） ==================== */
async function callZhipuAI(apiKey, model, messages, onChunk, signal, onDebug) {
  const url = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      stream: true,
      temperature: 0.1,
      max_tokens: 8192,
    }),
    signal: signal,
  });
  if (!resp.ok) {
    let detail = '';
    try { const j = await resp.json(); detail = (j && j.error && j.error.message) || JSON.stringify(j); }
    catch (_) { detail = await resp.text(); }
    throw new Error('HTTP ' + resp.status + ' · ' + detail);
  }

  const ctype = (resp.headers.get('content-type') || '').toLowerCase();
  if (onDebug) onDebug('响应 Content-Type: ' + ctype);

  if (ctype.includes('application/json')) {
    const j = await resp.json();
    const choice = j && j.choices && j.choices[0];
    const content = (choice && choice.message && choice.message.content)
                 || (choice && choice.message && choice.message.reasoning_content)
                 || '';
    if (onDebug) onDebug('非流式响应，content 长度=' + content.length);
    if (content) onChunk(content, 'content');
    return;
  }

  if (!resp.body || !resp.body.getReader) {
    const j = await resp.json();
    const choice = j && j.choices && j.choices[0];
    const content = (choice && choice.message && choice.message.content)
                 || (choice && choice.message && choice.message.reasoning_content)
                 || '';
    if (content) onChunk(content, 'content');
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let rawLines = 0;
  let dataLines = 0;
  let chunkCount = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const raw of lines) {
      rawLines++;
      const line = raw.trim();
      if (!line) continue;
      if (!line.startsWith('data:')) continue;
      dataLines++;
      const data = line.slice(5).trim();
      if (data === '[DONE]') {
        if (onDebug) onDebug('收到 [DONE]，原始行数=' + rawLines + '，data 行数=' + dataLines + '，内容 chunk 数=' + chunkCount);
        return;
      }
      try {
        const obj = JSON.parse(data);
        const choice = obj.choices && obj.choices[0];
        if (!choice) continue;
        const delta = choice.delta || choice.message || {};
        const content = delta.content;
        const reason  = delta.reasoning_content;
        const finish  = choice.finish_reason;

        if (typeof content === 'string' && content.length > 0) {
          chunkCount++;
          onChunk(content, 'content');
        }
        if (typeof reason === 'string' && reason.length > 0) {
          onChunk(reason, 'reasoning');
        }
        if (finish && onDebug) onDebug('finish_reason=' + finish);
      } catch (e) {
        if (onDebug && dataLines <= 3) onDebug('解析失败: ' + data.slice(0, 200));
      }
    }
  }
  if (onDebug) onDebug('流结束（未收到 DONE）：原始行数=' + rawLines + '，data 行数=' + dataLines + '，内容 chunk 数=' + chunkCount);
}

/* ==================== 月度上下文（按 focus 精简） ==================== */
function buildMonthContext(biz, wk, focus) {
  focus = focus || '综合';
  const src = bizToSrc(biz);
  const month = S.month;
  if (!month) return null;

  const needAll     = (focus === '综合' || focus === '对比');
  const needAHT     = (focus === 'AHT' || focus === '综合' || focus === '对比');
  const needQuality = (focus === '质量' || focus === '综合' || focus === '对比');
  const need30S     = (focus === '30S' || focus === '综合' || focus === '对比');

  const monthSet = new Set([month]);
  const mCur = calcBySrc(src, { monthSet });
  const mS30 = need30S ? calcByL1(biz, { monthSet }) : null;

  const allW = allWeeks();
  const monthWeeks = allW.filter(w => {
    const start = wkStartDate(w);
    return monthOf(start) === month || monthOf(wkEndDate(w)) === month;
  });

  const weekTrend = monthWeeks.map(w => {
    const c = calcBySrc(src, { wkSet: new Set([w]) });
    const row = { wk: w, caseVolume: c.caseVolume };
    if (needAHT) {
      row.cpd = c.cpd; row.aht = c.aht;
      row.concurrency = c.concurrency; row.utilization = c.utilization;
    }
    if (needQuality) {
      row.solveRate = c.solveRate; row.satisfaction = c.satisfaction;
      row.qualityPassRate = c.qualityPassRate;
    }
    if (need30S) {
      const s30 = calcByL1(biz, { wkSet: new Set([w]) });
      row.s30Rate = s30.s30Rate; row.s30Num = s30.s30Num;
      row.s30Den = s30.s30Den; row.s30Miss = s30.s30Miss;
    }
    return row;
  });

  const srcEmps = srcEmployeeSet(src);
  const allEmps = S.roster.filter(e => employeeVisible(e) && srcEmps.has(e.name));

  const monthByCat = {};
  for (const cat of ['首月','次月','老人']) {
    const names = allEmps.filter(e => (categoryOf(e, month) || '').includes(cat)).map(e => e.name);
    if (!names.length) continue;
    const nameSet = new Set(names);
    const c = calcBySrc(src, { nameSet, monthSet });
    const row = { count: names.length, caseVolume: c.caseVolume };
    if (needAHT) { row.cpd = c.cpd; row.aht = c.aht; row.concurrency = c.concurrency; }
    if (needQuality) { row.solveRate = c.solveRate; row.satisfaction = c.satisfaction; row.qualityPassRate = c.qualityPassRate; }
    if (need30S) {
      const s30 = calcByL1(biz, { nameSet, monthSet });
      row.s30Rate = s30.s30Rate; row.s30Num = s30.s30Num; row.s30Den = s30.s30Den;
    }
    monthByCat[cat] = row;
  }

  const groupMap = {};
  for (const e of allEmps) { const g = e.group || '—'; (groupMap[g] = groupMap[g] || []).push(e.name); }
  const monthGroups = Object.keys(groupMap).sort().map(g => {
    const nameSet = new Set(groupMap[g]);
    const c = calcBySrc(src, { nameSet, monthSet });
    const row = { name: g, count: nameSet.size, caseVolume: c.caseVolume };
    if (needAHT) { row.cpd = c.cpd; row.aht = c.aht; row.concurrency = c.concurrency; }
    if (needQuality) { row.solveRate = c.solveRate; row.satisfaction = c.satisfaction; row.qualityPassRate = c.qualityPassRate; }
    if (need30S) {
      const s30 = calcByL1(biz, { nameSet, monthSet });
      row.s30Rate = s30.s30Rate;
    }
    return row;
  }).filter(g => g.caseVolume > 0);

  let monthDayRates = [];
  if (need30S) {
    const monthDaySet = new Set();
    for (const r of S.records) {
      if (r.biz === biz && r.month === month) monthDaySet.add(r.date);
    }
    for (const d of Array.from(monthDaySet).sort()) {
      const recs = S.records.filter(r => r.biz === biz && r.date === d);
      let n = 0, den = 0;
      for (const r of recs) { n += r.s30Num; den += r.s30Den; }
      if (den <= 0) continue;
      monthDayRates.push({ date: d, rate: n / den, num: n, den: den, miss: den - n });
    }
  }

  const summary = { caseVolume: mCur.caseVolume };
  if (needAHT) {
    summary.cpd = mCur.cpd; summary.aht = mCur.aht;
    summary.concurrency = mCur.concurrency; summary.utilization = mCur.utilization;
  }
  if (needQuality) {
    summary.solveRate = mCur.solveRate;
    summary.satisfaction = mCur.satisfaction;
    summary.qualityPassRate = mCur.qualityPassRate;
  }
  if (need30S && mS30) {
    summary.s30Rate = mS30.s30Rate; summary.s30Num = mS30.s30Num;
    summary.s30Den = mS30.s30Den; summary.s30Miss = mS30.s30Miss;
  }

  return {
    month, monthLabel: parseInt(month.slice(5,7),10) + '月',
    summary,
    weekTrend, byCat: monthByCat, groups: monthGroups,
    dayRates: monthDayRates,
    totalWeeks: weekTrend.length,
  };
}

/* ==================== 组装 AI 上下文（按 focus 过滤） ==================== */
function buildAiContextData(biz, wk, focus) {
  focus = focus || '综合';
  const src = bizToSrc(biz);
  const prevWk = wk - 1;
  const out = { biz, wk, prevWk, focus, emps: [], groups: [], aht2: [], byCat: {}, baseline: {} };

  const need30S     = (focus === '30S' || focus === '综合' || focus === '对比');
  const needAHT     = (focus === 'AHT' || focus === '综合' || focus === '对比');
  const needQuality = (focus === '质量' || focus === '综合' || focus === '对比');
  const needAll     = (focus === '综合' || focus === '对比');
  const srcEmps = srcEmployeeSet(src);

  /* ① 30S 明细 */
  if (need30S) {
    const a = s30AnalysisData(biz, wk);
    if (a) {
      out.s30 = {
        totNum: a.totNum, totDen: a.totDen, totRate: a.totRate,
        th: a.th, hit: a.hit, gapNum: a.gapNum,
        totFc: a.totFc, totBias: a.totBias,
        days: a.days.map(d => ({
          date: d.date, rate: d.rate, miss: d.miss,
          den: d.den, forecast: d.forecast, bias: d.bias, hit: d.hit,
        })),
        periods: a.periods.map(p => ({
          period: p.period, rate: p.rate, miss: p.miss,
          den: p.den, forecast: p.forecast, bias: p.bias,
        })),
        emps: a.emps.slice(0, 15).map(e => ({ name: e.name, rate: e.rate, miss: e.miss, den: e.den })),
        fcBuckets: a.fcBuckets,
        impacts: (function () {
          try {
            const list = computeOverForecastImpactDetail(a);
            return list.slice(0, 12).map(x => ({
              date: x.date, period: x.period,
              forecast: x.forecast, den: x.den, bias: x.bias,
              miss: x.miss, rate: x.rate,
              dayImpact: x.dayImpact, weekImpact: x.weekImpact,
            }));
          } catch (_) { return []; }
        })(),
      };
    }
  }

  /* ①.5 质量指标日度明细 */
  if (needQuality) {
    const qDayMap = new Map();
    const recs = S.records.filter(r => r.src === src && r.wk === wk);
    for (const r of recs) {
      if (!qDayMap.has(r.date)) {
        qDayMap.set(r.date, { date: r.date, volume: 0, solved: 0, solveEval: 0, satisfy: 0, satisfyEval: 0 });
      }
      const d = qDayMap.get(r.date);
      d.volume += r.volume;
      d.solved += r.solved;
      d.solveEval += r.solveEval;
      d.satisfy += r.satisfy;
      d.satisfyEval += r.satisfyEval;
    }
    const inspByDay = new Map();
    for (const r of S.inspections) {
      if (r.src !== src || r.wk !== wk) continue;
      if (!inspByDay.has(r.date)) inspByDay.set(r.date, { total: 0, pass: 0, ids: new Set() });
      const o = inspByDay.get(r.date);
      if (!o.ids.has(r.id)) { o.ids.add(r.id); o.total++; if (r.pass) o.pass++; }
    }
    out.qualityDays = Array.from(qDayMap.values()).sort((a, b) => a.date < b.date ? -1 : 1).map(d => {
      const insp = inspByDay.get(d.date);
      return {
        date: d.date,
        solveRate: d.solveEval > 0 ? d.solved / d.solveEval : null,
        satisfaction: d.satisfyEval > 0 ? d.satisfy / d.satisfyEval : null,
        qualityPassRate: (insp && insp.total > 0) ? insp.pass / insp.total : null,
        qualityTotal: insp ? insp.total : 0,
      };
    });

    const qEmps = [];
    for (const e of S.roster.filter(x => employeeVisible(x) && srcEmps.has(x.name))) {
      const nameSet = new Set([e.name]);
      const c = calcBySrc(src, { nameSet, wkSet: new Set([wk]) });
      if (c.caseVolume === 0) continue;
      qEmps.push({
        name: e.name, group: e.group || '—', category: categoryOf(e, S.month) || '—',
        caseVolume: c.caseVolume,
        solveRate: c.solveRate, satisfaction: c.satisfaction,
        qualityPassRate: c.qualityPassRate,
        solveEval: c.solveEval, satisfyEval: c.satisfyEval,
      });
    }
    qEmps.sort((a, b) => (a.solveRate || 99) - (b.solveRate || 99));
    out.qualityEmps = qEmps;
  }

  /* ② 4 周基线 */
  try {
    const wks = [];
    for (let i = 0; i < 4; i++) {
      const w = wk - i;
      const c = calcBySrc(src, { wkSet: new Set([w]) });
      if (c.caseVolume === 0 && c.s30Den === 0) continue;
      const s30 = calcByL1(biz, { wkSet: new Set([w]) });
      const row = { wk: w, caseVolume: c.caseVolume };
      if (needAHT) {
        row.cpd = c.cpd; row.aht = c.aht;
        row.concurrency = c.concurrency; row.utilization = c.utilization;
      }
      if (needQuality) {
        row.solveRate = c.solveRate; row.satisfaction = c.satisfaction;
        row.qualityPassRate = c.qualityPassRate;
      }
      if (need30S) {
        row.s30Rate = s30.s30Rate; row.s30Num = s30.s30Num;
        row.s30Den = s30.s30Den; row.s30Miss = s30.s30Miss;
      }
      wks.push(row);
    }
    out.baseline.weeks = wks;
    if (need30S) {
      const dayBaseline = {};
      for (const w of wks) {
        if (w.wk === wk) continue;
        for (let i = 0; i < 7; i++) {
          const d = dateAdd(wkStartDate(w.wk), i);
          if (!d) continue;
          const recs = S.records.filter(r => r.biz === biz && r.date === d);
          if (!recs.length) continue;
          let n = 0, den = 0;
          for (const r of recs) { n += r.s30Num; den += r.s30Den; }
          if (den <= 0) continue;
          const key = weekdayOf(d);
          if (!dayBaseline[key]) dayBaseline[key] = { rates: [], n: 0 };
          dayBaseline[key].rates.push(n / den);
          dayBaseline[key].n++;
        }
      }
      out.baseline.dayOfWeek = {};
      for (const k in dayBaseline) {
        const arr = dayBaseline[k].rates;
        if (!arr.length) continue;
        const avg = arr.reduce((s, x) => s + x, 0) / arr.length;
        out.baseline.dayOfWeek[k] = { avg, min: Math.min.apply(null, arr), max: Math.max.apply(null, arr), n: arr.length };
      }
    }
  } catch (_) {}

  /* ③ 员工明细 */
  const allEmps = S.roster.filter(e => employeeVisible(e) && srcEmps.has(e.name));
  for (const e of allEmps) {
    const nameSet = new Set([e.name]);
    const c = calcBySrc(src, { nameSet, wkSet: new Set([wk]) });
    const p = calcBySrc(src, { nameSet, wkSet: new Set([prevWk]) });
    if (c.caseVolume === 0 && p.caseVolume === 0) continue;
    const row = { name: e.name, group: e.group || '—', category: categoryOf(e, S.month) || '—' };
    if (needAHT || needAll) {
      row.caseVolume = c.caseVolume; row.cpd = c.cpd; row.aht = c.aht;
      row.concurrency = c.concurrency;
      row.prevCaseVolume = p.caseVolume; row.prevCpd = p.cpd; row.prevAht = p.aht;
    }
    if (needQuality || needAll) {
      row.solveRate = c.solveRate; row.satisfaction = c.satisfaction;
      row.qualityPassRate = c.qualityPassRate;
      row.prevSolveRate = p.solveRate; row.prevSatisfaction = p.satisfaction;
    }
    if (focus === '30S') {
      const s30 = calcByL1(biz, { nameSet, wkSet: new Set([wk]) });
      row.s30Rate = s30.s30Rate; row.s30Den = s30.s30Den; row.s30Miss = s30.s30Miss;
    }
    out.emps.push(row);
  }

  /* ④ 分类明细 */
  for (const cat of ['首月','次月','老人']) {
    const names = allEmps.filter(e => (categoryOf(e, S.month) || '').includes(cat)).map(e => e.name);
    if (!names.length) continue;
    const nameSet = new Set(names);
    const c = calcBySrc(src, { nameSet, wkSet: new Set([wk]) });
    const p = calcBySrc(src, { nameSet, wkSet: new Set([prevWk]) });
    const row = { count: names.length };
    if (needAHT || needAll) {
      row.caseVolume = c.caseVolume; row.cpd = c.cpd; row.aht = c.aht;
      row.concurrency = c.concurrency;
      row.prevCpd = p.cpd; row.prevAht = p.aht;
    }
    if (needQuality || needAll) {
      row.solveRate = c.solveRate; row.satisfaction = c.satisfaction;
      row.qualityPassRate = c.qualityPassRate;
      row.prevSolveRate = p.solveRate; row.prevSatisfaction = p.satisfaction;
    }
    out.byCat[cat] = row;
  }

  /* ⑤ 组别明细 */
  const groupMap = {};
  for (const e of allEmps) { const g = e.group || '—'; (groupMap[g] = groupMap[g] || []).push(e.name); }
  out.groups = Object.keys(groupMap).sort().map(g => {
    const nameSet = new Set(groupMap[g]);
    const c = calcBySrc(src, { nameSet, wkSet: new Set([wk]) });
    const p = calcBySrc(src, { nameSet, wkSet: new Set([prevWk]) });
    const row = { name: g, count: nameSet.size };
    if (needAHT || needAll) {
      row.caseVolume = c.caseVolume; row.cpd = c.cpd; row.aht = c.aht;
      row.concurrency = c.concurrency;
      row.prevCpd = p.cpd; row.prevAht = p.aht;
    }
    if (needQuality || needAll) {
      row.solveRate = c.solveRate; row.satisfaction = c.satisfaction;
      row.qualityPassRate = c.qualityPassRate;
    }
    return row;
  }).filter(g => g.caseVolume != null ? g.caseVolume > 0 : true);

  /* ⑥ 二级打点 AHT */
  if (needAHT) {
    try {
      const aht2 = aht2ByWeek(biz, wk);
      out.aht2 = aht2.list.filter(o => o.volNow > 0 || o.volPrev > 0)
        .sort((x, y) => Math.abs(y.impact || 0) - Math.abs(x.impact || 0))
        .slice(0, 15)
        .map(o => ({ l1: o.l1, l2: o.l2, ahtNow: o.ahtNow, ahtPrev: o.ahtPrev, volNow: o.volNow, volPrev: o.volPrev, impact: o.impact }));
    } catch (_) {}
  }

  /* ⑦ 整体 */
  const wkCur  = calcBySrc(src, { wkSet: new Set([wk]) });
  const wkPrev = calcBySrc(src, { wkSet: new Set([prevWk]) });
  const curRow = { caseVolume: wkCur.caseVolume };
  const prevRow = { caseVolume: wkPrev.caseVolume };
  if (needAHT || needAll) {
    curRow.cpd = wkCur.cpd; curRow.aht = wkCur.aht;
    curRow.concurrency = wkCur.concurrency; curRow.utilization = wkCur.utilization;
    prevRow.cpd = wkPrev.cpd; prevRow.aht = wkPrev.aht;
    prevRow.concurrency = wkPrev.concurrency; prevRow.utilization = wkPrev.utilization;
  }
  if (needQuality || needAll) {
    curRow.solveRate = wkCur.solveRate; curRow.satisfaction = wkCur.satisfaction;
    curRow.qualityPassRate = wkCur.qualityPassRate;
    prevRow.solveRate = wkPrev.solveRate; prevRow.satisfaction = wkPrev.satisfaction;
    prevRow.qualityPassRate = wkPrev.qualityPassRate;
  }
  out.overall = { cur: curRow, prev: prevRow };

  /* ⑧ 月度上下文 */
  try {
    const monthCtx = buildMonthContext(biz, wk, focus);
    if (monthCtx) out.month = monthCtx;
  } catch (_) {}

  return out;
}

/* ==================== AI Prompt 组装 ==================== */
function buildStage1Prompt(biz, wk, focus, ctx) {
  const scopeMap = {
    '综合': '所有维度',
    '30S':  '**仅限 30S 接起率相关**（接起率、Miss、预测偏差、时段分布、员工接起率、超预测影响）。不得提及 AHT / CPD / 解决率 / 满意度 / 质检率等其他指标。',
    'AHT':  '**仅限 AHT 与人效相关**（AHT 数值与环比、二级打点 AHT 影响值、CPD、并发、工时利用率、CASE 处理量）。不得提及 30S 接起率 / 解决率 / 满意度 / 质检率。',
    '质量': '**仅限质量指标**（解决率、满意度、质检合格率、首月/次月/老人分类差异）。不得提及 30S 接起率 / AHT / CPD。',
    '对比': '所有指标的环比变化（本周 vs 上周 vs 本月均值）。',
  };
  const scopeText = scopeMap[focus] || scopeMap['综合'];

  const system = [
    '你是资深客服数据运营分析师。现在是**第一阶段：异常扫描**。',
    '你的唯一任务是：从给定的本周 + 月度背景数据中，**系统性地找出所有值得进一步分析的异常点**。',
    '',
    '【范围约束（最高优先级）】',
    '本次分析范围：' + scopeText,
    '范围外的指标，即使数据里有异常，也**绝对不要**出现在输出中。',
    '',
    '【异常定义】满足以下任一条件即为异常，必须列出：',
    '- 日度：单日指标偏离该星期几的近 4 周均值超过 5%，或偏离本月均值超过 8%',
    '- 月度对照：本周指标与本月均值差异 > 10%，或与本月最佳/最差周差异显著',
    '- 时段：单时段 Miss 量 ≥ 10，或接起率 < 阈值 - 5pp',
    '- 员工：单员工接起率 < 阈值 - 5pp 且服务量 ≥ 20；或员工间接起率极差 > 15pp',
    '- 分类：不同分类（首月/次月/老人）同指标差异 > 10%',
    '- 组别：不同组别同指标差异 > 10%',
    '- 环比：任一指标 WoW 变化 > 10%',
    '- 预测：任一日期或时段的实际/预测偏差 > 120% 或 < 80%',
    '',
    '【输出格式（严格 JSON，不要 Markdown 包裹）】',
    '{',
    '  "anomalies": [',
    '    { "type": "日度/时段/员工/分类/组别/环比/预测/月度对照",',
    '      "target": "精确坐标，如 09-16 16时 或 张三 或 一组",',
    '      "metric": "指标名（必须是本范围内的指标）",',
    '      "value": "本周值",',
    '      "baseline": "对比基线值（如近4周均值 / 本月均值 / 阈值 / 上周值）",',
    '      "gap": "差距（绝对值或百分比）",',
    '      "why": "为什么算异常（一句话，引用数字）" }',
    '  ]',
    '}',
    '',
    '要求：',
    '1. 每个异常必须给出精确坐标（具体到日期/时段/人名）；',
    '2. 至少列出 5 个，最多 15 个；',
    '3. 按严重度降序（gap 越大越靠前）；',
    '4. 只输出 JSON，不要解释文字。',
  ].join('\n');

  const user = '业务线：' + biz + '\n周次：WK' + wk + '\n分析范围：' + focus + '\n\n=== 数据 ===\n\n' + formatAiContext(ctx) + '\n\n请输出 JSON。';
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function buildStage2Prompt(biz, wk, focus, ctx, anomalies) {
  const focusMap = {
    '综合': '综合解读',
    '30S':  '聚焦 30S 接起率',
    'AHT':  '聚焦 AHT 与人效',
    '质量': '聚焦质量指标',
    '对比': '聚焦环比变化',
  };
  const focusText = focusMap[focus] || focusMap['综合'];

  const scopeMap = {
    '综合': '所有维度',
    '30S':  '**仅限 30S 接起率相关**。不得提及 AHT / CPD / 解决率 / 满意度 / 质检率等其他指标。',
    'AHT':  '**仅限 AHT 与人效相关**（AHT、二级打点影响值、CPD、并发、工时利用率）。不得提及 30S 接起率 / 解决率 / 满意度 / 质检率。',
    '质量': '**仅限质量指标**（解决率、满意度、质检合格率、分类差异）。不得提及 30S 接起率 / AHT / CPD。',
    '对比': '所有指标的环比变化。',
  };
  const scopeText = scopeMap[focus] || scopeMap['综合'];

  const system = [
    '你是资深客服数据运营分析师。现在是**第二阶段：深度归因**。',
    '第一阶段已识别出以下异常点，你的任务是逐一深度分析。',
    '',
    '【⚠️ 范围约束（最高优先级）】',
    '本次分析范围：' + scopeText,
    '范围外的指标，即使数据里有异常，也**绝对不要**出现在报告中。',
    '如果第一阶段的异常列表中包含范围外的指标，直接跳过，不要分析。',
    '',
    '【分析框架（每个异常必须严格按此展开）】',
    '### N. [异常标题：指标 + 方向 + 数值]',
    '**现象**：用一句话描述异常，**必须**含：坐标（日期或时段或人名）+ 该指标本周值 + 对比值 + 差距。',
    '**数据**：列出 2~4 个数据点。**每一条数据必须是本异常指标的直接数据**——',
    '  - 如果异常是"解决率下降"，就列解决率的周值/日值/员工值；',
    '  - **禁止**把满意度、质检率等其他指标也列进来凑数；',
    '  - 只有作为"相关性旁证"时，才允许在**最后一条**列一次其他指标，且必须标注"（旁证）"。',
    '**周内定位**：**必须**说出具体是哪一天/哪个时段最差。',
    '  - 如果本指标有日度明细数据（见上文「日度明细」表），直接引用最差/最好的日期；',
    '  - 如果**本指标没有**日度数据，就明说"本指标无日度明细数据，无法定位到具体日期"，不要跳过此段。',
    '**月度定位**：本周指标在本月各周中的排名（最低/最高/中位），以及与月均值的偏离。',
    '**基线**：与近 4 周均值 / 上周 / 阈值 / 本月均值分别对比，说明为什么算异常。',
    '**根因推断**：给出 2~3 个可能根因，每个根因**必须**引用具体数据（哪个员工、哪一天、哪个分类），按可能性排序。',
    '**验证方法**：为证实/排除每个根因，需要查看什么数据或做什么检查。',
    '**行动建议**：【谁 + 做什么 + 预期效果 + 如何衡量】，2~3 条。**必须**能落到人/组/日期上，不能泛泛说"加强培训"。',
    '',
    '【硬性要求】',
    '1. **指标纯度**：每一条数据都要标清属于哪个指标，禁止把 A 指标的结论挂在 B 指标下。',
    '2. **具体可溯源**：引用数字时必须带坐标（日期 / 时段 / 人名 / 组名）。',
    '3. **禁止空泛**：',
    '   ❌ 反例："人员能力不足，建议加强培训。"',
    '   ✅ 正例："张三（组别A，首月）解决率 48.2%，低于组均 65.1% 约 17pp，其本周处理 120 单中仅 58 单有解决评价且 28 单好评；建议对其 3 月 15-17 日的 40 单做逐单复盘。"',
    '4. **根因必须落到"人 / 流程 / 系统 / 数据口径"四类之一**。',
    '5. **数据不足时明说**："本指标缺 XX 数据，无法判断 XX"，不要编造。',
  ].join('\n');

  const anomalyList = anomalies.map((a, i) =>
    (i + 1) + '. [' + a.type + '] ' + a.target + ' · ' + a.metric + ' = ' + a.value + '（基线 ' + a.baseline + '，差距 ' + a.gap + '）\n   ' + a.why
  ).join('\n');

  const user = [
    '业务线：' + biz + '，周次：WK' + wk + '（' + focusText + '）',
    '',
    '=== 第一阶段识别出的异常 ===',
    '',
    anomalyList,
    '',
    '=== 本周完整明细数据 + 月度背景（' + focus + '模式） ===',
    '',
    formatAiContext(ctx),
    '',
    '=== 数据结束 ===',
    '',
    '请按框架逐一深度分析上述异常。输出 Markdown 格式。',
    '',
    '最后附加一段：',
    '## 整体判断',
    '综合以上异常，结合本月各周趋势，用 3~5 句话给出本周整体结论：最大问题是什么、次要问题是什么、下一周应该优先改进什么、与月度目标的关系。',
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/* ==================== AI 上下文格式化 ==================== */
function formatAiContext(ctx) {
  const lines = [];
  const focus = ctx.focus || '综合';
  const n2 = v => (v == null || !isFinite(v)) ? '—' : (typeof v === 'number' ? v.toFixed(2) : String(v));
  const p2 = v => (v == null || !isFinite(v)) ? '—' : (v * 100).toFixed(2) + '%';
  const i0 = v => (v == null || !isFinite(v)) ? '—' : String(Math.round(v));
  const sgn = v => (v == null || !isFinite(v)) ? '—' : ((v >= 0 ? '+' : '') + n2(v));

  const need30S     = !!ctx.s30;
  const needAHT     = !!(ctx.aht2 && ctx.aht2.length) || focus === 'AHT';
  const needQuality = focus === '质量' || focus === '综合' || focus === '对比';

  if (ctx.baseline && ctx.baseline.weeks && ctx.baseline.weeks.length) {
    lines.push('【近 4 周基线（含本周，帮判断异常）】');
    const cols = ['WK', 'CASE'];
    if (needAHT) cols.push('CPD', 'AHT', '并发', '利用率');
    if (needQuality) cols.push('解决率', '满意度', '质检率');
    if (need30S) cols.push('30S接起率');
    lines.push('  ' + cols.join(' | '));
    for (const w of ctx.baseline.weeks) {
      const arr = ['WK' + w.wk, i0(w.caseVolume)];
      if (needAHT) arr.push(n2(w.cpd), n2(w.aht), n2(w.concurrency), p2(w.utilization));
      if (needQuality) arr.push(p2(w.solveRate), p2(w.satisfaction), p2(w.qualityPassRate));
      if (need30S) arr.push(p2(w.s30Rate));
      lines.push('  ' + arr.join(' | '));
    }
    lines.push('');
    if (need30S && ctx.baseline.dayOfWeek && Object.keys(ctx.baseline.dayOfWeek).length) {
      lines.push('【30S 按星期几的近 4 周基线】');
      lines.push('  星期 | 均值 | 最小 | 最大 | 样本数');
      for (const k of ['一','二','三','四','五','六','日']) {
        const b = ctx.baseline.dayOfWeek[k];
        if (!b) continue;
        lines.push('  周' + k + ' | ' + p2(b.avg) + ' | ' + p2(b.min) + ' | ' + p2(b.max) + ' | ' + b.n);
      }
      lines.push('');
    }
  }

  const { cur, prev } = ctx.overall;
  lines.push('【整体指标 · 本周 vs 上周】');
  lines.push('  指标         | 本周      | 上周      | 变化');
  lines.push('  CASE处理量   | ' + i0(cur.caseVolume) + ' | ' + i0(prev.caseVolume) + ' | ' + sgn(cur.caseVolume - prev.caseVolume));
  if (needAHT) {
    lines.push('  CPD          | ' + n2(cur.cpd) + ' | ' + n2(prev.cpd) + ' | ' + sgn(cur.cpd != null && prev.cpd != null ? cur.cpd - prev.cpd : null));
    lines.push('  AHT          | ' + n2(cur.aht) + ' | ' + n2(prev.aht) + ' | ' + sgn(cur.aht != null && prev.aht != null ? cur.aht - prev.aht : null));
    lines.push('  并发         | ' + n2(cur.concurrency) + ' | ' + n2(prev.concurrency) + ' | ' + sgn(cur.concurrency != null && prev.concurrency != null ? cur.concurrency - prev.concurrency : null));
    lines.push('  工时利用率   | ' + p2(cur.utilization) + ' | ' + p2(prev.utilization));
  }
  if (needQuality) {
    lines.push('  解决率       | ' + p2(cur.solveRate) + ' | ' + p2(prev.solveRate));
    lines.push('  满意度       | ' + p2(cur.satisfaction) + ' | ' + p2(prev.satisfaction));
    lines.push('  质检合格率   | ' + p2(cur.qualityPassRate) + ' | ' + p2(prev.qualityPassRate));
  }
  lines.push('');

  if (ctx.s30) {
    const s = ctx.s30;
    lines.push('【30S 接起率 · 整体】');
    lines.push('  接起率=' + p2(s.totRate) + '（阈值 ' + p2(s.th) + '，' + (s.hit ? '达标' : '未达标') + '），分子=' + i0(s.totNum) + '，分母=' + i0(s.totDen) + '，Miss=' + i0(s.totDen - s.totNum));
    if (!s.hit && s.gapNum != null) lines.push('  缺口=' + s.gapNum + ' 单');
    if (s.totFc > 0) lines.push('  预测量合计=' + i0(s.totFc) + '，实际/预测偏差=' + p2(s.totBias));
    lines.push('');
    lines.push('【30S 日度明细】');
    lines.push('  日期       | 接起率   | Miss | 服务量 | 预测量 | 偏差    | 是否达标');
    for (const d of s.days) {
      lines.push('  ' + d.date + ' | ' + p2(d.rate) + ' | ' + d.miss + ' | ' + i0(d.den) + ' | ' + (d.forecast > 0 ? i0(d.forecast) : '—') + ' | ' + p2(d.bias) + ' | ' + (d.hit ? '✅' : '❌'));
    }
    lines.push('');
    if (s.periods.length) {
      lines.push('【30S 时段明细 · 按 Miss 降序 Top 12】');
      lines.push('  时段 | 接起率   | Miss | 服务量 | 预测量 | 偏差');
      const sorted = s.periods.slice().sort((a, b) => b.miss - a.miss).slice(0, 12);
      for (const p of sorted) {
        lines.push('  ' + p.period + '时 | ' + p2(p.rate) + ' | ' + p.miss + ' | ' + i0(p.den) + ' | ' + (p.forecast > 0 ? i0(p.forecast) : '—') + ' | ' + p2(p.bias));
      }
      lines.push('');
    }
    if (s.emps.length) {
      lines.push('【30S 员工维度 · 按 Miss 降序 Top 15】');
      lines.push('  排名 | 姓名 | 接起率   | Miss | 服务量');
      s.emps.forEach((e, i) => {
        lines.push('  ' + (i + 1) + ' | ' + e.name + ' | ' + p2(e.rate) + ' | ' + e.miss + ' | ' + i0(e.den));
      });
      lines.push('');
    }
    if (s.impacts && s.impacts.length) {
      lines.push('【30S 超预测 & 未达标影响值明细 · Top 12】');
      lines.push('  日期 | 时段 | 预测量 | 实际量 | 偏差 | Miss | 时段接起率 | 日度影响 | 周度影响');
      for (const x of s.impacts) {
        lines.push('  ' + x.date + ' | ' + x.period + '时 | ' + i0(x.forecast) + ' | ' + i0(x.den) + ' | ' + p2(x.bias) + ' | ' + x.miss + ' | ' + p2(x.rate) + ' | ' + (x.dayImpact >= 0 ? '+' : '') + (x.dayImpact * 100).toFixed(2) + 'pp | ' + (x.weekImpact >= 0 ? '+' : '') + (x.weekImpact * 100).toFixed(2) + 'pp');
      }
      lines.push('');
    }
  }

  if (ctx.qualityDays && ctx.qualityDays.length) {
    lines.push('【🎯 质量指标 · 日度明细（找具体哪一天最差）】');
    lines.push('  日期       | 解决率   | 满意度   | 质检合格率 | 抽检量');
    for (const d of ctx.qualityDays) {
      lines.push('  ' + d.date + ' | ' + p2(d.solveRate) + ' | ' + p2(d.satisfaction) + ' | ' + p2(d.qualityPassRate) + ' | ' + d.qualityTotal);
    }
    lines.push('');
  }

  if (ctx.qualityEmps && ctx.qualityEmps.length) {
    lines.push('【🎯 质量指标 · 员工维度（按解决率升序，最差在前 Top 15）】');
    lines.push('  姓名 | 组别 | 分类 | CASE | 解决率 | 满意度 | 质检率 | 解决评价量 | 满意评价量');
    const sorted = ctx.qualityEmps.slice(0, 15);
    for (const e of sorted) {
      lines.push('  ' + e.name + ' | ' + e.group + ' | ' + e.category + ' | ' + i0(e.caseVolume) + ' | ' + p2(e.solveRate) + ' | ' + p2(e.satisfaction) + ' | ' + p2(e.qualityPassRate) + ' | ' + i0(e.solveEval) + ' | ' + i0(e.satisfyEval));
    }
    lines.push('');
  }

  if (ctx.byCat && Object.keys(ctx.byCat).length) {
    lines.push('【分类明细（本周）】');
    const cols = ['分类', '人数', 'CASE'];
    if (needAHT) cols.push('CPD(本周/上周)', 'AHT(本周/上周)');
    if (needQuality) cols.push('解决率(本周/上周)', '满意度(本周/上周)');
    lines.push('  ' + cols.join(' | '));
    for (const cat of ['首月','次月','老人']) {
      const c = ctx.byCat[cat];
      if (!c) continue;
      const arr = [cat, c.count, i0(c.caseVolume)];
      if (needAHT) arr.push(n2(c.cpd) + '/' + n2(c.prevCpd), n2(c.aht) + '/' + n2(c.prevAht));
      if (needQuality) arr.push(p2(c.solveRate) + '/' + p2(c.prevSolveRate), p2(c.satisfaction) + '/' + p2(c.prevSatisfaction));
      lines.push('  ' + arr.join(' | '));
    }
    lines.push('');
  }

  if (ctx.groups && ctx.groups.length) {
    lines.push('【组别明细（本周）】');
    const cols = ['组别', '人数', 'CASE'];
    if (needAHT) cols.push('CPD(本周/上周)', 'AHT');
    if (needQuality) cols.push('解决率', '满意度');
    lines.push('  ' + cols.join(' | '));
    for (const g of ctx.groups) {
      const arr = [g.name, g.count, i0(g.caseVolume)];
      if (needAHT) arr.push(n2(g.cpd) + '/' + n2(g.prevCpd), n2(g.aht));
      if (needQuality) arr.push(p2(g.solveRate), p2(g.satisfaction));
      lines.push('  ' + arr.join(' | '));
    }
    lines.push('');
  }

  if (ctx.emps && ctx.emps.length) {
    const sorted = ctx.emps.slice().sort((a, b) => (b.caseVolume || 0) - (a.caseVolume || 0)).slice(0, 25);
    lines.push('【员工明细 · Top 25】');
    const cols = ['姓名', '组别', '分类'];
    if (needAHT) cols.push('CASE', 'CPD', 'AHT', '并发', '上周CPD');
    if (needQuality) cols.push('解决率', '满意度', '质检率');
    if (focus === '30S') cols.push('接起率', 'Miss', '服务量');
    lines.push('  ' + cols.join(' | '));
    for (const e of sorted) {
      const arr = [e.name, e.group, e.category];
      if (needAHT) arr.push(i0(e.caseVolume), n2(e.cpd), n2(e.aht), n2(e.concurrency), n2(e.prevCpd));
      if (needQuality) arr.push(p2(e.solveRate), p2(e.satisfaction), p2(e.qualityPassRate));
      if (focus === '30S') arr.push(p2(e.s30Rate), i0(e.s30Miss), i0(e.s30Den));
      lines.push('  ' + arr.join(' | '));
    }
    lines.push('');
  }

  if (ctx.aht2 && ctx.aht2.length) {
    lines.push('【二级打点 AHT · 按影响绝对值 Top 15】');
    lines.push('  一级 | 二级 | AHT(本周/上周) | 服务量(本周/上周) | 影响值');
    for (const o of ctx.aht2) {
      const imp = o.impact == null ? '—' : ((o.impact > 0 ? '+' : '') + o.impact.toFixed(2));
      lines.push('  ' + o.l1 + ' | ' + o.l2 + ' | ' + n2(o.ahtNow) + '/' + n2(o.ahtPrev) + ' | ' + i0(o.volNow) + '/' + i0(o.volPrev) + ' | ' + imp);
    }
    lines.push('');
  }

  if (ctx.month) {
    lines.push('');
    lines.push(formatMonthContext(ctx.month));
  }

  return lines.join('\n');
}

function formatMonthContext(monthCtx) {
  if (!monthCtx) return '';
  const lines = [];
  const n2 = v => (v == null || !isFinite(v)) ? '—' : (typeof v === 'number' ? v.toFixed(2) : String(v));
  const p2 = v => (v == null || !isFinite(v)) ? '—' : (v * 100).toFixed(2) + '%';
  const i0 = v => (v == null || !isFinite(v)) ? '—' : String(Math.round(v));

  lines.push('【📅 ' + monthCtx.monthLabel + ' 月度汇总（用于判断本周在月内所处位置）】');
  const s = monthCtx.summary;
  lines.push('  指标         | 月度值');
  lines.push('  CASE处理量   | ' + i0(s.caseVolume));
  if (s.cpd != null) lines.push('  CPD          | ' + n2(s.cpd));
  if (s.aht != null) lines.push('  AHT          | ' + n2(s.aht));
  if (s.concurrency != null) lines.push('  并发         | ' + n2(s.concurrency));
  if (s.utilization != null) lines.push('  工时利用率   | ' + p2(s.utilization));
  if (s.solveRate != null) lines.push('  解决率       | ' + p2(s.solveRate));
  if (s.satisfaction != null) lines.push('  满意度       | ' + p2(s.satisfaction));
  if (s.qualityPassRate != null) lines.push('  质检合格率   | ' + p2(s.qualityPassRate));
  if (s.s30Rate != null) lines.push('  30S接起率    | ' + p2(s.s30Rate) + '（分子=' + i0(s.s30Num) + '，分母=' + i0(s.s30Den) + '，Miss=' + i0(s.s30Miss) + '）');
  lines.push('');

  if (monthCtx.weekTrend.length > 1) {
    lines.push('【📈 本月各周趋势（共 ' + monthCtx.totalWeeks + ' 周）】');
    const cols = ['WK', 'CASE'];
    if (s.cpd != null) cols.push('CPD');
    if (s.aht != null) cols.push('AHT');
    if (s.concurrency != null) cols.push('并发');
    if (s.solveRate != null) cols.push('解决率');
    if (s.satisfaction != null) cols.push('满意度');
    if (s.qualityPassRate != null) cols.push('质检率');
    if (s.s30Rate != null) cols.push('30S接起率', '30S Miss');
    lines.push('  ' + cols.join(' | '));
    for (const w of monthCtx.weekTrend) {
      const arr = ['WK' + w.wk, i0(w.caseVolume)];
      if (s.cpd != null) arr.push(n2(w.cpd));
      if (s.aht != null) arr.push(n2(w.aht));
      if (s.concurrency != null) arr.push(n2(w.concurrency));
      if (s.solveRate != null) arr.push(p2(w.solveRate));
      if (s.satisfaction != null) arr.push(p2(w.satisfaction));
      if (s.qualityPassRate != null) arr.push(p2(w.qualityPassRate));
      if (s.s30Rate != null) arr.push(p2(w.s30Rate), i0(w.s30Miss));
      lines.push('  ' + arr.join(' | '));
    }
    lines.push('');
  }

  if (monthCtx.byCat && Object.keys(monthCtx.byCat).length) {
    lines.push('【📊 本月分类明细】');
    const cols = ['分类', '人数', 'CASE'];
    if (s.cpd != null) cols.push('CPD', 'AHT');
    if (s.solveRate != null) cols.push('解决率', '满意度');
    if (s.s30Rate != null) cols.push('30S接起率');
    lines.push('  ' + cols.join(' | '));
    for (const cat of ['首月','次月','老人']) {
      const c = monthCtx.byCat[cat];
      if (!c) continue;
      const arr = [cat, c.count, i0(c.caseVolume)];
      if (s.cpd != null) arr.push(n2(c.cpd), n2(c.aht));
      if (s.solveRate != null) arr.push(p2(c.solveRate), p2(c.satisfaction));
      if (s.s30Rate != null) arr.push(p2(c.s30Rate));
      lines.push('  ' + arr.join(' | '));
    }
    lines.push('');
  }

  if (monthCtx.groups && monthCtx.groups.length) {
    lines.push('【📊 本月组别明细】');
    const cols = ['组别', '人数', 'CASE'];
    if (s.cpd != null) cols.push('CPD', 'AHT');
    if (s.solveRate != null) cols.push('解决率', '满意度');
    if (s.s30Rate != null) cols.push('30S接起率');
    lines.push('  ' + cols.join(' | '));
    for (const g of monthCtx.groups) {
      const arr = [g.name, g.count, i0(g.caseVolume)];
      if (s.cpd != null) arr.push(n2(g.cpd), n2(g.aht));
      if (s.solveRate != null) arr.push(p2(g.solveRate), p2(g.satisfaction));
      if (s.s30Rate != null) arr.push(p2(g.s30Rate));
      lines.push('  ' + arr.join(' | '));
    }
    lines.push('');
  }

  if (monthCtx.dayRates && monthCtx.dayRates.length > 0) {
    lines.push('【📅 本月每日 30S 接起率（用于对比本周每日，判断"某天是否异常"）】');
    lines.push('  日期 | 接起率 | Miss | 服务量');
    const showDays = monthCtx.dayRates.slice(-20);
    for (const d of showDays) {
      lines.push('  ' + d.date.slice(5) + ' | ' + p2(d.rate) + ' | ' + d.miss + ' | ' + i0(d.den));
    }
    if (monthCtx.dayRates.length > 20) {
      lines.push('  ...（仅展示最近 20 天，全月共 ' + monthCtx.dayRates.length + ' 天）');
    }
    lines.push('');
  }

  return lines.join('\n');
}

/* ==================== AI 主流程 ==================== */
async function runAiAnalysis() {
  const keyEl = $('#aiKey');
  const modelEl = $('#aiModel');
  const focusEl = $('#aiFocus');
  const modeEl = $('#aiMode');
  const outEl = $('#aiOut');
  const btnRun = $('#btnAiRun');
  const btnStop = $('#btnAiStop');
  if (!outEl) return;

  const apiKey = ((keyEl && keyEl.value) || '').trim();
  const model = (modelEl && modelEl.value) || 'glm-5.3-flash';
  const focus = (focusEl && focusEl.value) || '综合';
  const mode = (modeEl && modeEl.value) || 'deep';

  if (!apiKey) {
    outEl.innerHTML = '<div class="ai-err">❌ 请先填写智谱 API Key（到 https://open.bigmodel.cn 免费注册）</div>';
    return;
  }
  saveAiConfig(apiKey, model);

  const bizEl = $('#rpBiz');
  const wkEl = $('#rpWK');
  const biz = (bizEl && bizEl.value) || '买手合作';
  const wk = parseInt((wkEl && wkEl.value) || '', 10) || S.latestWK;

  let ctx = null;
  try {
    ctx = buildAiContextData(biz, wk, focus);
    /* 已删除：ctx._reportMd 从未被使用，避免每次 AI 分析都白跑一遍全量周报聚合 */
  } catch (e) {
    outEl.innerHTML = '<div class="ai-err">❌ 生成上下文失败：' + esc(e.message) + '</div>';
    return;
  }
  if (!ctx || ((!ctx.emps || !ctx.emps.length) && !ctx.s30)) {
    outEl.innerHTML = '<div class="ai-err">❌ 数据不足（无员工/无 30S 记录），无法分析。请确认当前周次有数据。</div>';
    return;
  }

  _aiStreaming = true;
  if (btnRun) { btnRun.disabled = true; btnRun.textContent = '分析中…'; }
  if (btnStop) btnStop.classList.remove('hidden');

  const controller = new AbortController();
  _aiAbort = controller;

  try {
    if (mode === 'single') {
      outEl.innerHTML = '<div class="ai-cursor"></div>';
      const messages = buildStage2Prompt(biz, wk, focus, ctx, [{ type: '整体', target: 'WK' + wk, metric: '所有', value: '见数据', baseline: '见基线', gap: '—', why: '请全面分析' }]);
      let buffer = '';
      let reasoningBuf = '';
      const logs = [];
      const render = () => {
        const dbg = logs.length
          ? '<div style="font-size:11px;color:#999;padding:4px 0;border-bottom:1px dashed #eee;margin-bottom:6px">' + logs.slice(-3).map(esc).join('<br>') + '</div>'
          : '';
        outEl.innerHTML = dbg + renderAiMarkdown(buffer) + (_aiStreaming ? '<span class="ai-cursor"></span>' : '');
        outEl.scrollTop = outEl.scrollHeight;
      };
      await callZhipuAI(
        apiKey, model, messages,
        (chunk, type) => {
          if (type === 'reasoning') reasoningBuf += chunk;
          else buffer += chunk;
          render();
        },
        controller.signal,
        (msg) => { logs.push('[调试] ' + msg); render(); }
      );
      _aiStreaming = false;
      if (!buffer.trim() && reasoningBuf.trim()) buffer = reasoningBuf;
      render();
    } else {
      outEl.innerHTML = '<div style="color:#7B8FBF;font-weight:600;padding:8px 0">🔍 阶段 1 / 2：扫描异常点…（范围：' + esc(focus) + '）</div><div class="ai-cursor"></div>';
      const stage1Messages = buildStage1Prompt(biz, wk, focus, ctx);
      let stage1Buf = '';
      let stage1Reason = '';
      const s1Logs = [];
      await callZhipuAI(
        apiKey, model, stage1Messages,
        (chunk, type) => {
          if (type === 'reasoning') stage1Reason += chunk;
          else stage1Buf += chunk;
          const show = stage1Buf || stage1Reason;
          outEl.innerHTML = '<div style="color:#7B8FBF;font-weight:600;padding:8px 0">🔍 阶段 1 / 2：扫描异常点…（范围：' + esc(focus) + '）</div>' +
            (s1Logs.length ? '<div style="font-size:11px;color:#999">' + s1Logs.slice(-2).map(esc).join('<br>') + '</div>' : '') +
            '<pre style="font-size:11px;color:#999;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow:auto">' + esc(show.slice(-800)) + '</pre><div class="ai-cursor"></div>';
        },
        controller.signal,
        (msg) => { s1Logs.push('[调试] ' + msg); }
      );

      let anomalies = [];
      try {
        const cleaned = stage1Buf.replace(/```json|```/g, '').trim();
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (m) {
          const obj = JSON.parse(m[0]);
          anomalies = obj.anomalies || [];
        }
      } catch (_) {}

      if (!anomalies.length) {
        const rawSnippet = (stage1Buf || stage1Reason || '').slice(0, 2000);
        outEl.innerHTML = '<div class="ai-err">' +
          '⚠ 阶段 1 未识别出有效异常点。<br>' +
          '可能原因：① 模型未按 JSON 格式输出；② 模型只输出了思维链未给出最终 JSON。<br>' +
          '<b>建议</b>：换用 <code>glm-5.3</code> 或 <code>glm-4-plus</code> 重试。<br><br>' +
          '<details><summary>查看原始输出（前 2000 字）</summary>' +
          '<pre style="font-size:11px;white-space:pre-wrap;word-break:break-all;max-height:400px;overflow:auto;background:#F4F3EF;padding:10px;border-radius:6px">' +
          esc(rawSnippet || '(空)') + '</pre></details>' +
          '</div>';
        _aiStreaming = false;
        return;
      }

      outEl.innerHTML = '<div style="color:#7B8FBF;font-weight:600;padding:8px 0">🔍 阶段 1 完成：识别出 <b>' + anomalies.length + '</b> 个异常点（范围：' + esc(focus) + '）</div>' +
        '<div style="background:#FAF9F7;padding:10px 14px;border-radius:8px;border-left:3px solid #98A8CE;font-size:12px;line-height:1.8;margin-bottom:12px">' +
        anomalies.map((a, i) => '• [' + esc(a.type) + '] ' + esc(a.target) + ' · ' + esc(a.metric) + ' = ' + esc(String(a.value)) + '（基线 ' + esc(String(a.baseline)) + '）').join('<br>') +
        '</div>' +
        '<div style="color:#7B8FBF;font-weight:600;padding:8px 0">🧠 阶段 2 / 2：逐条深度归因…</div><div class="ai-cursor"></div>';

      const stage2Messages = buildStage2Prompt(biz, wk, focus, ctx, anomalies);
      let stage2Buf = '';
      let stage2Reason = '';
      const s2Logs = [];
      const render2 = () => {
        const header = '<div style="color:#7B8FBF;font-weight:600;padding:8px 0;border-bottom:1px dashed #ddd;margin-bottom:10px">🔍 阶段 1 识别出 <b>' + anomalies.length + '</b> 个异常点 · 🧠 阶段 2 深度归因（范围：' + esc(focus) + '）</div>';
        const dbg = s2Logs.length
          ? '<div style="font-size:11px;color:#999;padding:4px 0;border-bottom:1px dashed #eee;margin-bottom:6px">' + s2Logs.slice(-3).map(esc).join('<br>') + '</div>'
          : '';
        outEl.innerHTML = header + dbg + renderAiMarkdown(stage2Buf) + (_aiStreaming ? '<span class="ai-cursor"></span>' : '');
        outEl.scrollTop = outEl.scrollHeight;
      };
      await callZhipuAI(
        apiKey, model, stage2Messages,
        (chunk, type) => {
          if (type === 'reasoning') stage2Reason += chunk;
          else stage2Buf += chunk;
          render2();
        },
        controller.signal,
        (msg) => { s2Logs.push('[调试] ' + msg); render2(); }
      );
      _aiStreaming = false;
      if (!stage2Buf.trim() && stage2Reason.trim()) stage2Buf = stage2Reason;
      render2();
    }
  } catch (err) {
    _aiStreaming = false;
    if (err && err.name === 'AbortError') {
      toast('已停止生成');
    } else {
      const msg = String((err && err.message) || err);
      let tip = '';
      if (/Failed to fetch|NetworkError|Network request failed|Load failed/i.test(msg)) {
        tip = '<br><br>可能原因：<br>① <b>浏览器 CORS 拦截</b>——请用本地小服务器打开；<br>② 网络不通——确认能访问 open.bigmodel.cn；<br>③ 如仍不通，需要后端代理。';
      } else if (/401|403/.test(msg)) {
        tip = '<br><br>API Key 无效、过期或权限不足。';
      } else if (/429/.test(msg)) {
        tip = '<br><br>请求过于频繁或超出配额。';
      }
      outEl.innerHTML = '<div class="ai-err">❌ 调用失败：' + esc(msg) + tip + '</div>';
    }
  } finally {
    if (btnRun) { btnRun.disabled = false; btnRun.textContent = '生成分析'; }
    if (btnStop) btnStop.classList.add('hidden');
    _aiAbort = null;
  }
}

function stopAiAnalysis() {
  if (_aiAbort) { try { _aiAbort.abort(); } catch (_) {} }
}

/* ==================== AI 设置面板（含保存 / 测试 / 清空） ==================== */
function initAiPanel() {
  const keyEl    = $('#aiKey');
  const modelEl  = $('#aiModel');
  const statusEl = $('#aiStatus');
  const cfg = loadAiConfig();
  if (keyEl && cfg.key) keyEl.value = cfg.key;
  if (modelEl && cfg.model) modelEl.value = cfg.model;

  const btnRun   = $('#btnAiRun');
  const btnStop  = $('#btnAiStop');
  const btnSave  = $('#btnAiSave');
  const btnTest  = $('#btnAiTest');
  const btnClear = $('#btnAiClear');

  const showStatus = (txt, cls) => {
    if (!statusEl) return;
    statusEl.className = 'ai-status show ' + (cls || 'info');
    statusEl.innerHTML = txt;
  };

  if (btnRun)  btnRun.addEventListener('click', runAiAnalysis);
  if (btnStop) btnStop.addEventListener('click', stopAiAnalysis);

  if (btnSave) btnSave.addEventListener('click', () => {
    saveAiConfig((keyEl && keyEl.value.trim()) || '', (modelEl && modelEl.value) || null);
    showStatus('✅ 配置已保存到本地浏览器', 'ok');
  });

  if (btnTest) btnTest.addEventListener('click', async () => {
    const key = ((keyEl && keyEl.value) || '').trim();
    const model = (modelEl && modelEl.value) || 'glm-5.3-flash';
    if (!key) { showStatus('❌ 请先填写 API Key', 'err'); return; }
    showStatus('⏳ 正在测试连接…', 'info');
    try {
      let got = '';
      await callZhipuAI(key, model, [
        { role: 'user', content: '请只回复：连接成功' }
      ], (chunk) => { got += chunk; }, null);
      showStatus('✅ 连接成功（' + esc(model) + '）<br>返回：' + esc((got || '').slice(0, 60)), 'ok');
    } catch (e) {
      showStatus('❌ 连接失败：' + esc(e.message), 'err');
    }
  });

  if (btnClear) btnClear.addEventListener('click', () => {
    if (!confirm('确定清空本地保存的 API Key / 模型配置吗？')) return;
    localStorage.removeItem(AI_KEY_STORE);
    localStorage.removeItem(AI_MODEL_STORE);
    if (keyEl) keyEl.value = '';
    if (modelEl) modelEl.value = 'glm-5.3-flash';
    showStatus('已清空配置', 'info');
  });

  if (keyEl)   keyEl.addEventListener('change',   () => saveAiConfig(keyEl.value.trim(), null));
  if (modelEl) modelEl.addEventListener('change', () => saveAiConfig(null, modelEl.value));
}

/* ==================== 全局初始化引导 ==================== */
function initSelects() {
  for (const s of ['#ovBiz','#peBiz','#tmBiz','#s30Biz','#a2Biz','#slaBiz','#exBiz','#rpBiz','#fcBiz']) {
    const el = $(s);
    if (!el) continue;
    const cur = el.value;
    el.innerHTML = BIZ_LIST.map(b => '<option>' + b + '</option>').join('');
    if (BIZ_LIST.includes(cur)) el.value = cur;
  }
  const rpWK = $('#rpWK');
  if (rpWK) {
    const cur = rpWK.value;
    const wks = allWeeks();
    rpWK.innerHTML = wks.map(w => '<option value="' + w + '">WK' + w + '（' + wkStartDate(w) + ' ~ ' + wkEndDate(w) + '）</option>').join('') || '<option value="">暂无周次</option>';
    if (cur && wks.some(w => String(w) === cur)) rpWK.value = cur;
    else if (wks.length) rpWK.value = String(wks[wks.length - 1]);
  }
  const att = $('#attName');
  if (att) {
    const cur = att.value;
    const emps = S.roster.filter(e => /一线/.test(e.attr || ''));
    if (emps.length) att.innerHTML = emps.map(e => '<option value="' + esc(e.name) + '">' + esc(e.name) + '</option>').join('');
    else att.innerHTML = '<option value="">暂无一线员工</option>';
    if (cur && emps.some(e => e.name === cur)) att.value = cur;
  }
  refreshPersonOptions();
  refreshTeamOptions();
  refreshExportOptions();
  renderTargetConfig();

  const fcStart = $('#fcStartDate');
  if (fcStart && !fcStart.value) {
    if (S.latestDate) {
      fcStart.value = dateAdd(S.latestDate, 1);
    } else {
      const d = new Date();
      fcStart.value = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
  }
  if (typeof renderForecastConfig === 'function') renderForecastConfig();
}

function bindEvents() {
  const on = (sel, evt, fn) => { const el = $(sel); if (el) el.addEventListener(evt, fn); };
  on('#tabs', 'click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    switchView(b.dataset.view);
    if (b.dataset.view === 'report') renderTargetConfig();
    if (b.dataset.view === 'sla') renderSLA();
    if (b.dataset.view === 'forecast') { renderForecastConfig(); renderForecastResult(); }
  });
  const dz = $('#dropZone'), fi = $('#fileInput');
  if (dz && fi) {
    dz.addEventListener('click', () => fi.click());
    fi.addEventListener('change', () => { if (fi.files && fi.files[0]) handleFile(fi.files[0]); fi.value = ''; });
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  } else console.error('[bindEvents] 未找到 #dropZone 或 #fileInput');
  on('#hideLeft', 'change', e => { S.hidden = e.target.checked; renderRoster(); refreshAll(); });
  on('#btnReset', 'click', () => {
    if (!confirm('确定要清除已导入数据吗？（花名册离职记忆、出勤调整记录会保留）')) return;
    S.sheets = {}; S.headers = {}; S.mapping = {};
    S.roster = []; S.records = []; S.wtRecords = []; S.inspections = [];
    S.slaBuyer = []; S.slaBlogger = [];
    S.businessMap = {}; S.business2Map = {}; S.shiftMap = {}; S.schedule = {};
    S.forecastBuyer = {}; S.forecastBlogger = {};
    S.volumeForecast = {};
    S.scheduleDates = []; S.month = ''; S.latestDate = ''; S.latestWK = 0;
    S.expandedRows = new Set();
    const ds = $('#dataStatus'); if (ds) { ds.textContent = '未导入'; ds.classList.remove('pill-on'); ds.classList.add('pill-off'); }
    const pw = $('#progressWrap'); if (pw) pw.classList.add('hidden');
    const is = $('#importSummary'); if (is) is.innerHTML = '';
    const mb = $('#mappingBody'); if (mb) mb.innerHTML = '';
    const rt = $('#rosterTable'); if (rt) rt.innerHTML = '';
    const ov = $('#ovBody'); if (ov) ov.innerHTML = '';
    const pb = $('#peBody'); if (pb) pb.innerHTML = '';
    const pn = $('#peNames'); if (pn) pn.innerHTML = '';
    const tb = $('#tmBody'); if (tb) tb.innerHTML = '';
    const td = $('#tmDims'); if (td) td.innerHTML = '';
    const s3 = $('#s30Top'); if (s3) s3.innerHTML = '';
    const s3d = $('#s30Dates'); if (s3d) s3d.innerHTML = '';
    const s3b = $('#s30Body'); if (s3b) s3b.innerHTML = '';
    const a2 = $('#a2Body'); if (a2) a2.innerHTML = '';
    const sl = $('#slaBody'); if (sl) sl.innerHTML = '';
    const at = $('#attBody'); if (at) at.innerHTML = '';
    const fc = $('#fcResult'); if (fc) fc.innerHTML = '';
    const fn = $('#fcNotes'); if (fn) fn.innerHTML = '';
    const fa = $('#fcAiOut'); if (fa) { fa.style.display = 'none'; fa.innerHTML = ''; }
    const ftip = $('#fcAutoTip'); if (ftip) { ftip.style.display = 'none'; ftip.innerHTML = ''; }
    const ex = $('#exPreview'); if (ex) ex.innerHTML = '<div class="muted">选择条件后点击「生成预览」。</div>';
    const be = $('#btnExport'); if (be) be.disabled = true;
    const rb = $('#rpBody'); if (rb) rb.innerHTML = '';
    const rc = $('#btnRpCopy'); if (rc) rc.disabled = true;
    const rm = $('#btnRpMd'); if (rm) rm.disabled = true;
    const ao = $('#aiOut'); if (ao) ao.innerHTML = '<div class="muted">填写 API Key 后，点击「生成分析」。</div>';
  });
  on('#rosterSearch', 'input', renderRoster);
  on('#ovBiz', 'change', renderOverview);
  on('#peBiz', 'change', () => {
    S.personSel.clear();
    S.expandedRows = new Set();
    const all = $('#peAll');
    if (all) all.checked = false;
    refreshPersonOptions();
    renderPerson();
  });
  on('#peAll', 'change', e => {
    const bizEl = $('#peBiz');
    const biz = (bizEl && bizEl.value) || '买手合作';
    const src = bizToSrc(biz);
    if (e.target.checked) {
      S.personSel.clear();
      const srcEmps = srcEmployeeSet(src);
      let emps = S.roster.filter(x => employeeVisible(x) && srcEmps.has(x.name) && /一线/.test(x.attr||''));
      if (!emps.length) emps = S.roster.filter(x => employeeVisible(x) && srcEmps.has(x.name));
      emps.forEach(x => S.personSel.add(x.name));
    } else S.personSel.clear();
    renderPerson();
  });
  on('#peToggle', 'click', () => { const el = $('#peNames'); if (el) el.classList.toggle('collapsed'); });
  on('#tmBiz', 'change', () => {
    S.teamSel = { group:new Set(), batch:new Set(), category:new Set() };
    S.expandedRows = new Set();
    refreshTeamOptions();
    renderTeam();
  });
  on('#a2Biz', 'change', renderAHT2);
  on('#slaBiz', 'change', renderSLA);
  on('#exBiz', 'change', refreshExportOptions);
  on('#s30Biz', 'change', renderS30);
  on('#attName', 'change', renderAttendance);
  on('#btnPreview', 'click', previewExport);
  on('#btnExport', 'click', downloadExport);
  on('#rpBiz', 'change', () => { renderTargetConfig(); renderReport(); });
  on('#rpWK', 'change', renderReport);
  on('#btnRpCopy', 'click', copyReport);
  on('#btnRpMd', 'click', downloadReportMd);

  on('#fcBiz', 'change', () => { renderForecastConfig(); renderForecastResult(); });
  on('#fcStartDate', 'change', () => { renderForecastConfig(); renderForecastResult(); });
  on('#fcDays', 'change', () => { renderForecastConfig(); renderForecastResult(); });
  on('#fcSampleWeeks', 'change', renderForecastResult);
  on('#btnFcRun', 'click', renderForecastResult);
  on('#btnFcAi', 'click', runForecastAiAnalysis);
  on('#btnFcCopy', 'click', copyForecastMd);
  on('#btnFcClear', 'click', clearForecastInputs);
}

function init() {
  ['peMetric', 'tmMetric', 'exMetric', 'exGroup', 'exBatch', 'exCategory'].forEach(ensureChipContainer);
  bindEvents();
  initAiPanel();
  renderTargetConfig();
  switchView('import');
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

/* ==================== 智能排班 · 诉求 AI 解析 ==================== */
const SC_REQ_SYSTEM_PROMPT = [
  '你是排班诉求解析助手。请把员工自然语言诉求转成结构化 JSON 数组。',
  '输出格式（严格 JSON，不要 Markdown 包裹）：',
  '[{',
  '  "name": "员工姓名",',
  '  "items": [',
  '    { "type": "same_as", "target_person": "张三", "raw": "跟张三一样", "confidence": 0.95 },',
  '    { "type": "only",    "target_shift": "E1", "raw": "只上E1", "confidence": 0.9 },',
  '    { "type": "not",     "target_shifts": ["R","D","E1","E2","R（短）","D（短）","E（短）"], "raw": "不上晚班", "confidence": 0.9 },',
  '    { "type": "prefer",  "target_shifts": ["B1","B2","K1","K2"], "raw": "希望上早班", "confidence": 0.8 }',
  '  ]',
  '}]',
  '规则：',
  '- "跟/和 XXX 一样" → type: same_as, target_person: XXX',
  '- "只上 X" → type: only, target_shift: X',
  '- "不上 X / 不上晚班 / 不上早班" → type: not',
  '- "希望 / 想 / 尽量上 X" → type: prefer',
  '- 晚班 = [R, D, E1, E2, R（短）, D（短）, E（短）]',
  '- 早班 = [B1, B2, K1, K2, B（短）, K（短）]',
  '- 中班 = [S, C, C（短）]',
  '仅输出 JSON。'
].join('\n');

/* 宽松 JSON 解析：剥掉 Markdown 代码围栏后尝试解析，失败再截取首个 [...] 片段 */
function scParseJsonLoose(s) {
  if (!s) return null;
  let t = String(s).trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch (_) {}
  const m = /\[[\s\S]*\]/.exec(t);
  if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  return null;
}

/* 把员工自然语言诉求按 10 人/批交给 AI 解析（复用智谱 SSE 通道），
   结果合并到 S.parsedRequests；单批失败仅标记 error，不阻断流程 */
async function parseScheduleRequests() {
  const emps = [];
  const seen = new Set();
  for (const d of S.scheduleDraft) {
    if (!d.requestText || seen.has(d.name)) continue;
    seen.add(d.name);
    emps.push({ name: d.name, raw: d.requestText });
  }
  if (!emps.length) { toast('未检测到员工诉求'); return; }
  const status = document.getElementById('scReqStatus');
  const setSt = t => { if (status) status.textContent = t; };
  S.parsedRequests = S.parsedRequests || {};
  const cfg = loadAiConfig();
  if (!cfg.key) {
    for (const e of emps) if (!S.parsedRequests[e.name]) S.parsedRequests[e.name] = { items: [], error: '未配置 AI Key' };
    setSt('⚠ 未配置 AI Key（请到「🤖 AI 设置」页填写），暂用原始文本占位');
    return;
  }
  if (typeof _aiStreaming !== 'undefined' && _aiStreaming) { toast('AI 正在执行其他任务，请稍后再试'); return; }
  for (let i = 0; i < emps.length; i += 10) {
    const batch = emps.slice(i, i + 10);
    setSt('解析中… ' + Math.min(i + 10, emps.length) + '/' + emps.length);
    const userMsg = '请解析以下员工排班诉求：\n' + batch.map(e => e.name + '：' + e.raw).join('\n');
    let acc = '';
    try {
      await callZhipuAI(cfg.key, cfg.model, [
        { role: 'system', content: SC_REQ_SYSTEM_PROMPT },
        { role: 'user', content: userMsg }
      ], chunk => { acc += chunk; }, null, null);
      const json = scParseJsonLoose(acc);
      const arr = Array.isArray(json) ? json : ((json && json.employees) || []);
      for (const item of arr) {
        if (!item || !item.name) continue;
        S.parsedRequests[item.name] = { items: Array.isArray(item.items) ? item.items : [], error: null };
      }
      for (const e of batch) if (!S.parsedRequests[e.name]) S.parsedRequests[e.name] = { items: [], error: '未识别' };
    } catch (e) {
      console.warn('[parseScheduleRequests]', e);
      for (const emp of batch) S.parsedRequests[emp.name] = { items: [], error: '解析失败：' + e.message };
    }
  }
  setSt('✓ 已解析 ' + emps.length + ' 人');
}

/* ============================================================
   END OF dashboard-ai.js
   ============================================================ */