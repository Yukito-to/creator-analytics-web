/* ============================================================
   创作者数据分析 · 智能排班系统（dashboard-schedule.js）
   数据源：S.scheduleDraft / S.shiftPeriods / S.shiftMeta（core 解析）
   依赖：S.roster / S.records / S.volumeForecast / getHolidayMap /
        dateAdd / normPeriod / empBiz / esc / toast / buildXlsxBlob
   ============================================================ */
'use strict';

/* ==================== 常量 ==================== */
/* ★ 不再硬编码任何班次名。班次属性从 S.shiftMeta 读取。 */
const SC_BASE_HOLIDAY = 6;
const SC_TRIPLE_BONUS = 1;
const SC_HOURS = PREDICT_PERIODS;   // ['9'..'23']
const SC_MAX_STREAK = 6;
/* 周期起始日相对"前置排班最后一天"的偏移量：+1 = 最后一天 + 1 */
const SC_CYCLE_START_OFFSET = 1;
const SC_BIZ_LIST = ['买手合作', '博主合作'];
const SC_COLOR_LEAVE_REQ = '#92D050';   // Excel 标准绿
const SC_COLOR_REST_ALGO = '#FFA94D';   // 橙色：非员工诉求的休息（前置/算法/其它假）

/* ==================== 班次 / 日期工具 ==================== */
function scIsLateShift(shift) {
  const meta = S.shiftMeta && S.shiftMeta[shift];
  return !!(meta && meta.isLate);
}
function scIsRestShift(shift) {
  const meta = S.shiftMeta && S.shiftMeta[shift];
  return !!(meta && !meta.isWorking && meta.restDays > 0);
}
function scIsLeaveShift(shift) {
  const meta = S.shiftMeta && S.shiftMeta[shift];
  return !!(meta && !meta.isWorking && meta.restDays === 0);
}
function scIsWorkingShift(shift) {
  const meta = S.shiftMeta && S.shiftMeta[shift];
  return !!(meta && meta.isWorking);
}
function scWeekdayOf(date) { return new Date(date + 'T00:00:00Z').getUTCDay(); }
function scIsWeekend(date) { const wd = scWeekdayOf(date); return wd === 0 || wd === 6; }
function scDatesBetween(a, b) {
  const out = [];
  if (!a || !b) return out;
  let d = a;
  let guard = 0;
  while (d && d <= b && guard++ < 366) { out.push(d); d = dateAdd(d, 1); }
  return out;
}

/* ============================================================
   排班表 · 展示日期范围（仅用于表格展示，不参与排班计算）
   规则：
     起点 = min(周期起始日 − 7 天, 周期起始日所在月的 1 号)
     终点 = 周期结束日（不再到月末）

   即：
     · 起始日往前推 7 天跨月 → 起点 = 往前推 7 天那天
     · 起始日往前推 7 天同月 → 起点 = 起始月 1 号
     · 终点 = 周期结束日

   示例：
     9/28 – 10/4   → 9/1  ~ 10/4
     10/5 – 10/11  → 9/28 ~ 10/11
     10/12 – 10/18 → 10/1 ~ 10/18
     10/12 – 10/25 → 10/1 ~ 10/25

   说明：
     起始日之前的日期即「前置已排班次 / 历史班次」；
     用户可点「📦 折叠历史列」按钮一键折叠（由 renderScGrid 里
     S.scCollapseHist 通过 dates.filter(d => d >= cycle.start) 实现）。

   注意：scDatesBetween 仍被生成/导出/复制等逻辑复用（那些必须是
   真实周期），因此这里独立实现，不改动 scDatesBetween。
   ============================================================ */
function scDisplayDateRange(cycle) {
  const out = { dates: [], isCrossMonth: false };
  if (!cycle || !cycle.start || !cycle.end) return out;

  const startMonth = cycle.start.slice(0, 7);   // 'YYYY-MM'
  const endMonth   = cycle.end.slice(0, 7);

  if (startMonth !== endMonth) out.isCrossMonth = true;

  /* ---- 1. 起点 = min(起始日 − 7 天, 起始月 1 号) ---- */
  const startMonthFirst = startMonth + '-01';
  const minus7 = dateAdd(cycle.start, -7);   // 依赖 core 里的 dateAdd

  let beginDate = (minus7 && minus7 < startMonthFirst) ? minus7 : startMonthFirst;
  if (!beginDate) beginDate = startMonthFirst;

  /* ---- 2. 终点 = 周期结束日（不再延伸到月末） ---- */
  const endDate = cycle.end;

  /* ---- 3. 逐日生成 ---- */
  let d = beginDate;
  let guard = 0;
  while (d && d <= endDate && guard++ < 400) {
    out.dates.push(d);
    d = dateAdd(d, 1);
  }
  return out;
}

/* ==================== 员工池 ==================== */
/* ★ 员工顺序：优先按「排班草稿表格」中出现顺序（= 员工行顺序）；
    草稿里没有、但花名册里符合条件的一线员工，追加在最后（保持 roster 顺序）。 */
function scActiveEmployees() {
  const c = scGetCycle();
  const start = c.start || S.latestDate || '';

  /* 1. 建过滤后的 name → emp 映射 */
  const empMap = new Map();
  for (const e of (S.roster || [])) {
    if (!e.name) continue;
    if (e.resignDate && start && e.resignDate < start) continue;
    if (!/一线/.test(e.attr || '')) continue;
    empMap.set(e.name, e);
  }

  /* 2. 按 scheduleDraft 出现顺序提取 */
  const orderedNames = [];
  const seen = new Set();
  for (const d of (S.scheduleDraft || [])) {
    if (!d.name || seen.has(d.name)) continue;
    seen.add(d.name);
    if (empMap.has(d.name)) orderedNames.push(d.name);
  }

  /* 3. 草稿里没有的一线员工追加在末尾（保持 roster 顺序） */
  for (const e of (S.roster || [])) {
    if (!empMap.has(e.name) || seen.has(e.name)) continue;
    seen.add(e.name);
    orderedNames.push(e.name);
  }

  return orderedNames.map(n => empMap.get(n));
}
/* H8：按业务线专属/弹性分池 */
function scPartitionEmployees() {
  const buyerOnly = [], bloggerOnly = [], flex = [];
  for (const e of scActiveEmployees()) {
    const b = String(e.biz || '');
    if (/买手/.test(b) && !/博主/.test(b)) buyerOnly.push(e);
    else if (/博主/.test(b) && !/买手/.test(b)) bloggerOnly.push(e);
    else flex.push(e);
  }
  return { buyerOnly, bloggerOnly, flex };
}

/* ==================== 诉求（H2/H3/S1/S6） ==================== */
function scLoadParsedRequests() {
  return S.parsedRequests || {};
}
function scRequestsAllow(ctx, name, shift) {
  const req = ctx.parsed && ctx.parsed[name];
  if (req && req.items) {
    for (const it of req.items) {
      if (it.type === 'only' && it.target_shift && it.target_shift !== shift) return false;   // H2
      if (it.type === 'not' && it.target_shifts && it.target_shifts.indexOf(shift) >= 0) return false;   // H3
    }
  }
  return true;
}
function scSameAsTarget(ctx, name) {
  const req = ctx.parsed && ctx.parsed[name];
  if (!req || !req.items) return null;
  for (const it of req.items) {
    if (it.type === 'same_as' && it.target_person) return it.target_person;
  }
  return null;
}
/* 判断某员工某日期是否有 leave_on 诉求（明确的休假日期）。
   注意：与下方 renderScGrid 附近已存在的 isLeaveRequest() 语义完全一致，
   此处保留独立命名以便排班约束逻辑语义自解释；isLeaveRequest 仍供渲染层使用。 */
function scHasLeaveOn(name, date) {
  const req = (S.parsedRequests || {})[name];
  if (!req || !req.items) return false;
  for (const it of req.items) {
    if (it.type === 'leave_on'
        && Array.isArray(it.dates)
        && it.dates.indexOf(date) >= 0) return true;
  }
  return false;
}

/* 返回某员工某日期的「有效班次」：
   优先 scheduleDraft；无则看 leave_on 诉求；都无则空字符串 */
function scEffectiveShift(name, date) {
  const draft = S.scheduleDraft.find(x => x.name === name && x.date === date);
  if (draft && draft.shift) return draft.shift;
  if (scHasLeaveOn(name, date)) return scDefaultRestShift();
  return '';
}

/* ==================== 可休天数 ==================== */
/* 三倍日判定：只认用户勾选的节假日 */
function scIsTripleDay(date) {
  return S.scTripleDates.has(date);
}

/* 单员工休假统计（按「统计月」口径，默认 = 排班周期起始月）：
   tripleDays = 在 S.scTripleDates 里、且排了工作班次的天数（仅统计月内）
   used       = sheet「休」列（shiftMeta.restDays）求和（仅统计月内）
   total      = 按 S.scHolidayRules 精确匹配 tripleDays 得到的应休天数
   remain     = max(0, total - used)；未匹配规则时 total/remain 为 null

   统计月优先级：排班周期起始月 (S.scheduleCycle.start) → S.month → 空(=全部)
   例：周期 2026-09-28~10-04 → 统计月 = 2026-09；
       周期 2026-10-05~10-11 → 统计月 = 2026-10。
   S.scheduleDraft 里其它月份的记录仍然保留，只是不计入这三列。 */
function scHolidayStat(name) {
  const tripleSet = S.scTripleDates;
  let tripleDays = 0;
  let used = 0;

  /* ★ 统计月 = 排班周期起始日所在月；无周期则回退 S.month */
  const cycle = (typeof scGetCycle === 'function')
    ? scGetCycle()
    : (S.scheduleCycle || {});
  const statMonth = (cycle && cycle.start)
    ? cycle.start.slice(0, 7)
    : (S.month || '');

  /* ★ 遍历统计月内所有日期（用日期序列，才能覆盖诉求 leave_on） */
  let monthDates = [];
  if (statMonth) {
    const [y, m] = statMonth.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    for (let i = 1; i <= lastDay; i++) {
      monthDates.push(statMonth + '-' + String(i).padStart(2, '0'));
    }
  } else {
    const dateSet = new Set();
    for (const d of S.scheduleDraft) dateSet.add(d.date);
    monthDates = Array.from(dateSet).sort();
  }

  for (const d of monthDates) {
    const shift = scEffectiveShift(name, d);
    if (!shift) continue;

    if (tripleSet.has(d) && scIsWorkingShift(shift)) tripleDays++;

    const meta = S.shiftMeta[shift];
    if (meta && meta.restDays > 0) used += meta.restDays;
  }

  let total = null;
  for (const r of S.scHolidayRules) {
    if (!r.enabled) continue;
    if (Number(r.triple) === tripleDays) { total = Number(r.rest); break; }
  }

  const remain = (total == null) ? null : Math.max(0, total - used);
  return { tripleDays, used, total, remain };
}

