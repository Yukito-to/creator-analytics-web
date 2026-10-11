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

/* ★ 支援博主排除集：买手里不具备博主技能、不应被派去支援的人员名单 */
(function initScSupportExclude() {
  if (!S.scNoSupportBlogger) S.scNoSupportBlogger = new Set();
})();

/* ============================================================
   ★ 用户选择习惯持久化
     · 班次池：S.shiftPoolByBiz = { '买手合作': [...], '博主合作': [...] }
     · 支援博主排除集：S.scNoSupportBlogger = Set<name>
   提供 loadScPrefs / saveScShiftPool / saveScSupportExclude 三个工具。
   ============================================================ */
const SC_PREF_KEY_POOL = 'creator_sc_shift_pool_by_biz';
const SC_PREF_KEY_EXCL = 'creator_sc_no_support_blogger';

function saveScShiftPool() {
  try {
    const obj = {};
    for (const b of SC_BIZ_LIST) {
      const arr = (S.shiftPoolByBiz && S.shiftPoolByBiz[b]) || [];
      obj[b] = Array.from(arr);
    }
    localStorage.setItem(SC_PREF_KEY_POOL, JSON.stringify(obj));
  } catch (_) {}
}

function saveScSupportExclude() {
  try {
    const arr = S.scNoSupportBlogger ? Array.from(S.scNoSupportBlogger) : [];
    localStorage.setItem(SC_PREF_KEY_EXCL, JSON.stringify(arr));
  } catch (_) {}
}

/* 从 localStorage 恢复用户上次的选择习惯（在 core 初始化之后、渲染之前调用一次） */
(function loadScPrefs() {
  /* ---- 班次池 ---- */
  try {
    const raw = localStorage.getItem(SC_PREF_KEY_POOL);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        if (!S.shiftPoolByBiz) S.shiftPoolByBiz = { '买手合作': [], '博主合作': [] };
        for (const b of SC_BIZ_LIST) {
          if (Array.isArray(obj[b])) S.shiftPoolByBiz[b] = obj[b].slice();
        }
        /* 同步活动引用 */
        if (S.scBizState && S.shiftPoolByBiz[S.scBizState]) {
          S.shiftPool = S.shiftPoolByBiz[S.scBizState];
        }
      }
    }
  } catch (_) {}

  /* ---- 支援博主排除集 ---- */
  try {
    const raw = localStorage.getItem(SC_PREF_KEY_EXCL);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) S.scNoSupportBlogger = new Set(arr);
    }
  } catch (_) {}
})();

/* ★ 日度量级匹配视图选择：业务线多选集合 + 所选日期 */
(function initScCoverageSel() {
  if (!S.scCoverageSel) {
    S.scCoverageSel = { bizSet: new Set(SC_BIZ_LIST), date: '' };
  }
})();

/* ★ CPH 面板折叠状态（默认展开） */
(function initScCphCollapsed() {
  if (typeof S.scCphCollapsed !== 'boolean') {
    try {
      const raw = localStorage.getItem('creator_sc_cph_collapsed');
      S.scCphCollapsed = raw === '1';
    } catch (_) { S.scCphCollapsed = false; }
  }
})();

function scSaveCphCollapsed() {
  try { localStorage.setItem('creator_sc_cph_collapsed', S.scCphCollapsed ? '1' : '0'); } catch (_) {}
}

/* ★ 班次规则面板折叠状态（默认展开） */
(function initScReqCollapsed() {
  if (typeof S.scReqCollapsed !== 'boolean') {
    try {
      const raw = localStorage.getItem('creator_sc_req_collapsed');
      S.scReqCollapsed = raw === '1';
    } catch (_) { S.scReqCollapsed = false; }
  }
})();

function scSaveReqCollapsed() {
  try { localStorage.setItem('creator_sc_req_collapsed', S.scReqCollapsed ? '1' : '0'); } catch (_) {}
}

/* ★ 「班次规则」大板块折叠状态（默认展开） */
(function initScRuleBlockCollapsed() {
  if (typeof S.scRuleBlockCollapsed !== 'boolean') {
    try {
      const raw = localStorage.getItem('creator_sc_rule_block_collapsed');
      S.scRuleBlockCollapsed = raw === '1';
    } catch (_) { S.scRuleBlockCollapsed = false; }
  }
})();

function scSaveRuleBlockCollapsed() {
  try {
    localStorage.setItem('creator_sc_rule_block_collapsed',
      S.scRuleBlockCollapsed ? '1' : '0');
  } catch (_) {}
}

/* ==================== 班次 / 日期工具 ==================== */
function scIsLateShift(shift) {
  const meta = S.shiftMeta && S.shiftMeta[shift];
  return !!(meta && meta.isLate);
}
/* ★ 判断是否为「休息」班次（出勤计数优先，与 scIsWorkingShift 对称）：
     ① 权威：S.shiftAttn[shift] === 0 且 restDays > 0
     ② 回退：S.shiftMeta[shift] 里 !isWorking 且 restDays > 0
     ③ 兜底：S.shiftMap[shift] === 0
   用于 renderScShiftPool 过滤「可排班次池」。 */
function scIsRestShift(shift) {
  if (S.shiftAttn && S.shiftAttn[shift] != null) {
    if (S.shiftAttn[shift] > 0) return false;   // 有出勤 = 不是休息
    /* 出勤 0，再看 restDays 区分「休假类」与「放休类」 */
    const meta0 = S.shiftMeta && S.shiftMeta[shift];
    return !!(meta0 && meta0.restDays > 0);
  }
  const meta = S.shiftMeta && S.shiftMeta[shift];
  if (meta) return !meta.isWorking && meta.restDays > 0;
  if (S.shiftMap && S.shiftMap[shift] != null) return S.shiftMap[shift] === 0;
  return false;
}
function scIsLeaveShift(shift) {
  const meta = S.shiftMeta && S.shiftMeta[shift];
  return !!(meta && !meta.isWorking && meta.restDays === 0);
}
/* ★ 判断班次是否为「工作班次」（三档判定，出勤计数优先）：
     ① 权威：S.shiftAttn[shift]（「班次时段」sheet 的「出勤计数」列）> 0
     ② 回退：S.shiftMeta[shift].isWorking（= 总计分钟 > 0）
     ③ 兜底：S.shiftMap[shift]（「班次时段」sheet 的「人力计数」列）> 0

   之所以「出勤计数」优先：用户明确指定「三倍出勤」的口径就是它，
   它与「总计分钟」可能不一致（例如某班次总工时不记出勤）。 */
function scIsWorkingShift(shift) {
  if (S.shiftAttn && S.shiftAttn[shift] != null) return S.shiftAttn[shift] > 0;
  const meta = S.shiftMeta && S.shiftMeta[shift];
  if (meta) return !!meta.isWorking;
  if (S.shiftMap && S.shiftMap[shift] != null) return S.shiftMap[shift] > 0;
  return false;
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

/* ★ 判断员工在指定日期是否在职：
     · 无离职日期 → 全程在职
     · 有离职日期 → 仅「离职日之前」的日期为在职（离职日当天起不排班） */
function scIsActiveOn(empOrName, date) {
  if (!date) return false;
  const e = (typeof empOrName === 'string') ? getEmp(empOrName) : empOrName;
  if (!e) return false;
  if (!e.resignDate) return true;
  return date < e.resignDate;
}

/* ★ 员工顺序：优先按「排班草稿表格」中出现顺序（= 员工行顺序）；
    草稿里没有、但花名册里符合条件的一线员工，追加在最后（保持 roster 顺序）。 */
function scActiveEmployees() {
  const c = scGetCycle();
  const start = c.start || S.latestDate || '';

  /* 1. 建过滤后的 name → emp 映射 */
  const empMap = new Map();
  for (const e of (S.roster || [])) {
    if (!e.name) continue;
    if (e.resignDate && start && e.resignDate <= start) continue;   // 离职日 <= 周期起始日 → 全周期不参与
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

  /* ★ 三倍天数 & 已休天数的数据源：
       · 三倍判定：排班草稿及诉求 sheet（scEffectiveShift 的草稿来源）
                    × 班次 sheet 的「出勤计数」列（scIsWorkingShift 的回退来源）
                    × 用户勾选的三倍日集合（S.scTripleDates）
       · 已休天数：班次 sheet 的「休」列（S.shiftMeta[shift].restDays，
                   若 shiftMeta 缺失则为 0）

     判定链：
       ① 员工该日必须「在职」（离职日当天及之后跳过）
       ② 排班草稿里有明确班次（scEffectiveShift）
       ③ 该日是三倍日（tripleSet.has）
       ④ 该班次是工作班次（scIsWorkingShift → 优先 shiftMeta.isWorking，
                           回退班次 sheet 出勤计数 > 0） */
  for (const d of monthDates) {
    if (!scIsActiveOn(name, d)) continue;   // ★ 离职日及之后不计入休假统计
    const shift = scEffectiveShift(name, d);
    if (!shift) continue;

    if (tripleSet.has(d) && scIsWorkingShift(shift)) tripleDays++;

    const meta = S.shiftMeta[shift];
    if (meta && meta.restDays > 0) used += meta.restDays;
  }

  /* ★ 规则匹配（≥ 语义）：
       把启用的规则按「三倍天数」阈值【从高到低】排序，
       取第一个满足 `tripleDays >= rule.triple` 的规则的可休天数。
     例：规则表为 [≥3 → 休6] [≥2 → 休6] [≥1 → 休7] [≥0 → 休7]，
         tripleDays=0 → 休7；=1 → 休7；=2 → 休6；=3 → 休6；=5 → 休6。 */
  let total = null;
  const activeRules = S.scHolidayRules
    .filter(r => r.enabled)
    .map(r => ({ triple: Number(r.triple), rest: Number(r.rest) }))
    .filter(r => isFinite(r.triple) && isFinite(r.rest))
    .sort((a, b) => b.triple - a.triple);   // 降序

  for (const r of activeRules) {
    if (tripleDays >= r.triple) { total = r.rest; break; }
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

  /* ★ 校验：至少存在一条「有效」的规则（日期 + 班次都选了），跨所有业务线。
     判定口径与 scGetShiftReq 保持一致 —— 只要日期、班次都填了就算生效，
     不要求 confirmed（confirmed 只影响折叠/视觉提示）。 */
  const hasValidRule = (function () {
    const all = S.shiftReqRules || {};
    for (const b of SC_BIZ_LIST) {
      const list = all[b] || [];
      for (const r of list) {
        if (!r) continue;
        if (Array.isArray(r.dates)  && r.dates.length  > 0 &&
            Array.isArray(r.shifts) && r.shifts.length > 0) return true;
      }
    }
    return false;
  })();
  if (!hasValidRule) {
    toast('请先设置至少一个业务线的班次需求规则（需选择生效日期和限制班次）');
    return null;
  }

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
      if (!scIsActiveOn(e, d)) continue;   // ★ 离职日及之后不参与预锁定
      const s = scEffectiveShift(e.name, d);
      if (s) locked[e.name][d] = s;
    }
  }

  const ctx = {
    dates, locked,
    buyerOnly: pools.buyerOnly, bloggerOnly: pools.bloggerOnly, flex: pools.flex,
    cph: S.employeeCPH,
    parsed: scLoadParsedRequests(),
    stats: {}, lastShift: {}, workStreak: {},
    preStreak: {},                      /* ★ 前置连续工作天数基线 */
    assigned: {}, assignedBiz: {},
    assignedSupport: {},   /* ★ 记录哪些格子是「买手支援博主」的班次 */
    demandVol: {}, warnings: [],
  };

  /* ★ H4 跨周期：用前置排班初始化连续工作天数与「上次班次」，
       否则周期第 1 天会把所有人当作 streak=0，导致跨越周期的超长连班。 */
  scInitStreakFromPre(ctx, c.start);

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
    scAssignBuyerSurplusToBlogger(ctx, d);   /* ★ 买手剩余人力主动支援博主 */
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
      const sup = !!(ctx.assignedSupport[d] && ctx.assignedSupport[d][e.name]);
      result.push({
        date: d, name: e.name, shift: s,
        biz: ctx.assignedBiz[d][e.name] || empBiz(e.name),
        support: sup   /* ★ 支援博主标记 */
      });
    }
  }
  scValidateQuota(ctx);      // H5 后验校验（只告警不回改，避免初期无人可排）

  /* ★ 硬约束：班次人数必须严格等于规则。
       不满足 → 不覆盖 S.scheduleResult（保留上次成功的），
       仅记录失败详情到 S.scheduleDiag，返回 null。 */
  const countCheck = scValidateShiftCounts(ctx);

  if (!countCheck.ok) {
    S.scheduleDiag = {
      dateCount: ctx.dates.length,
      employeeCount: scActiveEmployees().length,
      totalSlots: 0,
      failed: true,
      mismatches: countCheck.mismatches,
      warnings: ['❌ 班次人数不符合规则，排班已取消'],
    };
    return null;
  }

  S.scheduleResult = result;
  S.scheduleDiag = scBuildDiag(ctx, result);
  return result;
}

