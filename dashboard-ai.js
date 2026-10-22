/* ============================================================
   创作者数据分析 · 全局交互初始化（业务线切换 / 周次选择 / 事件绑定）
   ============================================================ */
/* ==================== 全局初始化引导 ==================== */
/* ★ 业务线下拉 → 按钮组：
   保留原 <select> 元素（display:none 隐藏），在它前面插入一组按钮。
   按钮点击 → 更新 select.value + 派发 change 事件，
   现有的 on(sel, 'change', ...) 监听器照常工作，业务逻辑无需改动。 */
function initBizSwitchers() {
  const ids = ['#ovBiz','#peBiz','#tmBiz','#s30Biz','#a2Biz','#slaBiz','#rpBiz','#fcBiz'];
  for (const sel of ids) {
    const el = $(sel);
    if (!el || el._bizSwitched) continue;
    el._bizSwitched = true;

    /* 隐藏原 select（保留其 DOM 与 value，作为唯一数据源） */
    el.style.display = 'none';

    /* 生成按钮组 */
    const wrap = document.createElement('div');
    wrap.className = 'biz-switch';
    wrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center';
    wrap.innerHTML = BIZ_LIST.map(b =>
      '<button type="button" class="btn sm" data-biz="' + esc(b) + '">' + esc(b) + '</button>'
    ).join('');

    /* 高亮：当前选中项用 primary 样式，其余保持 sm 灰底 */
    const paint = () => {
      const v = el.value;
      wrap.querySelectorAll('button').forEach(b => {
        const on = b.dataset.biz === v;
        b.classList.toggle('primary', on);
        b.classList.toggle('sm', !on);
      });
    };
    paint();

    wrap.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.biz;
        if (el.value === v) return;
        el.value = v;
        paint();
        /* 派发 change，触发原有监听器 */
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    /* 暴露 paint，供 syncBizSwitchers 在 select.value 被代码改写后调用 */
    el._bizPaint = paint;

    /* 插到 select 前面，与 label 里的其他 flex 子项并排显示 */
    el.parentNode.insertBefore(wrap, el);
  }
}

/* ★ 周次下拉：原生 <select> + .sc-native-select 样式覆盖，保证跨浏览器统一外观。 */
function initWeekPicker() {
  const sel = document.getElementById('rpWK');
  if (!sel) return;

  // 如果包裹层已存在，只需重新渲染选项数据
  let wrap = document.getElementById('rpWK-wrap');
  if (!wrap) {
    // 1. 初次初始化：隐藏原生 select
    sel.style.display = 'none';

    // 2. 创建自定义包裹层
    wrap = document.createElement('div');
    wrap.id = 'rpWK-wrap';
    wrap.style.cssText = 'position:relative; display:inline-block; min-width:240px; font-family:inherit;';

    // 3. 创建展示按钮
    const btn = document.createElement('div');
    btn.id = 'rpWK-btn';
    btn.className = 'sc-native-select';
    btn.style.cssText = 'cursor:pointer; display:flex; align-items:center; justify-content:space-between; user-select:none; padding:8px 12px; font-size:13px; background:#fff; border:1px solid var(--border-2); border-radius:8px; min-height:34px; box-sizing:border-box;';
    
    // 4. 创建下拉列表（max-height: 156px 刚好显示约 4 项）
    const list = document.createElement('div');
    list.id = 'rpWK-list';
    list.style.cssText = 'display:none; position:absolute; top:100%; left:0; right:0; z-index:9999; background:#fff; border:1px solid var(--border-2); border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15); max-height:156px; overflow-y:auto; margin-top:4px; padding:4px; box-sizing:border-box;';

    wrap.appendChild(btn);
    wrap.appendChild(list);
    
    // 5. 将包裹层插到 <label> 的后面，避免触发 label 的默认行为
    const label = sel.closest('label');
    if (label) {
      label.parentNode.insertBefore(wrap, label.nextSibling);
    } else {
      sel.parentNode.insertBefore(wrap, sel.nextSibling);
    }

    // 6. 按钮点击展开/收起
    btn.addEventListener('click', (e) => {
      e.preventDefault(); // 阻止可能的默认行为
      e.stopPropagation(); // 阻止冒泡到 document
      const isOpen = list.style.display === 'block';
      list.style.display = isOpen ? 'none' : 'block';
      
      // 展开时自动滚动到当前选中项
      if (!isOpen) {
        const selItem = list.querySelector('.rpWK-item-active');
        if (selItem) {
          list.scrollTop = selItem.offsetTop - 40;
        }
      }
    });

    // 7. 点击外部关闭（严格判断目标是否在 wrap 内）
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) {
        list.style.display = 'none';
      }
    });

    // 8. 监听原生 select 的 change 事件（同步按钮文字和高亮状态）
    sel.addEventListener('change', () => {
      const currentOpt = sel.options[sel.selectedIndex];
      if (currentOpt) {
        btn.innerHTML = '<span>' + currentOpt.text + '</span><span style="color:#77778A;font-size:10px;margin-left:8px;transform:scaleY(0.8);display:inline-block">▼</span>';
      }
      
      list.querySelectorAll('.rpWK-item').forEach(el => {
        if (el.dataset.val === sel.value) {
          el.className = 'rpWK-item rpWK-item-active';
          el.style.cssText = 'padding:8px 12px; font-size:13px; cursor:pointer; border-radius:6px; background:#E7ECF5; font-weight:600; color:#7B8FBF;';
        } else {
          el.className = 'rpWK-item';
          el.style.cssText = 'padding:8px 12px; font-size:13px; cursor:pointer; border-radius:6px; color:#33333D;';
        }
      });
    });
  }

  // 9. 渲染/更新选项列表
  const btn = document.getElementById('rpWK-btn');
  const list = document.getElementById('rpWK-list');
  const selectedOpt = sel.options[sel.selectedIndex];
  
  if (btn) {
    btn.innerHTML = '<span>' + (selectedOpt ? selectedOpt.text : '暂无周次') + '</span><span style="color:#77778A;font-size:10px;margin-left:8px;transform:scaleY(0.8);display:inline-block">▼</span>';
  }

  if (list) {
    list.innerHTML = Array.from(sel.options).map((opt) => {
      const isSel = opt.value === sel.value;
      return '<div class="rpWK-item' + (isSel ? ' rpWK-item-active' : '') + '" data-val="' + opt.value + '" style="padding:8px 12px; font-size:13px; cursor:pointer; border-radius:6px; ' + (isSel ? 'background:#E7ECF5; font-weight:600; color:#7B8FBF;' : 'color:#33333D;') + '">' + opt.text + '</div>';
    }).join('');

    // 10. 绑定选项点击
    list.querySelectorAll('.rpWK-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = item.dataset.val;
        if (sel.value !== val) {
          sel.value = val;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        list.style.display = 'none';
      });
    });
  }
}