/* 兼容旧调用：把统计口径统一为 S.scTripleDates + S.scHolidayRules */
function calcHolidayQuota(name) {
  const st = scHolidayStat(name);
  return {
    base: null,                          /* 新口径无「基础可休」概念 */
    tripleDays: st.tripleDays,
    used: st.used,
    remain: st.remain == null ? 0 : st.remain,
    total: st.total == null ? 0 : st.total,
  };
}
function calcAllHolidayQuota() {
  S.holidayQuota = {};
  for (const e of scActiveEmployees()) S.holidayQuota[e.name] = calcHolidayQuota(e.name);
}

/* ==================== 排班主流程 ==================== */
function generateSchedule() {
  const c = scGetCycle();
  if (!c.start || !c.end) { toast('请先设置排班周期'); return null; }
  if (!(S.shiftPool || []).length) { toast('请先选择可用班次'); return null; }
  if (!Object.keys(S.shiftReqs || {}).length) { toast('请先设置至少一个业务线的班次需求'); return null; }
  const dates = scDatesBetween(c.start, c.end);
  if (!dates.length) { toast('排班周期无效'); return null; }

  const pools = scPartitionEmployees();
  calcAllEmployeeCPH();
  calcAllHolidayQuota();

  /* ---- H1 硬约束预锁定 ----
     1) 草稿里已有班次（含「休」）→ 直接锁定
     2) 员工诉求里 leave_on 的日期（草稿未填）→ 锁定为默认休息班次
     只处理周期内 dates，前置部分不动。 */
  const locked = {};
  for (const e of scActiveEmployees()) {
    locked[e.name] = {};
    for (const d of dates) {
      const s = scEffectiveShift(e.name, d);
      if (s) locked[e.name][d] = s;
    }
  }

  const ctx = {
    dates, locked,
    buyerOnly: pools.buyerOnly, bloggerOnly: pools.bloggerOnly, flex: pools.flex,
    reqs: S.shiftReqs,
    cph: S.employeeCPH,
    parsed: scLoadParsedRequests(),
    stats: {}, lastShift: {}, workStreak: {},
    assigned: {}, assignedBiz: {},
    demandVol: {}, warnings: [],
  };
  for (const biz of SC_BIZ_LIST) ctx.demandVol[biz] = scComputeDemandTable(biz, dates);

  /* ---- 逐日贪心：专属池 → 缺口征调 → 休息填充 ---- */
  for (const d of dates) {
    ctx.assigned[d] = {};
    ctx.assignedBiz[d] = {};
    scApplyLocks(ctx, d);
    scAssignBizDay(ctx, d, '买手合作', ctx.buyerOnly);
    scAssignBizDay(ctx, d, '博主合作', ctx.bloggerOnly);
    scFillShortage(ctx, d, '买手合作');
    scFillShortage(ctx, d, '博主合作');
    scFillRest(ctx, d);
    scUpdateStreak(ctx, d);
  }

  /* ---- 局部搜索优化（软约束 S2-S5） ---- */
  scRebalanceLateShifts(ctx);
  scRebalanceRestDays(ctx);

  /* ---- 输出 ---- */
  const result = [];
  for (const d of dates) {
    for (const e of scActiveEmployees()) {
      const s = ctx.assigned[d] && ctx.assigned[d][e.name];
      if (!s) continue;
      result.push({ date: d, name: e.name, shift: s, biz: ctx.assignedBiz[d][e.name] || empBiz(e.name) });
    }
  }
  scValidateQuota(ctx);   // H5 后验校验（只告警不回改，避免初期无人可排）
  S.scheduleResult = result;
  S.scheduleDiag = scBuildDiag(ctx, result);
  return result;
}

/* ==================== 分配内部函数 ==================== */
function scDoAssign(ctx, date, e, shift, biz) {
  ctx.assigned[date][e.name] = shift;
  ctx.assignedBiz[date][e.name] = biz || '';
  if (!ctx.stats[e.name]) ctx.stats[e.name] = {};
  ctx.stats[e.name][shift] = (ctx.stats[e.name][shift] || 0) + 1;
}

function scApplyLocks(ctx, date) {
  for (const e of scActiveEmployees()) {
    const s = ctx.locked[e.name] && ctx.locked[e.name][date];
    if (s) scDoAssign(ctx, date, e, s, '');
  }
}

/* 按需求表逐班次分配（H8 由候选池保证；H2/H3/H4 由 scCanAssign 保证） */
function scAssignBizDay(ctx, date, biz, candidates) {
  for (const shift of S.shiftPool) {
    const need = scGetShiftReq(biz, shift, date);
    if (need == null) continue;
    let already = 0;
    for (const n in ctx.assigned[date]) {
      if (ctx.assigned[date][n] === shift && ctx.assignedBiz[date][n] === biz) already++;
    }
    let needMore = need - already;
    if (needMore <= 0) continue;
    const sorted = candidates
      .filter(e => !ctx.assigned[date][e.name])
      .filter(e => scCanAssign(ctx, e, date, shift))
      .map(e => ({ e, score: scScoreCandidate(ctx, e, date, shift) }))
      .sort((a, b) => b.score - a.score);
    for (const item of sorted) {
      if (needMore <= 0) break;
      scDoAssign(ctx, date, item.e, shift, biz);
      needMore--;
    }
  }
}

/* 硬约束校验（H2 only / H3 not / H4 连续工作 ≤6） */
function scCanAssign(ctx, e, date, shift) {
  if (!scRequestsAllow(ctx, e.name, shift)) return false;
  if ((ctx.workStreak[e.name] || 0) >= SC_MAX_STREAK) return false;   // H4
  /* ★ 员工诉求里明确指定该日休假 → 禁止安排任何工作班次 */
  if (scIsWorkingShift(shift) && scHasLeaveOn(e.name, date)) return false;
  return true;
}

/* 软约束打分（S1 prefer / S6 same_as / S2 一致性 / S3 晚班均衡 / S4 可休 / S5 连续工作） */
function scScoreCandidate(ctx, e, date, shift) {
  let s = 0;
  const req = ctx.parsed && ctx.parsed[e.name];

  /* S1 prefer 诉求 */
  if (req && req.items) {
    for (const it of req.items) {
      if (it.type === 'prefer') {
        const arr = it.target_shifts || (it.target_shift ? [it.target_shift] : []);
        if (arr.indexOf(shift) >= 0) s += 100;
      }
    }
  }
  /* S6 same_as：与目标人物今日班次一致加分，不一致减分 */
  const twin = scSameAsTarget(ctx, e.name);
  if (twin && ctx.assigned[date] && ctx.assigned[date][twin]) {
    s += (ctx.assigned[date][twin] === shift) ? 90 : -30;
  }
  /* S2 班次一致性（与昨日同班次）——★ 提权到 300，高于 prefer(100)/same_as(90)，保证「优先保持统一班次」 */
  if (ctx.lastShift[e.name] === shift) s += 300;
  /* S3 晚班均衡（晚班计数越多越不倾向再排晚班）——★ 加权 + E 班专项 */
  if (scIsLateShift(shift)) {
    const st = ctx.stats[e.name] || {};
    const lateCount = (st.R || 0) + (st.D || 0) + (st.E1 || 0) + (st.E2 || 0)
                    + (st['R（短）'] || 0) + (st['D（短）'] || 0) + (st['E（短）'] || 0);
    s -= lateCount * 40;
    /* ★ E 班特别约束：不允许一直排同一员工 */
    if (/^E/.test(String(shift))) {
      const eCount = (st.E1 || 0) + (st.E2 || 0) + (st.E || 0) + (st['E（短）'] || 0);
      s -= eCount * 60;
    }
  }
  /* S4 剩余可休天数多者优先排班 */
  const q = S.holidayQuota[e.name];
  if (q) s += Math.max(0, q.remain) * 5;
  /* S5 连续工作天数少者优先 */
  s -= (ctx.workStreak[e.name] || 0) * 5;
  return s;
}

/* H6：该业务线当日每小时缺口 = 预测量 − Σ(在岗×CPH) */
function scCoverageShortage(ctx, date, biz) {
  const out = [];
  const dem = (ctx.demandVol[biz] && ctx.demandVol[biz][date]) || {};
  const cap = {};
  for (const n in ctx.assigned[date]) {
    if (ctx.assignedBiz[date][n] !== biz) continue;
    const shift = ctx.assigned[date][n];
    const mins = (S.shiftPeriods || {})[shift] || {};
    const cph = ctx.cph[n] || {};
    for (const h in mins) {
      if (mins[h] > 0 && cph[h]) cap[h] = (cap[h] || 0) + cph[h];
    }
  }
  for (const h of SC_HOURS) {
    const need = dem[h] || 0;
    if (need > 0 && (cap[h] || 0) < need) out.push({ hour: h, short: need - (cap[h] || 0) });
  }
  return out;
}

/* 单班次容量：需求为数字时不超编，null = 无限制 */
function scShiftHasCapacity(ctx, date, biz, shift) {
  const need = scGetShiftReq(biz, shift, date);
  if (need == null) return true;
  let cnt = 0;
  for (const n in ctx.assigned[date]) {
    if (ctx.assigned[date][n] === shift && ctx.assignedBiz[date][n] === biz) cnt++;
  }
  return cnt < need;
}

/* 骨架接口：某员工顶某班次是否有助于覆盖当前缺口 */
function scCoverageOK(ctx, date, shift, emp) {
  const short = scCoverageShortage(ctx, date, scReqBizState || '买手合作');
  if (!short.length) return true;
  const mins = (S.shiftPeriods || {})[shift] || {};
  const cph = (ctx.cph && ctx.cph[emp.name]) || {};
  return SC_HOURS.some(h => mins[h] > 0 && short.some(x => x.hour === h && (cph[h] || 0) > 0));
}

function scFillShortage(ctx, date, biz) {
  const own      = (biz === '买手合作') ? ctx.buyerOnly    : ctx.bloggerOnly;
  const otherBiz = (biz === '买手合作') ? '博主合作'        : '买手合作';
  const other    = (biz === '买手合作') ? ctx.bloggerOnly  : ctx.buyerOnly;

  for (let round = 0; round < 6; round++) {
    const short = scCoverageShortage(ctx, date, biz);
    if (!short.length) break;
    short.sort((a, b) => b.short - a.short);

    const ownCands = own.concat(ctx.flex).filter(e => !ctx.assigned[date][e.name]);
    let best = scPickBestCandidate(ctx, date, biz, ownCands, short);

    if (!best || best.gain <= 0) {
      const otherShort = scCoverageShortage(ctx, date, otherBiz);
      if (otherShort.length === 0) {
        const borrowCands = other.filter(e => !ctx.assigned[date][e.name]);
        const best2 = scPickBestCandidate(ctx, date, biz, borrowCands, short);
        if (best2 && best2.gain > 0) best = best2;
      }
    }

    if (!best || best.gain <= 0) {
      ctx.warnings.push(date + ' ' + biz + ' 存在时段缺口且无可征调人力');
      break;
    }
    scDoAssign(ctx, date, best.e, best.shift, biz);
  }
}

