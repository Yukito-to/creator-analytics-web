/* ============================================================
   创作者数据分析 · 核心层
   （常量 / 状态 / 工具 / 文件解析 / 数据聚合 / 目标读取 / 时段预测算法 / 节假日API / 线性回归）
   ============================================================ */
'use strict';

/* ==================== 基础工具 ==================== */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const pad2 = n => String(n).padStart(2, '0');
const esc  = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ==================== 常量 ==================== */
const WK_BASE_UTC = Date.UTC(2026, 8, 1);
const WK_BASE_NUM = 36;
const WK_BASE_DATE = '2026-09-01';
const BIZ_LIST = ['买手合作', '博主合作'];
const CAT_ORDER = { '老人': 1, '次月': 2, '首月': 3 };
const S30_THRESHOLD = { '买手合作': 0.97, '博主合作': 0.95 };
const WEEKDAY_CN = ['日','一','二','三','四','五','六'];

const METRICS = [
  { key:'caseVolume', label:'CASE处理量', icon:'📊', digits:0, pct:false, better:'up' },
  { key:'cpd', label:'CPD', icon:'📈', digits:2, pct:false, better:'up' },
  { key:'aht', label:'AHT', icon:'⏱️', digits:2, pct:false, better:'down' },
  { key:'concurrency', label:'并发', icon:'🔀', digits:2, pct:false, better:'up' },
  { key:'utilization', label:'工时利用率', icon:'⚙️', digits:2, pct:true, better:'up' },
  { key:'solveRate', label:'解决率', icon:'✅', digits:2, pct:true, better:'up' },
  { key:'satisfaction', label:'满意度', icon:'⭐', digits:2, pct:true, better:'up' },
  { key:'escalateRate', label:'升级率', icon:'⚠️', digits:2, pct:true, better:'down' },
  { key:'fcr', label:'FCR', icon:'🔁', digits:2, pct:true, better:'down' },
  { key:'qualityPassRate', label:'质检合格率', icon:'🎯', digits:2, pct:true, better:'up' },
  { key:'s30Rate', label:'30S接起率', icon:'📞', digits:2, pct:true, better:'up' },
];
const METRIC_MAP = Object.fromEntries(METRICS.map(m => [m.key, m]));
const metricLabel = m => (m.icon ? m.icon + ' ' : '') + m.label;
const METRIC_BG = { caseVolume:'#E8EDF3', cpd:'#F3EFE2', aht:'#E4EFE6', concurrency:'#F5E6EC', utilization:'#E4EAF5', solveRate:'#F5F0DF', satisfaction:'#ECE6F5', escalateRate:'#E0EFEC', fcr:'#F5E4E2', qualityPassRate:'#F0E6F0', s30Rate:'#E0EFEC' };

const MAP_DEF = {
  buyer: { name:'主责客服姓名', date:'CASE创建日期', period:'CASE创建时段', l1:'一级打点', l2:'二级打点', volume:'人工服务量', s30Num:'30S接起率-分子', s30Den:'30S接起率-分母', aht:'CASE处理时长（分钟）', solved:'已解决量', solveEval:'解决评价量', satisfy:'满意量', satisfyEval:'满意评价量', escalate:'升级二线工单数', repeat72:'全渠道72H重复进线量（T-3）', fcrDen:'全渠道72HFCR分母（T-3）' },
  blogger: { name:'主责客服姓名', date:'CASE创建日期', period:'CASE创建时段', l1:'一级打点', l2:'二级打点', volume:'人工服务量', s30Num:'30S接起量', s30Den:'人工服务量', aht:'CASE处理时长（分钟）', solved:'已解决量', solveEval:'解决评价量', satisfy:'满意量', satisfyEval:'满意评价量', escalate:'升级二线工单数', repeat72:'全渠道72H重复进线量（T-3）', fcrDen:'全渠道72HFCR分母（T-3）' },
  inspectionBuyer: { date:'质检日期', id:'质检对象id', name:'责任客服姓名', l1:'一级打点', pass:'是否合格' },
  inspectionBlogger: { date:'质检日期', id:'质检对象id', name:'责任客服姓名', l1:'一级打点', pass:'是否合格' },
  worktime: { name:'客服姓名', date:'日期', online:'在线（H）', after:'后处理（H）', official:'公务（H）', train:'培训（H）', mentor:'带教（H）', rest:'小休（H）,包含busy', meal:'就餐（H）', total:'总登录时长（不含就餐）-H' },
  business:  { l1:'一级打点', biz:'业务线' },
  business2: { l1:'一级打点', l2:'二级打点', biz:'业务线' },
  buyerSla:   {},
  bloggerSla: {},
};
const FIELD_LABEL = { name:'姓名', date:'日期', period:'时段', l1:'一级打点', l2:'二级打点', volume:'CASE处理量（人工服务量）', s30Num:'30S接起率-分子', s30Den:'30S接起率-分母', aht:'CASE处理时长（分钟）', solved:'已解决量', solveEval:'解决评价量', satisfy:'满意量', satisfyEval:'满意评价量', escalate:'升级二线工单数', repeat72:'全渠道72H重复进线量（T-3）', fcrDen:'全渠道72HFCR分母（T-3）', online:'在线时长', after:'后处理时长', official:'公务时长', train:'培训时长', mentor:'带教时长', rest:'小休时长（含busy）', meal:'就餐时长', total:'总登录时长（不含就餐）', biz:'业务线', id:'质检对象id', pass:'是否合格' };
const MAP_TITLE = { buyer:'买手员工数据', blogger:'博主员工数据', inspectionBuyer:'买手员工质检', inspectionBlogger:'博主员工质检', worktime:'工时', business:'业务线映射', business2:'二级打点映射', buyerSla:'买手员工SLA', bloggerSla:'博主员工SLA' };
const DATE_BG = ['#E8EDF3','#F3EFE2','#E4EFE6','#F5E6EC','#E4EAF5','#F5F0DF','#ECE6F5','#E0EFEC','#F5E4E2','#F0E6F0'];

/* ==================== 时段预测专用常量 ==================== */
const PREDICT_PERIOD_MIN = 9;
const PREDICT_PERIOD_MAX = 23;
const PREDICT_PERIODS = (function() {
  const arr = [];
  for (let h = PREDICT_PERIOD_MIN; h <= PREDICT_PERIOD_MAX; h++) arr.push(String(h));
  return arr;
})();
function isPredictPeriod(p) {
  const n = parseInt(p, 10);
  return isFinite(n) && n >= PREDICT_PERIOD_MIN && n <= PREDICT_PERIOD_MAX;
}
function periodSortKey(p) {
  const n = parseInt(p, 10);
  if (isFinite(n)) return n;
  return 9999;
}

/* ============================================================
   线性回归工具（时段预测用）
   ============================================================ */
function _dateDiffDays(dateA, dateB) {
  if (!dateA || !dateB) return 0;
  const tA = Date.parse(dateA + 'T00:00:00Z');
  const tB = Date.parse(dateB + 'T00:00:00Z');
  if (isNaN(tA) || isNaN(tB)) return 0;
  return Math.round((tB - tA) / 86400000);
}
/* 一元线性回归 y = slope * x + intercept */
function _linearReg(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: n > 0 ? points[0].y : 0, r2: 0, n };
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (const p of points) { sx += p.x; sy += p.y; sxy += p.x * p.y; sx2 += p.x * p.x; }
  const denom = n * sx2 - sx * sx;
  if (Math.abs(denom) < 1e-12) return { slope: 0, intercept: sy / n, r2: 0, n };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const meanY = sy / n;
  let ssTot = 0, ssRes = 0;
  for (const p of points) {
    const pred = slope * p.x + intercept;
    ssTot += (p.y - meanY) * (p.y - meanY);
    ssRes += (p.y - pred) * (p.y - pred);
  }
  const r2 = ssTot > 1e-12 ? 1 - ssRes / ssTot : 0;
  return { slope, intercept, r2, n };
}
/**
 * 用回归预测某天的时段占比并归一化
 * - 样本 n >= 3 且参数有效 → 按 R² 混合回归与中位数（R²>=0.5 完全用回归，否则各 50%）
 * - 否则直接用中位数
 */
function _predictShare(regrObj, baseDate, targetDate, fallbackShare) {
  const out = {};
  const x = _dateDiffDays(baseDate, targetDate);
  let sum = 0;
  const periods = Object.keys(fallbackShare);
  for (const p of periods) {
    const median = fallbackShare[p] || 0;
    const r = regrObj ? regrObj[p] : null;
    let val;
    if (r && r.n >= 3 && isFinite(r.slope) && isFinite(r.intercept)) {
      const pred = r.slope * x + r.intercept;
      const blend = (r.r2 >= 0.5) ? 1.0 : 0.5;
      val = Math.max(0, blend * pred + (1 - blend) * median);
    } else {
      val = median;
    }
    out[p] = val;
    sum += val;
  }
  if (sum > 0) for (const p of periods) out[p] = out[p] / sum;
  else         for (const p of periods) out[p] = fallbackShare[p] || 0;
  return out;
}