/* ★ 让所有业务线按钮组重新高亮（读各自的 select.value） */
function syncBizSwitchers() {
  const ids = ['#ovBiz','#peBiz','#tmBiz','#s30Biz','#a2Biz','#slaBiz','#rpBiz','#fcBiz'];
  for (const sel of ids) {
    const el = $(sel);
    if (el && el._bizPaint) el._bizPaint();
  }
}

function initSelects() {
  for (const s of ['#ovBiz','#peBiz','#tmBiz','#s30Biz','#a2Biz','#slaBiz','#rpBiz','#fcBiz']) {
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
    /* ★ 最新周次在最上面：渲染时降序（默认选中仍保留最新的逻辑） */
    const wksDesc = wks.slice().reverse();
    rpWK.innerHTML = wksDesc.map(w => '<option value="' + w + '">WK' + w + '（' + wkStartDate(w) + ' ~ ' + wkEndDate(w) + '）</option>').join('') || '<option value="">暂无周次</option>';
    if (cur && wks.some(w => String(w) === cur)) rpWK.value = cur;
    else if (wks.length) rpWK.value = String(wks[wks.length - 1]);
  }
  /* ★ 出勤看板融合到员工看板后，不再需要独立的员工下拉 */
  refreshPersonOptions();
  refreshTeamOptions();
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

  /* ★ 所有业务线下拉 → 按钮组；初始化后再同步一次高亮 */
  initBizSwitchers();
  syncBizSwitchers();

  /* ★ 周次下拉 → 自定义浮层（最多 4 项高度，其余滚动） */
  initWeekPicker();
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
  on('#s30Biz', 'change', renderS30);
  /* ★ 出勤看板已融合到员工看板，「#attName」下拉移除 */
  on('#rpBiz', 'change', () => { renderTargetConfig(); renderReport(); });
  on('#rpWK', 'change', renderReport);
  on('#btnRpCopy', 'click', copyReport);
  on('#btnRpMd', 'click', downloadReportMd);

  on('#fcBiz', 'change', () => { renderForecastConfig(); renderForecastResult(); });
  on('#fcStartDate', 'change', () => { renderForecastConfig(); renderForecastResult(); });
  on('#fcDays', 'change', () => { renderForecastConfig(); renderForecastResult(); });
  /* ★ 样本周数变化 → 日度总量输入框里的预测提示也需要重算；
       renderForecastConfig 内部会自动调用 renderForecastResult，无需重复绑定 */
  on('#fcSampleWeeks', 'change', renderForecastConfig);
  on('#btnFcRun', 'click', renderForecastResult);
  
  on('#btnFcCopy', 'click', copyForecastMd);
  on('#btnFcClear', 'click', clearForecastInputs);

  /* ★ 数据看板 sub-tabs：员工视角 / 团队视角 切换 */
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

      /* 首次切到该视角时主动渲染一次，避免空表 */
      if (sub === 'team' && typeof renderTeam === 'function') renderTeam();
      if (sub === 'emp'  && typeof renderPerson === 'function') renderPerson();
    });
  }
}

function init() {
  ['peMetric', 'tmMetric'].forEach(id => {
    if (typeof ensureChipContainer === 'function') ensureChipContainer(id);
  });
  bindEvents();
  renderTargetConfig();
  switchView('import');
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

/* ============================================================
   END OF dashboard-ai.js
   ============================================================ */

/* ★ 移动端 Tooltip：点击 ? 号时弹出解释 */
document.addEventListener('click', function(e) {
  const helpEl = e.target.closest('.help');
  if (helpEl && helpEl.getAttribute('data-tip')) {
    // 阻止事件冒泡，避免触发表格排序或折叠
    e.stopPropagation();
    const tipText = helpEl.getAttribute('data-tip');
    // 复用 core 里的 toast 函数（如果没有找到 toast，则用 alert 兜底）
    if (typeof toast === 'function') {
      toast(tipText);
    } else {
      alert(tipText);
    }
  }
});