function scPickBestCandidate(ctx, date, biz, cands, short) {
  let best = null;
  for (const e of cands) {
    for (const shift of S.shiftPool) {
      if (!scCanAssign(ctx, e, date, shift)) continue;
      if (!scShiftHasCapacity(ctx, date, biz, shift)) continue;
      const mins = (S.shiftPeriods || {})[shift] || {};
      const cph  = ctx.cph[e.name] || {};
      let gain = 0;
      for (const sp of short) {
        if (mins[sp.hour] > 0) gain += Math.min(sp.short, cph[sp.hour] || 0);
      }
      if (!best || gain > best.gain) best = { e, shift, gain };
    }
  }
  return best;
}

/* 从 sheet 里找一个默认休息班次：
   优先「不上班且休列最大」（用户 sheet 里的「休」），
   其次任何「不上班」的班次，最后兜底 '放休'。 */
function scDefaultRestShift() {
  let best = null, bestRest = -1;
  for (const s in S.shiftMeta) {
    const m = S.shiftMeta[s];
    if (m.isWorking) continue;
    if (m.restDays > bestRest) { bestRest = m.restDays; best = s; }
  }
  return best || '放休';
}

function scFillRest(ctx, date) {
  const def = scDefaultRestShift();
  for (const e of scActiveEmployees()) {
    if (ctx.assigned[date][e.name]) continue;
    ctx.assigned[date][e.name] = def;
  }
}

/* 更新昨日班次与连续工作天数（供次日打分/硬约束用） */
function scUpdateStreak(ctx, date) {
  for (const e of scActiveEmployees()) {
    const s = ctx.assigned[date] && ctx.assigned[date][e.name];
    if (s && scIsWorkingShift(s)) ctx.workStreak[e.name] = (ctx.workStreak[e.name] || 0) + 1;
    else ctx.workStreak[e.name] = 0;
    ctx.lastShift[e.name] = s || '';
  }
}

/* ==================== 局部搜索优化 ==================== */
/* 全周期重扫某员工，检查任意连续工作段 ≤6（H4） */
function scStreakOK(ctx, dates, name) {
  let run = 0;
  for (const d of dates) {
    const s = ctx.assigned[d] && ctx.assigned[d][name];
    if (s && scIsWorkingShift(s)) { run++; if (run > SC_MAX_STREAK) return false; }
    else run = 0;
  }
  return true;
}

/* S3 晚班均衡：晚班计数极差 >2 时，随机交换两人某天的工作班次（带硬约束回验） */
function scRebalanceLateShifts(ctx) {
  const dates = ctx.dates;
  const emps = scActiveEmployees().filter(e => ctx.assigned[dates[0]] && ctx.assigned[dates[0]][e.name] !== undefined);
  if (emps.length < 2) return;
  const lateCount = name => {
    let c = 0;
    for (const d of dates) {
      const s = ctx.assigned[d] && ctx.assigned[d][name];
      if (s && scIsLateShift(s)) c++;
    }
    return c;
  };
  const t0 = Date.now();
  let iter = 0;
  while (iter++ < 200 && Date.now() - t0 < 2000) {
    let maxDiff = 0, pa = null, pb = null;
    for (let i = 0; i < emps.length; i++) {
      for (let j = i + 1; j < emps.length; j++) {
        const diff = Math.abs(lateCount(emps[i].name) - lateCount(emps[j].name));
        if (diff > maxDiff) { maxDiff = diff; pa = emps[i]; pb = emps[j]; }
      }
    }
    if (!pa || maxDiff <= 2) break;
    const days = dates.slice().sort(() => Math.random() - 0.5);
    let swapped = false;
    for (const d of days) {
      const sa = ctx.assigned[d][pa.name], sb = ctx.assigned[d][pb.name];
      if (!sa || !sb) continue;
      if (!scIsWorkingShift(sa) || !scIsWorkingShift(sb)) continue;
      if (ctx.locked[pa.name][d] || ctx.locked[pb.name][d]) continue;
      if (!scRequestsAllow(ctx, pa.name, sb) || !scRequestsAllow(ctx, pb.name, sa)) continue;
      ctx.assigned[d][pa.name] = sb;
      ctx.assigned[d][pb.name] = sa;
      if (scStreakOK(ctx, dates, pa.name) && scStreakOK(ctx, dates, pb.name)) { swapped = true; break; }
      ctx.assigned[d][pa.name] = sa;   // 回滚
      ctx.assigned[d][pb.name] = sb;
    }
    if (!swapped) break;
  }
}

/* 休息均衡：同组内实际工作天数差 >1 时，把多干者某工作日与少干者某放休日对调 */
function scRebalanceRestDays(ctx) {
  const dates = ctx.dates;
  const emps = scActiveEmployees().filter(e => ctx.assigned[dates[0]] && ctx.assigned[dates[0]][e.name] !== undefined);
  const workDays = name => {
    let c = 0;
    for (const d of dates) {
      const s = ctx.assigned[d] && ctx.assigned[d][name];
      if (s && scIsWorkingShift(s)) c++;
    }
    return c;
  };
  for (let iter = 0; iter < 50; iter++) {
    let pa = null, pb = null;
    for (let i = 0; i < emps.length && !pa; i++) {
      for (let j = 0; j < emps.length; j++) {
        if (i === j) continue;
        if (workDays(emps[i].name) - workDays(emps[j].name) > 1) { pa = emps[i]; pb = emps[j]; break; }
      }
    }
    if (!pa) break;
    let done = false;
    for (const d of dates) {
      const sa = ctx.assigned[d][pa.name], sb = ctx.assigned[d][pb.name];
      if (!sa || !sb) continue;
      if (!scIsWorkingShift(sa) || scIsWorkingShift(sb)) continue;   // a 工作、b 休息才可对调
      if (ctx.locked[pa.name][d] || ctx.locked[pb.name][d]) continue;
      if (!scRequestsAllow(ctx, pa.name, sb) || !scRequestsAllow(ctx, pb.name, sa)) continue;
      ctx.assigned[d][pa.name] = sb;
      ctx.assigned[d][pb.name] = sa;
      if (scStreakOK(ctx, dates, pa.name) && scStreakOK(ctx, dates, pb.name)) { done = true; break; }
      ctx.assigned[d][pa.name] = sa;   // 回滚
      ctx.assigned[d][pb.name] = sb;
    }
    if (!done) break;
  }
}

/* H5 后验校验：实际工作天数 ≥ 周期天数 − 可休总额（只告警不回改） */
function scValidateQuota(ctx) {
  const total = ctx.dates.length;
  for (const e of scActiveEmployees()) {
    let work = 0;
    for (const d of ctx.dates) {
      const s = ctx.assigned[d] && ctx.assigned[d][e.name];
      if (s && scIsWorkingShift(s)) work++;
    }
    const q = S.holidayQuota[e.name] || {};
    /* total=0 表示未匹配到任何休假规则 → 退回默认基础可休，避免误报 */
    const quota = (q.total != null && q.total > 0) ? q.total : SC_BASE_HOLIDAY;
    const need = Math.max(0, total - quota);
    if (work < need) {
      ctx.warnings.push(e.name + ' 实际工作 ' + work + ' 天 < 期望 ' + need + ' 天（周期 ' + total + ' 天 / 可休 ' + quota + '）');
    }
  }
}

/* 诊断信息 */
function scBuildDiag(ctx, result) {
  return {
    totalSlots: result.length,
    dateCount: ctx.dates.length,
    employeeCount: scActiveEmployees().length,
    warnings: (ctx.warnings || []).slice(0, 30),
  };
}

/* ==================== 视图渲染 ==================== */
let scReqBizState = '买手合作';   // 需求表当前业务线

function renderSchedulePanel() {
  let c = scGetCycle();
  const cHint = document.getElementById('scCycleHint');

  /* ★ 自动推断的两个前置条件：
       ① 用户从未手动改过周期（S.scCycleLocked === false）
       ② 当前周期还没有值（c.start 为空）
     这样用户手动改过之后，刷新页面也不会被自动推断覆盖。 */
  if (!c.start && !S.scCycleLocked) {
    const inferred = (typeof scInferCycleFromDraft === 'function')
      ? scInferCycleFromDraft() : null;
    if (inferred) {
      scSetCycle({ start: inferred.start, end: inferred.end });   // 不写盘
      if (cHint) {
        cHint.innerHTML = '📌 已根据前置排班最后一天 <b>' + esc(inferred.lastDraftDate) +
          '</b> 自动推断周期：<b>' + esc(inferred.start) + ' ~ ' + esc(inferred.end) +
          '</b>（手动修改后即锁定）';
      }
    } else if (S.latestDate) {
      scSetCycle({ start: S.latestDate, end: dateAdd(S.latestDate, 6) });
      if (cHint) {
        cHint.innerHTML = '📌 已回退使用最新数据日期 <b>' + esc(S.latestDate) +
          '</b> 作为周期起始日（手动修改后即锁定）';
      }
    }
    c = scGetCycle();
  } else if (cHint) {
    cHint.innerHTML = S.scCycleLocked
      ? '🔒 排班周期已锁定（手动设置过），点「🎯 自动识别」重算或点「🔓 解锁」恢复自动识别。'
      : '';
  }
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (document.activeElement === el) return;   /* 正在输入 → 不覆盖，避免打断焦点 */
    if (v) el.value = v;
  };
  set('scCycleStart', c.start);
  set('scCycleEnd',   c.end);

  ['scCycleStart','scCycleEnd'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el._scBound) {
      el._scBound = true;
      const handler = () => {
        const s = (document.getElementById('scCycleStart') || {}).value || '';
        const e = (document.getElementById('scCycleEnd')   || {}).value || '';
        /* ★ 用户手动改动 → 立即锁定（刷新页面也不会被自动推断覆盖） */
        scSetCycle({ start: s, end: e }, { locked: true });
        console.log('[排班] 周期已保存（已锁定）→', s, '~', e);
        renderSchedulePanel();
      };
      el.addEventListener('input',  handler);
      el.addEventListener('change', handler);
    }
  });

  /* ★ 「🎯 自动识别」：从前置排班最后一天重算周期 */
  const btnInfer = document.getElementById('scCycleInfer');
  if (btnInfer && !btnInfer._scBound) {
    btnInfer._scBound = true;
    btnInfer.addEventListener('click', () => {
      const inferred = (typeof scInferCycleFromDraft === 'function')
        ? scInferCycleFromDraft() : null;
      if (!inferred) { toast('未找到前置排班记录，无法推断'); return; }
      /* ★ 用户主动要求重算 → 直接覆盖并保持锁定 */
      scSetCycle({ start: inferred.start, end: inferred.end }, { locked: true });
      toast('🎯 已识别：' + inferred.start + ' ~ ' + inferred.end + '（已锁定）');
      renderSchedulePanel();
    });
  }

  /* ★ 「🔓 解锁」：清除锁定 + 清空周期 → 下一帧触发自动推断 */
  const btnUnlock = document.getElementById('scCycleUnlock');
  if (btnUnlock && !btnUnlock._scBound) {
    btnUnlock._scBound = true;
    btnUnlock.addEventListener('click', () => {
      if (!confirm('解锁后将清除当前周期，并恢复基于前置排班的自动识别。继续？')) return;
      S.scCycleLocked = false;
      S.scheduleCycle = { start: '', end: '', reqStart: '', reqEnd: '' };
      try { localStorage.removeItem('creator_sc_cycle'); } catch (_) {}
      toast('🔓 已解锁，恢复自动识别');
      renderSchedulePanel();
    });
  }


  /* CPH 尚未计算时先算一遍，便于预览与手动覆盖 */
  if ((!S.employeeCPH || !Object.keys(S.employeeCPH).length) && (S.records || []).length) {
    try { calcAllEmployeeCPH(); } catch (_) {}
  }

  /* ★ 子 Tab 切换绑定 */
  (function bindScSubTabs() {
    const tabs = document.getElementById('scSubTabs');
    if (!tabs || tabs._scBound) return;
    tabs._scBound = true;
    tabs.addEventListener('click', e => {
      const btn = e.target.closest('.sub-tab');
      if (!btn) return;
      const sub = btn.dataset.sub;
      document.querySelectorAll('#scSubTabs .sub-tab').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('#view-schedule .sub-view').forEach(v => v.classList.remove('active'));
      const target = document.getElementById('scSub-' + sub);
      if (target) target.classList.add('active');
      if (sub === 'coverage' && typeof renderScCoverageDaily === 'function') renderScCoverageDaily();
    });
  })();

  /* ★ 排班表工具栏（隐藏统计列 / 折叠历史列） */
  (function bindGridTools() {
    const hideBtn = document.getElementById('scToggleStats');
    const histBtn = document.getElementById('scToggleHistory');
    if (hideBtn && !hideBtn._bound) {
      hideBtn._bound = true;
      hideBtn.addEventListener('click', () => {
        S.scShowStats = !S.scShowStats;
        hideBtn.textContent = S.scShowStats ? '👁 隐藏统计列' : '👁 显示统计列';
        renderScGrid();
      });
      hideBtn.textContent = S.scShowStats ? '👁 隐藏统计列' : '👁 显示统计列';
    }
    if (histBtn && !histBtn._bound) {
      histBtn._bound = true;
      histBtn.addEventListener('click', () => {
        S.scCollapseHist = !S.scCollapseHist;
        histBtn.textContent = S.scCollapseHist ? '📦 展开历史列' : '📦 折叠历史列';
        renderScGrid();
      });
      histBtn.textContent = S.scCollapseHist ? '📦 展开历史列' : '📦 折叠历史列';
    }
  })();

  renderScShiftPool();
  renderScReqGrid();
  renderScCphGrid();
  renderScReqList();
  renderScCoverage();
  renderScDiag();
  if (typeof renderScCoverageDaily === 'function') renderScCoverageDaily();

  renderScTripleGrid();
  renderScRulesTable();
  renderScGrid();
}