/* ==================== 分配内部函数 ==================== */
function scDoAssign(ctx, date, e, shift, biz, support) {
  ctx.assigned[date][e.name] = shift;
  ctx.assignedBiz[date][e.name] = biz || '';
  if (support) {
    if (!ctx.assignedSupport[date]) ctx.assignedSupport[date] = {};
    ctx.assignedSupport[date][e.name] = true;
  }
  if (!ctx.stats[e.name]) ctx.stats[e.name] = {};
  ctx.stats[e.name][shift] = (ctx.stats[e.name][shift] || 0) + 1;
}

function scApplyLocks(ctx, date) {
  for (const e of scActiveEmployees()) {
    if (!scIsActiveOn(e, date)) continue;   // ★
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
  if (!scIsActiveOn(e, date)) return false;   // ★ 离职日及之后一律不排
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
  const short = scCoverageShortage(ctx, date, S.scBizState || '买手合作');
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
        const borrowCands = other
          .filter(e => !ctx.assigned[date][e.name])
          /* ★ 从买手借调到博主时，排除「不支援博主」的员工 */
          .filter(e => !(biz === '博主合作' && (S.scNoSupportBlogger || new Set()).has(e.name)));
        const best2 = scPickBestCandidate(ctx, date, biz, borrowCands, short);
        if (best2 && best2.gain > 0) best = best2;
      }
    }

    if (!best || best.gain <= 0) {
      ctx.warnings.push(date + ' ' + biz + ' 存在时段缺口且无可征调人力');
      break;
    }
    /* ★ 博主需求 + 买手/弹性候选人 → 打 support 标记 */
    const isBuyerPool = ctx.buyerOnly.indexOf(best.e) >= 0 || ctx.flex.indexOf(best.e) >= 0;
    const isSupport   = (biz === '博主合作' && isBuyerPool);
    scDoAssign(ctx, date, best.e, best.shift, biz, isSupport);
  }
}

/* ★ 买手剩余人力主动支援博主：
     · 只在博主有「明确班次需求」（scGetShiftReq 返回数字）且需求尚未填满时才征调
     · 候选 = 尚未被分配的买手专属 + 弹性员工，且不在 S.scNoSupportBlogger 里
     · 按 scScoreCandidate 打分排序 */
function scAssignBuyerSurplusToBlogger(ctx, date) {
  const biz = '博主合作';

  /* 1. 汇总博主各班次当前缺口 */
  const shiftGap = {};
  for (const shift of S.shiftPool) {
    const need = scGetShiftReq(biz, shift, date);
    if (need == null || !isFinite(need) || need <= 0) continue;
    let already = 0;
    for (const n in ctx.assigned[date]) {
      if (ctx.assigned[date][n] === shift && ctx.assignedBiz[date][n] === biz) already++;
    }
    const gap = need - already;
    if (gap > 0) shiftGap[shift] = gap;
  }
  if (!Object.keys(shiftGap).length) return;

  /* 2. 候选池：买手专属 + 弹性，未分配、可支援、在职 */
  const exclude = S.scNoSupportBlogger || new Set();
  const candidates = ctx.buyerOnly
    .concat(ctx.flex)
    .filter(e => !ctx.assigned[date][e.name])
    .filter(e => !exclude.has(e.name))
    .filter(e => scIsActiveOn(e, date));
  if (!candidates.length) return;

  /* 3. 逐班次分配 */
  for (const shift of Object.keys(shiftGap)) {
    let gap = shiftGap[shift];
    if (gap <= 0) continue;
    const sorted = candidates
      .filter(e => !ctx.assigned[date][e.name])
      .filter(e => scCanAssign(ctx, e, date, shift))
      .filter(e => scShiftHasCapacity(ctx, date, biz, shift))
      .map(e => ({ e, score: scScoreCandidate(ctx, e, date, shift) }))
      .sort((a, b) => b.score - a.score);
    for (const item of sorted) {
      if (gap <= 0) break;
      scDoAssign(ctx, date, item.e, shift, biz, true);   /* ★ 打 support 标记 */
      gap--;
    }
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
    if (!scIsActiveOn(e, date)) continue;   // ★ 离职日及之后不填「默认休」
    if (ctx.assigned[date][e.name]) continue;
    ctx.assigned[date][e.name] = def;
  }
}

/* 更新昨日班次与连续工作天数（供次日打分/硬约束用） */
function scUpdateStreak(ctx, date) {
  for (const e of scActiveEmployees()) {
    /* ★ 离职日及之后：清零连续工作天数与上次班次，避免污染后续日期的打分 */
    if (!scIsActiveOn(e, date)) {
      ctx.workStreak[e.name] = 0;
      ctx.lastShift[e.name]  = '';
      continue;
    }
    const s = ctx.assigned[date] && ctx.assigned[date][e.name];
    if (s && scIsWorkingShift(s)) ctx.workStreak[e.name] = (ctx.workStreak[e.name] || 0) + 1;
    else ctx.workStreak[e.name] = 0;
    ctx.lastShift[e.name] = s || '';
  }
}

/* ★ 用「前置排班」（周期起始日之前）初始化每位员工的连续工作天数。
   回溯规则：
     · 从 cycleStart 前一天开始，逐日向前推
     · 遇到非工作班次（休/假等）→ 停止
     · 遇到缺失记录（草稿里没有这天）→ 视为未知，停止
     · 遇到员工当天不在职 → 停止
     · 最多回溯 MAX_LOOKBACK 天（防御性上限）

   结果：
     ctx.workStreak[name] = 连续工作天数（作为周期第 1 天的初始值）
     ctx.lastShift[name]  = 紧邻周期起始日那天的班次（用于 S2 一致性打分）
     ctx.preStreak[name]  = 同上（常量基线，供 scStreakOK 跨周期复核使用） */
function scInitStreakFromPre(ctx, cycleStart) {
  const MAX_LOOKBACK = 30;
  ctx.preStreak = ctx.preStreak || {};

  /* 把前置草稿整理成 name → date → shift */
  const draftMap = {};
  for (const d of (S.scheduleDraft || [])) {
    if (!d.name || !d.date || !d.shift) continue;
    if (!draftMap[d.name]) draftMap[d.name] = {};
    draftMap[d.name][d.date] = d.shift;
  }

  for (const e of scActiveEmployees()) {
    let streak = 0;
    let lastShift = '';
    let cursor = dateAdd(cycleStart, -1);
    let step = 0;
    while (cursor && step++ < MAX_LOOKBACK) {
      if (!scIsActiveOn(e, cursor)) break;                       // 不在职 → 停
      const s = draftMap[e.name] && draftMap[e.name][cursor];
      if (!s) break;                                             // 缺失 → 停（未知即视为不连续）
      if (scIsWorkingShift(s)) {
        streak++;
        if (!lastShift) lastShift = s;                           // 只记最靠后那天
        cursor = dateAdd(cursor, -1);
      } else {
        break;                                                   // 遇到休/假 → 停
      }
    }
    ctx.workStreak[e.name] = streak;
    ctx.lastShift[e.name]  = lastShift;
    ctx.preStreak[e.name]  = streak;
  }
}