/* 统计工具：均值 / 中位数 / 分位数（用于总量锚点与区间约束） */
function _statOf(arr) {
  if (!arr || !arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((x, y) => x + y, 0) / n;
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  const q = p => s[Math.min(n - 1, Math.max(0, Math.round((n - 1) * p)))];
  return { mean, median, min: s[0], max: s[n - 1], p10: q(0.1), p90: q(0.9), n };
}

/**
 * 日总量预测（排班安全版）
 *
 * 设计原则：宁可高估不可低估 —— 排班少人会导致接起率暴跌，多人只是成本略增。
 *
 * 决策链：
 *  ① 博主特殊日（25/28）→ 特殊日历史中位数 × 1.10
 *  ② 锚点 = max(同星期几加权均值, 同星期几 P60 分位数)
 *     - 同星期几样本 ≥ 2 → 用同星期几
 *     - 否则 → 同类型（工作日/周末）
 *     - 再否则 → 全样本
 *  ③ 趋势修正：7 天 + 14 天双窗口，上限 ±35%；
 *     负趋势只吃 50%（防误判下滑导致排班不足）；
 *     外推越远修正越弱（horizon=0 → 100%，horizon=14 → 0%）
 *  ④ 回归叠加：R² ≥ 0.5 才给权重（0.5/0.4/0.3/0.15/0），
 *     结果硬约束到锚点 0.7~1.3 倍
 *  ⑤ 排班 buffer：最终值 × 1.10
 *  ⑥ 硬 clamp：同类型历史 [P10×0.85, max×1.30]
 */
function _predictDailyTotal(stats, date, useWeekend, specialKind, biz) {
  if (!stats || !stats.dailyStats || !stats.dailyStats.length) return null;

  const outlierDates = new Set(
    (stats.diagnostic && stats.diagnostic.outlierDates) || []
  );

  /* ① 博主特殊日 */
  if (specialKind != null && stats.specialTotals) {
    const st = stats.specialTotals[String(specialKind)];
    if (st && st.n >= 1) {
      return { value: Math.round(st.median * 1.10), source: 'special' };
    }
  }

  const latest = stats.sampleRange.end;
  const horizon = Math.max(0, _dateDiffDays(latest, date));

  /* ② 锚点 */
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  const dowRows = stats.dailyStats
    .filter(d => !outlierDates.has(d.date))
    .filter(d => new Date(d.date + 'T00:00:00Z').getUTCDay() === dow)
    .sort((a, b) => b.date.localeCompare(a.date));

  const typeRows = stats.dailyStats
    .filter(d => !outlierDates.has(d.date))
    .filter(d => d.isWeekend === useWeekend)
    .sort((a, b) => b.date.localeCompare(a.date));

  const allRows = stats.dailyStats
    .filter(d => !outlierDates.has(d.date))
    .sort((a, b) => b.date.localeCompare(a.date));

  const quantile = (rows, q) => {
    if (!rows.length) return 0;
    const vals = rows.map(d => d.total).sort((a, b) => a - b);
    const n = vals.length;
    const pos = (n - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return vals[lo];
    return vals[lo] + (vals[hi] - vals[lo]) * (pos - lo);
  };

  const WEIGHTS = [5, 3, 2, 1.5, 1, 1, 1, 1, 1, 1];
  const wAvg = (rows, cap) => {
    if (!rows.length) return 0;
    const limit = Math.min(rows.length, cap || 10);
    let wSum = 0, vSum = 0;
    for (let i = 0; i < limit; i++) {
      const w = WEIGHTS[i] || 1;
      wSum += w;
      vSum += rows[i].total * w;
    }
    return wSum > 0 ? vSum / wSum : 0;
  };

  let anchor = 0;
  if (dowRows.length >= 2) {
    anchor = Math.max(wAvg(dowRows, 6), quantile(dowRows, 0.60));
  } else if (typeRows.length >= 3) {
    anchor = Math.max(wAvg(typeRows, 10), quantile(typeRows, 0.60));
  } else if (allRows.length >= 1) {
    anchor = Math.max(wAvg(allRows, 10), quantile(allRows, 0.60));
  }
  if (!(anchor > 0)) return null;

  /* ③ 趋势 */
  const c1 = dateAdd(latest, -6);
  const c2 = dateAdd(latest, -13);
  const c3 = dateAdd(latest, -27);

  const recent7  = stats.dailyStats.filter(d => d.date >= c1 && !outlierDates.has(d.date)).map(d => d.total);
  const prev7    = stats.dailyStats.filter(d => d.date >= c2 && d.date < c1 && !outlierDates.has(d.date)).map(d => d.total);
  const recent14 = stats.dailyStats.filter(d => d.date >= c2 && !outlierDates.has(d.date)).map(d => d.total);
  const prev14   = stats.dailyStats.filter(d => d.date >= c3 && d.date < c2 && !outlierDates.has(d.date)).map(d => d.total);

  const clampTrend = t => {
    if (t >  0.35) return  0.35;
    if (t < -0.35) return -0.35;
    return t;
  };

  let trend = 0, trendParts = 0;
  if (recent7.length >= 3 && prev7.length >= 3) {
    const p7 = _avg(prev7);
    if (p7 > 0) { trend += clampTrend((_avg(recent7) - p7) / p7) * 0.6; trendParts += 0.6; }
  }
  if (recent14.length >= 5 && prev14.length >= 5) {
    const p14 = _avg(prev14);
    if (p14 > 0) { trend += clampTrend((_avg(recent14) - p14) / p14) * 0.4; trendParts += 0.4; }
  }
  if (trendParts > 0) trend = trend / trendParts;
  else trend = 0;

  /* 负趋势只吃 50%，防排班不足 */
  if (trend < 0) trend *= 0.5;

  const trendWeight = horizon <= 7
    ? (1 - horizon * 0.08)
    : Math.max(0, 0.44 * (1 - (horizon - 7) / 14));
  const trendFactor = 1 + trend * trendWeight;

  let pred = anchor * trendFactor;
  let source = 'history';

  /* ④ 回归叠加 */
  if (horizon <= 14) {
    const regrW   = stats.totalRegression && stats.totalRegression.weekend;
    const regrD   = stats.totalRegression && stats.totalRegression.weekday;
    const regrAll = stats.totalRegression && stats.totalRegression.all;
    const primary = useWeekend ? regrW : regrD;
    const useRegr = (primary && primary.n >= 5 && isFinite(primary.slope) && isFinite(primary.intercept))
      ? primary
      : ((regrAll && regrAll.n >= 5 && isFinite(regrAll.slope) && isFinite(regrAll.intercept)) ? regrAll : null);

    if (useRegr) {
      const r2 = Number(useRegr.r2) || 0;
      let wRegr = 0;
      if      (r2 >= 0.70) wRegr = 0.50;
      else if (r2 >= 0.60) wRegr = 0.40;
      else if (r2 >= 0.50) wRegr = 0.30;
      else if (r2 >= 0.40) wRegr = 0.15;
      else                 wRegr = 0.00;

      if (horizon > 7) wRegr *= 0.5;

      if (wRegr > 0) {
        const x = _dateDiffDays(stats.sampleRange.start, date);
        const regrPred = useRegr.slope * x + useRegr.intercept;
        if (isFinite(regrPred) && regrPred > 0) {
          const hardLo = pred * 0.7;
          const hardHi = pred * 1.3;
          let capped = regrPred;
          if (capped < hardLo) capped = hardLo;
          if (capped > hardHi) capped = hardHi;
          pred = (1 - wRegr) * pred + wRegr * capped;
          source = 'regression';
        }
      }
    }
  }

  /* ⑤ 排班安全 buffer */
  pred = pred * 1.10;

  /* ⑥ 硬 clamp */
  const clampSource = (typeRows.length >= 3) ? typeRows : (allRows.length >= 3) ? allRows : null;
  if (clampSource) {
    const vals = clampSource.map(d => d.total).sort((a, b) => a - b);
    const p10 = vals[Math.floor((vals.length - 1) * 0.1)];
    const lo = p10 * 0.85;
    const hi = vals[vals.length - 1] * 1.30;
    if (pred < lo) pred = lo;
    if (pred > hi) pred = hi;
  }

  return { value: Math.round(pred), source };
}

const BUYER_AHT2_ORDER = [['买手带货','业务介绍'],['买手带货','准入门槛'],['买手带货','买手撮合'],['买手带货','商家分销'],['买手带货','买手选品'],['买手带货','笔记带货'],['买手带货','橱窗带货'],['买手带货','蓝链带货'],['买手带货','直播带货'],['买手带货','营销运营'],['买手带货','直播间审核'],['买手带货','笔记审核'],['买手带货','账号违规'],['买手带货','买手拿样'],['买手带货','买手成长'],['买手带货','商家分销结算'],['买手带货','经营数据'],['买手带货','买手活动'],['买手带货','合作纠纷'],['买手带货','买手财务'],['买手合作','其他']];
const BLOGGER_AHT2_ORDER = [['博主合作','蒲公英准入/准出'],['博主合作','蒲公英合作产品'],['博主合作','财务管理'],['博主合作','蒲公英审核'],['博主合作','健康等级'],['博主合作','蒲公英数据'],['博主合作','蒲公英合作纠纷'],['博主合作','蒲公英基础功能'],['蒲公英代理商','代理商入驻/审核'],['蒲公英代理商','蒲公英代理商保证金'],['蒲公英代理商','核实/解绑蒲公英代理商'],['蒲公英代理商','蒲公英代理商登录'],['蒲公英代理商','蒲公英代理商功能操作'],['蒲公英代理商','蒲公英代理商管理规范咨询'],['蒲公英代理商','蒲公英代理商策略'],['MCN机构（新）','MCN商业入驻'],['MCN机构（新）','MCN机构保证金'],['MCN机构（新）','MCN生态'],['博主合作','其他'],['博主合作','博主其他']];

const normAHT2 = s => String(s == null ? '' : s).replace(/\uFF08/g,'(').replace(/\uFF09/g,')').replace(/\uFF0F/g,'/').replace(/\u3000/g,'').replace(/\s+/g,'').toLowerCase();
const aht2Key = (l1, l2) => normAHT2(l1) + '|' + normAHT2(l2);

/* ====================================================================
   中国法定节假日 · 动态加载
   ==================================================================== */
const CN_HOLIDAY_API_BASE = 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master';
const CN_HOLIDAY_CACHE_KEY = 'creator_cn_holiday_cache';
const CN_HOLIDAY_CACHE_DAYS = 7;

let _cnHolidayMap = null;
let _cnHolidayVersion = '内置（未加载 API）';

function loadHolidayCache() {
  try {
    const raw = localStorage.getItem(CN_HOLIDAY_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    if (!cache.timestamp || !cache.data) return null;
    const ageDays = (Date.now() - cache.timestamp) / 86400000;
    if (ageDays > CN_HOLIDAY_CACHE_DAYS) return null;
    return cache;
  } catch (_) { return null; }
}
function buildHolidayMap(days) {
  const map = {};
  for (const d of days) {
    if (!d.date) continue;
    map[d.date] = d.isOffDay ? 'holiday' : 'workday';
  }
  return map;
}
async function loadHolidaysForYear(year) {
  const url = CN_HOLIDAY_API_BASE + '/' + year + '.json';
  try {
    const resp = await fetch(url, { cache: 'no-cache' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    return buildHolidayMap(json.days || []);
  } catch (e) {
    console.warn('[节假日API] ' + year + ' 年数据拉取失败：', e.message);
    return null;
  }
}
async function initHolidayData() {
  const now = new Date();
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const result = {};

  const cache = loadHolidayCache();
  if (cache && cache.data) {
    for (const y of years) if (cache.data[y]) result[y] = cache.data[y];
  }
  const missing = years.filter(y => !result[y]);
  if (missing.length) {
    const fetched = await Promise.all(missing.map(y => loadHolidaysForYear(y)));
    missing.forEach((y, i) => { if (fetched[i]) result[y] = fetched[i]; });
  }
  try {
    localStorage.setItem(CN_HOLIDAY_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: result }));
  } catch (_) {}

  _cnHolidayMap = {};
  for (const y of years) if (result[y]) for (const d in result[y]) _cnHolidayMap[d] = result[y][d];

  const total = Object.keys(_cnHolidayMap).length;
  _cnHolidayVersion = total > 0
    ? 'API（' + years.join('/') + '，共 ' + total + ' 条）'
    : '内置（API 不可用）';

  if (typeof renderForecastResult === 'function') { try { renderForecastResult(); } catch (_) {} }
  if (typeof renderForecastConfig === 'function') { try { renderForecastConfig(); } catch (_) {} }
}

const CN_HOLIDAY_FALLBACK = {
  '2025-01-01': 'holiday', '2025-01-26': 'workday',
  '2025-01-28': 'holiday', '2025-01-29': 'holiday', '2025-01-30': 'holiday',
  '2025-01-31': 'holiday', '2025-02-01': 'holiday', '2025-02-02': 'holiday',
  '2025-02-03': 'holiday', '2025-02-04': 'holiday', '2025-02-08': 'workday',
  '2025-04-04': 'holiday', '2025-04-05': 'holiday', '2025-04-06': 'holiday',
  '2025-04-27': 'workday',
  '2025-05-01': 'holiday', '2025-05-02': 'holiday', '2025-05-03': 'holiday',
  '2025-05-04': 'holiday', '2025-05-05': 'holiday',
  '2025-05-31': 'holiday', '2025-06-01': 'holiday', '2025-06-02': 'holiday',
  '2025-09-28': 'workday',
  '2025-10-01': 'holiday', '2025-10-02': 'holiday', '2025-10-03': 'holiday',
  '2025-10-04': 'holiday', '2025-10-05': 'holiday', '2025-10-06': 'holiday',
  '2025-10-07': 'holiday', '2025-10-08': 'holiday', '2025-10-11': 'workday',
  '2026-01-01': 'holiday', '2026-01-02': 'holiday', '2026-01-03': 'holiday',
  '2026-01-04': 'workday',
  '2026-02-14': 'workday',
  '2026-02-15': 'holiday', '2026-02-16': 'holiday', '2026-02-17': 'holiday',
  '2026-02-18': 'holiday', '2026-02-19': 'holiday', '2026-02-20': 'holiday',
  '2026-02-21': 'holiday', '2026-02-22': 'workday',
  '2026-04-04': 'holiday', '2026-04-05': 'holiday', '2026-04-06': 'holiday',
  '2026-05-01': 'holiday', '2026-05-02': 'holiday', '2026-05-03': 'holiday',
  '2026-05-04': 'holiday', '2026-05-05': 'holiday',
  '2026-06-19': 'holiday', '2026-06-20': 'holiday', '2026-06-21': 'holiday',
  '2026-09-25': 'holiday', '2026-09-26': 'holiday', '2026-09-27': 'holiday',
  '2026-10-01': 'holiday', '2026-10-02': 'holiday', '2026-10-03': 'holiday',
  '2026-10-04': 'holiday', '2026-10-05': 'holiday', '2026-10-06': 'holiday',
  '2026-10-07': 'holiday'
};
function getHolidayMap() {
  if (_cnHolidayMap && Object.keys(_cnHolidayMap).length > 0) return _cnHolidayMap;
  return CN_HOLIDAY_FALLBACK;
}
function classifyDate(date) {
  if (!date) return 'weekday';
  const map = getHolidayMap();
  if (map[date] === 'holiday') return 'holiday';
  if (map[date] === 'workday') return 'workday';
  const wd = new Date(date + 'T00:00:00Z').getUTCDay();
  if (wd === 0 || wd === 6) return 'weekend';
  return 'weekday';
}
function shouldUseWeekendPattern(date) {
  if (S.forecastHolidays && S.forecastHolidays.has(date)) return true;
  if (S.forecastWorkdays && S.forecastWorkdays.has(date)) return false;
  const cls = classifyDate(date);
  return cls === 'holiday' || cls === 'weekend';
}
function dateTypeLabel(date) {
  const auto = classifyDate(date);
  const userHoliday = S.forecastHolidays && S.forecastHolidays.has(date);
  const userWorkday = S.forecastWorkdays && S.forecastWorkdays.has(date);
  if (userHoliday) {
    if (auto === 'weekend') return '周末';
    if (auto === 'holiday') return '节假日';
    return '自定义休';
  }
  if (userWorkday) {
    if (auto === 'workday') return '调休上班';
    if (auto === 'holiday' || auto === 'weekend') return '自定义班';
    return '工作日';
  }
  if (auto === 'holiday') return '节假日';
  if (auto === 'workday') return '调休上班';
  if (auto === 'weekend') return '周末';
  return '工作日';
}

/* ==================== 全局状态 ==================== */
const S = {
  fileName:'', sheets:{}, headers:{}, mapping:{},
  roster:[], records:[], wtRecords:[], inspections:[],
  slaBuyer:[], slaBlogger:[],
  businessMap:{}, business2Map:{},
  shiftMap:{}, schedule:{}, scheduleDates:[],
  month:'', latestDate:'', latestWK:0, hidden:false,
  attOverride:{}, personSel:new Set(),
  teamSel:{ group:new Set(), batch:new Set(), category:new Set() },
  s30Dates:new Set(), s30ShowSummary:false, s30MonthOpen:new Set(),
  s30MonthInitialized:false,
  unknownShifts:new Set(),
  expandedRows:new Set(),
  forecastBuyer:{}, forecastBlogger:{},
  volumeForecast:{},
  forecastInputs:{},
  forecastHolidays:new Set(),
  forecastWorkdays:new Set()
};

/* ==================== 格式化工具 ==================== */
const num = v => { if (v===''||v==null) return 0; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g,'')); return isNaN(n)?0:n; };
const fmtVal = (n,m) => { if (n==null||!isFinite(n)) return '—'; if (m.pct) return (n*100).toFixed(m.digits)+'%'; return n.toFixed(m.digits); };
const fmtInt = v => (v==null||!isFinite(v)) ? '—' : String(Math.round(v));
const pct2 = v => (v==null||!isFinite(v)) ? '—' : (v*100).toFixed(2)+'%';
const num2 = (v,d) => (v==null||!isFinite(v)) ? '—' : v.toFixed(d==null?2:d);
const dArrow = d => (d==null||!isFinite(d)||Math.abs(d)<1e-9) ? '' : (d>0?'↑':'↓');
const dStr = (d,dg) => (d==null||!isFinite(d)) ? '—' : (d>0?'+':'')+d.toFixed(dg==null?2:dg);
const dPct = (d,dg) => (d==null||!isFinite(d)) ? '—' : (d>0?'+':'')+(d*100).toFixed(dg==null?2:dg)+'%';

function isPassValue(v) { const s = String(v == null ? '' : v).trim(); if (!s) return false; if (/不合格|不通过|不达标|未通过|fail/i.test(s)) return false; if (/^(n|no|0|false|否)$/i.test(s)) return false; return true; }
function bizToSrc(biz) { return biz === '博主合作' ? 'blogger' : 'buyer'; }

/* ==================== 日期工具 ==================== */
function parseDate(v) {
  if (v === '' || v == null) return '';
  if (v instanceof Date) return v.getFullYear()+'-'+pad2(v.getMonth()+1)+'-'+pad2(v.getDate());
  if (typeof v === 'number') { const d = new Date(Date.UTC(1899,11,30) + Math.round(v*86400000)); return d.getUTCFullYear()+'-'+pad2(d.getUTCMonth()+1)+'-'+pad2(d.getUTCDate()); }
  const s = String(v).trim();
  let m = /^(\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})/.exec(s);
  if (m) return m[1]+'-'+pad2(m[2])+'-'+pad2(m[3]);
  m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/.exec(s);
  if (m) return m[3]+'-'+pad2(m[1])+'-'+pad2(m[2]);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());
  return '';
}
const monthOf = d => d ? d.slice(0,7) : '';
const wkOf = d => { if (!d) return 0; const t = Date.parse(d + 'T00:00:00Z'); if (isNaN(t)) return 0; return WK_BASE_NUM + Math.floor(Math.floor((t - WK_BASE_UTC) / 86400000) / 7); };
const dateAdd = (d, delta) => {
  const dd = Number(delta);
  if (!isFinite(dd)) return '';
  const t = Date.parse(d + 'T00:00:00Z') + dd * 86400000;
  if (isNaN(t)) return '';
  const x = new Date(t);
  return x.getUTCFullYear()+'-'+pad2(x.getUTCMonth()+1)+'-'+pad2(x.getUTCDate());
};
const wkStartDate = wk => dateAdd(WK_BASE_DATE, (wk - WK_BASE_NUM) * 7);
const wkEndDate   = wk => dateAdd(wkStartDate(wk), 6);
const weekdayOf   = d => d ? WEEKDAY_CN[new Date(d + 'T00:00:00Z').getUTCDay()] : '';

