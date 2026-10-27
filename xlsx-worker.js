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
      if (!rawData.length) {
        // ★ 空数据时直接降级，避免解析出空结果
        throw new Error('Worker 解析结果为空，降级使用 sheet_to_json');
      }
      
      // 1. 预扫描最大列数，避免动态扩容
      let maxCols = 0;
      let maxRowWithData = -1;
      
      for (let r = 0; r < rawData.length; r++) {
        if (rawData[r] && rawData[r].length > maxCols) maxCols = rawData[r].length;
        // 记录最后一行有数据的行号
        if (rawData[r] && rawData[r].length > 0) maxRowWithData = r;
      }
      
      // 2. 快速构建纯值二维数组，并剔除空行和空列
      for (let r = 0; r <= maxRowWithData; r++) {
        const rowCells = rawData[r];
        if (!rowCells) { 
          rows.push([]); 
          continue; 
        }
        
        const rowArr = new Array(maxCols);
        let hasDataInRow = false;
        
        for (let c = 0; c < maxCols; c++) {
          const cell = rowCells[c];
          if (!cell) { 
            rowArr[c] = ''; 
          } else {
            // 提取原始值 v，如果没有则退回格式化文本 w
            const value = cell.v !== undefined ? cell.v : (cell.w !== undefined ? cell.w : '');
            rowArr[c] = value;
            // 检查是否包含有效数据
            if (value !== '' && value !== null && value !== undefined) {
              hasDataInRow = true;
            }
          }
        }
        
        // 只添加包含有效数据的行（或空行）
        if (hasDataInRow || r === 0) { // 保留第一行（标题行）
          rows.push(rowArr);
        } else if (rows.length > 0) {
          // 如果是空行且不是第一行，则跳过
          // 注意：这里我们只跳过完全空白的行，但保留标题行
        }
      }
      
      // 3. 剔除末尾的空行和空列
      if (rows.length > 0) {
        // 剔除末尾的空行
        while (rows.length > 0 && rows[rows.length - 1].every(cell => cell === '' || cell === null || cell === undefined)) {
          rows.pop();
        }
        
        // 剔除末尾的空列
        if (rows.length > 0 && rows[0].length > 0) {
          let lastNonEmptyCol = -1;
          // 找到最后一个非空列
          for (let c = rows[0].length - 1; c >= 0; c--) {
            let colHasData = false;
            for (let r = 0; r < rows.length; r++) {
              if (rows[r][c] !== '' && rows[r][c] !== null && rows[r][c] !== undefined) {
                colHasData = true;
                break;
              }
            }
            if (colHasData) {
              lastNonEmptyCol = c;
              break;
            }
          }
          
          // 如果找到了非空列，则裁剪掉后面的空列
          if (lastNonEmptyCol >= 0) {
            for (let r = 0; r < rows.length; r++) {
              rows[r] = rows[r].slice(0, lastNonEmptyCol + 1);
            }
          }
        }
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