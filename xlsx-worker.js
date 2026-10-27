/* =====================================================================
 *  xlsx-worker.js —— SheetJS 解析 Worker
 *  职责：把 XLSX.read() + sheet_to_json() 从主线程移到独立线程，
 *        主线程在解析期间保持完全可交互。
 *  输入：{ buffer: ArrayBuffer, neededSheets: string[] | null }
 *  输出：progress / done / error 三类消息
 * ===================================================================== */

/* ★ SheetJS 从 CDN 加载，与 index.html 主线程使用的版本保持一致。
   若项目改为本地库（如 lib/xlsx.full.min.js），把下面这行改成对应相对路径即可。 */
try {
    // 统一使用稳定的国内镜像 CDN
    importScripts('https://jsd.onmicrosoft.cn/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  } catch (e) {
    self.postMessage({
      type: 'error',
      message: 'SheetJS 加载失败：CDN 不可达，请检查网络。',
    });
  }

self.onmessage = function (e) {
  const data = e.data || {};
  const buffer = data.buffer;
  const neededSheets = data.neededSheets;

  if (typeof XLSX === 'undefined') {
    self.postMessage({ type: 'error', message: 'SheetJS 未就绪' });
    return;
  }

  let wb;
  try {
    wb = XLSX.read(buffer, {
      type: 'array',
      dense: true,          /* ★ 必须：绕过 Chrome 对大对象的性能退化 */
      cellDates: false,     /* ★ 关闭：日期交给主线程 parseDate 处理 */
      cellNF: false,        /* ★ 关闭：不保留数字格式 */
      cellStyles: false,    /* ★ 关闭：不解析样式 */
      cellFormula: false,   /* ★ 关闭：不需要公式 */
      cellHTML: false,      /* ★ 关闭：不需要富文本 */
      raw: true,
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: 'XLSX.read 失败：' + (err && err.message || err) });
    return;
  }

  const names = wb.SheetNames || [];
  const targets = (neededSheets && neededSheets.length)
    ? names.filter(function (n) { return neededSheets.indexOf(n) !== -1; })
    : names;

  if (!targets.length) {
    self.postMessage({ type: 'error', message: '目标 sheet 均未在文件中找到' });
    return;
  }

  const result = [];
  for (let i = 0; i < targets.length; i++) {
    const name = targets[i];
    const ws = wb.Sheets[name];
    if (!ws) continue;

    let rows = [];
    
    try {
      /* ★ 极限提速：在 dense 模式下，直接读取二维单元格数组 ws['!data'] */
      const rawData = ws['!data'] || [];
      
      // 1. 预扫描最大列数，避免动态扩容
      let maxCols = 0;
      for (let r = 0; r < rawData.length; r++) {
        if (rawData[r] && rawData[r].length > maxCols) maxCols = rawData[r].length;
      }
      
      // 2. 快速构建纯值二维数组（不跳过任何行）
      for (let r = 0; r < rawData.length; r++) {
        const rowCells = rawData[r];
        if (!rowCells) { rows.push([]); continue; }
        
        const rowArr = new Array(maxCols);
        for (let c = 0; c < maxCols; c++) {
          const cell = rowCells[c];
          if (!cell) { 
            rowArr[c] = ''; 
          } else {
            // 提取原始值 v，如果没有则退回格式化文本 w
            rowArr[c] = cell.v !== undefined ? cell.v : (cell.w !== undefined ? cell.w : '');
          }
        }
        rows.push(rowArr);
      }
    } catch (err) {
      // 极端异常情况降级回 sheet_to_json
      console.warn('底层读取失败，降级使用 sheet_to_json', err);
      rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    }
    result.push({ name: name, rows: rows, cellColors: [] });

    /* 进度推送：0~100，主线程会再乘 0.85 映射到整体进度 */
    self.postMessage({
      type: 'progress',
      pct: Math.round(((i + 1) / targets.length) * 100),
      sheet: name,
    });

    /* 内存压力检测（仅 Chrome/Edge 有 performance.memory） */
    try {
      if (self.performance && self.performance.memory) {
        const used = self.performance.memory.usedJSHeapSize;
        const limit = self.performance.memory.jsHeapSizeLimit;
        if (limit > 0 && used / limit > 0.85) {
          self.postMessage({
            type: 'error',
            message: '内存占用过高（' + Math.round(used / limit * 100) + '%），请拆分文件后重试',
          });
          return;
        }
      }
    } catch (_) {}
  }

  self.postMessage({ type: 'done', sheets: result });
};