/* ==================== UI 辅助 ==================== */
function getCheckedValues(selector) { const el = $(selector); if (!el) return []; return Array.from(el.querySelectorAll('.chip.on')).map(ch => ch.dataset.val); }
function ensureChipContainer(id) {
  let el = document.getElementById(id);
  if (!el) return null;
  if (el.tagName !== 'DIV') { const div = document.createElement('div'); div.id = id; el.parentNode.replaceChild(div, el); el = div; }
  if (!el.classList.contains('chips')) el.classList.add('chips');
  el.style.margin = '0';
  return el;
}
function setProgress(pct, text) {
  const w = $('#progressWrap'); if (w) w.classList.remove('hidden');
  const f = $('#progressFill'); if (f) f.style.width = Math.max(0, Math.min(100, pct)) + '%';
  const p = $('#progressPct'); if (p) p.textContent = Math.round(pct) + '%';
  if (text) { const t = $('#progressText'); if (t) t.textContent = text; }
}
function toast(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'position:fixed;left:50%;bottom:40px;transform:translateX(-50%);background:#3A3A44;color:#fff;padding:10px 22px;border-radius:10px;font-size:13px;z-index:9999;box-shadow:0 6px 20px rgba(0,0,0,.2);transition:.25s;opacity:0;pointer-events:none';
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.bottom = '60px'; });
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 1800);
}

/* ==================== 工作表识别 ==================== */
function identify(name) {
  const n = String(name);
  if (/^预测量$|预测总量|日度总量表|volumeForecast/i.test(n)) return 'volumeForecast';
  if (/花名册|名单|员工表|人员表|人员信息/.test(n)) return 'roster';
  if (/班次/.test(n)) return 'shift';
  if (/班表|排班/.test(n)) return 'schedule';
  if (/买手.*质检|质检.*买手/.test(n)) return 'inspectionBuyer';
  if (/博主.*质检|质检.*博主/.test(n)) return 'inspectionBlogger';
  if (/二级打点|二级映射/.test(n)) return 'business2';
  if (/买手.*SLA|SLA.*买手/i.test(n)) return 'buyerSla';
  if (/博主.*SLA|SLA.*博主/i.test(n)) return 'bloggerSla';
  if (/买手.*预测|预测.*买手/.test(n)) return 'forecastBuyer';
  if (/博主.*预测|预测.*博主/.test(n)) return 'forecastBlogger';
  if (/买手/.test(n)) return 'buyer';
  if (/博主/.test(n)) return 'blogger';
  if (/工时|在线时长|工时表/.test(n)) return 'worktime';
  if (/业务线/.test(n)) return 'business';
  return null;
}
function detectHeaders(rows) {
  if (!rows || !rows.length) return [];
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const r = rows[i] || [];
    const nonEmpty = r.filter(x => x !== '' && x != null).length;
    if (nonEmpty >= 2) return r.map(x => String(x == null ? '' : x).trim());
  }
  return (rows[0] || []).map(x => String(x == null ? '' : x).trim());
}
function normalize(s) { return String(s||'').replace(/\s+/g,'').replace(/[（]/g,'(').replace(/[）]/g,')').replace(/[，]/g,',').replace(/[－—]/g,'-').toLowerCase(); }
function autoMatch(headers, wanted) {
  let hit = headers.find(h => h === wanted);
  if (hit) return hit;
  const nw = normalize(wanted);
  hit = headers.find(h => normalize(h) === nw);
  if (hit) return hit;
  hit = headers.find(h => { const nh = normalize(h); return nh && (nh.includes(nw) || nw.includes(nh)); });
  return hit || '';
}
function buildAutoMap(headers, def) { const out = {}; for (const k in def) out[k] = autoMatch(headers, def[k]); return out; }

/* ==================== 文件导入 ==================== */
async function handleFile(file) {
  if (typeof XlsxParser === 'undefined') { alert('解析器未加载：请确认 lib/xlsx.js 存在。'); return; }
  S.fileName = file.name;
  const impSum = $('#importSummary'); if (impSum) impSum.innerHTML = '';
  setProgress(1, '准备读取…');
  try {
    const lower = file.name.toLowerCase();
    let sheets;
    if (lower.endsWith('.csv')) {
      setProgress(20, '读取 CSV…');
      const text = await file.text();
      const base = file.name.replace(/\.csv$/i, '');
      sheets = [{ name: base || 'Sheet1', rows: parseCSV(text) }];
    } else {
      const buf = await file.arrayBuffer();
      sheets = await XlsxParser.parseWorkbook(buf, (p, t) => setProgress(p * 0.85, t));
    }
    setProgress(88, '识别工作表类型…'); await sleep(30);
    S.sheets = {}; S.headers = {}; S.mapping = {};
    for (const sh of sheets) {
      const k = identify(sh.name);
      if (!k || S.sheets[k]) continue;
      S.sheets[k] = sh;
      S.headers[k] = detectHeaders(sh.rows);
    }
    for (const mod of ['buyer','blogger','inspectionBuyer','inspectionBlogger','worktime','business','business2']) {
      if (S.headers[mod]) S.mapping[mod] = buildAutoMap(S.headers[mod], MAP_DEF[mod]);
    }
    setProgress(92, '解析花名册…'); await sleep(20);
    parseRoster();
    setProgress(96, '构建数据记录…'); await sleep(20);
    buildAll();
    setProgress(99, '汇总…'); await sleep(20);
    afterLoad();
    setProgress(100, '完成');
    const st = $('#dataStatus');
    if (st) {
      const nm = S.fileName.length > 12 ? S.fileName.slice(0, 12) + '…' : S.fileName;
      st.textContent = '✓ ' + nm;
      st.title = '已导入：' + S.fileName;
      st.classList.remove('pill-off');
      st.classList.add('pill-on');
    }
  } catch (err) {
    console.error(err);
    setProgress(0, '❌ ' + err.message);
    alert('解析失败：' + err.message);
  }
}
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let cur = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else { if (c === '"') inQ = true; else if (c === ',') { cur.push(field); field = ''; } else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; } else if (c !== '\r') field += c; }
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

/* ==================== 各 sheet → 对象数组 ==================== */
function rowsToObjs(kind) {
  const sheet = S.sheets[kind];
  if (!sheet) return [];
  const headers = S.headers[kind] || [];
  const map = S.mapping[kind] || {};
  const idx = {};
  for (const k in map) idx[k] = map[k] ? headers.indexOf(map[k]) : -1;
  const out = [];
  for (let i = 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i];
    if (!r || !r.length) continue;
    const o = {};
    for (const k in idx) o[k] = idx[k] >= 0 && r[idx[k]] !== undefined ? r[idx[k]] : '';
    if (!String(o.name||'').trim() && !String(o.date||'').trim() && !String(o.l1||'').trim() && !String(o.id||'').trim() && !String(o.metric||'').trim()) continue;
    out.push(o);
  }
  return out;
}

