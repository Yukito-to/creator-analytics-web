/* ============================================================
   App 装配入口（原 dashboard-report.js 末尾搬出）
   —— 事件绑定 / 初始化启动 / 全局 Tooltip / sticky 偏移测量
   ============================================================ */
'use strict';

function init() {
  ['peMetric', 'tmMetric'].forEach(id => {
    if (typeof ensureChipContainer === 'function') ensureChipContainer(id);
  });
  bindEvents();
  renderTargetConfig();
  switchView('import');

  /* ★ P2-FIX：测量 topbar + tabs 实际高度，写入 CSS 变量，修复硬编码 sticky 偏移 */
  updateStickyOffsets();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

/* ★ 移动端 Tooltip：点击 ? 号时弹出解释 */
document.addEventListener('click', function(e) {
  const helpEl = e.target.closest('.help');
  if (helpEl && helpEl.getAttribute('data-tip')) {
    e.stopPropagation();
    const tipText = helpEl.getAttribute('data-tip');
    if (typeof toast === 'function') toast(tipText);
    else alert(tipText);
  }
});

/* ★ P2-FIX：动态测量 sticky 偏移，替代 CSS 中的硬编码 52px / 112px */
function updateStickyOffsets() {
  const topbar = document.querySelector('.topbar');
  const tabs   = document.querySelector('.tabs');
  if (!topbar) return;
  const tbRect = topbar.getBoundingClientRect();
  document.documentElement.style.setProperty('--tabs-top', Math.round(tbRect.height) + 'px');
  if (tabs) {
    const tabsRect = tabs.getBoundingClientRect();
    const stickyTop = Math.max(tbRect.bottom, tabsRect.bottom) + 4;
    document.documentElement.style.setProperty('--sc-grid-sticky-top', Math.round(stickyTop) + 'px');
  } else {
    document.documentElement.style.setProperty('--sc-grid-sticky-top', Math.round(tbRect.height + 4) + 'px');
  }
}
window.addEventListener('resize', updateStickyOffsets);
window.addEventListener('load',   updateStickyOffsets);

/* ★ 事件绑定主函数 */
function bindEvents() {
  const on = (sel, evt, fn) => { const el = $(sel); if (el) el.addEventListener(evt, fn); };

  on('#tabs', 'click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    switchView(b.dataset.view);
    if (b.dataset.view === 'report')   renderTargetConfig();
    if (b.dataset.view === 'sla')      renderSLA();
    if (b.dataset.view === 'forecast') { renderForecastConfig(); renderForecastResult(); }
    /* ★ P0-FIX：月报 tab 补刷新分支，避免手动切换时数据不更新 */
    if (b.dataset.view === 'monthly')  { initMonthlyReportOptions(); renderMonthlyReport(); }
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
    S._lastFileName = '';
    S._dataVersion = 0;
    S._allSheetNames = [];   /* ★ P0-FIX：清空 sheet 名记录 */
    S._idx = null;           /* ★ P1-FIX：清空员工索引 */
    S.personSel = new Set();
    S.teamSel = { group: new Set(), batch: new Set(), category: new Set() };
    S.forecastInputs = {};
    S.forecastHolidays = new Set();
    S.forecastWorkdays = new Set();
    try {
      localStorage.removeItem('creator_forecast_holidays');
      localStorage.removeItem('creator_forecast_workdays');
    } catch (_) {}
    if (typeof _resetPerfCache === 'function') _resetPerfCache();
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
    const atCal = $('#peAttCalendar'); if (atCal) { atCal.innerHTML = ''; atCal.classList.add('hidden'); }
    const fc = $('#fcResult'); if (fc) fc.innerHTML = '';
    const fn = $('#fcNotes'); if (fn) fn.innerHTML = '';
    const ftip = $('#fcAutoTip'); if (ftip) { ftip.style.display = 'none'; ftip.innerHTML = ''; }
    const rb = $('#rpBody'); if (rb) rb.innerHTML = '';
    const rc = $('#btnRpCopy'); if (rc) rc.disabled = true;
    const rm = $('#btnRpMd'); if (rm) rm.disabled = true;
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
  on('#s30Biz', 'change', () => {
    S.expandedRows = new Set();
    renderS30();
  });
  on('#rpBiz', 'change', () => { renderTargetConfig(); renderReport(); });
  on('#rpWK', 'change', renderReport);
  on('#btnRpCopy', 'click', copyReport);
  on('#btnRpMd', 'click', downloadReportMd);

  /* ★ P1-FIX：预测视图 change 事件统一用 fcRefresh */
  const fcRefresh = () => { renderForecastConfig(); renderForecastResult(); };
  on('#fcBiz', 'change', fcRefresh);
  on('#fcStartDate', 'change', fcRefresh);
  on('#fcDays', 'change', fcRefresh);
  on('#fcSampleWeeks', 'change', fcRefresh);
  on('#btnFcRun', 'click', renderForecastResult);
  on('#btnFcCopy', 'click', copyForecastMd);
  on('#btnFcClear', 'click', clearForecastInputs);

  const peTabs = $('#peSubTabs');
  if (peTabs && !peTabs._bound) {
    peTabs._bound = true;
    peTabs.addEventListener('click', e => {
      const btn = e.target.closest('.sub-tab');
      if (!btn) return;
      const sub = btn.dataset.sub;
      peTabs.querySelectorAll('.sub-tab').forEach(b => b.classList.toggle('active', b === btn));
      const wrap = document.getElementById('view-person');
      if (!wrap) return;
      wrap.querySelectorAll('.sub-view').forEach(v => v.classList.remove('active'));
      const target = document.getElementById('peSub-' + sub);
      if (target) target.classList.add('active');
      if (sub === 'team' && typeof renderTeam === 'function') renderTeam();
      if (sub === 'emp'  && typeof renderPerson === 'function') renderPerson();
    });
  }
}