/* ==================== 局部搜索优化 ==================== */
/* 全周期重扫某员工，检查任意连续工作段 ≤6（H4） */
function scStreakOK(ctx, dates, name) {
  /* ★ 起始值 = 周期起始日前的连续工作天数（前置排班），
       否则局部搜索（换班/调休）会绕过 H4 的跨周期约束。 */
  let run = (ctx.preStreak && ctx.preStreak[name]) || 0;
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
      if (!scIsActiveOn(pa, d) || !scIsActiveOn(pb, d)) continue;   // ★
      if (!scRequestsAllow(ctx, pa.name, sb) || !scRequestsAllow(ctx, pb.name, sa)) continue;
      ctx.assigned[d][pa.name] = sb;
      ctx.assigned[d][pb.name] = sa;
      if (scStreakOK(ctx, dates, pa.name) && scStreakOK(ctx, dates, pb.name)) {
        if (ctx.assignedSupport[d]) {
          delete ctx.assignedSupport[d][pa.name];
          delete ctx.assignedSupport[d][pb.name];
        }
        swapped = true; break;
      }
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
      if (!scIsActiveOn(pa, d) || !scIsActiveOn(pb, d)) continue;   // ★
      if (!scRequestsAllow(ctx, pa.name, sb) || !scRequestsAllow(ctx, pb.name, sa)) continue;
      ctx.assigned[d][pa.name] = sb;
      ctx.assigned[d][pb.name] = sa;
      if (scStreakOK(ctx, dates, pa.name) && scStreakOK(ctx, dates, pb.name)) {
        if (ctx.assignedSupport[d]) {
          delete ctx.assignedSupport[d][pa.name];
          delete ctx.assignedSupport[d][pb.name];
        }
        done = true; break;
      }
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

/* ★ 后验校验：逐 (date, biz, shift) 检查实际分配人数是否等于目标人数。
   · 只对「规则命中的班次」检查（scGetShiftReq 返回非 null）
   · 实际 > 目标 → 记为「超编」（理论上不会发生，防御性检查）
   · 实际 < 目标 → 记为「不足」（常见原因：人力不够 / 硬约束冲突）
   结果写入 ctx.warnings（最多保留 30 条，避免刷屏）。 */
/* ★ 硬约束校验：逐 (date, biz, shift) 检查实际分配人数是否严格等于目标。
   返回 { ok, mismatches }，由 generateSchedule 决定是否中止。

   关键点：遍历的是【规则涉及的所有班次】（而不是 S.shiftPool），
   因为规则里可能写了某班次但用户没把它勾进班次池，
   此时 scGetShiftReq 仍会返回 need，必须一并校验。 */
function scValidateShiftCounts(ctx) {
  const mismatches = [];
  if (!ctx || !ctx.dates || !ctx.dates.length) return { ok: true, mismatches };

  /* 收集所有规则涉及的班次（跨业务线） */
  const shiftsInRules = new Set();
  for (const b of SC_BIZ_LIST) {
    const list = (S.shiftReqRules && S.shiftReqRules[b]) || [];
    for (const r of list) {
      if (Array.isArray(r.shifts)) for (const s of r.shifts) shiftsInRules.add(s);
    }
  }
  if (!shiftsInRules.size) return { ok: true, mismatches };

  for (const d of ctx.dates) {
    if (!ctx.assigned[d]) continue;
    for (const biz of SC_BIZ_LIST) {
      for (const shift of shiftsInRules) {
        const need = scGetShiftReq(biz, shift, d);
        if (need == null || !isFinite(need)) continue;   // 未命中规则 → 不校验
        let actual = 0;
        for (const n in ctx.assigned[d]) {
          if (ctx.assigned[d][n] === shift && ctx.assignedBiz[d][n] === biz) actual++;
        }
        if (actual !== need) {
          mismatches.push({
            date: d, biz: biz, shift: shift,
            need: need, actual: actual, diff: actual - need
          });
        }
      }
    }
  }
  return { ok: mismatches.length === 0, mismatches };
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
/* ★ 业务线 Tab（顶部，全局唯一）：
     切换后：① 同步活动池引用 ② 重渲班次池 + 需求表 */
function renderScBizTabs() {
  const el = document.getElementById('scBizTabs');
  if (!el) return;
  el.innerHTML = SC_BIZ_LIST.map(b =>
    '<button type="button" class="btn ' + (b === S.scBizState ? 'primary' : 'sm') +
    '" data-biz="' + esc(b) + '">' + esc(b) + '</button>'
  ).join('');
  el.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      S.scBizState = btn.dataset.biz;
      if (!Array.isArray(S.shiftPoolByBiz[S.scBizState])) S.shiftPoolByBiz[S.scBizState] = [];
      S.shiftPool = S.shiftPoolByBiz[S.scBizState];   // ★ 切换活动引用
      saveScShiftPool();                              // ★ 记住当前业务线视角
      renderScBizTabs();
      renderScShiftPool();
      renderScReqGrid();
    });
  });
}

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

  /* ---------- 外层「班次规则」大板块折叠 ---------- */
  const rbToggle = document.getElementById('scRuleBlockToggle');
  const rbArrow  = document.getElementById('scRuleBlockArrow');
  const rbBody   = document.getElementById('scRuleBlockBody');

  if (rbToggle && !rbToggle._scBound) {
    rbToggle._scBound = true;
    rbToggle.addEventListener('click', (e) => {
      if (e.target.closest('.help')) return;   /* 点问号不折叠 */
      S.scRuleBlockCollapsed = !S.scRuleBlockCollapsed;
      scSaveRuleBlockCollapsed();
      renderSchedulePanel();
    });
  }
  if (rbArrow) rbArrow.style.transform =
    S.scRuleBlockCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
  if (rbBody) rbBody.style.display = S.scRuleBlockCollapsed ? 'none' : '';

  renderScBizTabs();
  renderScShiftPool();
  renderScReqGrid();
  renderScSupportExclude();   // ★ 新增
  renderScCphGrid();
  renderScReqList();
  renderScCoverage();
  renderScDiag();
  if (typeof renderScCoverageDaily === 'function') renderScCoverageDaily();

  renderScTripleGrid();
  renderScRulesTable();
  renderScGrid();
  renderScRulesSummary();   // ★ 渲染规则说明面板
}

function renderScShiftPool() {
  const el = document.getElementById('scShiftPool');
  if (!el) return;

  /* ★ 只展示「工作班次」；使用 scIsWorkingShift 三档判定（出勤计数优先），
       避免因缺失「班次时段」sheet 而把休息类班次混进来 */
  const all = Object.keys(S.shiftMeta || {});
  const workingShifts = all.filter(s => scIsWorkingShift(s));

  /* ★ 取当前业务线的池子 */
  const pool = S.shiftPoolByBiz[S.scBizState] || [];

  if (!workingShifts.length) {
    el.innerHTML = '<p class="muted" style="margin:4px 0">未识别到工作班次（请检查「班次时段」sheet 的「出勤计数」列）。</p>';
    return;
  }

  el.innerHTML = workingShifts.map(s =>
    '<span class="chip' + (pool.indexOf(s) >= 0 ? ' on' : '') +
    '" data-shift="' + esc(s) + '">' + esc(s) + '</span>'
  ).join('');

  el.querySelectorAll('.chip').forEach(ch => {
    ch.addEventListener('click', () => {
      const s = ch.dataset.shift;
      const arr = S.shiftPoolByBiz[S.scBizState];
      const i = arr.indexOf(s);
      if (i >= 0) arr.splice(i, 1); else arr.push(s);
      saveScShiftPool();   /* ★ 记住用户勾选习惯 */
      renderScShiftPool();
      renderScReqGrid();
    });
  });
}

/* ★ 支援博主设置：只展示买手专属 + 弹性员工 */
function renderScSupportExclude() {
  const el = document.getElementById('scSupportExclude');
  if (!el) return;

  if (S.scBizState !== '买手合作') {
    el.innerHTML = '<p class="muted" style="margin:4px 0;font-size:12px">' +
      '该设置仅在「买手合作」业务线下生效，请切换到「买手合作」后配置。</p>';
    return;
  }

  const all = scActiveEmployees();
  const buyerPool = [];
  for (const e of all) {
    const b = String(e.biz || '');
    if (/买手/.test(b) && !/博主/.test(b)) buyerPool.push(e);
    else if (!/买手/.test(b) && !/博主/.test(b)) buyerPool.push(e);
  }

  if (!buyerPool.length) {
    el.innerHTML = '<p class="muted" style="margin:4px 0;font-size:12px">' +
      '未识别到买手专属 / 弹性员工。</p>';
    return;
  }

  const exSet = S.scNoSupportBlogger || new Set();

  el.innerHTML =
    '<p class="muted" style="margin:0 0 6px;font-size:11.5px">' +
      '勾选 = <b>不支援博主</b>（默认全部可支援）。当前已排除：<b>' + exSet.size + '</b> 人' +
    '</p>' +
    buyerPool.map(e => {
      const on = exSet.has(e.name);
      return '<span class="chip' + (on ? ' on' : '') + '" data-name="' + esc(e.name) + '">' +
        esc(e.name) + '</span>';
    }).join('');

  el.querySelectorAll('.chip').forEach(ch => {
    ch.addEventListener('click', () => {
      const n = ch.dataset.name;
      if (!S.scNoSupportBlogger) S.scNoSupportBlogger = new Set();
      if (S.scNoSupportBlogger.has(n)) S.scNoSupportBlogger.delete(n);
      else S.scNoSupportBlogger.add(n);
      saveScSupportExclude();   /* ★ 记住排除集 */
      renderScSupportExclude();
    });
  });
}