/* ==================== 花名册解析 ==================== */
function parseRoster() {
  S.roster = [];
  const sheet = S.sheets.roster;
  if (!sheet) return;
  const headers = S.headers.roster || [];
  const findCol = (keys) => {
    for (const k of keys) { const i = headers.findIndex(h => h === k); if (i >= 0) return i; }
    for (const k of keys) { const nk = normalize(k); const i = headers.findIndex(h => normalize(h).includes(nk)); if (i >= 0) return i; }
    return -1;
  };
  const cName   = findCol(['姓名','员工姓名','客服姓名','主责客服姓名']);
  const cGroup  = findCol(['组别','小组','团队']);
  const cBatch  = findCol(['批次']);
  const cOnline = findCol(['上线日期','上线时间','入职日期']);
  const cBiz    = findCol(['业务线']);
  const cAttr   = findCol(['属性','员工属性']);
  const cResign = findCol(['离职日期','离职时间','离职日','离职']);
  const catCols = [];
  headers.forEach((h, i) => { if (/分类/.test(h)) { const mm = /(\d{1,2})\s*月/.exec(h); catCols.push({ idx:i, month: mm ? parseInt(mm[1],10) : null }); } });

  for (let i = 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i] || [];
    const name = cName >= 0 ? String(r[cName] || '').trim() : '';
    if (!name) continue;
    const emp = {
      name,
      group:      cGroup  >= 0 ? String(r[cGroup]  || '').trim() : '',
      batch:      cBatch  >= 0 ? String(r[cBatch]  || '').trim() : '',
      onlineDate: cOnline >= 0 ? parseDate(r[cOnline]) : '',
      biz:        cBiz    >= 0 ? String(r[cBiz]    || '').trim() : '',
      attr:       cAttr   >= 0 ? String(r[cAttr]   || '').trim() : '',
      categories: {},
      resignDate: cResign >= 0 ? parseDate(r[cResign]) : ''
    };
    for (const cc of catCols) {
      const v = String(r[cc.idx] || '').trim();
      if (cc.month != null) emp.categories[cc.month] = v;
      else if (emp.categories['*'] == null) emp.categories['*'] = v;
    }
    S.roster.push(emp);
  }
  try {
    const memo = JSON.parse(localStorage.getItem('creator_roster_memo') || '{}');
    if (memo.resign) for (const e of S.roster) if (memo.resign[e.name]) e.resignDate = memo.resign[e.name];
    if (memo.att) S.attOverride = memo.att;
  } catch (_) {}
}
function persistMemo() { const resign = {}; for (const e of S.roster) if (e.resignDate) resign[e.name] = e.resignDate; localStorage.setItem('creator_roster_memo', JSON.stringify({ resign, att: S.attOverride })); }
function getEmp(name) { return S.roster.find(e => e.name === name); }
function categoryOf(emp, monthStr) { if (!emp) return ''; if (monthStr) { const m = parseInt(monthStr.slice(5,7), 10); if (emp.categories[m] != null && emp.categories[m] !== '') return emp.categories[m]; } return emp.categories['*'] || ''; }
function catSortKey(c) { for (const k in CAT_ORDER) if (String(c).includes(k)) return CAT_ORDER[k]; return 9; }
function empBiz(name) { const e = getEmp(name); if (!e) return ''; const b = String(e.biz || ''); if (BIZ_LIST.includes(b)) return b; if (/买手/.test(b)) return '买手合作'; if (/博主/.test(b)) return '博主合作'; return ''; }
function employeeVisible(e) { if (!e) return false; if (S.hidden && e.resignDate) return false; return true; }
function srcEmployeeSet(src) { const set = new Set(); for (const r of S.records) if (r.src === src) set.add(r.name); for (const r of S.inspections) if (r.src === src) set.add(r.name); return set; }
function bizByL1(l1, defaultBiz) { const b = S.businessMap[l1] || ''; if (BIZ_LIST.includes(b)) return b; return defaultBiz; }
function bizByL1L2(l1, l2, defaultBiz) {
  const key = (l1 || '') + '|' + (l2 || '');
  const b2 = S.business2Map[key] || '';
  if (b2) return { biz: b2, l1: l1, l2: l2 };
  if (defaultBiz === '买手合作') return { biz: '买手合作', l1: '买手合作', l2: '其他' };
  return { biz: '博主合作', l1: '博主合作', l2: '博主其他' };
}
function normPeriod(p) {
  const s = String(p == null ? '' : p).trim();
  if (!s) return '';
  const m = /^(\d{1,2})/.exec(s);
  if (m) return String(parseInt(m[1], 10));
  return s;
}

/* ==================== 30S 预测表解析 ==================== */
function parseForecastSheet(kind) {
  const sheet = S.sheets[kind];
  if (!sheet) return {};
  const rows = sheet.rows || [];
  if (!rows.length) return {};
  let headerRow = -1;
  let dateCols = [];
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    const row = rows[r] || [];
    const dc = [];
    for (let c = 0; c < row.length; c++) {
      const d = parseDate(row[c]);
      if (d) dc.push({ idx: c, date: d });
    }
    if (dc.length >= 2) { headerRow = r; dateCols = dc; break; }
  }
  if (headerRow < 0 || !dateCols.length) return {};
  const firstDateCol = Math.min.apply(null, dateCols.map(d => d.idx));
  const periodCol = firstDateCol > 0 ? firstDateCol - 1 : 0;
  const out = {};
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (!row.length) continue;
    const periodRaw = row[periodCol];
    if (periodRaw == null || periodRaw === '') continue;
    const period = normPeriod(periodRaw);
    if (!period) continue;
    for (const dc of dateCols) {
      const raw = row[dc.idx];
      if (raw === '' || raw == null) continue;
      const parsed = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/,/g, ''));
      if (isNaN(parsed)) continue;
      out[dc.date + '|' + period] = parsed;
    }
  }
  return out;
}

/* ==================== 预测量表解析 ==================== */
function parseVolumeSheet() {
  const sheet = S.sheets.volumeForecast;
  if (!sheet) return null;
  const rows = sheet.rows || [];
  if (!rows.length) return null;
  const refYear  = S.latestDate ? parseInt(S.latestDate.slice(0,4), 10) : new Date().getFullYear();
  const refMonth = S.latestDate ? parseInt(S.latestDate.slice(5,7), 10) : (new Date().getMonth() + 1);
  let headerRow = -1;
  let dateCols = [];
  for (let r = 0; r < Math.min(rows.length, 3); r++) {
    const row = rows[r] || [];
    const dc = [];
    for (let c = 0; c < row.length; c++) {
      const d = parseDateFlexible(row[c], refYear, refMonth);
      if (d) dc.push({ idx: c, date: d });
    }
    if (dc.length >= 2) { headerRow = r; dateCols = dc; break; }
  }
  if (headerRow < 0 || !dateCols.length) return null;
  const out = {};
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const biz = String(row[0] || '').trim();
    if (!BIZ_LIST.includes(biz)) continue;
    out[biz] = {};
    for (const dc of dateCols) {
      const v = num(row[dc.idx]);
      if (v > 0) out[biz][dc.date] = v;
    }
  }
  return out;
}
function parseDateFlexible(v, refYear, refMonth) {
  if (v === '' || v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  let m = /^(\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})/.exec(s);
  if (m) return m[1]+'-'+pad2(m[2])+'-'+pad2(m[3]);
  m = /^(\d{1,2})[\/\-月.](\d{1,2})/.exec(s);
  if (m) {
    const mo = parseInt(m[1], 10);
    const dy = parseInt(m[2], 10);
    if (mo < 1 || mo > 12 || dy < 1 || dy > 31) return '';
    const year = mo > refMonth ? refYear - 1 : refYear;
    return year+'-'+pad2(mo)+'-'+pad2(dy);
  }
  return parseDate(s);
}

/* ==================== SLA 表解析 ==================== */
function normPctVal(v) { const n = num(v); if (!isFinite(n)) return null; return n > 1 ? n / 100 : n; }
function parseSlaSheet(kind) {
  const sheet = S.sheets[kind];
  if (!sheet) return [];
  const headers = S.headers[kind] || [];
  const cMetric   = headers.findIndex(h => /指标/.test(h));
  const cCategory = headers.findIndex(h => /分类/.test(h));
  if (cMetric < 0 || cCategory < 0) return [];
  const monthCols = {};
  headers.forEach((h, i) => {
    const hh = String(h||'').trim();
    let m;
    if ((m = /^(\d{1,2})\s*月\s*权重$/.exec(hh))) { (monthCols[parseInt(m[1], 10)] = monthCols[parseInt(m[1], 10)] || {}).weight = i; }
    else if ((m = /^(\d{1,2})\s*月\s*目标$/.exec(hh))) { (monthCols[parseInt(m[1], 10)] = monthCols[parseInt(m[1], 10)] || {}).target = i; }
    else if ((m = /^(\d{1,2})\s*月\s*得分$/.exec(hh))) { (monthCols[parseInt(m[1], 10)] = monthCols[parseInt(m[1], 10)] || {}).points = i; }
  });
  const groups = new Map();
  for (let r = 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] || [];
    const metric   = String(row[cMetric]   || '').trim();
    const category = String(row[cCategory] || '').trim();
    if (!metric || !category) continue;
    const key = metric + '|' + category;
    if (!groups.has(key)) groups.set(key, { metric, category, months: {} });
    const g = groups.get(key);
    for (const moStr in monthCols) {
      const mo = parseInt(moStr, 10);
      const cols = monthCols[mo];
      if (!g.months[mo]) g.months[mo] = { weight: null, tiers: [] };
      const mObj = g.months[mo];
      if (mObj.weight == null && cols.weight != null) {
        const raw = row[cols.weight];
        if (raw !== '' && raw != null) { const v = normPctVal(raw); if (v != null) mObj.weight = v; }
      }
      const tRaw = cols.target != null ? row[cols.target] : '';
      const pRaw = cols.points != null ? row[cols.points] : '';
      if (tRaw !== '' && tRaw != null && pRaw !== '' && pRaw != null) {
        const pts = num(pRaw);
        if (isFinite(pts)) mObj.tiers.push({ rawThreshold: tRaw, points: pts });
      }
    }
  }
  for (const g of groups.values()) {
    for (const mo in g.months) {
      const mObj = g.months[mo];
      for (const t of mObj.tiers) t.threshold = normPctVal(t.rawThreshold);
      mObj.tiers = mObj.tiers.filter(t => t.threshold != null && isFinite(t.threshold));
      mObj.tiers.sort((a, b) => b.threshold - a.threshold);
    }
  }
  return Array.from(groups.values());
}