function renderScShiftPool() {
  const el = document.getElementById('scShiftPool');
  if (!el) return;
  const all = Object.keys(S.shiftMeta || {});
  const workingShifts = all.filter(s => !scIsRestShift(s) && !scIsLeaveShift(s));
  el.innerHTML = workingShifts.map(s =>
    '<span class="chip' + ((S.shiftPool || []).indexOf(s) >= 0 ? ' on' : '') + '" data-shift="' + esc(s) + '">' + esc(s) + '</span>'
  ).join('');
  el.querySelectorAll('.chip').forEach(ch => {
    ch.addEventListener('click', () => {
      const s = ch.dataset.shift;
      const i = S.shiftPool.indexOf(s);
      if (i >= 0) S.shiftPool.splice(i, 1); else S.shiftPool.push(s);
      renderScShiftPool();
      renderScReqGrid();
    });
  });
}

function renderScReqGrid() {
  const tabs = document.getElementById('scReqTabs');
  const el = document.getElementById('scReqGrid');
  if (!el) return;
  /* 业务线切换按钮（骨架中的 #scReqBiz 由这里替代） */
  if (tabs) {
    tabs.innerHTML = SC_BIZ_LIST.map(b =>
      '<button class="btn sm' + (b === scReqBizState ? ' primary' : '') + '" data-biz="' + esc(b) + '">' + esc(b) + '</button>'
    ).join('');
    tabs.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => { scReqBizState = btn.dataset.biz; renderScReqGrid(); });
    });
  }
  const biz = scReqBizState;
  if (!(S.shiftPool || []).length) { el.innerHTML = '<p class="muted">请先在上方选择可用班次。</p>'; return; }
  const header = '<tr><th>班次</th><th>工作日需求</th><th>周末需求</th></tr>';
  const rows = S.shiftPool.map(s => {
    const r = (S.shiftReqs[biz] && S.shiftReqs[biz][s]) || {};
    return '<tr>' +
      '<td>' + esc(s) + '</td>' +
      '<td><input type="number" min="0" data-shift="' + esc(s) + '" data-kind="weekday" value="' + (r.weekday == null ? '' : r.weekday) + '"></td>' +
      '<td><input type="number" min="0" data-shift="' + esc(s) + '" data-kind="weekend" value="' + (r.weekend == null ? '' : r.weekend) + '"></td>' +
    '</tr>';
  }).join('');
  el.innerHTML = '<table>' + header + rows + '</table>';
  el.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      scSetShiftReq(biz, inp.dataset.shift, inp.dataset.kind, inp.value);
    });
  });
}

function renderScCphGrid() {
  const el = document.getElementById('scCphGrid');
  if (!el) return;
  const emps = scActiveEmployees();
  if (!emps.length) { el.innerHTML = '<p class="muted">无可用员工。</p>'; return; }

  /* 周期内每一天 */
  const c = scGetCycle();
  let dates = scDatesBetween(c.start, c.end);
  if (!dates.length && S.scheduleDraft.length) {
    dates = Array.from(new Set(S.scheduleDraft.map(d => d.date))).sort();
  }

  const bizTag = (e) => {
    const b = String(e.biz || '');
    if (/买手/.test(b) && !/博主/.test(b)) return { text: '买手', color: '#7B8FBF' };
    if (/博主/.test(b) && !/买手/.test(b)) return { text: '博主', color: '#C4B0CE' };
    return { text: '弹性', color: '#A0A0AE' };
  };
  const pick = (obj, name) => {
    const cc = (obj || {})[name] || {};
    for (const h of SC_HOURS) if (cc[h] > 0) return cc[h];
    return 0;
  };
  const isOverridden = (name) => {
    const auto = pick(S.employeeCPHAuto, name);
    const cur  = pick(S.employeeCPH, name);
    return Math.abs(auto - cur) > 1e-6;
  };

  /* ★ 顺序与 scActiveEmployees() 保持一致（= 排班草稿表格中的员工行顺序） */

  /* 表头 */
  let html = '<table><thead><tr>' +
    '<th style="width:56px;text-align:center">业务线</th>' +
    '<th style="min-width:110px">姓名</th>' +
    '<th style="width:86px;text-align:right">P90 生效值</th>';
  for (const d of dates) {
    const wd = new Date(d + 'T00:00:00Z').getUTCDay();
    const cls = classifyDate(d);
    const color = cls === 'holiday' ? '#D9363E' : (cls === 'workday' ? '#C75C5C' : '#333');
    html += '<th style="width:74px;text-align:center;font-size:11.5px;color:' + color + '">' +
      parseInt(d.slice(5,7),10) + '月' + parseInt(d.slice(8,10),10) + '日' +
      '<div style="font-size:10px;color:#A0A0AE;font-weight:400">周' + WEEKDAY_CN[wd] + '</div>' +
    '</th>';
  }
  html += '<th style="width:70px;text-align:center">操作</th></tr></thead><tbody>';

  for (const e of emps) {
    const tag = bizTag(e);
    const auto = pick(S.employeeCPHAuto, e.name);
    const cur  = pick(S.employeeCPH, e.name);
    const ov   = isOverridden(e.name);
    const autoDisp = auto > 0 ? auto.toFixed(2) : '';
    const curVal   = cur > 0 ? cur.toFixed(2) : '';
    const daily = (S.employeeCPHDaily || {})[e.name] || {};

    html += '<tr>' +
      '<td style="text-align:center">' +
        '<span style="display:inline-block;padding:1px 6px;font-size:10.5px;' +
          'border-radius:4px;color:#fff;background:' + tag.color + '">' + tag.text + '</span>' +
      '</td>' +
      '<td>' +
        esc(e.name) +
        (ov ? ' <span style="color:#E8A33E;font-size:11px">✎</span>' : '') +
      '</td>' +
      '<td style="text-align:right">' +
        '<input type="number" min="0" step="0.1" style="width:70px;text-align:right"' +
        ' data-name="' + esc(e.name) + '" value="' + curVal + '" placeholder="' + autoDisp + '"' +
        ' title="生效值（排班算法使用）：留空 = 自动值 = 日 CPD 前三均值 / 8；手动填写后持久保存">' +
      '</td>';
    for (const d of dates) {
      const v = daily[d];
      const txt = (v > 0) ? v.toFixed(2) : '—';
      const color = (v > 0) ? '#333' : '#C0BDB5';
      html += '<td style="text-align:center;color:' + color +
              ';font-variant-numeric:tabular-nums">' + txt + '</td>';
    }
    html += '<td style="text-align:center">' +
      '<button type="button" class="btn sm" data-reset="' + esc(e.name) + '"' +
      (ov ? '' : ' disabled') + ' style="padding:2px 8px;font-size:11px">恢复</button>' +
    '</td></tr>';
  }
  html += '</tbody></table>';
  el.innerHTML = '<p class="muted" style="font-size:11.5px;margin:0 0 6px">' +
    '<span style="font-weight:400;font-size:11px;color:#77778A">' +
    '日 CPH = 当日 CASE / 8；自动 CPH = 日 CPD 最高三天求平均后 / 8（无记录则用同组同事均值兜底）</span>' +
  '</p>' + html;

  /* 手改生效值 → 持久化到 localStorage */
  el.querySelectorAll('input[data-name]').forEach(inp => {
    inp.addEventListener('change', () => {
      const n = inp.dataset.name;
      const v = parseFloat(inp.value);
      const manual = scLoadCphManual();
      if (!S.employeeCPH[n]) S.employeeCPH[n] = {};

      if (isNaN(v) || v <= 0) {
        /* 清空输入框 = 撤销手动值 → 用自动值 */
        delete manual[n];
        scSaveCphManual(manual);
        const auto = pick(S.employeeCPHAuto, n);
        for (const h of SC_HOURS) S.employeeCPH[n][h] = auto;
      } else {
        /* 手动值生效 + 写盘 */
        manual[n] = v;
        scSaveCphManual(manual);
        for (const h of SC_HOURS) S.employeeCPH[n][h] = v;
      }
      renderScCphGrid();
    });
  });
  /* 恢复自动 → 同时删除手动值 */
  el.querySelectorAll('button[data-reset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = btn.dataset.reset;
      const manual = scLoadCphManual();
      delete manual[n];
      scSaveCphManual(manual);
      const auto = pick(S.employeeCPHAuto, n);
      if (!S.employeeCPH[n]) S.employeeCPH[n] = {};
      for (const h of SC_HOURS) S.employeeCPH[n][h] = auto;
      renderScCphGrid();
    });
  });
}

