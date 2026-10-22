/* =====================================================================
 *  高速 XLSX 解析器（基于 SheetJS）
 *  说明：极其庞大的数据（几十万行）也能在数秒内解析完成，不卡顿。
 * ===================================================================== */
window.XlsxParser = (function () {
  'use strict';

  async function parseWorkbook(arrayBuffer, onProgress) {
    if (typeof XLSX === 'undefined') {
      throw new Error('SheetJS 库未加载，请确认 CDN 或本地 xlsx.full.min.js 是否存在且引入正确。');
    }
    
    if (onProgress) onProgress(10, '初始化极速解析引擎…');
    
    // 使用 Promise + setTimeout 让出主线程，避免大文件导致 UI 假死
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          if (onProgress) onProgress(30, '正在解析工作簿…');
          
          // 使用 SheetJS 高速解析
          const workbook = XLSX.read(arrayBuffer, {
            type: 'array',
            cellDates: true,    // 自动将日期解析为 Date 对象
            cellNF: true,       // 保留数字格式
            raw: true,          // 保留最原始的数据类型（数字、布尔、日期）
            dense: true         // ★ 开启紧凑模式，大幅提升大文件解析速度
          });

          const result = [];
          const sheetNames = workbook.SheetNames;
          const total = sheetNames.length;

          for (let i = 0; i < total; i++) {
            const name = sheetNames[i];
            if (onProgress) onProgress(30 + Math.round((i / total) * 60), '解析工作表：' + name);
            
            const worksheet = workbook.Sheets[name];
            
            // 转换为二维数组，header: 1 表示输出数组的数组；defval: '' 保证空单元格不被跳过
            const rows = XLSX.utils.sheet_to_json(worksheet, { 
              header: 1, 
              defval: ''
            });

            // 由于旧版排班功能已移除，不再需要高开销的逐格 XML 颜色解析，传入空数组以保证极速
            result.push({ name: name, rows: rows, cellColors: [] });
          }

          if (onProgress) onProgress(100, '解析完成');
          resolve(result);
        } catch (err) {
          console.error('[XlsxParser] 解析失败:', err);
          reject(err);
        }
      }, 50); // 延时 50ms 确保 UI 渲染出进度条
    });
  }

  return { parseWorkbook };
})();