/* ==================== 数据构建 ==================== */
function buildAll() {
  S.records = []; S.wtRecords = []; S.inspections = [];
  S.slaBuyer = []; S.slaBlogger = [];
  S.businessMap = {}; S.business2Map = {};
  S.shiftMap = {}; S.schedule = {}; S.scheduleDates = [];
  S.forecastBuyer = {}; S.forecastBlogger = {};
  S.volumeForecast = {};

  if (S.sheets.business) { for (const o of rowsToObjs('business')) { const l1 = String(o.l1||'').trim(); const biz = String(o.biz||'').trim(); if (l1 && biz && !S.businessMap[l1]) S.businessMap[l1] = biz; } }
  if (S.sheets.business2) { for (const o of rowsToObjs('business2')) { const l1 = String(o.l1||'').trim(); const l2 = String(o.l2||'').trim(); const biz = String(o.biz||'').trim(); if (l1 && l2 && biz) { const key = l1 + '|' + l2; if (!S.business2Map[key]) S.business2Map[key] = biz; } } }
  if (S.sheets.shift) { for (const row of S.sheets.shift.rows) { if (!row) continue; const name = String(row[0]||'').trim(); if (!name || name === '班次') continue; S.shiftMap[name] = num(row[1]); } }
  if (S.sheets.schedule) {
    const rows = S.sheets.schedule.rows;
    if (rows.length) {
      const head = rows[0] || [];
      const dates = []; const dateCols = [];
      for (let c = 0; c < head.length; c++) { const d = parseDate(head[c]); if (d) { dates.push(d); dateCols.push(c); } }
      S.scheduleDates = dates;
      let nameCol = -1;
      for (let r = 0; r < Math.min(rows.length, 3) && nameCol < 0; r++) { const rr = rows[r] || []; for (let c = 0; c < rr.length; c++) if (String(rr[c]||'').trim() === '姓名') { nameCol = c; break; } }
      if (nameCol < 0) nameCol = 0;
      let start = 1;
      for (let r = 0; r < Math.min(rows.length, 3); r++) { const rr = rows[r] || []; if (String(rr[nameCol]||'').trim() === '姓名') { start = r + 1; break; } }
      for (let r = start; r < rows.length; r++) {
        const row = rows[r] || [];
        const name = String(row[nameCol]||'').trim();
        if (!name) continue;
        if (!S.schedule[name]) S.schedule[name] = {};
        for (let i = 0; i < dateCols.length; i++) S.schedule[name][dates[i]] = String(row[dateCols[i]]||'').trim();
      }
    }
  }

  for (const mod of ['buyer','blogger']) {
    if (!S.sheets[mod]) continue;
    const defaultBiz = (mod === 'buyer') ? '买手合作' : '博主合作';
    for (const o of rowsToObjs(mod)) {
      const name = String(o.name||'').trim();
      const date = parseDate(o.date);
      if (!name || !date) continue;
      const l1Raw = String(o.l1||'').trim();
      const l2Raw = String(o.l2||'').trim();
      const biz = bizByL1(l1Raw, defaultBiz);
      const m2 = bizByL1L2(l1Raw, l2Raw, defaultBiz);
      S.records.push({
        src: mod, biz, biz2: m2.biz, name, date,
        wk: wkOf(date), month: monthOf(date),
        period: String(o.period||'').trim(),
        l1: m2.l1, l2: m2.l2, l1Raw, l2Raw,
        volume: num(o.volume), s30Num: num(o.s30Num), s30Den: num(o.s30Den),
        aht: num(o.aht), solved: num(o.solved), solveEval: num(o.solveEval),
        satisfy: num(o.satisfy), satisfyEval: num(o.satisfyEval),
        escalate: num(o.escalate), repeat72: num(o.repeat72), fcrDen: num(o.fcrDen)
      });
    }
  }
  for (const mod of ['inspectionBuyer','inspectionBlogger']) {
    if (!S.sheets[mod]) continue;
    const src = (mod === 'inspectionBuyer') ? 'buyer' : 'blogger';
    const defaultBiz = (mod === 'inspectionBuyer') ? '买手合作' : '博主合作';
    for (const o of rowsToObjs(mod)) {
      const name = String(o.name||'').trim();
      const date = parseDate(o.date);
      const id = String(o.id||'').trim();
      if (!date || !id) continue;
      const l1 = String(o.l1||'').trim();
      const biz = bizByL1(l1, defaultBiz);
      S.inspections.push({ src, biz, name, date, id, l1, wk: wkOf(date), month: monthOf(date), pass: isPassValue(o.pass) });
    }
  }
  if (S.sheets.worktime) {
    for (const o of rowsToObjs('worktime')) {
      const name = String(o.name||'').trim();
      const date = parseDate(o.date);
      if (!name || !date) continue;
      S.wtRecords.push({
        name, date, wk: wkOf(date), month: monthOf(date), biz: empBiz(name),
        online: num(o.online), after: num(o.after), official: num(o.official),
        train: num(o.train), mentor: num(o.mentor), rest: num(o.rest),
        meal: num(o.meal), total: num(o.total)
      });
    }
  }
  if (S.sheets.buyerSla) S.slaBuyer = parseSlaSheet('buyerSla');
  if (S.sheets.bloggerSla) S.slaBlogger = parseSlaSheet('bloggerSla');
  S.forecastBuyer   = parseForecastSheet('forecastBuyer');
  S.forecastBlogger = parseForecastSheet('forecastBlogger');

  /* 先算出 latestDate / latestWK / month（供 parseVolumeSheet 使用） */
  const dates = [];
  for (const r of S.records) dates.push(r.date);
  for (const r of S.wtRecords) dates.push(r.date);
  for (const r of S.inspections) dates.push(r.date);
  dates.sort();
  S.latestDate = dates[dates.length-1] || '';
  S.latestWK = wkOf(S.latestDate);
  S.month = monthOf(S.latestDate);

  /* 再解析 volumeForecast（依赖 latestDate 推断年份/月份） */
  try {
    if (S.sheets.volumeForecast) {
      const vf = parseVolumeSheet();
      if (vf) S.volumeForecast = vf;
    }
  } catch (e) { console.warn('[volumeForecast] 解析失败：', e); }

  /* 默认选中最近 3 个「有 30S 数据」的日期 */
  if (S.s30Dates.size === 0 && S.latestDate) {
    const s30Days = new Set();
    for (const r of S.records) {
      if (r.date && (r.s30Num > 0 || r.s30Den > 0)) s30Days.add(r.date);
    }
    const sorted = Array.from(s30Days).sort().reverse().slice(0, 3);
    if (sorted.length) {
      for (const d of sorted) S.s30Dates.add(d);
    } else {
      for (let i = 0; i < 3; i++) { const d = dateAdd(S.latestDate, -i); if (d) S.s30Dates.add(d); }
    }
  }
}

function attOf(name, date) {
  const ov = S.attOverride[name];
  if (ov && ov[date] !== undefined) return ov[date];
  const sched = S.schedule[name];
  if (!sched) return 0;
  const shift = sched[date];
  if (!shift) return 0;
  if (S.shiftMap[shift] == null) {
    if (S.unknownShifts) S.unknownShifts.add(shift);
    return 0;
  }
  return S.shiftMap[shift];
}

/* ==================== 聚合与过滤 ==================== */
function aggregate(recs, wts, attDays, insp) {
  let volume=0, s30Num=0, s30Den=0, aht=0, solved=0, solveEval=0, satisfy=0, satisfyEval=0, escalate=0, repeat72=0, fcrDen=0, online=0, after=0, total=0;
  for (const r of recs) { volume += r.volume; s30Num += r.s30Num; s30Den += r.s30Den; aht += r.aht; solved += r.solved; solveEval += r.solveEval; satisfy += r.satisfy; satisfyEval += r.satisfyEval; escalate += r.escalate; repeat72 += r.repeat72; fcrDen += r.fcrDen; }
  for (const w of wts) { online += w.online; after += w.after; total += w.total; }
  const inspTotal = insp ? insp.total : 0;
  const inspPass = insp ? insp.pass : 0;
  return {
    caseVolume: volume,
    cpd: attDays > 0 ? volume / attDays : null,
    aht: volume > 0 ? aht / volume : null,
    concurrency: online > 0 ? aht / (online * 60) : null,
    utilization: total > 0 ? (online + after) / total : null,
    solveRate: solveEval > 0 ? solved / solveEval : null,
    satisfaction: satisfyEval > 0 ? satisfy / satisfyEval : null,
    escalateRate: volume > 0 ? escalate / volume : null,
    fcr: fcrDen > 0 ? 1 - repeat72 / fcrDen : null,
    qualityPassRate: inspTotal > 0 ? inspPass / inspTotal : null,
    s30Num, s30Den, s30Miss: s30Den - s30Num,
    s30Rate: s30Den > 0 ? s30Num / s30Den : null
  };
}
function filterRecs(o) {
  const { nameSet, dateSet, wkSet, monthSet, bizL1, src } = o || {};
  return S.records.filter(r => {
    if (bizL1 && r.biz !== bizL1) return false;
    if (src && r.src !== src) return false;
    if (nameSet && !nameSet.has(r.name)) return false;
    if (dateSet && !dateSet.has(r.date)) return false;
    if (wkSet && !wkSet.has(r.wk)) return false;
    if (monthSet && !monthSet.has(r.month)) return false;
    return true;
  });
}
function filterWt(o) {
  const { nameSet, dateSet, wkSet, monthSet, bizL1, srcEmps } = o || {};
  return S.wtRecords.filter(r => {
    if (bizL1 && r.biz !== bizL1) return false;
    if (srcEmps && !srcEmps.has(r.name)) return false;
    if (nameSet && !nameSet.has(r.name)) return false;
    if (dateSet && !dateSet.has(r.date)) return false;
    if (wkSet && !wkSet.has(r.wk)) return false;
    if (monthSet && !monthSet.has(r.month)) return false;
    return true;
  });
}
function inspectionStats(o) {
  const { nameSet, dateSet, wkSet, monthSet, bizL1, src } = o || {};
  const seen = new Set();
  let total = 0, passCount = 0;
  for (const r of S.inspections) {
    if (bizL1 && r.biz !== bizL1) continue;
    if (src && r.src !== src) continue;
    if (nameSet && !nameSet.has(r.name)) continue;
    if (dateSet && !dateSet.has(r.date)) continue;
    if (wkSet && !wkSet.has(r.wk)) continue;
    if (monthSet && !monthSet.has(r.month)) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    total += 1;
    if (r.pass) passCount += 1;
  }
  return { total, pass: passCount, fail: total - passCount };
}
function s30AggFor(biz, opts) {
  const timeOpts = {};
  if (opts) {
    if (opts.dateSet)  timeOpts.dateSet  = opts.dateSet;
    if (opts.wkSet)    timeOpts.wkSet    = opts.wkSet;
    if (opts.monthSet) timeOpts.monthSet = opts.monthSet;
    if (opts.nameSet)  timeOpts.nameSet  = opts.nameSet;
    if (opts.srcEmps)  timeOpts.srcEmps  = opts.srcEmps;
  }
  const o = Object.assign({ bizL1: biz }, timeOpts);
  return aggregate(filterRecs(o), filterWt(o), 0, inspectionStats(o));
}
function calcBySrc(src, opts) {
  const srcEmps = srcEmployeeSet(src);
  const o = Object.assign({ src, srcEmps }, opts || {});
  const recs = filterRecs(o);
  const wts = filterWt(o);
  const empSet = new Set(recs.map(r => r.name));
  const dateSet = new Set(recs.map(r => r.date));
  let attDays = 0;
  for (const n of empSet) for (const d of dateSet) attDays += attOf(n, d);
  const insp = inspectionStats(o);
  const agg = aggregate(recs, wts, attDays, insp);
  const biz = (src === 'buyer') ? '买手合作' : '博主合作';
  const s30 = s30AggFor(biz, opts || {});
  agg.s30Num  = s30.s30Num;
  agg.s30Den  = s30.s30Den;
  agg.s30Miss = s30.s30Miss;
  agg.s30Rate = s30.s30Rate;
  return agg;
}
function calcBySrcAndL1(src, bizL1, opts) {
  const srcEmps = srcEmployeeSet(src);
  const o = Object.assign({ src, bizL1, srcEmps }, opts || {});
  const recs = filterRecs(o);
  const wts = filterWt(o);
  const empSet = new Set(recs.map(r => r.name));
  const dateSet = new Set(recs.map(r => r.date));
  let attDays = 0;
  for (const n of empSet) for (const d of dateSet) attDays += attOf(n, d);
  const insp = inspectionStats(o);
  const agg = aggregate(recs, wts, attDays, insp);
  const s30 = s30AggFor(bizL1, opts || {});
  agg.s30Num  = s30.s30Num;
  agg.s30Den  = s30.s30Den;
  agg.s30Miss = s30.s30Miss;
  agg.s30Rate = s30.s30Rate;
  return agg;
}
function calcByL1(bizL1, opts) { const o = Object.assign({ bizL1 }, opts || {}); return aggregate(filterRecs(o), filterWt(o), 0, inspectionStats(o)); }

/* ==================== 时间列与表头 ==================== */
function timeCols() {
  const latest = S.latestDate;
  const baseWk = S.latestWK || 1;
  const wks = [baseWk-2, baseWk-1, baseWk];
  const dateSet = new Set();
  for (const r of S.records) if (r.date) dateSet.add(r.date);
  for (const r of S.wtRecords) if (r.date) dateSet.add(r.date);
  for (const r of S.inspections) if (r.date) dateSet.add(r.date);
  let last7 = Array.from(dateSet).sort();
  if (last7.length > 7) last7 = last7.slice(-7);
  else if (last7.length < 7) {
    const fallback = [];
    for (let i = 1; i <= 7 && last7.length + fallback.length < 7; i++) { const d = dateAdd(latest, -i); if (d && !dateSet.has(d)) fallback.push(d); }
    last7 = Array.from(new Set([...last7, ...fallback])).sort().slice(-7);
  }
  return { monthLabel: S.month ? (parseInt(S.month.slice(5,7),10) + '月') : '月度', wks, last7, latest };
}
function buildHeaderHTML(cols) {
  const ths = ['<th>指标</th>', '<th>' + esc(cols.monthLabel) + '</th>'];
  for (const w of cols.wks) ths.push('<th>WK' + w + '</th>');
  ths.push('<th>WK' + cols.wks[1] + ' − WK' + cols.wks[0] + '</th>');
  ths.push('<th>WK' + cols.wks[2] + ' − WK' + cols.wks[1] + '</th>');
  for (const d of cols.last7) ths.push('<th>' + esc(d.slice(5)) + '</th>');
  return ths.join('');
}