function renderScReqGrid() {
  const el = document.getElementById('scReqGrid');
  const arrowEl = document.getElementById('scReqArrow');
  if (!el) return;

  /* ---------- 折叠切换绑定（只绑一次） ---------- */
  const toggleEl = document.getElementById('scReqToggle');
  if (toggleEl && !toggleEl._bound) {
    toggleEl._bound = true;
    toggleEl.addEventListener('click', () => {
      S.scReqCollapsed = !S.scReqCollapsed;
      scSaveReqCollapsed();
      renderScReqGrid();
    });
  }
  if (arrowEl) arrowEl.style.transform = S.scReqCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';

  /* ---------- 折叠态：清空 DOM 并显示一行摘要 ---------- */
  if (S.scReqCollapsed) {
    const biz = S.scBizState;
    const rules = (S.shiftReqRules && S.shiftReqRules[biz]) || [];
    const validCnt = rules.filter(r =>
      Array.isArray(r.dates)  && r.dates.length  > 0 &&
      Array.isArray(r.shifts) && r.shifts.length > 0
    ).length;
    const summary = rules.length === 0
      ? '<span class="muted" style="font-size:12px">（暂无规则，展开后可添加）</span>'
      : '<span class="muted" style="font-size:12px">已配置 <b>' + rules.length +
        '</b> 条规则' + (validCnt < rules.length
          ? '，其中 <b style="color:#B36A00">' + (rules.length - validCnt) + ' 条待补全</b>'
          : '') + '</span>';
    el.innerHTML = '<div style="padding:8px 14px;background:#FAF9F7;' +
      'border:1px solid var(--border);border-radius:8px;margin-bottom:10px">' +
      summary + '</div>';
    return;
  }

  /* ---------- 展开态：正常渲染 ---------- */
  const biz = S.scBizState;
  const rules = S.shiftReqRules[biz] || [];
  const pool  = S.shiftPoolByBiz[biz] || [];
  const cycle = scGetCycle();

  /* 生效日期候选 = 排班周期内每一天 */
  let cycleDates = [];
  if (cycle.start && cycle.end) cycleDates = scDatesBetween(cycle.start, cycle.end);

  /* 空状态 */
  if (!pool.length) {
    el.innerHTML = '<p class="muted" style="margin:4px 0">请先在上方「选择本业务线可排班次」中勾选至少一个班次。</p>';
    return;
  }
  if (!cycleDates.length) {
    el.innerHTML = '<p class="muted" style="margin:4px 0">请先设置排班周期。</p>';
    return;
  }

  const cards = rules.map((r, idx) => renderScReqRuleCardHTML(idx, r, cycleDates, pool)).join('');
  const emptyTip = rules.length === 0
    ? '<p class="muted" style="margin:4px 0;font-size:12px">暂无规则。点击下方「+ 添加规则」创建第一条。</p>'
    : '';

  el.innerHTML = emptyTip +
    '<div class="sc-req-cards">' + cards + '</div>' +
    '<button type="button" class="btn sm" id="scReqAddRule" style="margin-top:10px">+ 添加规则</button>';

  bindScReqRuleEvents(el, cycleDates, pool, biz);
}

/* 单条规则卡片的 HTML */
/* 单条规则卡片的 HTML */
function renderScReqRuleCardHTML(idx, rule, cycleDates, pool) {
  const dates = rule.dates  || [];
  const shifts = rule.shifts || [];
  const max = rule.max;
  const confirmed = !!rule.confirmed;
  const collapsed = !!rule.collapsed;   // ★ 折叠状态

  /* 顶部状态提示 */
  const warnings = [];
  if (!dates.length)  warnings.push('日期');
  if (!shifts.length) warnings.push('班次');
  let statusHTML = '';
  if (confirmed) {
    statusHTML = '<span style="color:#6EA980;font-size:12px;flex:none">✓ 已确认</span>';
  } else if (warnings.length) {
    statusHTML = '<span style="color:#B36A00;font-size:12px;flex:none">⚠ 请补全：' + warnings.join('、') + '</span>';
  }

  /* ★ 折叠态摘要 */
  const dTxt = !dates.length ? '未选日期'
             : (dates.length === cycleDates.length ? '全周期'
             : (dates.length <= 3 ? dates.map(d => d.slice(5)).join('、') : dates.length + ' 天'));
  const sTxt = !shifts.length ? '未选班次' : shifts.join('/');
  const mTxt = max == null ? '不限' : '≤' + max + '人';
  const summaryHTML = collapsed
    ? '<span style="color:#A0A0AE;font-size:11.5px;margin-left:8px;overflow:hidden;' +
      'text-overflow:ellipsis;white-space:nowrap;min-width:0">' +
      esc(dTxt + ' · ' + sTxt + ' · ' + mTxt) + '</span>'
    : '';

  const dateChips = cycleDates.map(d => {
    const on = dates.indexOf(d) >= 0;
    const wd = WEEKDAY_CN[scWeekdayOf(d)];
    return '<span class="chip' + (on ? ' on' : '') + '" data-date="' + d + '">' +
      d.slice(5) + ' 周' + wd + '</span>';
  }).join('');

  const shiftChips = pool.map(s => {
    const on = shifts.indexOf(s) >= 0;
    return '<span class="chip' + (on ? ' on' : '') + '" data-shift="' + esc(s) + '">' + esc(s) + '</span>';
  }).join('');

  /* ★ 折叠时去掉头部下边框 / 下边距，视觉上更紧凑 */
  const headStyle = collapsed
    ? ' style="padding-bottom:0;border-bottom:none;margin-bottom:0"'
    : '';

  return '<div class="sc-req-card" data-idx="' + idx + '">' +
    '<div class="sc-req-card-head"' + headStyle + '>' +
      '<div data-act="toggle" style="display:flex;align-items:center;gap:8px;' +
        'cursor:pointer;min-width:0;flex:1 1 auto;user-select:none">' +
        '<span class="arrow" style="display:inline-block;width:12px;text-align:center;' +
          'font-size:10px;color:#7B8FBF;flex:none;transition:transform .15s ease;' +
          'transform:rotate(' + (collapsed ? '-90deg' : '0deg') + ')">▼</span>' +
        '<span style="font-weight:600;color:#7B8FBF;flex:none">规则 #' + (idx + 1) + '</span>' +
        statusHTML +
        summaryHTML +
      '</div>' +
      '<div style="margin-left:auto;display:flex;gap:6px;flex:none">' +
        '<button type="button" class="btn sm" data-act="confirm"' + (confirmed ? ' disabled' : '') + '>' +
          (confirmed ? '✓ 已确认' : '✓ 确认') +
        '</button>' +
        '<button type="button" class="btn sm" data-act="delete" style="background:#FCE5E5;color:#D9363E">删除</button>' +
      '</div>' +
    '</div>' +

    '<div class="sc-req-card-body"' + (collapsed ? ' style="display:none"' : '') + '>' +

    '<div class="sc-req-card-section">' +
      '<div class="sc-req-card-label">📅 生效日期' +
        '<button type="button" class="btn sm" data-act="all-dates">全选</button>' +
        '<button type="button" class="btn sm" data-act="clear-dates">清空</button>' +
        '<span style="color:#A0A0AE;font-weight:400;margin-left:auto">已选 ' + dates.length + ' / ' + cycleDates.length + ' 天</span>' +
      '</div>' +
      '<div class="chips" style="margin:6px 0 0">' + dateChips + '</div>' +
    '</div>' +

    '<div class="sc-req-card-section">' +
      '<div class="sc-req-card-label">🎯 限制班次' +
        '<button type="button" class="btn sm" data-act="all-shifts">全选</button>' +
        '<button type="button" class="btn sm" data-act="clear-shifts">清空</button>' +
        '<span style="color:#A0A0AE;font-weight:400;margin-left:auto">已选 ' + shifts.length + ' / ' + pool.length + ' 个班次</span>' +
      '</div>' +
      '<div class="chips" style="margin:6px 0 0">' + shiftChips + '</div>' +
    '</div>' +

    '<div class="sc-req-card-section" style="display:flex;align-items:center;gap:8px">' +
      '<span class="sc-req-card-label" style="margin:0">每天等于</span>' +
      '<input type="number" min="0" step="1" data-act="max" value="' +
        (max == null ? '' : max) + '" placeholder="不限" style="width:80px">' +
      '<span>人</span>' +
    '</div>' +

    '</div>' +
  '</div>';
}

/* 绑定规则卡片的所有交互 */
function bindScReqRuleEvents(el, cycleDates, pool, biz) {
  const rules = S.shiftReqRules[biz] || (S.shiftReqRules[biz] = []);

  /* 「+ 添加规则」 */
  const addBtn = el.querySelector('#scReqAddRule');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      rules.push({ dates: [], shifts: [], max: null, confirmed: false });
      renderScReqGrid();
    });
  }

  el.querySelectorAll('.sc-req-card').forEach(card => {
    const idx = parseInt(card.dataset.idx, 10);
    const rule = rules[idx];
    if (!rule) return;
    if (!Array.isArray(rule.dates))  rule.dates  = [];
    if (!Array.isArray(rule.shifts)) rule.shifts = [];

    /* ★ 新增：点击头部（箭头/标题区域）→ 折叠 / 展开 */
    const toggleArea = card.querySelector('[data-act="toggle"]');
    if (toggleArea) {
      toggleArea.addEventListener('click', () => {
        rule.collapsed = !rule.collapsed;
        renderScReqGrid();
      });
    }

    /* 日期 chip 点击 */
    card.querySelectorAll('.chip[data-date]').forEach(ch => {
      ch.addEventListener('click', () => {
        const d = ch.dataset.date;
        const i = rule.dates.indexOf(d);
        if (i >= 0) rule.dates.splice(i, 1); else rule.dates.push(d);
        renderScReqGrid();
      });
    });
    /* 班次 chip 点击 */
    card.querySelectorAll('.chip[data-shift]').forEach(ch => {
      ch.addEventListener('click', () => {
        const s = ch.dataset.shift;
        const i = rule.shifts.indexOf(s);
        if (i >= 0) rule.shifts.splice(i, 1); else rule.shifts.push(s);
        renderScReqGrid();
      });
    });

    /* 日期 全选 / 清空 */
    const allDatesBtn = card.querySelector('[data-act="all-dates"]');
    if (allDatesBtn) allDatesBtn.addEventListener('click', () => {
      rule.dates = cycleDates.slice(); renderScReqGrid();
    });
    const clrDatesBtn = card.querySelector('[data-act="clear-dates"]');
    if (clrDatesBtn) clrDatesBtn.addEventListener('click', () => {
      rule.dates = []; renderScReqGrid();
    });

    /* 班次 全选 / 清空 */
    const allShiftsBtn = card.querySelector('[data-act="all-shifts"]');
    if (allShiftsBtn) allShiftsBtn.addEventListener('click', () => {
      rule.shifts = pool.slice(); renderScReqGrid();
    });
    const clrShiftsBtn = card.querySelector('[data-act="clear-shifts"]');
    if (clrShiftsBtn) clrShiftsBtn.addEventListener('click', () => {
      rule.shifts = []; renderScReqGrid();
    });

    /* 每天等于（不重渲，只改数据） */
    const maxInp = card.querySelector('input[data-act="max"]');
    if (maxInp) {
      maxInp.addEventListener('change', () => {
        const v = parseFloat(maxInp.value);
        rule.max = (isFinite(v) && v >= 0) ? v : null;
      });
    }

    /* 确认 → 校验通过后自动折叠 */
    const okBtn = card.querySelector('[data-act="confirm"]');
    if (okBtn) okBtn.addEventListener('click', () => {
      if (rule.dates.length === 0 || rule.shifts.length === 0) {
        toast('请至少选择 1 个生效日期 + 1 个限制班次');
        return;
      }
      rule.confirmed = true;
      rule.collapsed = true;   /* ★ 新增：确认后自动折叠 */
      renderScReqGrid();
    });

    /* 删除 */
    const delBtn = card.querySelector('[data-act="delete"]');
    if (delBtn) delBtn.addEventListener('click', () => {
      if (!confirm('确定删除「规则 #' + (idx + 1) + '」？')) return;
      rules.splice(idx, 1);
      renderScReqGrid();
    });
  });
}