function renderScReqList() {
  const el = document.getElementById('scReqList');
  if (!el) return;
  const emps = (S.scheduleDraft || []).filter(d => d.requestText).map(d => d.name).filter((v, i, a) => a.indexOf(v) === i);
  if (!emps.length) { el.innerHTML = '<p class="muted">未检测到员工诉求（需导入「排班草稿及诉求」sheet）。</p>'; return; }
  const rows = emps.map(n => {
    const parsed = (S.parsedRequests && S.parsedRequests[n] && S.parsedRequests[n].items) || [];
    const err = (S.parsedRequests && S.parsedRequests[n] && S.parsedRequests[n].error) || '';
    const raw = ((S.scheduleDraft || []).find(d => d.name === n) || {}).requestText || '';
    const parsedStr = parsed.length
      ? parsed.map(it => '[' + esc(it.type) + '] ' + esc(it.target_shift || (it.target_shifts && it.target_shifts.join(',')) || it.target_person || '')).join('； ')
      : '<span class="muted">' + esc(err || '未解析（点击上方按钮）') + '</span>';
    return '<tr><td>' + esc(n) + '</td><td>' + esc(raw) + '</td><td>' + parsedStr + '</td></tr>';
  }).join('');
  el.innerHTML = '<table><tr><th>姓名</th><th>原始诉求</th><th>AI 解析</th></tr>' + rows + '</table>';
  const btn = document.getElementById('btnScParseReq');
  if (btn && !btn._scBound) {
    btn._scBound = true;
    btn.addEventListener('click', async () => {
      if (typeof parseScheduleRequests !== 'function') { toast('AI 模块未就绪'); return; }
      btn.disabled = true;
      try {
        await parseScheduleRequests();
      } finally {
        btn.disabled = false;
        renderScReqList();
      }
    });
  }
}

/* ==================== 排班表（前置 + 新排 + 统计） ==================== */
/* 渲染前置+新排的统一表格 */
function renderScGrid() {
  const tbl = document.getElementById('scGridTable');
  if (!tbl) return;

  /* 日期范围：默认 = 展示范围（min(起始日-7, 起始月1号) ~ 结束日）；
     可选折叠历史（周期起始日前不显示）。
     注意：这里用 scDisplayDateRange 而非 scDatesBetween，
     后者被生成/导出/复制复用，必须是真实周期。 */
  const c = scGetCycle();
  let dates = scDisplayDateRange(c).dates;
  if (!dates.length && S.scheduleDraft.length) {
    /* 兜底：用草稿里所有日期 */
    const set = new Set(S.scheduleDraft.map(d => d.date));
    dates = Array.from(set).sort();
  }

  /* 折叠历史：只显示起点之后的日期 */
  if (S.scCollapseHist) {
    const start = c.start || dates[0];
    dates = dates.filter(d => d >= start);
  }

  /* 员工列表（参与排班的） */
  const emps = scActiveEmployees();
  if (!emps.length) {
    tbl.innerHTML = '<tbody><tr><td class="muted">无可排班员工</td></tr></tbody>';
    return;
  }

  /* 前置排班 map：name → date → shift（含诉求 leave_on 自动补「休」） */
  const draftMap = {};
  for (const d of S.scheduleDraft) {
    if (!draftMap[d.name]) draftMap[d.name] = {};
    draftMap[d.name][d.date] = d.shift;
  }
  /* ★ 补充：员工诉求 leave_on 的日期若草稿未填，也视作「休」显示 */
  if (S.parsedRequests) {
    for (const n in S.parsedRequests) {
      const items = (S.parsedRequests[n] || {}).items || [];
      for (const it of items) {
        if (it.type !== 'leave_on' || !Array.isArray(it.dates)) continue;
        if (!draftMap[n]) draftMap[n] = {};
        for (const dt of it.dates) {
          if (!draftMap[n][dt]) draftMap[n][dt] = scDefaultRestShift();
        }
      }
    }
  }
  /* 前置集合：用于加左侧竖条 */
  const preSet = new Set(S.scheduleDraft.filter(d => d.shift).map(d => d.name + '|' + d.date));

  /* 当前状态是否有排班结果（生成后用这个覆盖前置） */
  const resultMap = {};
  for (const r of (S.scheduleResult || [])) {
    if (!resultMap[r.name]) resultMap[r.name] = {};
    resultMap[r.name][r.date] = r.shift;
  }

  /* ===== 表头（业务线 + 员工 + 可休/已休/未休 + 日期列） ===== */
  const statCols = ['可休', '已休', '未休'];

  let headTop = '<tr>' +
    '<th>业务线</th>' +
    '<th>员工</th>' +
    statCols.map(s => '<th class="sc-stat">' + s + '</th>').join('');
  for (const d of dates) {
    const wd = new Date(d + 'T00:00:00Z').getUTCDay();
    const cls = classifyDate(d);
    const clsCss = cls === 'holiday' ? 'is-holiday' : (cls === 'workday' ? 'is-workday' : '');
    const isTriple = S.scTripleDates.has(d);
    const tag = isTriple ? '三倍' : (cls === 'holiday' ? '节' : (cls === 'workday' ? '班' : ''));
    headTop += '<th class="sc-date-h ' + clsCss + '">' +
      '<span class="d">' + esc(d.slice(5)) + '</span>' +
      '<span class="w">周' + WEEKDAY_CN[wd] + '</span>' +
      (tag ? '<span class="tag">' + tag + '</span>' : '') +
    '</th>';
  }
  headTop += '</tr>';

  /* ===== 表身 ===== */
  /* ★ 业务线 tag（与 renderScCphGrid 保持一致的配色） */
  const scBizTagOf = (e) => {
    const b = String(e.biz || '');
    if (/买手/.test(b) && !/博主/.test(b)) return { text: '买手', color: '#7B8FBF' };
    if (/博主/.test(b) && !/买手/.test(b)) return { text: '博主', color: '#C4B0CE' };
    return { text: '弹性', color: '#A0A0AE' };
  };

  const bodyRows = emps.map((e, ri) => {
    const st = scHolidayStat(e.name);
    const tag = scBizTagOf(e);

    /* ★ 业务线列 */
    const bizTd =
      '<td style="text-align:center">' +
        '<span style="display:inline-block;padding:1px 6px;font-size:10.5px;' +
          'border-radius:4px;color:#fff;background:' + tag.color + '">' +
          tag.text +
        '</span>' +
      '</td>';

    /* ★ 可休列：主值 + 红字小字（tripleDays > 0 时显示） */
    const tripleTxt = (st.tripleDays > 0)
      ? '<div style="color:#D9363E;font-size:10px;font-weight:600;' +
          'line-height:1.15;margin-top:1px">（' + st.tripleDays + '）</div>'
      : '';
    const statTds = [
      '<td class="sc-stat">' +
        '<div>' + (st.total == null ? '—' : st.total) + '</div>' +
        tripleTxt +
      '</td>',
      '<td class="sc-stat">' + st.used.toFixed(2).replace(/\.00$/, '') + '</td>',
      '<td class="sc-stat">' + (st.remain == null ? '—' : st.remain.toFixed(2).replace(/\.00$/, '')) + '</td>',
    ].join('');

    const dayTds = dates.map((d, ci) => {
      const s = (resultMap[e.name] && resultMap[e.name][d]) ||
                (draftMap[e.name]  && draftMap[e.name][d])   || '';
      const meta = s ? S.shiftMeta[s] : null;

      /* ★ 员工休假需求判定（必须同时满足两个条件）：
         条件 1：日期 d 必须在排班周期内（start ≤ d ≤ end）
         条件 2：以下任一来源命中：
                 · 草稿里明确写的非工作班次（休 / 放休 / 事假 / 病假 / 丧假 / 婚假等）
                 · AI 诉求解析出的 leave_on 日期
         只有「周期内 + 命中来源」才判定为员工休假需求（绿色）；
         周期外的休（已完成的前置排班）→ 橙色；
         其它非工作班次（算法补的休 / 事假 / 病假 / 放休等）→ 橙色；
         工作班次 → 保留班次自身颜色。 */

      const cycle = (typeof scGetCycle === 'function') ? scGetCycle() : (S.scheduleCycle || {});
      const inCycle = !!(cycle && cycle.start && cycle.end
                     && d >= cycle.start && d <= cycle.end);

      const draftShift = (draftMap[e.name] && draftMap[e.name][d]) || '';
      const draftMeta = draftShift ? S.shiftMeta[draftShift] : null;
      const isDraftLeave = !!(draftShift && draftMeta && !draftMeta.isWorking);
      const isAILeave = !!(s && isLeaveRequest(e.name, d));
      const isLeaveReq = inCycle && (isDraftLeave || isAILeave);

      /* 单元格底色优先级：
         1）周期内 + 员工诉求 → 绿色
         2）其它休息类班次（非工作班次）→ 橙色
         3）工作班次 → 班次原色 */
      let bg;
      if (isLeaveReq) {
        bg = SC_COLOR_LEAVE_REQ;
      } else if (inCycle && meta && !meta.isWorking) {
        bg = SC_COLOR_REST_ALGO;
      } else {
        bg = (meta && meta.color) || '';
      }
      const isPre = preSet.has(e.name + '|' + d);
      const style = bg ? ' style="background:' + bg + '"' : '';
      const cls = 'sc-grid-cell' + (isPre ? ' pre' : '') + (s ? '' : ' empty');
      return '<td class="' + cls + '"' + style +
             ' data-r="' + ri + '" data-c="' + ci + '" data-name="' + esc(e.name) + '" data-date="' + d + '">' +
             (s ? esc(s) : '') + '</td>';
    }).join('');

    return '<tr>' + bizTd + '<td>' + esc(e.name) + '</td>' + statTds + dayTds + '</tr>';
  }).join('');

  tbl.innerHTML = '<thead>' + headTop + '</thead><tbody>' + bodyRows + '</tbody>';

  /* 应用 "隐藏统计列" 状态 */
  if (!S.scShowStats) {
    tbl.querySelectorAll('.sc-stat').forEach(el => el.classList.add('hide'));
  }

  bindScGridEvents(tbl, emps, dates);
}

/* 拖拽是否移动过（用于抑制拖拽结束后的 click 弹窗） */
let scDragMoved = false;