/* ==================== SLA 计算 ==================== */
const SLA_METRIC_ALIAS = {
  'casevolume': 'caseVolume', 'case处理量': 'caseVolume', 'case量': 'caseVolume', '人工服务量': 'caseVolume', 'case处理': 'caseVolume',
  'cpd': 'cpd',
  'aht': 'aht', '处理时长': 'aht', 'case处理时长': 'aht',
  'concurrency': 'concurrency', '并发': 'concurrency',
  'utilization': 'utilization', '工时利用率': 'utilization', '利用率': 'utilization',
  'solverate': 'solveRate', '解决率': 'solveRate',
  'satisfaction': 'satisfaction', '满意度': 'satisfaction',
  'escalaterate': 'escalateRate', '升级率': 'escalateRate',
  'fcr': 'fcr',
  'qualitypassrate': 'qualityPassRate', '质检合格率': 'qualityPassRate', '质检': 'qualityPassRate',
  's30rate': 's30Rate', '30s接起率': 's30Rate', '30s': 's30Rate', '30秒接起率': 's30Rate',
};
function matchMetricKey(s) {
  const n = String(s||'').replace(/\s+/g,'').replace(/[（(][^)）]*[)）]/g,'').toLowerCase();
  if (SLA_METRIC_ALIAS[n]) return SLA_METRIC_ALIAS[n];
  const keys = Object.keys(SLA_METRIC_ALIAS).sort((a,b)=>b.length-a.length);
  for (const k of keys) if (n.includes(k)) return SLA_METRIC_ALIAS[k];
  return null;
}
function slaAchieve(src, metricKey, category) {
  const monthSet = new Set([S.month]);
  const srcEmps = srcEmployeeSet(src);
  const c = String(category == null ? '' : category).trim();
  const isOverall = !c || c === '整体' || c === '全部' || c === '合计' || c === '总计' || c === '平均' || c === '总体';
  let nameSet = null;
  if (!isOverall) {
    const names = S.roster.filter(e => srcEmps.has(e.name) && (categoryOf(e, S.month) || '').includes(c)).map(e => e.name);
    if (!names.length) return null;
    nameSet = new Set(names);
  }
  const opts = { monthSet };
  if (nameSet) opts.nameSet = nameSet;
  return calcBySrc(src, opts)[metricKey];
}
function calcSlaScore(metricKey, actual, monthCfg) {
  if (!monthCfg) return { threshold: null, points: null, achieveRate: null, finalScore: null, hitTierIndex: -1, actualDisp: null, weight: null, isPct: false, belowLowest: false };
  const m = metricKey ? METRIC_MAP[metricKey] : null;
  const isPct = m ? !!m.pct : false;
  const better = m ? m.better : 'up';
  const actualDisp = actual == null || !isFinite(actual) ? null : actual;
  if (actualDisp == null || !monthCfg.tiers.length) {
    return { threshold: null, points: null, achieveRate: null, finalScore: null, hitTierIndex: -1, actualDisp, weight: monthCfg.weight, isPct, belowLowest: false };
  }
  const target = monthCfg.tiers[0].threshold;
  let achieveRate = null;
  if (target != null && target !== 0) {
    if (better === 'down') achieveRate = actualDisp > 0 ? target / actualDisp : null;
    else                   achieveRate = actualDisp / target;
  }
  let hitIdx = -1, points = null;
  if (better === 'down') {
    if (achieveRate != null) {
      for (let i = 0; i < monthCfg.tiers.length; i++) { if (achieveRate >= monthCfg.tiers[i].threshold) { hitIdx = i; points = monthCfg.tiers[i].points; break; } }
    }
  } else {
    for (let i = 0; i < monthCfg.tiers.length; i++) { if (actualDisp >= monthCfg.tiers[i].threshold) { hitIdx = i; points = monthCfg.tiers[i].points; break; } }
  }
  let belowLowest = false;
  if (hitIdx === -1) {
    const lowest = monthCfg.tiers[monthCfg.tiers.length - 1];
    if (lowest && lowest.points != null && isFinite(lowest.points)) { points = lowest.points; belowLowest = true; }
  }
  const finalScore = (points != null && monthCfg.weight != null) ? points * monthCfg.weight : null;
  return { threshold: target, points, achieveRate, finalScore, hitTierIndex: hitIdx, actualDisp, weight: monthCfg.weight, isPct, belowLowest };
}

/* ==================== 目标读取 ==================== */
function loadTargets() { try { return JSON.parse(localStorage.getItem('creator_kpi_target') || '{}'); } catch (_) { return {}; } }
function saveTargets(t) { localStorage.setItem('creator_kpi_target', JSON.stringify(t)); }
function slaTargets100(biz) {
  const out = {};
  const src = bizToSrc(biz);
  const rawList = (src === 'buyer') ? S.slaBuyer : S.slaBlogger;
  if (!rawList || !rawList.length) return out;
  const curMonth = S.month ? parseInt(S.month.slice(5,7), 10) : null;
  if (curMonth == null) return out;
  const isElder = (cat) => String(cat == null ? '' : cat).trim().includes('老人');
  const isOverall = (cat) => {
    const c = String(cat == null ? '' : cat).trim();
    if (!c) return true;
    return c === '整体' || c === '全部' || c === '合计' || c === '总计' || c === '平均' || c === '总体';
  };
  const isFullScore = (points) => {
    const p = Number(points);
    if (!isFinite(p)) return false;
    if (p === 100) return true;
    if (Math.abs(p - 1) < 1e-6) return true;
    return false;
  };
  for (const round of [1, 2, 3]) {
    for (const item of rawList) {
      const key = matchMetricKey(item.metric);
      if (!key || out[key] != null) continue;
      const elder = isElder(item.category);
      const overall = isOverall(item.category);
      if (round === 1 && !elder) continue;
      if (round === 2 && (!overall || elder)) continue;
      if (round === 3 && (elder || overall)) continue;
      const cfg = item.months[curMonth];
      if (!cfg || !cfg.tiers || !cfg.tiers.length) continue;
      const t100 = cfg.tiers.find(t => isFullScore(t.points));
      if (!t100 || t100.threshold == null || !isFinite(t100.threshold)) continue;
      const m = METRIC_MAP[key];
      let v;
      if (m && m.pct) v = t100.threshold;
      else {
        const raw = num(t100.rawThreshold);
        v = (isFinite(raw) && raw !== 0) ? raw : t100.threshold;
      }
      out[key] = v;
    }
  }
  return out;
}
function getTargets(biz) {
  const manual = loadTargets()[biz] || {};
  const sla = slaTargets100(biz);
  return Object.assign({}, sla, manual);
}
function s30TargetFromSLA(biz) {
  const t = slaTargets100(biz);
  return t.s30Rate != null ? t.s30Rate : null;
}
function s30Threshold(biz) {
  const v = s30TargetFromSLA(biz);
  if (v != null) return v;
  return S30_THRESHOLD[biz] != null ? S30_THRESHOLD[biz] : 0.97;
}
function s30TargetPct(biz) {
  const t = getTargets(biz);
  if (t && t.s30Rate != null) return Number(t.s30Rate);
  return S30_THRESHOLD[biz] != null ? S30_THRESHOLD[biz] : 0.97;
}

/* ==================== 其它辅助 ==================== */
function allWeeks() {
  const set = new Set();
  for (const r of S.records) if (r.wk) set.add(r.wk);
  for (const r of S.wtRecords) if (r.wk) set.add(r.wk);
  for (const r of S.inspections) if (r.wk) set.add(r.wk);
  return Array.from(set).sort((a, b) => a - b);
}
function aht2ByWeek(biz, wk) {
  const prevWk = wk - 1;
  const map = new Map();
  let bizAht = 0, bizVol = 0;
  for (const r of S.records) {
    if (r.biz2 !== biz) continue;
    if (r.wk !== wk && r.wk !== prevWk) continue;
    if (r.wk === wk) { bizAht += r.aht || 0; bizVol += r.volume || 0; }
    const key = (r.l1 || '') + '|' + (r.l2 || '');
    if (!map.has(key)) map.set(key, { l1: r.l1 || '—', l2: r.l2 || '—', ahtNow:0, volNow:0, ahtPrev:0, volPrev:0 });
    const o = map.get(key);
    if (r.wk === wk) { o.ahtNow += r.aht || 0; o.volNow += r.volume || 0; }
    else             { o.ahtPrev += r.aht || 0; o.volPrev += r.volume || 0; }
  }
  const bizRate = bizVol > 0 ? bizAht / bizVol : null;
  const list = Array.from(map.values()).map(o => {
    const ahtNow  = o.volNow  > 0 ? o.ahtNow  / o.volNow  : null;
    const ahtPrev = o.volPrev > 0 ? o.ahtPrev / o.volPrev : null;
    let impact = null;
    if (ahtNow != null && bizRate != null) { const nv = bizVol - o.volNow; if (nv > 0) impact = (bizAht - o.ahtNow) / nv - bizRate; }
    return { l1:o.l1, l2:o.l2, ahtNow, ahtPrev, volNow:o.volNow, volPrev:o.volPrev, impact };
  });
  return { list, bizRate, bizVol };
}
function bizAttendanceCount(biz, wk) {
  const start = wkStartDate(wk);
  const days = [];
  for (let i = 0; i < 7; i++) days.push(dateAdd(start, i));
  const srcEmps = srcEmployeeSet(bizToSrc(biz));
  let total = 0;
  for (const name of srcEmps) {
    const e = getEmp(name);
    if (e && !employeeVisible(e)) continue;
    for (const d of days) total += attOf(name, d);
  }
  return total;
}
function attendanceByWeek(emps, wk) {
  const start = wkStartDate(wk);
  const days = [];
  for (let i = 0; i < 7; i++) days.push(dateAdd(start, i));
  const rows = emps.map(e => {
    let total = 0;
    for (const d of days) total += attOf(e.name, d);
    return { name: e.name, group: e.group || '—', total };
  });
  const sum = rows.reduce((s, r) => s + r.total, 0);
  return { days, rows, sum, avg: rows.length ? sum / rows.length : 0 };
}
function darkenColor(hex, factor) {
  if (!hex || typeof hex !== 'string' || hex[0] !== '#') return hex;
  let r, g, b;
  if (hex.length === 4) {
    r = parseInt(hex[1]+hex[1], 16); g = parseInt(hex[2]+hex[2], 16); b = parseInt(hex[3]+hex[3], 16);
  } else {
    r = parseInt(hex.slice(1,3), 16); g = parseInt(hex.slice(3,5), 16); b = parseInt(hex.slice(5,7), 16);
  }
  const f = factor || 0.88;
  const to2 = c => Math.max(0, Math.round(c * f)).toString(16).padStart(2, '0');
  return '#' + to2(r) + to2(g) + to2(b);
}

/* ====================================================================
   时段量预测 · 核心算法
   - 时段占比：线性回归（与中位数按 R² 混合）
   - 日度总量：优先用户输入，其次线性回归外推
   - 博主合作 25/28 日：单独回归
   ==================================================================== */