function renderScCphGrid() {
  const el = document.getElementById('scCphGrid');
  const arrowEl = document.getElementById('scCphArrow');
  if (!el) return;

  /* ---------- 折叠切换 ---------- */
  const toggleEl = document.getElementById('scCphToggle');
  if (toggleEl && !toggleEl._bound) {
    toggleEl._bound = true;
    toggleEl.addEventListener('click', () => {
      S.scCphCollapsed = !S.scCphCollapsed;
      scSaveCphCollapsed();
      renderScCphGrid();
    });
  }
  if (arrowEl) arrowEl.style.transform = S.scCphCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
  if (S.scCphCollapsed) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';

  /* ---------- 数据准备 ---------- */
  const emps = scActiveEmployees();
  if (!emps.length) {
    el.innerHTML = '<p class="muted" style="margin:4px 0">无可用员工。</p>';
    return;
  }

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

  /* ---------- 表格样式：仅横向滚动，垂直方向全展示 ---------- */
  el.style.overflowX = 'auto';
  el.style.overflowY = 'visible';
  el.style.maxHeight = 'none';
  el.style.border = '1px solid var(--border)';
  el.style.borderRadius = '8px';
  el.style.background = '#fff';

  /* 表头 & 首两列的 sticky 定位（相对 el 这个滚动容器） */
  const thBase = 'position:sticky;top:0;z-index:4;background:#F4F3EF;' +
                 'box-shadow:inset 0 -1px 0 #E7E5DE;padding:8px 10px;' +
                 'font-size:12px;font-weight:600;color:#77778A;text-align:center;white-space:nowrap';
  const thBiz  = thBase + ';left:0;z-index:6;width:48px;min-width:48px;' +
                 'box-shadow:inset 0 -1px 0 #E7E5DE, inset -1px 0 0 #E7E5DE';
  const thName = thBase + ';left:48px;z-index:6;width:1%;white-space:nowrap;' +
                 'text-align:center;font-size:11.5px;padding:8px 10px;' +
                 'box-shadow:inset 0 -1px 0 #E7E5DE, inset -1px 0 0 #E7E5DE';
  const thVal  = thBase + ';width:88px;min-width:88px;text-align:right';
  const thTop  = thBase + ';width:76px;min-width:76px;' +
                 'background:#F0EFE9;border-left:2px solid #E0DDD5';
  const thDay  = thBase + ';width:66px;min-width:66px';
  const thOp   = thBase + ';width:150px;min-width:150px';

  const tdBase = 'padding:6px 10px;font-size:12px;border-bottom:1px solid #F5F3EE;' +
                 'white-space:nowrap;vertical-align:middle';
  const tdBiz  = tdBase + ';position:sticky;left:0;z-index:2;background:#fff;' +
                 'box-shadow:inset -1px 0 0 #F0EEE9;text-align:center;' +
                 'width:48px;padding:6px 4px';
  const tdName = tdBase + ';position:sticky;left:48px;z-index:2;background:#fff;' +
                 'box-shadow:inset -1px 0 0 #F0EEE9;width:1%;white-space:nowrap;' +
                 'text-align:center;padding:6px 10px';
  const tdTop  = tdBase + ';text-align:center;font-size:11px;' +
                 'font-variant-numeric:tabular-nums;border-left:2px solid #E0DDD5';

  /* ---------- 表头 ---------- */
  let html = '<table style="border-collapse:separate;border-spacing:0;width:100%;font-size:12px">' +
    '<thead><tr>' +
      '<th style="' + thBiz  + '">业务线</th>' +
      '<th style="' + thName + '">姓名</th>' +
      '<th style="' + thVal  + '">P90 生效值</th>' +
      /* ★ 新增：日 CPD 最高的三天明细列（每列显示 CPD / CPH 两行） */
      '<th style="' + thTop + '">MAX1<br>' +
        '<span style="font-size:9px;color:#A0A0AE;font-weight:400">CPD/CPH</span></th>' +
      '<th style="' + thTop + '">MAX2<br>' +
        '<span style="font-size:9px;color:#A0A0AE;font-weight:400">CPD/CPH</span></th>' +
      '<th style="' + thTop + '">MAX3<br>' +
        '<span style="font-size:9px;color:#A0A0AE;font-weight:400">CPD/CPH</span></th>';

  for (const d of dates) {
    const wd = new Date(d + 'T00:00:00Z').getUTCDay();
    const cls = classifyDate(d);
    const color = cls === 'holiday' ? '#D9363E' : (cls === 'workday' ? '#C75C5C' : '#333');
    html += '<th style="' + thDay + ';color:' + color + '">' +
      parseInt(d.slice(5,7),10) + '月' + parseInt(d.slice(8,10),10) + '日' +
      '<div style="font-size:10px;color:#A0A0AE;font-weight:400;margin-top:1px">周' +
        WEEKDAY_CN[wd] + '</div>' +
    '</th>';
  }
  html += '<th style="' + thOp + '">操作</th></tr></thead><tbody>';

  for (const e of emps) {
    const tag = bizTag(e);
    const auto = pick(S.employeeCPHAuto, e.name);
    const cur  = pick(S.employeeCPH, e.name);
    const ov   = isOverridden(e.name);
    const autoDisp = auto > 0 ? auto.toFixed(2) : '';
    const curVal   = cur > 0 ? cur.toFixed(2) : '';
    const daily = (S.employeeCPHDaily || {})[e.name] || {};

    html += '<tr>' +
      '<td style="' + tdBiz + '">' +
        '<span style="display:inline-block;padding:1px 6px;font-size:10.5px;' +
          'border-radius:4px;color:#fff;background:' + tag.color + '">' + tag.text + '</span>' +
      '</td>' +
      '<td style="' + tdName + '">' + esc(e.name) +
        (ov ? ' <span style="color:#E8A33E;font-size:11px">✎</span>' : '') +
      '</td>' +
      '<td style="' + tdBase + ';text-align:right">' +
        '<input type="number" min="0" step="0.1" style="width:70px;text-align:right;' +
          'padding:5px 8px;border:1px solid var(--border-2);border-radius:6px;' +
          'font-family:inherit;font-size:12.5px;outline:none"' +
          ' data-name="' + esc(e.name) + '" value="' + curVal + '" placeholder="' + autoDisp + '"' +
          ' title="生效值（排班算法使用）：留空 = 自动值 = 日 CPD 前三均值 / 8">' +
      '</td>';

    /* ★ MAX1/2/3：每列显示两行 —— 上 CPD（灰字），下 CPH（黑字粗体） */
    const top3 = (S.employeeCphTop3 && S.employeeCphTop3[e.name]) || [];
    for (let ti = 0; ti < 3; ti++) {
      const t = top3[ti];
      if (!t) {
        html += '<td style="' + tdTop + ';color:#C0BDB5">—</td>';
      } else {
        html += '<td style="' + tdTop + '" title="' + esc(t.date) + '">' +
          '<div style="color:#A0A0AE;font-size:10px;line-height:1.25">' +
            Math.round(t.cpd) + '</div>' +
          '<div style="color:#333;font-weight:600;line-height:1.25">' +
            t.cph.toFixed(2) + '</div>' +
        '</td>';
      }
    }

    for (const d of dates) {
      if (!scIsActiveOn(e, d)) {
        html += '<td style="' + tdBase + ';text-align:center;color:#E5E1DA">·</td>';
        continue;
      }
      const v = daily[d];
      const txt = (v > 0) ? v.toFixed(2) : '—';
      const color = (v > 0) ? '#333' : '#C0BDB5';
      html += '<td style="' + tdBase + ';text-align:center;color:' + color +
              ';font-variant-numeric:tabular-nums">' + txt + '</td>';
    }

    html += '<td style="' + tdBase + ';text-align:center;white-space:nowrap">' +
      '<button type="button" class="btn sm" data-apply="' + esc(e.name) + '"' +
        ' style="padding:4px 10px;font-size:11.5px;margin-right:4px;background:#E7ECF5;color:#5C7099;border:1px solid #C9D4E8"' +
        ' title="把 P90 生效值应用到本排班周期的每一天">应用</button>' +
      '<button type="button" class="btn sm" data-reset="' + esc(e.name) + '"' +
        (ov ? '' : ' disabled') +
        ' style="padding:4px 10px;font-size:11.5px">恢复</button>' +
    '</td></tr>';
  }
  html += '</tbody></table>';

  /* ★ 一键应用按钮：把所有员工的当前 P90 生效值写入本周期每一天 */
  const allCanApply = emps.length > 0 && dates.length > 0;
  el.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin:0 0 8px;flex-wrap:wrap">' +
      '<p class="muted" style="font-size:11.5px;margin:0;line-height:1.6;flex:1 1 auto">' +
        '日 CPH = 当日 CASE / 8；自动 CPH = 日 CPD 最高三天求平均后 / 8（无记录则用同组同事均值兜底）；' +
        '点「应用」把 P90 生效值写入本周期每一天。' +
      '</p>' +
      '<button type="button" id="scCphApplyAll" class="btn sm"' +
        (allCanApply ? '' : ' disabled') +
        ' style="flex:none;padding:5px 12px;font-size:12px;background:#E7ECF5;' +
        'color:#5C7099;border:1px solid #C9D4E8;font-weight:600">' +
        '⚡ 一键应用全部</button>' +
    '</div>' + html;

  /* ---------- 事件：一键应用全部 ---------- */
  const applyAllBtn = document.getElementById('scCphApplyAll');
  if (applyAllBtn) {
    applyAllBtn.addEventListener('click', () => {
      if (!dates.length) { toast('请先设置排班周期'); return; }
      let empCnt = 0, dayCnt = 0;
      for (const e of emps) {
        const auto = pick(S.employeeCPHAuto, e.name);
        const inp  = el.querySelector('input[data-name="' + e.name + '"]');
        const v    = inp ? parseFloat(inp.value) : NaN;
        const val  = (isFinite(v) && v > 0) ? v : auto;
        if (!(val > 0)) continue;
        if (!S.employeeCPHDaily[e.name]) S.employeeCPHDaily[e.name] = {};
        for (const d of dates) {
          if (!scIsActiveOn(e, d)) continue;
          S.employeeCPHDaily[e.name][d] = val;
          dayCnt++;
        }
        empCnt++;
      }
      if (!empCnt) { toast('没有可应用的员工（均无 P90 生效值）'); return; }
      renderScCphGrid();
      toast('✓ 已把 ' + empCnt + ' 位员工的 P90 值应用到 ' + dayCnt + ' 个员工日');
    });
  }

  /* ---------- 事件：手改 P90 生效值 ---------- */
  el.querySelectorAll('input[data-name]').forEach(inp => {
    inp.addEventListener('change', () => {
      const n = inp.dataset.name;
      const v = parseFloat(inp.value);
      const manual = scLoadCphManual();
      if (!S.employeeCPH[n]) S.employeeCPH[n] = {};

      if (isNaN(v) || v <= 0) {
        delete manual[n];
        scSaveCphManual(manual);
        const auto = pick(S.employeeCPHAuto, n);
        for (const h of SC_HOURS) S.employeeCPH[n][h] = auto;
      } else {
        manual[n] = v;
        scSaveCphManual(manual);
        for (const h of SC_HOURS) S.employeeCPH[n][h] = v;
      }
      renderScCphGrid();
    });
  });

  /* ---------- 事件：应用到周期内每一天 ---------- */
  el.querySelectorAll('button[data-apply]').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = btn.dataset.apply;
      const inp = el.querySelector('input[data-name="' + n + '"]');
      const v = inp ? parseFloat(inp.value) : NaN;
      const auto = pick(S.employeeCPHAuto, n);
      const val = (isFinite(v) && v > 0) ? v : auto;
      if (!(val > 0)) { toast('请先在「P90 生效值」里填一个大于 0 的数值'); return; }
      if (!dates.length) { toast('请先设置排班周期'); return; }

      const emp = getEmp(n);
      if (!S.employeeCPHDaily[n]) S.employeeCPHDaily[n] = {};
      let cnt = 0;
      for (const d of dates) {
        if (emp && !scIsActiveOn(emp, d)) continue;
        S.employeeCPHDaily[n][d] = val;
        cnt++;
      }
      renderScCphGrid();
      toast('✓ 已把 ' + val.toFixed(2) + ' 应用到 ' + n + ' 的 ' + cnt + ' 天');
    });
  });

  /* ---------- 事件：恢复自动 ---------- */
  el.querySelectorAll('button[data-reset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = btn.dataset.reset;
      const manual = scLoadCphManual();
      delete manual[n];
      scSaveCphManual(manual);
      const auto = pick(S.employeeCPHAuto, n);
      if (!S.employeeCPH[n]) S.employeeCPH[n] = {};
      for (const h of SC_HOURS) S.employeeCPH[n][h] = auto;
      if (S.employeeCPHDaily[n]) delete S.employeeCPHDaily[n];
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
    resultMap[r.name][r.date] = { shift: r.shift, support: !!r.support };
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
    /* ★ 两行结构：第一行日期，第二行「周X（标签）」小字体 */
    headTop += '<th class="sc-date-h ' + clsCss + '">' +
      '<div class="d">' + esc(d.slice(5)) + '</div>' +
      '<div class="w">周' + WEEKDAY_CN[wd] +
        (tag ? '（<span class="tag">' + tag + '</span>）' : '') +
      '</div>' +
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
      /* ★ 离职日及之后：单元格留空（不显示前置班次 / 不休假标注） */
      if (!scIsActiveOn(e, d)) {
        return '<td class="sc-grid-cell empty" data-r="' + ri + '" data-c="' + ci +
               '" data-name="' + esc(e.name) + '" data-date="' + d + '"></td>';
      }

      /* ★ 调度结果（对象）优先，其次前置草稿（字符串） */
      let s = '';
      let isSupport = false;
      const rr = resultMap[e.name] && resultMap[e.name][d];
      if (rr) {
        s = rr.shift;
        isSupport = !!rr.support;
      } else {
        s = (draftMap[e.name] && draftMap[e.name][d]) || '';
      }
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
      /* ★ 支援博主的班次 → 加一枚「博主」小徽章（不改 s 本体） */
      const cellText = s
        ? (isSupport
            ? esc(s) + '<span style="display:inline-block;margin-left:3px;' +
              'padding:0 3px;font-size:9px;line-height:1.4;border-radius:3px;' +
              'background:#7B8FBF;color:#fff;vertical-align:middle;' +
              'font-weight:400;letter-spacing:.2px">博主</span>'
            : esc(s))
        : '';

      return '<td class="' + cls + '"' + style +
             ' data-r="' + ri + '" data-c="' + ci + '" data-name="' + esc(e.name) + '" data-date="' + d + '">' +
             cellText + '</td>';
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
  if (rr) {
    rr.shift = shift;
    rr.support = false;   /* ★ 手工编辑 → 清掉支援标记 */
  } else if (shift) {
    (S.scheduleResult = S.scheduleResult || []).push({
      date, name, shift, biz: '', support: false
    });
  }
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
  let selectedCount = 0;   /* ★ 本周期内的已选三倍日数 */
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
    selectedCount += selCount;   /* ★ 累计到周期内总数 */

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

  /* 3. 计数：只统计周期覆盖月份内的已选数 */
  const cnt = document.getElementById('scTripleCount');
  const tot = document.getElementById('scTripleTotal');
  if (cnt) cnt.textContent = selectedCount;   /* ★ 周期内计数，不再用 S.scTripleDates.size */
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
      const dateSet = new Set(dates);   // 本周期内的所有日期

      /* ① 先尝试 timor.tech（wage=3），首次会拉取全年数据写入 S.scTripleDates */
      if (typeof initTimorTripleDays === 'function') {
        try { await initTimorTripleDays(); } catch (_) {}
      }

      /* ② 统计 S.scTripleDates 中落在本周期内的三倍日数
            ★ 不再无条件把所有 dates 塞进去——这是之前「全选」BUG 的根源 */
      let inCycleCount = 0;
      for (const d of dateSet) {
        if (S.scTripleDates.has(d)) inCycleCount++;
      }

      if (inCycleCount > 0) {
        toast('🎆 本周期内已勾选 ' + inCycleCount + ' 个三倍工资日（timor API）');
      } else {
        /* ③ timor 无数据 / 与本周期时间不重叠 → 回退 holiday-cn，只处理周期内日期 */
        const map = getHolidayMap();
        let n = 0;
        dates.forEach(d => {
          if (map[d] === 'holiday' && !S.scTripleDates.has(d)) {
            S.scTripleDates.add(d);
            n++;
          }
        });
        toast(n > 0
          ? '🎆 已自动勾选 ' + n + ' 个法定节假日（holiday-cn 兜底）'
          : '未在本周期内匹配到三倍工资日或法定节假日');
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
    '<th>三倍天数 ≥ X</th>' +
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

/* ============================================================
   ★ 排班规则说明面板
   —— 展示：
     ① 当前配置摘要（业务线 / 周期 / 班次池 / 需求规则 / 诉求）
     ② 硬约束（必执行）
     ③ 软约束（打分排序）
   —— 数据实时反映 S 状态，每次 renderSchedulePanel 都会重渲。
   ============================================================ */
function renderScRulesSummary() {
  const el = document.getElementById('scRulesSummary');
  if (!el) return;

  /* ---------- 一、当前配置摘要 ---------- */
  const biz   = S.scBizState || '买手合作';
  const c     = scGetCycle();
  const pool  = S.shiftPoolByBiz[biz] || [];
  const rules = S.shiftReqRules[biz] || [];
  const emps  = scActiveEmployees();

  /* 周期天数 */
  let cycleDays = 0;
  if (c.start && c.end) cycleDays = scDatesBetween(c.start, c.end).length;

  /* 需求规则统计：已确认 / 待补全 */
  let okRules = 0, warnRules = 0;
  for (const r of rules) {
    const ok = Array.isArray(r.dates) && r.dates.length > 0
            && Array.isArray(r.shifts) && r.shifts.length > 0;
    if (ok) okRules++; else warnRules++;
  }

  /* 诉求解析统计 */
  const reqNames = Object.keys(S.parsedRequests || {});
  let reqOk = 0, reqErr = 0;
  for (const n of reqNames) {
    const it = (S.parsedRequests[n] || {});
    if (it.error) reqErr++;
    else if (Array.isArray(it.items) && it.items.length) reqOk++;
  }

  /* 锁定人数 */
  let lockedCount = 0;
  for (const d of (S.scheduleDraft || [])) {
    if (d.shift && d.date >= (c.start || '') && d.date <= (c.end || '')) lockedCount++;
  }

  const tile = (label, value, color) =>
    '<div class="sc-rs-tile">' +
      '<div class="k">' + label + '</div>' +
      '<div class="v"' + (color ? ' style="color:' + color + '"' : '') + '>' + value + '</div>' +
    '</div>';

  const summaryTiles = [
    tile('当前业务线',    esc(biz),                                       '#7B8FBF'),
    tile('排班周期',      c.start && c.end ? (c.start.slice(5) + ' ~ ' + c.end.slice(5)) : '—'),
    tile('周期天数',      cycleDays || '—'),
    tile('在排员工',      emps.length + ' 人'),
    tile('可排班次',      pool.length + ' 个',                             pool.length ? '#6EA980' : '#C98383'),
    tile('需求规则',      rules.length + ' 条' + (warnRules ? '（' + warnRules + ' 条待补全）' : ''),
                                                                warnRules ? '#C98383' : (okRules ? '#6EA980' : '#A0A0AE')),
    tile('前置锁定',      lockedCount + ' 格'),
    tile('员工诉求已解析', reqOk + (reqErr ? ' 成功 / ' + reqErr + ' 失败' : ' 人'),
                                                                reqErr ? '#C98383' : (reqOk ? '#6EA980' : '#A0A0AE'))
  ].join('');

  /* ---------- 二、硬约束 ---------- */
  const hardRules = [
    { code: 'H1', text: '前置排班 / 员工诉求里的明确班次<b>直接锁定</b>，不再重排' },
    { code: 'H2', text: '「只上 X」诉求 → 该员工其他班次<b>全部排除</b>' },
    { code: 'H3', text: '「不上 X」诉求 → 该班次<b>不分配给该员工</b>' },
    { code: 'H4', text: '连续工作天数 <b>≤ 6 天</b>，第 7 天必须休息' },
    { code: 'H5', text: '实际工作天数 <b>≥ 周期天数 − 可休总额</b>（后验告警）' },
    { code: 'H6', text: '每小时缺口 = <b>预测量 − Σ(在岗 × CPH)</b>，缺口时段优先征调' },
    { code: 'H7', text: '已离职员工在<b>离职日当日及之后</b>不参与排班' },
    { code: 'H8', text: '按业务线分池：<b>买手专属 / 博主专属 / 弹性</b>，专属优先，缺口才跨池征调' },
    { code: 'H9', text: '需求目标：<b>规则命中的班次等于每天指定人数</b>（多条规则取最小值；不足时告警）' }
  ];

  /* ---------- 三、软约束（打分） ---------- */
  const softRules = [
    { code: 'S1', score: '+100', text: '「希望上 X」诉求命中 → 加分' },
    { code: 'S2', score: '+300', text: '与<b>昨日同班次</b> → 保持班次一致性，最高优先级' },
    { code: 'S3', score: '-40/次', text: '晚班越多越不倾向再排晚班（均衡）' },
    { code: 'S3·E', score: '-60/次', text: 'E 班专项：避免同一员工连续被排 E 班' },
    { code: 'S4', score: '+5/天', text: '<b>剩余可休天数</b>越多者 → 越优先排班' },
    { code: 'S5', score: '-5/天', text: '<b>连续工作天数</b>越多者 → 越不优先排班' },
    { code: 'S6', score: '+90 / -30', text: '「跟 XXX 一样」 → 与目标人物今日班次一致 / 不一致' }
  ];

  /* ---------- 四、局部搜索（生成后优化） ---------- */
  const searchRules = [
    { text: '<b>晚班均衡</b>：晚班计数极差 &gt; 2 时，随机交换两人某天的工作班次（带硬约束回验）' },
    { text: '<b>休息均衡</b>：同组内实际工作天数差 &gt; 1 时，把多干者某工作日与少干者某放休日对调' }
  ];

  /* ---------- 五、渲染 ---------- */
  const HTML = [
    '<div class="sc-rs-card">',
      '<div class="sc-rs-head">',
        '<span class="sc-rs-title">📋 当前配置摘要</span>',
      '</div>',
      '<div class="sc-rs-tiles">' + summaryTiles + '</div>',
    '</div>',

    '<div class="sc-rs-card">',
      '<div class="sc-rs-head">',
        '<span class="sc-rs-title">🔒 硬约束（保证执行）</span>',
        '<span class="sc-rs-badge">违反则不排</span>',
      '</div>',
      '<ul class="sc-rs-list">',
        hardRules.map(r =>
          '<li><code>' + r.code + '</code><span>' + r.text + '</span></li>'
        ).join(''),
      '</ul>',
    '</div>',

    '<div class="sc-rs-card">',
      '<div class="sc-rs-head">',
        '<span class="sc-rs-title">⚖️ 软约束（打分排序）</span>',
        '<span class="sc-rs-badge">用于候选优先级</span>',
      '</div>',
      '<ul class="sc-rs-list sc-rs-list-soft">',
        softRules.map(r =>
          '<li><code>' + r.code + '</code>' +
            '<span class="sc-rs-score">' + r.score + '</span>' +
            '<span>' + r.text + '</span></li>'
        ).join(''),
      '</ul>',
    '</div>',

    '<div class="sc-rs-card">',
      '<div class="sc-rs-head">',
        '<span class="sc-rs-title">🔁 生成后局部搜索优化</span>',
      '</div>',
      '<ul class="sc-rs-list">',
        searchRules.map(r => '<li><span>' + r.text + '</span></li>').join(''),
      '</ul>',
    '</div>'
  ].join('');

  el.innerHTML = HTML;
}

function renderScDiag() {
  const el = document.getElementById('scDiag');
  if (!el) return;
  const diag = S.scheduleDiag || {};
  if (!diag.dateCount) { el.textContent = ''; return; }

  const baseLine = '排班范围 ' + diag.dateCount + ' 天 / 员工 ' +
    diag.employeeCount + ' 人 / 排班记录 ' + (diag.totalSlots || 0) + ' 条';

  /* ★ 失败分支：红底提示 + 可展开的明细表 */
  if (diag.failed && Array.isArray(diag.mismatches) && diag.mismatches.length) {
    const list = diag.mismatches;
    const underCount = list.filter(x => x.diff < 0).length;
    const overCount  = list.filter(x => x.diff > 0).length;
    const totalGap   = list.reduce((s, x) => s + (x.diff < 0 ? -x.diff : 0), 0);

    const rows = list.map(x => {
      const gapColor = x.diff < 0 ? '#D9363E' : '#C98383';
      const gapTxt   = (x.diff > 0 ? '+' : '') + x.diff;
      return '<tr>' +
        '<td>' + esc(x.date) + '</td>' +
        '<td>' + esc(x.biz) + '</td>' +
        '<td>' + esc(x.shift) + '</td>' +
        '<td style="text-align:right">' + x.need + '</td>' +
        '<td style="text-align:right;color:' + gapColor + ';font-weight:600">' + x.actual + '</td>' +
        '<td style="text-align:right;color:' + gapColor + ';font-weight:600">' + gapTxt + '</td>' +
      '</tr>';
    }).join('');

    el.innerHTML =
      '<div style="padding:10px 14px;background:#F5E5E5;border-radius:10px;' +
        'border-left:3px solid #C98383;color:#A64A4A;line-height:1.85;font-size:12.5px">' +
        '❌ <b>排班失败：班次人数不符合「每天等于」规则，本次未生成。</b><br>' +
        '不匹配 <b>' + list.length + '</b> 处' +
        '（不足 <b>' + underCount + '</b> 处 / 累计缺口 <b>' + totalGap + '</b> 人' +
        (overCount ? '，超编 <b>' + overCount + '</b> 处' : '') + '）。<br>' +
        '<span style="color:#B36A00">' + esc(baseLine) + '（未更新排班表，保留上次结果）</span><br>' +
        '<span style="color:#B36A00">请调小规则人数、增加可用员工、或放宽员工诉求/离职限制后重试。</span>' +
      '</div>' +
      '<details style="margin-top:10px">' +
        '<summary style="cursor:pointer;font-size:12.5px;color:#B36A00;' +
          'user-select:none;outline:none;padding:4px 0">' +
          '📋 点击查看不匹配明细（共 ' + list.length + ' 条）' +
        '</summary>' +
        '<div class="table-scroll-x" style="margin-top:8px;max-height:340px;overflow:auto">' +
          '<table class="rp-table"><thead><tr>' +
            '<th>日期</th><th>业务线</th><th>班次</th>' +
            '<th style="text-align:right">规则人数</th>' +
            '<th style="text-align:right">实际人数</th>' +
            '<th style="text-align:right">差额</th>' +
          '</tr></thead><tbody>' + rows + '</tbody></table>' +
        '</div>' +
      '</details>';
    return;
  }

  /* 常规分支：保持原样 */
  const text = baseLine + '　|　' +
    ((diag.warnings && diag.warnings.length)
      ? '⚠ 诊断：' + diag.warnings.join('；')
      : '✓ 无硬约束告警');
  el.textContent = text;
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
      try {
        const r = generateSchedule();
        renderSchedulePanel();
        if (r == null && S.scheduleDiag && S.scheduleDiag.failed) {
          const n = (S.scheduleDiag.mismatches || []).length;
          toast('❌ 排班失败：' + n + ' 处班次人数不符合规则，详见诊断栏');
        }
      } catch (e) {
        console.error(e);
        toast('排班失败：' + e.message);
      }
    });
    bind('btnScExport', scExportXlsx);
    bind('btnScCopy', scCopyMarkdown);
    bind('btnScClear', () => {
      S.shiftPool = []; S.shiftReqs = {};
      S.shiftReqRules = { '买手合作': [], '博主合作': [] };
      S.scheduleResult = [];
      S.parsedRequests = {}; S.scheduleDiag = {};
      if (S.shiftPoolByBiz) {
        for (const biz of SC_BIZ_LIST) {
          if (Array.isArray(S.shiftPoolByBiz[biz])) S.shiftPoolByBiz[biz] = [];
        }
      }
      /* ★ 清空持久化的选择习惯 */
      if (S.scNoSupportBlogger) S.scNoSupportBlogger.clear();
      try {
        localStorage.removeItem(SC_PREF_KEY_POOL);
        localStorage.removeItem(SC_PREF_KEY_EXCL);
      } catch (_) {}
      /* 折叠状态也复位（下次打开默认展开） */
      S.scReqCollapsed = false;
      scSaveReqCollapsed();
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
/* 单班次需求上限（新规则模式）：
   · 遍历该业务线的所有规则，找匹配 (date, shift) 的规则
   · 若任一规则匹配且 max 有值 → 取「最小上限」（多规则同时命中时最严格者生效）
   · 若匹配但 max 为空 → 无限制（返回 null）
   · 若无规则匹配 → 无限制（返回 null） */
function scGetShiftReq(biz, shift, date) {
  const rules = (S.shiftReqRules && S.shiftReqRules[biz]) || [];
  let matched = false;
  let minCap = null;
  for (const r of rules) {
    if (!Array.isArray(r.dates)  || r.dates.indexOf(date) < 0)   continue;
    if (!Array.isArray(r.shifts) || r.shifts.indexOf(shift) < 0) continue;
    matched = true;
    const cap = Number(r.max);
    if (isFinite(cap) && cap >= 0) {
      if (minCap == null || cap < minCap) minCap = cap;
    }
  }
  if (!matched) return null;
  return minCap;
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

/* ==================== 日度量级匹配 · 每日总览 + 时段明细 ==================== */
function renderScCoverageDaily() {
  const bizBar   = document.getElementById('scCovBiz');
  const dateWrap = document.getElementById('scCovDateWrap');
  const el       = document.getElementById('scCoverageDaily');
  const el2      = document.getElementById('scCoverage');
  if (!el) return;

  /* 未生成排班结果：清空控件与表格，仅显示提示 */
  if (!(S.scheduleResult || []).length) {
    if (bizBar)   bizBar.innerHTML   = '';
    if (dateWrap) dateWrap.innerHTML = '';
    el.innerHTML = '<p class="muted">生成排班后显示日度量级匹配。</p>';
    if (el2) el2.innerHTML = '';
    return;
  }

  const c = scGetCycle();
  const dates = scDatesBetween(c.start, c.end);
  if (!dates.length) {
    if (bizBar)   bizBar.innerHTML   = '';
    if (dateWrap) dateWrap.innerHTML = '';
    el.innerHTML = '<p class="muted">排班周期无效。</p>';
    if (el2) el2.innerHTML = '';
    return;
  }

  /* 视图状态兜底 */
  if (!S.scCoverageSel || !(S.scCoverageSel.bizSet instanceof Set)) {
    S.scCoverageSel = { bizSet: new Set(SC_BIZ_LIST), date: '' };
  }
  if (dates.indexOf(S.scCoverageSel.date) < 0) S.scCoverageSel.date = dates[0];

  /* 业务线多选 chips */
  if (bizBar) {
    bizBar.innerHTML = SC_BIZ_LIST.map(b =>
      '<span class="chip' + (S.scCoverageSel.bizSet.has(b) ? ' on' : '') +
      '" data-biz="' + esc(b) + '">' + esc(b) + '</span>'
    ).join('');
    bizBar.querySelectorAll('.chip').forEach(ch => {
      ch.addEventListener('click', () => {
        const b = ch.dataset.biz;
        if (S.scCoverageSel.bizSet.has(b)) S.scCoverageSel.bizSet.delete(b);
        else S.scCoverageSel.bizSet.add(b);
        if (!S.scCoverageSel.bizSet.size) S.scCoverageSel.bizSet = new Set(SC_BIZ_LIST);
        renderScCoverageDaily();
      });
    });
  }

  /* 日期下拉（带星期与日期类型标签） */
  if (dateWrap) {
    const opts = dates.map(d => {
      const wd  = WEEKDAY_CN[scWeekdayOf(d)];
      const cls = classifyDate(d);
      const tag = cls === 'holiday' ? '节假日'
                : cls === 'workday' ? '调休上班'
                : cls === 'weekend' ? '周末' : '工作日';
      return '<option value="' + d + '"' +
        (d === S.scCoverageSel.date ? ' selected' : '') + '>' +
        d + ' 周' + wd + '（' + tag + '）</option>';
    }).join('');
    dateWrap.innerHTML =
      '<select id="scCovDateSel" style="width:100%;max-width:320px;padding:8px 10px;' +
      'border:1px solid var(--border-2,#ddd);border-radius:8px;font-family:inherit;' +
      'font-size:13px;background:#fff;outline:none">' + opts + '</select>';
    const sel = document.getElementById('scCovDateSel');
    if (sel) {
      sel.addEventListener('change', () => {
        S.scCoverageSel.date = sel.value;
        renderScCoverageDaily();
      });
    }
  }

  const date = S.scCoverageSel.date;
  const bizList = SC_BIZ_LIST.filter(b => S.scCoverageSel.bizSet.has(b));
  if (!bizList.length) bizList.push(SC_BIZ_LIST[0]);

  const demandAll = {};
  for (const biz of bizList) demandAll[biz] = scComputeDemandTable(biz, [date]);

  /* —— 区域 4：所选日期 · 各业务线汇总 —— */
  const summaryRows = [];
  for (const biz of bizList) {
    let forecast = 0;
    if (S.volumeForecast && S.volumeForecast[biz] && S.volumeForecast[biz][date] > 0) {
      forecast = S.volumeForecast[biz][date];
    } else if (demandAll[biz] && demandAll[biz][date]) {
      for (const h of SC_HOURS) forecast += demandAll[biz][date][h] || 0;
    }

    let capacity = 0;
    for (const r of S.scheduleResult) {
      if (r.date !== date || r.biz !== biz) continue;
      const mins = (S.shiftPeriods || {})[r.shift] || {};
      const cph  = (S.employeeCPH || {})[r.name] || {};
      for (const h in mins) {
        if (mins[h] > 0 && cph[h]) capacity += cph[h] * (mins[h] / 60);
      }
    }

    const gap    = capacity - forecast;
    const gapPct = forecast > 0 ? (gap / forecast * 100) : 0;
    const ok     = gap >= -forecast * 0.02;
    const color  = ok ? '#6EA980' : '#D9363E';

    summaryRows.push('<tr>' +
      '<td>' + esc(biz) + '</td>' +
      '<td style="text-align:right">' + Math.round(forecast) + '</td>' +
      '<td style="text-align:right">' + Math.round(capacity) + '</td>' +
      '<td style="text-align:right;color:' + color + ';font-weight:600">' +
        (gap >= 0 ? '+' : '') + Math.round(gap) + '</td>' +
      '<td style="text-align:right;color:' + color + ';font-weight:600">' +
        (gapPct >= 0 ? '+' : '') + gapPct.toFixed(1) + '%</td>' +
      '<td style="text-align:center;color:' + color + ';font-weight:600">' +
        (ok ? '✓ 承接充足' : '⚠ 承接不足') + '</td>' +
      '</tr>');
  }

  const wd = WEEKDAY_CN[scWeekdayOf(date)];
  el.innerHTML =
    '<div class="muted" style="font-size:12px;margin-bottom:8px">' +
      '📅 <b>' + date + '</b> 周' + wd + ' · 业务线：<b>' +
      bizList.map(b => esc(b)).join(' / ') + '</b></div>' +
    '<div class="table-scroll-x"><table class="rp-table"><thead><tr>' +
      '<th>业务线</th><th style="text-align:right">预测量</th>' +
      '<th style="text-align:right">可承接量</th><th style="text-align:right">缺口</th>' +
      '<th style="text-align:right">缺口率</th><th>状态</th>' +
      '</tr></thead><tbody>' + summaryRows.join('') + '</tbody></table></div>';

  if (!el2) return;

  /* —— 区域 5：所选日期 · 逐时段明细 —— */
  const head = '<tr><th>业务线</th><th>时段</th>' +
    '<th style="text-align:right">预测量</th>' +
    '<th style="text-align:right">可承接量</th>' +
    '<th style="text-align:right">缺口</th>' +
    '<th style="text-align:center">状态</th></tr>';

  const detailRows = [];
  for (const biz of bizList) {
    const cap = {};
    for (const r of S.scheduleResult) {
      if (r.date !== date || r.biz !== biz) continue;
      const mins = (S.shiftPeriods || {})[r.shift] || {};
      const cph  = (S.employeeCPH || {})[r.name] || {};
      for (const h in mins) {
        if (mins[h] > 0 && cph[h]) cap[h] = (cap[h] || 0) + cph[h];
      }
    }
    const demand = (demandAll[biz] && demandAll[biz][date]) || {};

    let needSum = 0, capSum = 0;
    for (const h of SC_HOURS) { needSum += demand[h] || 0; capSum += cap[h] || 0; }
    const sumGap = capSum - needSum;
    const sumOk  = sumGap >= -needSum * 0.02;
    const sumClr = needSum > 0 ? (sumOk ? '#6EA980' : '#D9363E') : '#8B8B8B';

    detailRows.push(
      '<tr style="background:#F4F3EF;font-weight:600">' +
      '<td>' + esc(biz) + '</td>' +
      '<td style="text-align:center">合计</td>' +
      '<td style="text-align:right">' + Math.round(needSum) + '</td>' +
      '<td style="text-align:right">' + Math.round(capSum) + '</td>' +
      '<td style="text-align:right;color:' + sumClr + '">' +
        (needSum > 0 ? ((sumGap >= 0 ? '+' : '') + Math.round(sumGap)) : '—') + '</td>' +
      '<td style="text-align:center;color:' + sumClr + '">' +
        (needSum > 0 ? (sumOk ? '✓' : '⚠') : '—') + '</td>' +
      '</tr>'
    );

    for (const h of SC_HOURS) {
      const need = Math.round(demand[h] || 0);
      const got  = Math.round(cap[h] || 0);
      const bad  = need > 0 && got < need;
      const clr  = need > 0 ? (bad ? '#D9363E' : '#6EA980') : '#8B8B8B';
      const gapH = got - need;
      detailRows.push(
        '<tr>' +
        '<td>' + esc(biz) + '</td>' +
        '<td style="text-align:center">' + h + ':00</td>' +
        '<td style="text-align:right">' + (need || '—') + '</td>' +
        '<td style="text-align:right">' + (got || (need ? 0 : '—')) + '</td>' +
        '<td style="text-align:right;color:' + clr + '">' +
          (need > 0 ? ((gapH >= 0 ? '+' : '') + gapH) : '—') + '</td>' +
        '<td style="text-align:center;color:' + clr + '">' +
          (need > 0 ? (bad ? '⚠' : '✓') : '—') + '</td>' +
        '</tr>'
      );
    }
  }

  el2.innerHTML = '<div class="table-scroll-x"><table class="rp-table"><thead>' +
    head + '</thead><tbody>' + detailRows.join('') + '</tbody></table></div>';
}