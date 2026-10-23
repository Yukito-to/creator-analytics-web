/* =====================================================================
 *  高速 XLSX 解析器（Worker 优先 + 主线程降级）
 *
 *  路径选择：
 *    · 支持 Worker → 走 xlsx-worker.js（主线程不阻塞）
 *    · 不支持 / Worker 加载失败 → 降级到主线程解析（功能等价）
 *
 *  公开接口：
 *    XlsxParser.parseWorkbook(arrayBuffer, onProgress, neededSheets)
 *      - arrayBuffer   : 文件二进制
 *      - onProgress    : (pct, text) => void
 *      - neededSheets  : string[] | null  仅解析这些 sheet；null = 全解析
 * ===================================================================== */
window.XlsxParser = (function () {
  'use strict';

  /* ==================== 主线程降级实现 ==================== */
  async function parseWorkbookMainThread(arrayBuffer, onProgress, neededSheets) {
    if (typeof XLSX === 'undefined') {
      throw new Error('SheetJS 库未加载，请确认 CDN 或本地 xlsx.full.min.js 是否存在且引入正确。');
    }
    if (onProgress) onProgress(10, '初始化解析引擎…');

    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try {
          if (onProgress) onProgress(20, '正在解析工作簿…');

          const workbook = XLSX.read(arrayBuffer, {
            type: 'array',
            dense: true,
            cellDates: false,
            cellNF: false,
            cellStyles: false,
            cellFormula: false,
            cellHTML: false,
            raw: true,
          });

          const names = workbook.SheetNames || [];
          const targets = (neededSheets && neededSheets.length)
            ? names.filter(function (n) { return neededSheets.indexOf(n) !== -1; })
            : names;

          const result = [];
          for (let i = 0; i < targets.length; i++) {
            const name = targets[i];
            if (onProgress) onProgress(20 + Math.round((i / targets.length) * 70), '解析工作表：' + name);
            const ws = workbook.Sheets[name];
            if (!ws) continue;
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            result.push({ name: name, rows: rows, cellColors: [] });
          }

          if (onProgress) onProgress(100, '解析完成');
          resolve(result);
        } catch (err) {
          console.error('[XlsxParser] 主线程解析失败:', err);
          reject(err);
        }
      }, 30);
    });
  }

  /* ==================== Worker 实现 ==================== */
  function parseWorkbookWorker(arrayBuffer, onProgress, neededSheets) {
    return new Promise(function (resolve, reject) {
      let worker;
      try {
        worker = new Worker('xlsx-worker.js');
      } catch (e) {
        /* Worker 构造失败（如 file:// 协议）→ 直接降级 */
        return parseWorkbookMainThread(arrayBuffer, onProgress, neededSheets).then(resolve, reject);
      }

      let settled = false;
      let timeoutId = null;

      function finish(fn, arg) {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        try { worker.terminate(); } catch (_) {}
        fn(arg);
      }

      timeoutId = setTimeout(function () {
        finish(reject, new Error('解析超时（90s），文件可能过大或已损坏。建议拆分文件后重试。'));
      }, 90000);

      worker.onmessage = function (ev) {
        const d = ev.data || {};
        if (d.type === 'progress') {
          if (onProgress) onProgress(d.pct || 0, '解析 ' + (d.sheet || ''));
        } else if (d.type === 'done') {
          if (onProgress) onProgress(100, '解析完成');
          finish(resolve, d.sheets || []);
        } else if (d.type === 'error') {
          finish(reject, new Error(d.message || 'Worker 解析失败'));
        }
      };

      worker.onerror = function (err) {
        /* Worker 脚本本身加载失败（如 importScripts 出错）→ 降级到主线程。
           注意：为避免 arrayBuffer 被转移后主线程无法降级，此处不使用 transferable。 */
        if (!settled) {
          try { worker.terminate(); } catch (_) {}
          settled = true;
          if (timeoutId) clearTimeout(timeoutId);
          parseWorkbookMainThread(arrayBuffer, onProgress, neededSheets).then(resolve, reject);
        }
      };

      /* ★ 不使用 transferable：保留 arrayBuffer 以便 onerror 时降级 */
      try {
        worker.postMessage({ buffer: arrayBuffer, neededSheets: neededSheets || null });
      } catch (err) {
        finish(reject, err);
      }
    });
  }

  /* ==================== 对外统一入口 ==================== */
  async function parseWorkbook(arrayBuffer, onProgress, neededSheets) {
    if (typeof Worker === 'undefined') {
      return parseWorkbookMainThread(arrayBuffer, onProgress, neededSheets);
    }
    return parseWorkbookWorker(arrayBuffer, onProgress, neededSheets);
  }

  return { parseWorkbook };
})();