function bindScGridEvents(tbl, emps, dates) {
  /* 清理上一次渲染遗留的监听，避免重复叠加 */
  if (tbl._scCopy)    document.removeEventListener('copy', tbl._scCopy);
  if (tbl._scPaste)   document.removeEventListener('paste', tbl._scPaste);
  if (tbl._scKey)     tbl.removeEventListener('keydown', tbl._scKey);
  if (tbl._scMouseUp) document.removeEventListener('mouseup', tbl._scMouseUp);

  const cells = tbl.querySelectorAll('.sc-grid-cell');
  tbl.tabIndex = 0;

  /* 单击 → 弹出班次选择（简版：prompt） */
  cells.forEach(td => {
    td.addEventListener('click', () => {
      if (scDragMoved) { scDragMoved = false; return; }
      const cur = td.textContent.trim();
      const next = prompt(
        '输入班次（留空 = 清空）\n' +
        '可选：' + Object.keys(S.shiftMeta).join(' / '),
        cur
      );
      if (next == null) return;
      scSetCell(td.dataset.name, td.dataset.date, next.trim());
      renderScGrid();
      const t = document.getElementById('scGridTable');
      if (t) { try { t.focus({ preventScroll: true }); } catch (_) { t.focus(); } }
    });
  });

  /* 拖拽框选 */
  let dragging = false, startR = -1, startC = -1;
  cells.forEach(td => {
    td.addEventListener('mousedown', e => {
      if (e.shiftKey || e.ctrlKey || e.metaKey) return;
      dragging = true;
      scDragMoved = false;
      startR = +td.dataset.r;
      startC = +td.dataset.c;
      clearSel(tbl);
      td.classList.add('sel');
      try { tbl.focus({ preventScroll: true }); } catch (_) { tbl.focus(); }
      e.preventDefault();
    });
    td.addEventListener('mouseenter', () => {
      if (!dragging) return;
      scDragMoved = true;
      const r = +td.dataset.r, c = +td.dataset.c;
      const r1 = Math.min(startR, r), r2 = Math.max(startR, r);
      const c1 = Math.min(startC, c), c2 = Math.max(startC, c);
      clearSel(tbl);
      cells.forEach(x => {
        const xr = +x.dataset.r, xc = +x.dataset.c;
        if (xr >= r1 && xr <= r2 && xc >= c1 && xc <= c2) x.classList.add('sel');
      });
    });
  });
  const up = () => { dragging = false; };
  document.addEventListener('mouseup', up);
  tbl._scMouseUp = up;

  /* Ctrl+A / Esc */
  const keyHandler = e => {
    if (e.key === 'Escape') clearSel(tbl);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      cells.forEach(x => x.classList.add('sel'));
    }
  };
  tbl.addEventListener('keydown', keyHandler);
  tbl._scKey = keyHandler;

  /* Ctrl+C / Ctrl+V —— 用 clipboard 事件挂在 document 上，只在表格聚焦时生效 */
  const copyHandler = e => {
    const sel = tbl.querySelectorAll('.sc-grid-cell.sel');
    if (!sel.length || !tbl.contains(document.activeElement)) return;
    const txt = Array.from(sel).map(td => td.textContent.trim()).join('\t');
    e.clipboardData.setData('text/plain', txt);
    e.preventDefault();
  };
  const pasteHandler = e => {
    const sel = tbl.querySelectorAll('.sc-grid-cell.sel');
    if (!sel.length || !tbl.contains(document.activeElement)) return;
    const txt = e.clipboardData.getData('text/plain');
    if (!txt) return;
    const lines = txt.split(/\r?\n/).filter(x => x);
    /* 单值 → 填满选区；多值 → 按行列铺 */
    if (lines.length === 1 && lines[0].indexOf('\t') < 0) {
      const v = lines[0].trim();
      sel.forEach(td => scSetCell(td.dataset.name, td.dataset.date, v));
    } else {
      const grid = lines.map(l => l.split('\t').map(x => x.trim()));
      const rows = {}, cols = {};
      sel.forEach(td => { rows[td.dataset.r] = 1; cols[td.dataset.c] = 1; });
      const rs = Object.keys(rows).map(Number).sort((a, b) => a - b);
      const cs = Object.keys(cols).map(Number).sort((a, b) => a - b);
      for (let i = 0; i < rs.length && i < grid.length; i++) {
        for (let j = 0; j < cs.length && j < grid[i].length; j++) {
          const td = tbl.querySelector('.sc-grid-cell[data-r="' + rs[i] + '"][data-c="' + cs[j] + '"]');
          if (td) scSetCell(td.dataset.name, td.dataset.date, grid[i][j]);
        }
      }
    }
    e.preventDefault();
    renderScGrid();
  };
  document.addEventListener('copy',  copyHandler);
  document.addEventListener('paste', pasteHandler);
  tbl._scCopy = copyHandler;
  tbl._scPaste = pasteHandler;
}

function clearSel(tbl) {
  tbl.querySelectorAll('.sc-grid-cell.sel').forEach(x => x.classList.remove('sel'));
}

/* 写入某员工某天的班次（同时更新 S.scheduleDraft / S.scheduleResult） */
function scSetCell(name, date, shift) {
  let rec = S.scheduleDraft.find(x => x.name === name && x.date === date);
  if (!rec) {
    if (!shift) return;
    S.scheduleDraft.push({ name, date, shift, requestText: '' });
  } else {
    if (!shift) { S.scheduleDraft = S.scheduleDraft.filter(x => x !== rec); return; }
    rec.shift = shift;
  }
  /* 同时更新 scheduleResult（若已生成） */
  let rr = (S.scheduleResult || []).find(x => x.name === name && x.date === date);
  if (rr) rr.shift = shift;
  else if (shift) (S.scheduleResult = S.scheduleResult || []).push({ date, name, shift, biz: '' });
}

/* 该员工在 date 是否有明确日期的休假诉求（leave_on） */
function isLeaveRequest(name, date) {
  const req = (S.parsedRequests || {})[name];
  if (!req || !req.items) return false;
  for (const it of req.items) {
    if (it.type === 'leave_on' && Array.isArray(it.dates) && it.dates.indexOf(date) >= 0) return true;
  }
  return false;
}

/* ==================== 三倍日网格（整月显示） ==================== */
function renderScTripleGrid() {
  const el = document.getElementById('scTripleDates');
  if (!el) return;

  /* ★ 月份折叠状态：懒初始化 */
  if (!S.scTripleMonthOpen) {
    S.scTripleMonthOpen = new Set();
    /* 从 localStorage 恢复 */
    const rawLS = localStorage.getItem('creator_sc_triple_month_open');
    if (rawLS) {
      try {
        const saved = JSON.parse(rawLS);
        if (Array.isArray(saved)) {
          saved.forEach(m => S.scTripleMonthOpen.add(m));
          S.scTripleMonthOpen._hasSaved = true;  /* 有存档（哪怕存的是空数组=全折叠） */
        }
      } catch (_) {}
    }
    /* 首次无记录 → 默认全部展开（下面渲染时会自动补全当月） */
    if (!S.scTripleMonthOpen._hasSaved) S.scTripleMonthOpen._defaultAll = true;
  }
  const c = scGetCycle();
  if (!c.start || !c.end) {
    el.innerHTML = '<p class="muted">请先设置排班周期。</p>';
    return;
  }

  /* 1. 周期覆盖的所有月份 */
  const startMonth = c.start.slice(0, 7);
  const endMonth   = c.end.slice(0, 7);
  const months = [];
  let m = startMonth, guard = 0;
  while (m <= endMonth && guard++ < 24) {
    months.push(m);
    const [y, mo] = m.split('-').map(Number);
    const nextMo = mo === 12 ? 1 : mo + 1;
    const nextY  = mo === 12 ? y + 1 : y;
    m = nextY + '-' + String(nextMo).padStart(2, '0');
  }

  /* 2. 逐月渲染整月 */
  let html = '';
  let totalCount = 0;
  for (const mo of months) {
    const [y, mm] = mo.split('-').map(Number);
    const daysInMonth = new Date(y, mm, 0).getDate();
    totalCount += daysInMonth;

    /* 首次渲染默认全部展开 */
    if (S.scTripleMonthOpen._defaultAll) S.scTripleMonthOpen.add(mo);
    const open = S.scTripleMonthOpen.has(mo);

    /* 该月已勾选三倍日数 */
    let selCount = 0;
    for (let i = 1; i <= daysInMonth; i++) {
      const d = mo + '-' + String(i).padStart(2, '0');
      if (S.scTripleDates.has(d)) selCount++;
    }

    html += '<div class="sc-triple-month-block">';
    html += '<div class="sc-triple-month-title' + (open ? '' : ' collapsed') + '" data-month="' + esc(mo) + '">' +
      '<span class="arrow">▼</span>' +
      '<span>📅 ' + y + '年' + mm + '月</span>' +
      '<span class="meta">已选 ' + selCount + ' / ' + daysInMonth + ' 天</span>' +
    '</div>';
    html += '<div class="sc-triple-month' + (open ? '' : ' hidden') + '" data-month="' + esc(mo) + '">';
    for (let i = 1; i <= daysInMonth; i++) {
      const d = mo + '-' + String(i).padStart(2, '0');
      const wd = new Date(d + 'T00:00:00Z').getUTCDay();
      const cls = classifyDate(d);
      const on = S.scTripleDates.has(d);
      const clsCss = cls === 'holiday' ? 'is-holiday' : (cls === 'workday' ? 'is-workday' : '');
      /* ★ 三倍日优先显示「三倍」标签，其次才是国/班 */
      let tag = '';
      if (on) tag = '三倍';
      else if (cls === 'holiday') tag = '国';
      else if (cls === 'workday') tag = '班';
      html += '<button type="button" class="sc-triple-btn ' + clsCss + (on ? ' on' : '') +
        '" data-date="' + d + '">' +
        '<span class="d">' + esc(d.slice(5)) + '</span>' +
        '<span class="w">周' + WEEKDAY_CN[wd] + '</span>' +
        (tag ? '<span class="t">' + tag + '</span>' : '') +
      '</button>';
    }
    html += '</div></div>';
  }
  el.innerHTML = html;

  /* ★ 月份折叠绑定 */
  el.querySelectorAll('.sc-triple-month-title').forEach(head => {
    head.addEventListener('click', () => {
      const mo = head.dataset.month;
      if (S.scTripleMonthOpen.has(mo)) S.scTripleMonthOpen.delete(mo);
      else S.scTripleMonthOpen.add(mo);
      S.scTripleMonthOpen._defaultAll = false;
      /* 持久化 */
      try {
        localStorage.setItem('creator_sc_triple_month_open',
          JSON.stringify(Array.from(S.scTripleMonthOpen)));
      } catch (_) {}
      renderScTripleGrid();
    });
  });

  /* 3. 计数 */
  const cnt = document.getElementById('scTripleCount');
  const tot = document.getElementById('scTripleTotal');
  if (cnt) cnt.textContent = S.scTripleDates.size;
  if (tot) tot.textContent = totalCount;

  /* 4. 手动点选 */
  el.querySelectorAll('.sc-triple-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.dataset.date;
      if (S.scTripleDates.has(d)) S.scTripleDates.delete(d);
      else                         S.scTripleDates.add(d);
      scSaveRules();
      renderScTripleGrid();
      renderScGrid();
    });
  });

  /* 5. 首次渲染且节假日 API 未加载 → 主动拉一次再重绘 */
  if (typeof _cnHolidayVersion === 'string' && _cnHolidayVersion.indexOf('未加载') >= 0) {
    if (typeof initHolidayData === 'function') {
      initHolidayData()
        .then(() => { try { renderScTripleGrid(); } catch (_) {} })
        .catch(() => {});
    }
  }
}