function calcPeriodStats(biz, metricKey, sampleWeeks, refDate) {
  const latest = refDate || S.latestDate;
  if (!latest) return null;
  const startDate = dateAdd(latest, -(sampleWeeks * 7 - 1));
  const dayMap = new Map();
  const periodSet = new Set();
  const allPeriodsSet = new Set();
  let scanned = 0;
  let sumVolume = 0;
  let rowsWithPeriod = 0;
  let rowsInRange = 0;

  for (const r of S.records) {
    if (r.biz !== biz) continue;
    if (r.date < startDate || r.date > latest) continue;
    scanned++;
    const pRaw = String(r.period == null ? '' : r.period).trim();
    if (!pRaw) continue;
    const p = normPeriod(pRaw);
    if (!p) continue;
    rowsWithPeriod++;
    allPeriodsSet.add(p);
    if (!isPredictPeriod(p)) continue;
    rowsInRange++;

    periodSet.add(p);
    if (!dayMap.has(r.date)) {
      dayMap.set(r.date, { date: r.date, total: 0, periods: {}, s30: {}, rowCount: 0, periodRowCount: {} });
    }
    const d = dayMap.get(r.date);

    let rawMetric = null;
    if (metricKey === 'caseVolume' || metricKey === 'volume') rawMetric = r.volume;
    else rawMetric = r[metricKey];
    const v = num(rawMetric);
    sumVolume += v;

    d.periods[p] = (d.periods[p] || 0) + v;
    d.total += v;
    d.rowCount = (d.rowCount || 0) + 1;
    d.periodRowCount[p] = (d.periodRowCount[p] || 0) + 1;

    if (!d.s30[p]) d.s30[p] = { num: 0, den: 0 };
    d.s30[p].num += num(r.s30Num) || 0;
    d.s30[p].den += num(r.s30Den) || 0;
  }

  const sortedPeriods = Array.from(periodSet).sort((a, b) => periodSortKey(a) - periodSortKey(b));
  const allPeriodsSorted = Array.from(allPeriodsSet).sort((a, b) => periodSortKey(a) - periodSortKey(b));
  const diagnostic = {
    scanned, matchedDays: dayMap.size,
    periodsDetected: allPeriodsSorted, periodsUsed: sortedPeriods,
    sampleRange: { start: startDate, end: latest },
    sumVolume, rowsWithPeriod, rowsInRange,
  };

  const emptyReturn = () => ({
    weekday: {}, weekend: {}, weekdayS30: {}, weekendS30: {},
    weekdayCount: 0, weekendCount: 0,
    sampleRange: { start: startDate, end: latest },
    dailyStats: [], abnormalDays: [], periods: [], diagnostic,
    specialDays: { '25': null, '28': null },
    specialTotals: { '25': null, '28': null },
    totalStats: { weekday: null, weekend: null, all: null },
    regressions: { weekday: {}, weekend: {}, special25: {}, special28: {} },
    totalRegression: { all: null, weekday: null, weekend: null },
  });

  if (!scanned) {
    diagnostic.reason = 'no-records-in-range';
    diagnostic.hint = '在样本周期 ' + startDate + ' ~ ' + latest + ' 内，业务线「' + biz + '」没有任何数据行。';
    return emptyReturn();
  }
  if (!dayMap.size) {
    diagnostic.reason = 'no-period-data';
    if (rowsWithPeriod > 0 && rowsInRange === 0) {
      diagnostic.hint = '数据里所有时段都不在 9-23 范围内（检测到：' + allPeriodsSorted.join('、') + '）。';
    } else {
      diagnostic.hint = '数据行有日期，但「CASE创建时段」字段全为空或都超出 9-23 范围。请到「🔗 映射」页检查该字段是否已正确映射。';
    }
    return emptyReturn();
  }

  const useRowCount = (sumVolume <= 0);
  for (const d of dayMap.values()) {
    if (useRowCount) {
      d.total = d.rowCount || 0;
      d.periods = Object.assign({}, d.periodRowCount || {});
    }
  }

  const groups = { weekday: {}, weekend: {} };
  const s30Groups = { weekday: {}, weekend: {} };
  const regressionPoints = { weekday: {}, weekend: {}, special25: {}, special28: {} };
  const specialDayGroups = {
    '25': { shares: {}, s30: {}, count: 0, dates: [] },
    '28': { shares: {}, s30: {}, count: 0, dates: [] },
  };

  let wdCount = 0, weCount = 0;
  const dailyStats = [];
  const totalPointsAll = [];
  const totalPointsWeekday = [];
  const totalPointsWeekend = [];

  for (const d of dayMap.values()) {
    if (d.total <= 0) continue;
    const x = _dateDiffDays(startDate, d.date);
    const wd = new Date(d.date + 'T00:00:00Z').getUTCDay();
    const isWeekend = (wd === 0 || wd === 6);
    const type = isWeekend ? 'weekend' : 'weekday';
    if (isWeekend) weCount++; else wdCount++;

    totalPointsAll.push({ x, y: d.total });
    if (isWeekend) totalPointsWeekend.push({ x, y: d.total });
    else totalPointsWeekday.push({ x, y: d.total });

    for (const p in d.periods) {
      const share = d.periods[p] / d.total;
      if (!groups[type][p]) groups[type][p] = [];
      groups[type][p].push(share);
      if (!regressionPoints[type][p]) regressionPoints[type][p] = [];
      regressionPoints[type][p].push({ x, y: share });
    }
    for (const p in d.s30) {
      const s = d.s30[p];
      if (s.den <= 0) continue;
      if (!s30Groups[type][p]) s30Groups[type][p] = [];
      s30Groups[type][p].push(s.num / s.den);
    }

    if (biz === '博主合作') {
      const dom = parseInt(d.date.slice(8, 10), 10);
      if (dom === 25 || dom === 28) {
        const cls = classifyDate(d.date);
        if (cls !== 'holiday') {
          const k = String(dom);
          const sg = specialDayGroups[k];
          sg.count++;
          sg.dates.push(d.date);
          const regKey = 'special' + k;
          for (const p in d.periods) {
            const share = d.periods[p] / d.total;
            if (!sg.shares[p]) sg.shares[p] = [];
            sg.shares[p].push(share);
            if (!regressionPoints[regKey][p]) regressionPoints[regKey][p] = [];
            regressionPoints[regKey][p].push({ x, y: share });
          }
          for (const p in d.s30) {
            const s = d.s30[p];
            if (s.den <= 0) continue;
            if (!sg.s30[p]) sg.s30[p] = [];
            sg.s30[p].push(s.num / s.den);
          }
        }
      }
    }

    dailyStats.push({ date: d.date, total: d.total, isWeekend, periods: Object.assign({}, d.periods), s30: Object.assign({}, d.s30) });
  }

  if (!dailyStats.length) {
    diagnostic.reason = 'zero-volume-and-zero-rows';
    diagnostic.hint = '检测到 ' + dayMap.size + ' 天有数据，但既没有 CASE 处理量、也没有有效明细行。';
    return emptyReturn();
  }

  /* ---- 总量统计（用于日总量预测锚点与区间约束） ---- */
  const weekdayTotals = [];
  const weekendTotals = [];
  for (const d of dailyStats) {
    if (d.isWeekend) weekendTotals.push(d.total);
    else             weekdayTotals.push(d.total);
  }
  const totalStats = {
    weekday: _statOf(weekdayTotals),
    weekend: _statOf(weekendTotals),
    all:     _statOf(dailyStats.map(d => d.total)),
  };

  /* ---- 博主 25/28 日：单独统计历史日总量 ---- */
  const specialTotals = { '25': null, '28': null };
  if (biz === '博主合作') {
    for (const k of ['25', '28']) {
      const sg = specialDayGroups[k];
      if (!sg || !sg.count) continue;
      const dateSet = new Set(sg.dates);
      const arr = [];
      for (const d of dailyStats) if (dateSet.has(d.date)) arr.push(d.total);
      specialTotals[k] = _statOf(arr);
    }
  }

  const median = (group) => {
    const out = {};
    for (const p in group) {
      const arr = group[p].slice().sort((a, b) => a - b);
      const n = arr.length;
      out[p] = n % 2 ? arr[(n - 1) / 2] : (arr[n / 2 - 1] + arr[n / 2]) / 2;
    }
    return out;
  };
  const avg = (group) => { const out = {}; for (const p in group) { const arr = group[p]; out[p] = arr.reduce((s, x) => s + x, 0) / arr.length; } return out; };
  const normalize = (obj) => { let sum = 0; for (const p in obj) sum += obj[p]; if (sum <= 0) return obj; const out = {}; for (const p in obj) out[p] = obj[p] / sum; return out; };
  const fillPeriods = (obj) => { const out = {}; for (const p of sortedPeriods) out[p] = obj[p] || 0; return out; };

  const weekdayRaw = median(groups.weekday);
  const weekendRaw = median(groups.weekend);
  const weekday = normalize(fillPeriods(weekdayRaw));
  const weekendFinal = Object.keys(weekendRaw).length > 0 ? normalize(fillPeriods(weekendRaw)) : weekday;
  const weekdayS30 = avg(s30Groups.weekday);
  const weekendS30 = avg(s30Groups.weekend);
  const weekendS30Final = Object.keys(weekendS30).length > 0 ? weekendS30 : weekdayS30;

  const specialDays = { '25': null, '28': null };
  for (const k of ['25', '28']) {
    const sg = specialDayGroups[k];
    if (sg.count < 1) continue;
    const medRaw = median(sg.shares);
    const share = normalize(fillPeriods(medRaw));
    const s30 = avg(sg.s30);
    specialDays[k] = { share, s30, sampleCount: sg.count, dates: sg.dates.slice() };
  }

  const regressions = { weekday: {}, weekend: {}, special25: {}, special28: {} };
  for (const type of ['weekday', 'weekend', 'special25', 'special28']) {
    const pts = regressionPoints[type];
    for (const p in pts) {
      regressions[type][p] = _linearReg(pts[p]);
    }
  }
  const totalRegression = {
    all: _linearReg(totalPointsAll),
    weekday: _linearReg(totalPointsWeekday),
    weekend: _linearReg(totalPointsWeekend),
  };

  const abnormalDays = [];
  for (const d of dailyStats) {
    const type = d.isWeekend ? 'weekend' : 'weekday';
    const refShare = d.isWeekend ? weekendFinal : weekday;
    let maxDev = 0, devPeriod = '';
    for (const p in d.periods) {
      if (refShare[p] == null) continue;
      const actualShare = d.periods[p] / d.total;
      const dev = refShare[p] > 0 ? Math.abs(actualShare - refShare[p]) / refShare[p] : 0;
      if (dev > maxDev) { maxDev = dev; devPeriod = p; }
    }
    const sameType = dailyStats.filter(x => x.isWeekend === d.isWeekend);
    const avgTotal = sameType.reduce((s, x) => s + x.total, 0) / sameType.length;
    const totalDev = avgTotal > 0 ? Math.abs(d.total - avgTotal) / avgTotal : 0;
    if (maxDev > 0.5 || totalDev > 0.4) {
      abnormalDays.push({ date: d.date, isWeekend: d.isWeekend, total: d.total, avgTotal: Math.round(avgTotal), totalDevPct: (totalDev * 100).toFixed(1), maxShareDev: (maxDev * 100).toFixed(1), maxDevPeriod: devPeriod });
    }
  }

  return {
    weekday, weekend: weekendFinal,
    weekdayS30, weekendS30: weekendS30Final,
    weekdayCount: wdCount, weekendCount: weCount,
    sampleRange: { start: startDate, end: latest },
    dailyStats, abnormalDays,
    periods: sortedPeriods,
    diagnostic,
    usedRowCount: useRowCount,
    specialDays,
    specialTotals,
    totalStats,
    regressions,
    totalRegression,
  };
}

/* 缓存层：避免 renderForecastConfig / renderForecastResult 重复聚合 */
let _calcPeriodStatsCache = { key: '', data: null };
function calcPeriodStatsCached(biz, metricKey, sampleWeeks, refDate) {
  const key = [
    biz, metricKey, sampleWeeks,
    refDate || S.latestDate || '',
    S.records.length,
    S.wtRecords.length,
  ].join('|');
  if (_calcPeriodStatsCache.key === key) return _calcPeriodStatsCache.data;
  const data = calcPeriodStats(biz, metricKey, sampleWeeks, refDate);
  _calcPeriodStatsCache.key = key;
  _calcPeriodStatsCache.data = data;
  return data;
}

function generateForecast(biz, metricKey, sampleWeeks, startDate, days, dailyTotals, holidays) {
  const stats = calcPeriodStatsCached(biz, metricKey, sampleWeeks);
  if (!stats) return null;
  const periods = (stats.periods && stats.periods.length) ? stats.periods : PREDICT_PERIODS;
  const results = [];

  for (let i = 0; i < days; i++) {
    const date = dateAdd(startDate, i);
    if (!date) continue;
    const useWeekend = shouldUseWeekendPattern(date);
    let share = null, s30Rate = null, typeLabel = null, specialKind = null;
    let shareSource = 'regression';
    let usedSpecial = false;

    if (biz === '博主合作' && stats.specialDays) {
      const dom = parseInt(date.slice(8, 10), 10);
      const isSpecialDom = (dom === 25 || dom === 28);
      const cls = classifyDate(date);
      const userHoliday = S.forecastHolidays && S.forecastHolidays.has(date);
      if (isSpecialDom && cls !== 'holiday' && !userHoliday) {
        const sd = stats.specialDays[String(dom)];
        if (sd && sd.sampleCount >= 1) {
          share = _predictShare(stats.regressions['special' + dom], stats.sampleRange.start, date, sd.share);
          s30Rate = sd.s30;
          typeLabel = '博主' + dom + '日';
          specialKind = dom;
          usedSpecial = true;
        }
      }
    }
    if (!usedSpecial) {
      if (useWeekend) {
        share = _predictShare(stats.regressions.weekend, stats.sampleRange.start, date, stats.weekend);
        s30Rate = stats.weekendS30;
      } else {
        share = _predictShare(stats.regressions.weekday, stats.sampleRange.start, date, stats.weekday);
        s30Rate = stats.weekdayS30;
      }
      typeLabel = dateTypeLabel(date);
    }

    let total = num(dailyTotals[date]);
    let totalSource = total > 0 ? 'user' : null;
    if (total <= 0) {
      const pr = _predictDailyTotal(stats, date, useWeekend, specialKind, biz);
      if (pr && pr.value > 0) {
        total = pr.value;
        totalSource = pr.source;
      }
    }

    const row = { date, useWeekend, typeLabel, total, periods: {}, s30Rate, specialKind, totalSource, shareSource };
    for (const p of periods) row.periods[p] = total * (share[p] || 0);
    results.push(row);
  }
  return { stats, results, periods };
}

