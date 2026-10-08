/* ============================================================
   创作者数据分析 · 智能排班系统（dashboard-schedule.js）
   数据源：S.scheduleDraft / S.shiftPeriods / S.shiftMeta（core 解析）
   依赖：S.roster / S.records / S.volumeForecast / getHolidayMap /
        dateAdd / normPeriod / empBiz / esc / toast / buildXlsxBlob
   ============================================================ */
'use strict';

/* ==================== 常量 ==================== */
const SC_LATE_SHIFTS = ['R','D','E1','E2','R（短）','D（短）','E（短）'];
const SC_EARLY_SHIFTS = ['B1','B2','K1','K2','B（短）','K（短）'];
const SC_MID_SHIFTS   = ['S','C','C（短）'];
const SC_REST_SHIFTS  = ['放休','放休0.5'];
const SC_LEAVE_SHIFTS = ['事假','病假','丧假','婚假'];
const SC_BASE_HOLIDAY = 6;
const SC_TRIPLE_BONUS = 1;
const SC_HOURS = PREDICT_PERIODS;        // ['9'..'23']
const SC_MAX_STREAK = 6;                 // H4：连续工作上限（第 7 天必须休）
const SC_BIZ_LIST = ['买手合作', '博主合作'];

/* ==================== 班次 / 日期工具 ==================== */
function scIsLateShift(shift) {
  if (!shift) return false;
  if (SC_LATE_SHIFTS.indexOf(shift) >= 0) return true;
  const meta = S.shiftMeta && S.shiftMeta[shift];
  if (!meta || !meta.endTime) return false;
  const m = /^(\d{1,2}):/.exec(meta.endTime);
  if (!m) return false;
  const h = parseInt(m[1], 10);
  return h >= 22 || h === 0;
}
function scIsRestShift(shift)  { return !!shift && SC_REST_SHIFTS.indexOf(shift) >= 0; }
function scIsLeaveShift(shift) { return !!shift && SC_LEAVE_SHIFTS.indexOf(shift) >= 0; }
function scIsWorkingShift(shift) {
  if (!shift) return false;
  if (scIsRestShift(shift) || scIsLeaveShift(shift)) return false;
  return !!(S.shiftPeriods && S.shiftPeriods[shift]);
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

/* ==================== 员工池 ==================== */
function scActiveEmployees() {
  const c = scGetCycle();
  const start = c.start || S.latestDate || '';
  return (S.roster || []).filter(e => {
    if (!e.name) return false;
    if (e.resignDate && start && e.resignDate < start) return false;   // H7 已离职不参与
    return true;
  });
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

/* ==================== 可休天数 ==================== */
function calcHolidayQuota(name) {
  const c = scGetCycle();
  const dates = scDatesBetween(c.start, c.end);
  const holidays = getHolidayMap();
  let tripleDays = 0;   // 本周期内法定节假日出勤天数（3 倍工资）
  let used = 0;         // 已休天数（放休按 restDays 折算）
  for (const d of S.scheduleDraft) {
    if (d.name !== name) continue;
    if (dates.length && dates.indexOf(d.date) < 0) continue;
    if (holidays[d.date] === 'holiday' && scIsWorkingShift(d.shift)) tripleDays++;
    if (scIsRestShift(d.shift)) used += (S.shiftMeta[d.shift] && S.shiftMeta[d.shift].restDays) || 1;
  }
  const base = SC_BASE_HOLIDAY;
  const total = Math.round((base + tripleDays * SC_TRIPLE_BONUS) * 100) / 100;
  used = Math.round(used * 100) / 100;
  return { base, tripleDays, used, remain: Math.max(0, total - used), total };
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

  /* ---- H1 硬约束预锁定：草稿里的放休/请假直接锁定 ---- */
  const locked = {};
  for (const e of scActiveEmployees()) {
    locked[e.name] = {};
    for (const d of dates) {
      const draft = S.scheduleDraft.find(x => x.name === e.name && x.date === d);
      if (draft && (scIsRestShift(draft.shift) || scIsLeaveShift(draft.shift))) {
        locked[e.name][d] = draft.shift;
      }
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
  /* S2 班次一致性（与昨日同班次） */
  if (ctx.lastShift[e.name] === shift) s += 80;
  /* S3 晚班均衡（晚班计数越多越不倾向再排晚班） */
  if (scIsLateShift(shift)) {
    const st = ctx.stats[e.name] || {};
    const lateCount = (st.R || 0) + (st.D || 0) + (st.E1 || 0) + (st.E2 || 0);
    s -= lateCount * 20;
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

/* 未排到的人 → 放休 */
function scFillRest(ctx, date) {
  for (const e of scActiveEmployees()) {
    if (ctx.assigned[date][e.name]) continue;
    ctx.assigned[date][e.name] = '放休';
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
    const quota = (q.total != null) ? q.total : SC_BASE_HOLIDAY;
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
  const c = scGetCycle();
  if (!c.start && S.latestDate) {
    c.start    = S.latestDate;
    c.end      = dateAdd(S.latestDate, 13);
    c.reqStart = c.start;
    c.reqEnd   = c.end;
    scSetCycle(c);
  } else if (c.start && !c.reqStart) {
    c.reqStart = c.start;
    c.reqEnd   = c.end || '';
    scSetCycle(c);
  }
  const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
  set('scCycleStart', c.start);
  set('scCycleEnd',   c.end);
  set('scReqStart',   c.reqStart);
  set('scReqEnd',     c.reqEnd);

  ['scCycleStart','scCycleEnd','scReqStart','scReqEnd'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el._scBound) {
      el._scBound = true;
      el.addEventListener('change', () => {
        scSetCycle({
          start:    (document.getElementById('scCycleStart') || {}).value || '',
          end:      (document.getElementById('scCycleEnd')   || {}).value || '',
          reqStart: (document.getElementById('scReqStart')   || {}).value || '',
          reqEnd:   (document.getElementById('scReqEnd')     || {}).value || '',
        });
        renderSchedulePanel();
      });
    }
  });

  const alphaEl = document.getElementById('scCphAlpha');
  if (alphaEl && !alphaEl._scBound) {
    alphaEl._scBound = true;
    alphaEl.addEventListener('change', () => {
      let alpha = parseFloat(alphaEl.value);
      if (!isFinite(alpha) || alpha <= 0) { alpha = 1.0; alphaEl.value = '1.00'; }
      if (!(S.records || []).length) { toast('尚无数据，无法重算 CPH'); return; }
      try {
        calcAllEmployeeCPH();
        renderScCphGrid();
        toast('✓ 已按 α=' + alpha.toFixed(2) + ' 重算 CPH');
      } catch (e) {
        console.warn('[scCphAlpha]', e);
        toast('重算 CPH 失败：' + e.message);
      }
    });
  }

  /* CPH 尚未计算时先算一遍，便于预览与手动覆盖 */
  if ((!S.employeeCPH || !Object.keys(S.employeeCPH).length) && (S.records || []).length) {
    try { calcAllEmployeeCPH(); } catch (_) {}
  }

  renderScShiftPool();
  renderScReqGrid();
  renderScCphGrid();
  renderScReqList();
  renderScHolidayGrid();
  renderScResult();
  renderScCoverage();
  renderScDiag();
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
  if (!emps.length) { el.innerHTML = '<p class="muted">无可用员工（请先导入花名册）。</p>'; return; }
  const header = '<tr><th>姓名</th>' + SC_HOURS.map(h => '<th>' + h + '时</th>').join('') + '</tr>';
  const rows = emps.map(e => {
    const cph = (S.employeeCPH || {})[e.name] || {};
    return '<tr><td>' + esc(e.name) + '</td>' + SC_HOURS.map(h =>
      '<td><input type="number" min="0" step="0.1" style="width:60px" data-name="' + esc(e.name) + '" data-hour="' + h + '" value="' + (cph[h] || 0).toFixed(2) + '"></td>'
    ).join('') + '</tr>';
  }).join('');
  el.innerHTML = '<table>' + header + rows + '</table>';
  el.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      const n = inp.dataset.name, h = inp.dataset.hour;
      if (!S.employeeCPH[n]) S.employeeCPH[n] = {};
      S.employeeCPH[n][h] = parseFloat(inp.value) || 0;
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

function renderScHolidayGrid() {
  const el = document.getElementById('scHolidayGrid');
  if (!el) return;
  const emps = scActiveEmployees();
  if (!emps.length) { el.innerHTML = '<p class="muted">无可用员工。</p>'; return; }
  const rows = emps.map(e => {
    const q = (S.holidayQuota || {})[e.name] || calcHolidayQuota(e.name);
    return '<tr><td>' + esc(e.name) + '</td><td>' + q.base + '</td><td>' + q.tripleDays + '</td><td>' + q.used.toFixed(2) + '</td><td>' + q.remain.toFixed(2) + '</td></tr>';
  }).join('');
  el.innerHTML = '<table><tr><th>姓名</th><th>基础</th><th>3倍天数</th><th>已休</th><th>剩余</th></tr>' + rows + '</table>';
}

function renderScResult() {
  const el = document.getElementById('scResult');
  if (!el) return;
  if (!(S.scheduleResult || []).length) { el.innerHTML = '<p class="muted">尚未生成排班。</p>'; return; }
  const c = scGetCycle();
  const dates = scDatesBetween(c.start, c.end);
  const emps = scActiveEmployees();
  const map = {};
  for (const r of S.scheduleResult) {
    if (!map[r.name]) map[r.name] = {};
    map[r.name][r.date] = r.shift;
  }
  const header = '<tr><th>姓名</th>' + dates.map(d => '<th>' + esc(d.slice(5)) + '</th>').join('') + '</tr>';
  const rows = emps.map(e => {
    const m = map[e.name] || {};
    return '<tr><td>' + esc(e.name) + '</td>' + dates.map(d => {
      const s = m[d] || '';
      const cls = scIsLateShift(s) ? 'sc-late' : scIsRestShift(s) ? 'sc-rest' : scIsLeaveShift(s) ? 'sc-leave' : 'sc-work';
      return '<td class="' + cls + '">' + esc(s) + '</td>';
    }).join('') + '</tr>';
  }).join('');
  el.innerHTML = '<table>' + header + rows + '</table>';
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
  return S.scheduleCycle || { start:'', end:'', reqStart:'', reqEnd:'' };
}
function scSetCycle(c) {
  S.scheduleCycle = Object.assign({ start:'', end:'', reqStart:'', reqEnd:'' }, c || {});
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