/* 三倍日全选 / 清空 / 自动匹配 */
(function bindTripleTools() {
  const tools = document.querySelector('.sc-triple-tools');
  if (!tools || tools._bound) return;
  tools._bound = true;

  /* 计算周期覆盖的所有月份的所有日期 */
  const allMonthDates = () => {
    const c = scGetCycle();
    if (!c.start || !c.end) return [];
    const months = [];
    let m = c.start.slice(0, 7), guard = 0;
    const em = c.end.slice(0, 7);
    while (m <= em && guard++ < 24) {
      months.push(m);
      const [y, mo] = m.split('-').map(Number);
      const nextMo = mo === 12 ? 1 : mo + 1;
      const nextY  = mo === 12 ? y + 1 : y;
      m = nextY + '-' + String(nextMo).padStart(2, '0');
    }
    const out = [];
    for (const mo of months) {
      const [y, mm] = mo.split('-').map(Number);
      const days = new Date(y, mm, 0).getDate();
      for (let i = 1; i <= days; i++) {
        out.push(mo + '-' + String(i).padStart(2, '0'));
      }
    }
    return out;
  };

  tools.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const dates = allMonthDates();

    if (act === 'all') {
      dates.forEach(d => S.scTripleDates.add(d));
    } else if (act === 'none') {
      dates.forEach(d => S.scTripleDates.delete(d));
    } else if (act === 'auto') {
      /* 优先：timor.tech wage=3（真·三倍工资日） */
      if (typeof initTimorTripleDays === 'function') {
        try { await initTimorTripleDays(); } catch (_) {}
      }
      const beforeSize = S.scTripleDates.size;
      dates.forEach(d => S.scTripleDates.add(d));
      const added = S.scTripleDates.size - beforeSize;
      if (added > 0) {
        toast('🎆 已自动勾选 ' + added + ' 个三倍工资日（timor API）');
      } else {
        /* 兜底：holiday-cn */
        const map = getHolidayMap();
        let n = 0;
        dates.forEach(d => {
          if (map[d] === 'holiday' && !S.scTripleDates.has(d)) { S.scTripleDates.add(d); n++; }
        });
        toast('🎆 已自动勾选 ' + n + ' 个法定节假日（holiday-cn 兜底）');
      }
    }

    scSaveRules();
    renderScTripleGrid();
    renderScGrid();
  });
})();

/* ==================== 休假规则表 ==================== */
function renderScRulesTable() {
  const tbl = document.getElementById('scRulesTable');
  if (!tbl) return;
  const head = '<thead><tr>' +
    '<th style="width:80px">启用</th>' +
    '<th>三倍天数 = X</th>' +
    '<th>本月可休天数 Y</th>' +
    '<th style="width:100px">操作</th>' +
  '</tr></thead>';

  const body = S.scHolidayRules.map((r, i) =>
    '<tr data-i="' + i + '">' +
      '<td><input type="checkbox" data-k="enabled"' + (r.enabled ? ' checked' : '') + '></td>' +
      '<td><input type="number" data-k="triple" min="0" step="1" value="' + (r.triple ?? '') + '"></td>' +
      '<td><input type="number" data-k="rest"   min="0" step="1" value="' + (r.rest   ?? '') + '"></td>' +
      '<td><button type="button" class="btn-del">删除</button></td>' +
    '</tr>'
  ).join('');

  tbl.innerHTML = head + '<tbody>' + body + '</tbody>';

  tbl.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      const i = +inp.closest('tr').dataset.i;
      const k = inp.dataset.k;
      if (k === 'enabled') S.scHolidayRules[i][k] = inp.checked;
      else S.scHolidayRules[i][k] = inp.value === '' ? null : Number(inp.value);
      scSaveRules();
      renderScGrid();   /* 可休天数变化 → 表格跟着更新 */
    });
  });
  tbl.querySelectorAll('.btn-del').forEach(b => {
    b.addEventListener('click', () => {
      const i = +b.closest('tr').dataset.i;
      S.scHolidayRules.splice(i, 1);
      scSaveRules();
      renderScRulesTable();
      renderScGrid();
    });
  });
}