function forecastToMarkdown(biz, metricKey, sampleWeeks, forecast) {
  if (!forecast) return '';
  const { stats, results } = forecast;
  const lines = [];
  lines.push('# ' + biz + ' · 时段量预测');
  lines.push('');
  lines.push('- 业务线口径：**按一级打点识别**（' + biz + '）');
  lines.push('- 时段范围：**9-23 时**（动态检测）');
  lines.push('- 样本周期：' + stats.sampleRange.start + ' ~ ' + stats.sampleRange.end + '（近 ' + sampleWeeks + ' 周）');
  lines.push('- 计算维度：CASE 总量');
  lines.push('- 样本天数：工作日 ' + stats.weekdayCount + ' 天 / 周末 ' + stats.weekendCount + ' 天');
  lines.push('- 时段占比算法：**线性回归**（R² ≥ 0.5 完全用回归，否则与中位数各 50%）');
  lines.push('- 日总量算法：**回归 + 历史中位数按 R² 加权混合**（R² ≥ 0.7 回归 70%，0.5~0.7 用 50%，0.3~0.5 用 30%，< 0.3 纯用中位数），结果 clamp 到历史同类型 P10~P90 区间；外推超过 7 天后回归权重线性衰减；博主 25/28 日直接使用特殊日历史中位数');
  const tr = stats.totalRegression && stats.totalRegression.all;
  if (tr && tr.n >= 3) {
    const dir = tr.slope > 0.5 ? '上升' : (tr.slope < -0.5 ? '下降' : '平稳');
    lines.push('- 日度总量趋势：斜率 = **' + tr.slope.toFixed(2) + ' 单/天**，R² = **' + tr.r2.toFixed(3) + '**（' + dir + '）');
  }
  if (biz === '博主合作' && stats.specialDays) {
    const tips = [];
    if (stats.specialDays['25']) tips.push('25 日（' + stats.specialDays['25'].sampleCount + ' 天样本）');
    if (stats.specialDays['28']) tips.push('28 日（' + stats.specialDays['28'].sampleCount + ' 天样本）');
    if (tips.length) lines.push('- **博主特殊日模板**：' + tips.join('、') + ' 单独统计');
  }
  lines.push('');
  const periodList = (forecast.periods && forecast.periods.length) ? forecast.periods : PREDICT_PERIODS;
  lines.push('| 时段 | ' + results.map(r => r.date.slice(5) + ' ' + r.typeLabel).join(' | ') + ' |');
  lines.push('| --- |' + results.map(() => ' ---: |').join(''));
  for (const p of periodList) {
    const cells = results.map(r => { const v = r.periods[p] || 0; return r.total > 0 ? String(Math.round(v)) : '—'; });
    lines.push('| ' + p + '时 | ' + cells.join(' | ') + ' |');
  }
  lines.push('| **合计** | ' + results.map(r => '**' + (r.total > 0 ? Math.round(r.total) : '—') + '**').join(' | ') + ' |');
  lines.push('');
  return lines.join('\n');
}

function buildForecastAiContext(biz, metricKey, sampleWeeks, startDate, days, dailyTotals, holidays, forecast) {
  const { stats, results } = forecast;
  const periodList = (forecast.periods && forecast.periods.length) ? forecast.periods : PREDICT_PERIODS;
  const historyDetail = stats.dailyStats.slice().sort((a, b) => a.date < b.date ? -1 : 1).map(d => {
    const row = { date: d.date, weekday: WEEKDAY_CN[new Date(d.date + 'T00:00:00Z').getUTCDay()], type: d.isWeekend ? '周末' : '工作日', total: Math.round(d.total), periods: {} };
    for (const p of periodList) {
      const v = d.periods[p] || 0;
      const share = d.total > 0 ? v / d.total : 0;
      const s30 = d.s30[p];
      const s30Rate = (s30 && s30.den > 0) ? s30.num / s30.den : null;
      row.periods[p] = { val: Math.round(v), share: (share * 100).toFixed(2) + '%', s30Rate: s30Rate == null ? null : (s30Rate * 100).toFixed(2) + '%' };
    }
    return row;
  });
  const avgShare = {
    weekday: Object.fromEntries(periodList.map(p => [p, ((stats.weekday[p] || 0) * 100).toFixed(2) + '%'])),
    weekend: Object.fromEntries(periodList.map(p => [p, ((stats.weekend[p] || 0) * 100).toFixed(2) + '%'])),
  };
  const avgS30 = {
    weekday: Object.fromEntries(periodList.map(p => [p, stats.weekdayS30[p] != null ? (stats.weekdayS30[p] * 100).toFixed(2) + '%' : '—'])),
    weekend: Object.fromEntries(periodList.map(p => [p, stats.weekendS30[p] != null ? (stats.weekendS30[p] * 100).toFixed(2) + '%' : '—'])),
  };
  const forecastRows = results.map(r => {
    const wd = new Date(r.date + 'T00:00:00Z').getUTCDay();
    return {
      date: r.date, weekday: WEEKDAY_CN[wd], typeLabel: r.typeLabel,
      total: Math.round(r.total), totalSource: r.totalSource,
      periods: Object.fromEntries(periodList.map(p => [p, Math.round(r.periods[p] || 0)]))
    };
  });

  const specialDaysInfo = {};
  if (stats.specialDays) {
    for (const k of ['25', '28']) {
      const sd = stats.specialDays[k];
      if (!sd) { specialDaysInfo[k] = null; continue; }
      specialDaysInfo[k] = {
        sampleCount: sd.sampleCount,
        dates: sd.dates,
        share: Object.fromEntries(periodList.map(p => [p, ((sd.share[p] || 0) * 100).toFixed(2) + '%'])),
        s30: Object.fromEntries(periodList.map(p => [p, sd.s30[p] != null ? (sd.s30[p] * 100).toFixed(2) + '%' : '—'])),
      };
    }
  }

  const trendInfo = (function () {
    const out = { total: null, shares: {} };
    const tr = stats.totalRegression && stats.totalRegression.all;
    if (tr && tr.n >= 3) {
      out.total = {
        slope: tr.slope, intercept: tr.intercept, r2: tr.r2, n: tr.n,
        direction: tr.slope > 0.5 ? '上升' : (tr.slope < -0.5 ? '下降' : '平稳'),
      };
    }
    if (stats.regressions) {
      for (const type of ['weekday', 'weekend']) {
        out.shares[type] = {};
        const regr = stats.regressions[type];
        for (const p of periodList) {
          const r = regr ? regr[p] : null;
          if (r && r.n >= 3) {
            out.shares[type][p] = {
              slope: r.slope, r2: r.r2, n: r.n,
              dailyChangePct: r.slope * 100,
            };
          }
        }
      }
    }
    return out;
  })();

  return {
    biz, metricKey, sampleWeeks, startDate, days,
    sampleRange: stats.sampleRange,
    weekdayCount: stats.weekdayCount, weekendCount: stats.weekendCount,
    periodList, avgShare, avgS30,
    abnormalDays: stats.abnormalDays,
    historyDetail, forecastRows,
    thresholds: { s30Rate: s30Threshold(biz) },
    specialDays: specialDaysInfo,
    trend: trendInfo,
  };
}

function formatForecastAiContext(ctx) {
  const L = [];
  L.push('【基本信息】');
  L.push('  业务线：' + ctx.biz + '（按一级打点识别）');
  L.push('  计算维度：CASE 总量（人工服务量）');
  L.push('  时段范围：9-23 时（共 ' + ctx.periodList.length + ' 个）');
  L.push('  样本周期：' + ctx.sampleRange.start + ' ~ ' + ctx.sampleRange.end + '（' + ctx.sampleWeeks + ' 周）');
  L.push('  样本天数：工作日 ' + ctx.weekdayCount + ' 天 / 周末 ' + ctx.weekendCount + ' 天');
  L.push('  30S 接起率阈值：' + (ctx.thresholds.s30Rate * 100).toFixed(2) + '%');
  L.push('  预测算法：时段占比采用**线性回归**（R² >= 0.5 完全用回归，否则与中位数各占 50%）');
  L.push('');

  if (ctx.trend) {
    L.push('【趋势分析（线性回归）】');
    if (ctx.trend.total) {
      const t = ctx.trend.total;
      L.push('  日度总量：斜率 = ' + t.slope.toFixed(2) + ' 单/天，R² = ' + t.r2.toFixed(3) + '，样本 ' + t.n + ' 天，方向：' + t.direction);
    } else {
      L.push('  日度总量：样本不足，未做回归。');
    }
    for (const type of ['weekday', 'weekend']) {
      const label = type === 'weekday' ? '工作日' : '周末';
      const keys = Object.keys(ctx.trend.shares[type] || {});
      if (!keys.length) {
        L.push('  ' + label + '时段占比：样本不足，使用中位数。');
        continue;
      }
      const parts = [];
      for (const p of ctx.periodList) {
        const s = ctx.trend.shares[type][p];
        if (!s) continue;
        const sign = s.dailyChangePct >= 0 ? '+' : '';
        parts.push(p + '时 ' + sign + s.dailyChangePct.toFixed(3) + 'pp/天(R²=' + s.r2.toFixed(2) + ')');
      }
      L.push('  ' + label + '占比趋势：' + parts.join('，'));
    }
    L.push('');
  }

  if (ctx.specialDays && (ctx.specialDays['25'] || ctx.specialDays['28'])) {
    L.push('【⚠️ 业务特殊日（仅博主合作）：每月 25 日 / 28 日为集中进线日】');
    for (const k of ['25', '28']) {
      const sd = ctx.specialDays[k];
      if (!sd) { L.push('  ' + k + ' 日：样本不足，未启用特殊模板。'); continue; }
      L.push('  ' + k + ' 日：样本 ' + sd.sampleCount + ' 天（' + (sd.dates.join('、') || '—') + '），时段占比如下：');
      L.push('    时段 | ' + ctx.periodList.join(' | '));
      L.push('    占比 | ' + ctx.periodList.map(p => sd.share[p] || '—').join(' | '));
      L.push('    30S  | ' + ctx.periodList.map(p => sd.s30[p] || '—').join(' | '));
    }
    L.push('');
  }

  L.push('【平均时段占比（中位数，作为回归的兜底参考）】');
  L.push('  时段 | 工作日占比 | 周末占比 | 工作日30S | 周末30S');
  for (const p of ctx.periodList) {
    L.push('  ' + p + '时 | ' + (ctx.avgShare.weekday[p] || '—') + ' | ' + (ctx.avgShare.weekend[p] || '—') + ' | ' + (ctx.avgS30.weekday[p] || '—') + ' | ' + (ctx.avgS30.weekend[p] || '—'));
  }
  L.push('');
  if (ctx.abnormalDays.length) {
    L.push('【⚠ 疑似异常天（占比偏差>50% 或 总量偏差>40%）】');
    L.push('  日期 | 类型 | 总量 | 同类型均值 | 总量偏差 | 最大时段占比偏差');
    for (const d of ctx.abnormalDays) {
      L.push('  ' + d.date + ' | ' + (d.isWeekend ? '周末' : '工作日') + ' | ' + d.total + ' | ' + d.avgTotal + ' | ' + d.totalDevPct + '% | ' + d.maxShareDev + '%（' + d.maxDevPeriod + '时）');
    }
    L.push('');
  } else {
    L.push('【⚠ 疑似异常天】未检出显著异常。');
    L.push('');
  }
  L.push('【历史每日明细（日期 / 类型 / 总量 / 每时段占比 / 30S接起率）】');
  L.push('  日期 | 类型 | 总量 | ' + ctx.periodList.map(p => p + '时占比(30S)').join(' | '));
  for (const d of ctx.historyDetail) {
    const cells = ctx.periodList.map(p => { const v = d.periods[p]; if (!v || v.val === 0) return '—'; return v.share + (v.s30Rate ? '(' + v.s30Rate + ')' : ''); });
    L.push('  ' + d.date + ' | ' + d.type + ' | ' + d.total + ' | ' + cells.join(' | '));
  }
  L.push('');
  L.push('【未来预测（占比来自线性回归，总量优先取用户输入）】');
  L.push('  说明：totalSource = user 表示用户输入；regression 表示用历史日度总量回归外推');
  L.push('  日期 | 类型 | 总量(来源) | ' + ctx.periodList.map(p => p + '时').join(' | '));
  for (const r of ctx.forecastRows) {
    const srcTag = r.totalSource === 'regression' ? '(回归)' : (r.totalSource === 'user' ? '' : '(无)');
    const cells = ctx.periodList.map(p => r.periods[p] || 0);
    L.push('  ' + r.date + '(' + r.weekday + ') | ' + r.typeLabel + ' | ' + r.total + srcTag + ' | ' + cells.join(' | '));
  }
  L.push('');
  return L.join('\n');
}

/* ============================================================
   END OF dashboard-core.js
   ============================================================ */