(function bindRulesAdd() {
  const run = () => {
    const btn = document.getElementById('scRulesAdd');
    if (!btn || btn._bound) return;
    btn._bound = true;
    btn.addEventListener('click', () => {
      S.scHolidayRules.push({ enabled: true, triple: 0, rest: 0 });
      scSaveRules();
      renderScRulesTable();
      renderScGrid();
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();

(function bindRulesReset() {
  const run = () => {
    const btn = document.getElementById('scRulesReset');
    if (!btn || btn._bound) return;
    btn._bound = true;
    btn.addEventListener('click', () => {
      if (!confirm('恢复默认休假规则？当前自定义规则将被清空。')) return;
      S.scHolidayRules = [
        { enabled: true, triple: 3, rest: 6 },
        { enabled: true, triple: 2, rest: 6 },
        { enabled: true, triple: 1, rest: 7 },
        { enabled: true, triple: 0, rest: 7 },
      ];
      scSaveRules();
      renderScRulesTable();
      renderScGrid();
      toast('已恢复默认休假规则');
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();

/* 规则持久化：三倍日勾选 + 休假规则 */
function scSaveRules() {
  try {
    localStorage.setItem('creator_sc_triple', JSON.stringify([...S.scTripleDates]));
    localStorage.setItem('creator_sc_rules', JSON.stringify(S.scHolidayRules));
  } catch (_) {}
}

/* 供需对比：①班次维度 需求 vs 实际；②时段维度 服务能力(Σ CPH×在岗) vs 预测量 */
function renderScCoverage() {
  const el = document.getElementById('scCoverage');
  if (!el) return;
  if (!(S.scheduleResult || []).length) { el.innerHTML = '<p class="muted">生成排班后显示供需对比。</p>'; return; }
  const c = scGetCycle();
  const dates = scDatesBetween(c.start, c.end);
  if (!dates.length) { el.innerHTML = '<p class="muted">排班周期无效。</p>'; return; }

  const bizRows = [];
  for (const biz of SC_BIZ_LIST) {
    for (const shift of S.shiftPool) {
      for (const d of dates) {
        const need = scGetShiftReq(biz, shift, d);
        if (need == null) continue;
        let actual = 0;
        for (const r of S.scheduleResult) {
          if (r.date === d && r.shift === shift && r.biz === biz) actual++;
        }
        if (need > 0 || actual > 0) {
          bizRows.push('<tr' + (actual < need ? ' class="sc-short"' : '') + '><td>' + esc(d.slice(5)) + '</td><td>' + esc(biz) + '</td><td>' + esc(shift) + '</td><td>' + need + '</td><td>' + actual + '</td></tr>');
        }
      }
    }
  }
  const t1 = '<h3 class="sub-title">班次人数：需求 vs 实际</h3><table><tr><th>日期</th><th>业务线</th><th>班次</th><th>需求</th><th>实际</th></tr>' +
    (bizRows.length ? bizRows.join('') : '<tr><td colspan="5" class="muted">无需求设置</td></tr>') + '</table>';

  const head2 = '<tr><th>日期 / 业务</th>' + SC_HOURS.map(h => '<th>' + h + '时</th>').join('') + '</tr>';
  const rows2 = [];
  for (const biz of SC_BIZ_LIST) {
    const demand = scComputeDemandTable(biz, dates);
    for (const d of dates) {
      const cap = {};
      for (const r of S.scheduleResult) {
        if (r.date !== d || r.biz !== biz) continue;
        const mins = (S.shiftPeriods || {})[r.shift] || {};
        const cph = (S.employeeCPH || {})[r.name] || {};
        for (const h in mins) {
          if (mins[h] > 0 && cph[h]) cap[h] = (cap[h] || 0) + cph[h];
        }
      }
      const cells = SC_HOURS.map(h => {
        const need = Math.round((demand[d] && demand[d][h]) || 0);
        const got = Math.round(cap[h] || 0);
        const bad = need > 0 && got < need;
        return '<td' + (bad ? ' class="sc-short"' : '') + '>' + got + ' / ' + (need || '—') + '</td>';
      });
      rows2.push('<tr><td>' + esc(d.slice(5)) + ' ' + esc(biz.slice(0, 2)) + '</td>' + cells.join('') + '</tr>');
    }
  }
  const t2 = '<h3 class="sub-title">时段服务能力 / 预测量（红色 = H6 不达标）</h3><table>' + head2 + rows2.join('') + '</table>';
  el.innerHTML = t1 + t2;
}

function renderScDiag() {
  const el = document.getElementById('scDiag');
  if (!el) return;
  const diag = S.scheduleDiag || {};
  if (!diag.dateCount) { el.textContent = ''; return; }
  const lines = ['排班范围 ' + diag.dateCount + ' 天 / 员工 ' + diag.employeeCount + ' 人 / 排班记录 ' + diag.totalSlots + ' 条'];
  if (diag.warnings && diag.warnings.length) {
    lines.push('⚠ 诊断：' + diag.warnings.join('；'));
  } else {
    lines.push('✓ 无硬约束告警');
  }
  el.textContent = lines.join('　|　');
}

/* ==================== 导出 ==================== */
function scResultMatrix() {
  const c = scGetCycle();
  const dates = scDatesBetween(c.start, c.end);
  const map = {};
  for (const r of S.scheduleResult) {
    if (!map[r.name]) map[r.name] = {};
    map[r.name][r.date] = r.shift;
  }
  return { dates, map, emps: scActiveEmployees() };
}

function scheduleToMarkdown() {
  const { dates, map, emps } = scResultMatrix();
  if (!dates.length || !emps.length) return '';
  const lines = [];
  lines.push('# 🧠 智能排班结果（' + dates[0] + ' ~ ' + dates[dates.length - 1] + '）');
  lines.push('');
  lines.push('| 姓名 | ' + dates.map(d => d.slice(5)).join(' | ') + ' |');
  lines.push('| --- |' + dates.map(() => ' ---: |').join(''));
  for (const e of emps) {
    const m = map[e.name] || {};
    lines.push('| ' + e.name + ' | ' + dates.map(d => m[d] || '—').join(' | ') + ' |');
  }
  const diag = S.scheduleDiag || {};
  if (diag.warnings && diag.warnings.length) {
    lines.push('');
    lines.push('## ⚠ 诊断');
    for (const w of diag.warnings) lines.push('- ' + w);
  }
  lines.push('');
  return lines.join('\n');
}

function scDownloadBlob(blob, fname) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function scExportXlsx() {
  if (!(S.scheduleResult || []).length) { toast('请先生成排班'); return; }
  const c = scGetCycle();
  const dates = scDatesBetween(c.start, c.end);
  const { map, emps } = scResultMatrix();
  const fname = '智能排班-' + dates[0] + '_' + dates[dates.length - 1];
  /* sheet1 排班表（行=员工，列=日期） */
  const rows1 = [[{ v: '姓名', t: 's', s: 1 }]];
  for (const d of dates) rows1[0].push({ v: d.slice(5), t: 's', s: 1 });
  for (const e of emps) {
    const m = map[e.name] || {};
    const row = [{ v: e.name, t: 's', s: 0 }];
    for (const d of dates) row.push({ v: m[d] || '', t: 's', s: 0 });
    rows1.push(row);
  }
  scDownloadBlob(buildXlsxBlob('排班表', rows1, {}), fname + '-排班表.xlsx');
  /* sheet2 供需对比（班次需求 vs 实际明细） */
  const rows2 = [[
    { v: '日期', t: 's', s: 1 }, { v: '业务线', t: 's', s: 1 },
    { v: '班次', t: 's', s: 1 }, { v: '需求', t: 's', s: 1 }, { v: '实际', t: 's', s: 1 }
  ]];
  for (const biz of SC_BIZ_LIST) {
    for (const shift of S.shiftPool) {
      for (const d of dates) {
        const need = scGetShiftReq(biz, shift, d);
        if (need == null) continue;
        let actual = 0;
        for (const r of S.scheduleResult) if (r.date === d && r.shift === shift && r.biz === biz) actual++;
        if (need > 0 || actual > 0) {
          rows2.push([{ v: d, t: 's', s: 0 }, { v: biz, t: 's', s: 0 }, { v: shift, t: 's', s: 0 }, { v: need, t: 'n', s: 0 }, { v: actual, t: 'n', s: 0 }]);
        }
      }
    }
  }
  setTimeout(() => scDownloadBlob(buildXlsxBlob('供需对比', rows2, {}), fname + '-供需对比.xlsx'), 400);
  toast('已导出两个 XLSX（排班表 / 供需对比）');
}

async function scCopyMarkdown() {
  const md = scheduleToMarkdown();
  if (!md) { toast('请先生成排班'); return; }
  try {
    await navigator.clipboard.writeText(md);
    toast('✓ 已复制 Markdown');
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = md;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('✓ 已复制 Markdown'); } catch (_) { toast('复制失败，请手动选择'); }
    ta.remove();
  }
}

/* ==================== 按钮绑定 ==================== */
(function bindSchedulePanel() {
  const run = () => {
    const bind = (id, fn) => {
      const btn = document.getElementById(id);
      if (btn && !btn._scBound) { btn._scBound = true; btn.addEventListener('click', fn); }
    };
    bind('btnScRun', () => {
      try { generateSchedule(); renderSchedulePanel(); }
      catch (e) { console.error(e); toast('排班失败：' + e.message); }
    });
    bind('btnScExport', scExportXlsx);
    bind('btnScCopy', scCopyMarkdown);
    bind('btnScClear', () => {
      S.shiftPool = []; S.shiftReqs = {}; S.scheduleResult = [];
      S.parsedRequests = {}; S.scheduleDiag = {};
      renderSchedulePanel();
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();

/* ==================== 周期 / 班次池 / 需求 ==================== */
function scGetCycle() {
  return S.scheduleCycle || { start: '', end: '' };
}

/* ★ 周期 + 锁定状态持久化：只有「用户手动锁定 / 解锁」才写盘，
     纯自动推断不写 —— 这样用户改了导入数据后能自动跟上新周期。 */
function scPersistCycle() {
  try {
    localStorage.setItem('creator_sc_cycle', JSON.stringify({
      cycle:  S.scheduleCycle || {},
      locked: !!S.scCycleLocked
    }));
  } catch (_) {}
}
(function initScCycleStorage() {
  try {
    const raw = localStorage.getItem('creator_sc_cycle');
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return;
    if (obj.cycle) {
      S.scheduleCycle = Object.assign(
        { start: '', end: '', reqStart: '', reqEnd: '' }, obj.cycle
      );
    }
    S.scCycleLocked = !!obj.locked;
    console.log('[排班] 从本地恢复周期 →',
                S.scheduleCycle.start || '（空）',
                S.scheduleCycle.end   || '（空）',
                '，锁定 =', S.scCycleLocked);
  } catch (_) {}
})();

/* ★ 第二参数 opts.locked：
     · 省略        → 只更新内存值，不改锁定状态，也不写盘（自动推断用）
     · true/false  → 显式设置锁定状态，并写盘（用户操作时用） */
function scSetCycle(c, opts) {
  opts = opts || {};
  S.scheduleCycle = Object.assign({ start: '', end: '' }, c || {});
  if (opts.locked !== undefined) {
    S.scCycleLocked = !!opts.locked;
    scPersistCycle();
  }
}

/* 从前置排班草稿推断周期：
   起始 = 草稿里最后一个「工作班次」日期 + SC_CYCLE_START_OFFSET
   结束 = 起始 + 6（默认 7 天周期）

   ★ 只考虑工作班次——「休 / 请假 / 放休 / 事假 / 病假...」等非工作班次，
     很可能是员工为「新周期」提的休假诉求，不应该把边界推向未来。
     例：前置排班最后一天是 2026-10-11 → 周期起始日 = 2026-10-12。
     如果没有任何工作班次（比如草稿全是休），返回 null，交给上层兜底。 */
function scInferCycleFromDraft() {
  if (!S.scheduleDraft || !S.scheduleDraft.length) return null;
  let maxWorkDate = '';
  for (const d of S.scheduleDraft) {
    if (!d.shift || !d.date) continue;
    if (!scIsWorkingShift(d.shift)) continue;   // ← 关键：跳过「休 / 请假」
    if (d.date > maxWorkDate) maxWorkDate = d.date;
  }
  if (!maxWorkDate) return null;
  const start = dateAdd(maxWorkDate, SC_CYCLE_START_OFFSET);
  if (!start) return null;
  const end = dateAdd(start, 6);
  return { start, end, lastDraftDate: maxWorkDate };
}
function scSetShiftReq(biz, shift, kind, n) {
  if (!S.shiftReqs[biz]) S.shiftReqs[biz] = {};
  if (!S.shiftReqs[biz][shift]) S.shiftReqs[biz][shift] = { weekday: null, weekend: null };
  S.shiftReqs[biz][shift][kind] = (n === '' || n == null) ? null : Number(n);
}
function scGetShiftReq(biz, shift, date) {
  const r = S.shiftReqs[biz] && S.shiftReqs[biz][shift];
  if (!r) return null;
  return scIsWeekend(date) ? r.weekend : r.weekday;
}

/* ==================== 时段需求量（H6 用） ==================== */
/* 班次池所有班次的分钟分布 → 每小时权重（把日总量拆到小时） */
function scPoolHourWeights() {
  const w = {};
  for (const s of (S.shiftPool || [])) {
    const mins = (S.shiftPeriods || {})[s] || {};
    for (const h in mins) if (mins[h] > 0) w[h] = (w[h] || 0) + mins[h];
  }
  return w;
}

/* 预测量：优先 S.volumeForecast[biz][date]（按分钟权重拆到每小时），
   否则用该业务线近 30 天同星期几的历史逐时段均值兜底 */
function scComputeDemandTable(biz, dates) {
  const out = {};
  if (!dates.length) return out;
  const start = dates[0];
  const from = dateAdd(start, -30);
  const prof = {};   // weekday → hour → {sum, cnt}
  for (const r of S.records) {
    if (r.biz !== biz || !r.date || r.date >= start || r.date < from) continue;
    const p = normPeriod(r.period);
    if (!p) continue;
    const wd = scWeekdayOf(r.date);
    if (!prof[wd]) prof[wd] = {};
    if (!prof[wd][p]) prof[wd][p] = { sum: 0, cnt: 0 };
    prof[wd][p].sum += r.volume || 0;
    prof[wd][p].cnt++;
  }
  const weights = scPoolHourWeights();
  let wsum = 0;
  for (const h of SC_HOURS) wsum += weights[h] || 0;
  for (const d of dates) {
    const hours = {};
    const total = (S.volumeForecast[biz] || {})[d];
    if (total > 0 && wsum > 0) {
      for (const h of SC_HOURS) hours[h] = total * (weights[h] || 0) / wsum;
    } else if (total > 0) {
      for (const h of SC_HOURS) hours[h] = total / SC_HOURS.length;
    } else {
      const wd = scWeekdayOf(d);
      for (const h of SC_HOURS) {
        const cell = (prof[wd] || {})[h];
        hours[h] = (cell && cell.cnt) ? cell.sum / cell.cnt : 0;
      }
    }
    out[d] = hours;
  }
  return out;
}

/* ==================== 日度量级匹配 · 每日总览 ==================== */
function renderScCoverageDaily() {
  const el = document.getElementById('scCoverageDaily');
  if (!el) return;
  if (!(S.scheduleResult || []).length) {
    el.innerHTML = '<p class="muted">生成排班后显示日度量级匹配。</p>';
    return;
  }
  const c = scGetCycle();
  const dates = scDatesBetween(c.start, c.end);
  if (!dates.length) { el.innerHTML = '<p class="muted">排班周期无效。</p>'; return; }

  const rows = [];
  for (const biz of SC_BIZ_LIST) {
    const demand = scComputeDemandTable(biz, dates);
    for (const d of dates) {
      /* 预测量：Σ 各时段 */
      let forecast = 0;
      if (S.volumeForecast && S.volumeForecast[biz] && S.volumeForecast[biz][d] > 0) {
        forecast = S.volumeForecast[biz][d];
      } else if (demand[d]) {
        for (const h of SC_HOURS) forecast += demand[d][h] || 0;
      }

      /* 可承接量：Σ(员工 CPH × 在岗小时) */
      let capacity = 0;
      for (const r of S.scheduleResult) {
        if (r.date !== d || r.biz !== biz) continue;
        const mins = (S.shiftPeriods || {})[r.shift] || {};
        const cph = (S.employeeCPH || {})[r.name] || {};
        for (const h in mins) {
          if (mins[h] > 0 && cph[h]) capacity += cph[h] * (mins[h] / 60);
        }
      }

      const gap = capacity - forecast;
      const gapPct = forecast > 0 ? (gap / forecast * 100) : 0;
      const ok = gap >= -forecast * 0.02;   /* 允许 2% 波动 */
      const color = ok ? '#6EA980' : '#D9363E';

      rows.push('<tr>' +
        '<td>' + esc(d) + ' 周' + esc(WEEKDAY_CN[scWeekdayOf(d)]) + '</td>' +
        '<td>' + esc(biz) + '</td>' +
        '<td style="text-align:right">' + Math.round(forecast) + '</td>' +
        '<td style="text-align:right">' + Math.round(capacity) + '</td>' +
        '<td style="text-align:right;color:' + color + ';font-weight:600">' + (gap >= 0 ? '+' : '') + Math.round(gap) + '</td>' +
        '<td style="text-align:right;color:' + color + ';font-weight:600">' + (gapPct >= 0 ? '+' : '') + gapPct.toFixed(1) + '%</td>' +
        '<td style="text-align:center;color:' + color + ';font-weight:600">' + (ok ? '✓ 承接充足' : '⚠ 承接不足') + '</td>' +
        '</tr>');
    }
  }

  el.innerHTML = '<div class="table-scroll-x"><table class="rp-table"><thead><tr>' +
    '<th>日期</th><th>业务线</th><th style="text-align:right">预测量</th>' +
    '<th style="text-align:right">可承接量</th><th style="text-align:right">缺口</th>' +
    '<th style="text-align:right">缺口率</th><th>状态</th>' +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
}