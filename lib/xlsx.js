/* =====================================================================
 *  轻量 XLSX 解析器（纯浏览器端 · 无第三方依赖）
 * ===================================================================== */
window.XlsxParser = (function () {
  'use strict';

  async function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('当前浏览器不支持 DecompressionStream，请使用 Chrome 103+');
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function findEOCD(u8) {
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
      if (u8[i] === 0x50 && u8[i+1] === 0x4b && u8[i+2] === 0x05 && u8[i+3] === 0x06) return i;
    }
    return -1;
  }

  async function unzip(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const eocd = findEOCD(u8);
    if (eocd < 0) throw new Error('不是有效的 xlsx（zip 结构缺失）');

    const count = dv.getUint16(eocd + 10, true);
    const cdOff = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder('utf-8');
    const entries = {};
    let p = cdOff;

    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method   = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen  = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const cmtLen   = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      entries[name] = { method, compSize, localOff };
      p += 46 + nameLen + extraLen + cmtLen;
    }

    async function read(name) {
      const e = entries[name];
      if (!e) return null;
      const lo = e.localOff;
      if (dv.getUint32(lo, true) !== 0x04034b50) return null;
      const nLen = dv.getUint16(lo + 26, true);
      const xLen = dv.getUint16(lo + 28, true);
      const start = lo + 30 + nLen + xLen;
      const raw = u8.subarray(start, start + e.compSize);
      if (e.method === 0) return raw;
      if (e.method === 8) return await inflateRaw(raw);
      throw new Error('不支持的压缩算法: ' + e.method);
    }
    return { entries, read };
  }

  function decodeXml(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, e) {
      if (e.charAt(0) === '#') {
        const code = (e.charAt(1) === 'x' || e.charAt(1) === 'X')
          ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return String.fromCodePoint(code); } catch (_) { return m; }
      }
      switch (e) {
        case 'amp': return '&'; case 'lt': return '<'; case 'gt': return '>';
        case 'quot': return '"'; case 'apos': return "'"; case 'nbsp': return ' ';
        default: return m;
      }
    });
  }

  function colToIdx(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }

  function serialToISO(serial) {
    const base = Date.UTC(1899, 11, 30);
    const d = new Date(base + Math.round(serial * 86400000));
    const p = n => String(n).padStart(2, '0');
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }

  /* ★ 用 indexOf 逐段扫描替代全局正则：
       · sharedStrings.xml 常有数十万条 <si>，正则 exec 的重新定位成本很高
       · <t> 文本节点同样用 indexOf 定位，避免每个 <si> 都新建一个 RegExp */
  function parseSST(xml) {
    const out = [];
    if (!xml) return out;

    const siOpen = '<si', siClose = '</si>';
    const tOpen  = '<t',  tClose  = '</t>';
    let pos = 0;
    const n = xml.length;

    while (pos < n) {
      const s = xml.indexOf(siOpen, pos);
      if (s < 0) break;

      /* 确保命中的是 <si> 而不是 <simple> 之类：<si 后面必须是 '>' 或空白 */
      const after = xml.charCodeAt(s + 3);
      if (after !== 0x3E /* > */ && after !== 0x20 && after !== 0x09 && after !== 0x0A && after !== 0x0D) {
        pos = s + 3;
        continue;
      }

      const siBodyStart = xml.indexOf('>', s);
      if (siBodyStart < 0) break;
      const siEnd = xml.indexOf(siClose, siBodyStart);
      if (siEnd < 0) break;

      /* 从 <si> 体内抽取所有 <t>…</t> 文本 */
      let txt = '';
      let tp = siBodyStart + 1;
      while (tp < siEnd) {
        const to = xml.indexOf(tOpen, tp);
        if (to < 0 || to >= siEnd) break;
        const gt = xml.indexOf('>', to);
        if (gt < 0 || gt >= siEnd) break;
        const tc = xml.indexOf(tClose, gt + 1);
        if (tc < 0 || tc > siEnd) break;
        txt += decodeXml(xml.substring(gt + 1, tc));
        tp = tc + 4;
      }
      out.push(txt);
      pos = siEnd + 5;
    }
    return out;
  }

  function parseStyles(xml) {
    const dateXf = new Set();
    if (!xml) return dateXf;
    const customFmt = {};
    const fmtRe = /<numFmt numFmtId="(\d+)" formatCode="([^"]*)"\s*\/>/g;
    let m;
    while ((m = fmtRe.exec(xml))) customFmt[m[1]] = decodeXml(m[2]);

    const builtin = new Set([14,15,16,17,18,19,20,21,22,27,28,29,30,31,32,33,34,35,36,45,46,47,50,51,52,53,54,55,56,57,58]);
    const xfsMatch = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
    if (!xfsMatch) return dateXf;

    const xfRe = /<xf\b([^>]*?)(?:\/>|>)/g;
    let idx = 0, xm;
    while ((xm = xfRe.exec(xfsMatch[1]))) {
      const attrs = xm[1] || '';
      const idM = /numFmtId="(\d+)"/.exec(attrs);
      const id = idM ? parseInt(idM[1], 10) : 0;
      let isDate = builtin.has(id);
      if (!isDate && customFmt[id] != null) {
        const code = customFmt[id].replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '');
        isDate = /[yd]/i.test(code) || /m{1,5}[\/\-]/.test(code);
      }
      if (isDate) dateXf.add(idx);
      idx++;
    }
    return dateXf;
  }

  /* 完整解析 styles.xml：返回 fills 数组 + cellXfs 数组 */
  function parseStylesFull(xml) {
    if (!xml) return { fills: [], xfs: [] };
    const fills = [null];           // fills[0] 通常是 none
    const xfs   = [];

    const fillsM = /<fills[^>]*>([\s\S]*?)<\/fills>/.exec(xml);
    if (fillsM) {
      const fillRe = /<fill[^>]*>([\s\S]*?)<\/fill>|<fill[^>]*\/>/g;
      let fm, first = true;
      while ((fm = fillRe.exec(fillsM[1]))) {
        if (first) { first = false; continue; }
        const inner = fm[1] || '';
        const rgbM = /<fgColor[^>]*rgb="([0-9A-Fa-f]{6,8})"/.exec(inner);
        fills.push(rgbM ? '#' + rgbM[1].slice(-6).toUpperCase() : null);
      }
    }

    const xfsM = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
    if (xfsM) {
      const xfRe = /<xf\b([^>]*?)(?:\/>|>)/g;
      let xm;
      while ((xm = xfRe.exec(xfsM[1]))) {
        const attrs = xm[1] || '';
        const fM = /fillId="(\d+)"/.exec(attrs);
        xfs.push({ fillId: fM ? parseInt(fM[1], 10) : 0 });
      }
    }
    return { fills, xfs };
  }

  /* ★ 模块级共享正则 + 匹配辅助函数：
       大数据下（几十万行 × 若干列）每次调用新建 RegExp 会成为瓶颈，
       这里把 rowRe / cellRe 提到函数外，配合 lastIndex 重置复用；
       同时对每个 cell 的属性做一次「先查 r= 再查 s=/t=」的短路，避免无谓扫描。 */
  const _ROW_RE  = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  const _CELL_RE = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  const _RE_R    = /\br="([A-Z]+)\d+"/;
  const _RE_ROW  = /\br="(\d+)"/;
  const _RE_S    = /\bs="(\d+)"/;
  const _RE_T    = /\bt="([^"]+)"/;
  const _RE_V    = /<v[^>]*>([\s\S]*?)<\/v>/;
  const _RE_TAG  = /<t[^>]*>([\s\S]*?)<\/t>/g;

  function parseSheet(xml, sst, dateXf, wantStyles) {
    const rows = [];
    const styleRows = [];
    _ROW_RE.lastIndex = 0;
    let rm, autoR = 0;
    while ((rm = _ROW_RE.exec(xml))) {
      const attrs = rm[1] || '';
      const inner = rm[2] || '';
      const rM = _RE_ROW.exec(attrs);
      const rowIdx = rM ? parseInt(rM[1], 10) - 1 : autoR;
      autoR = rowIdx + 1;
      if (!inner) { rows[rowIdx] = []; if (wantStyles) styleRows[rowIdx] = []; continue; }

      const cells = [];
      const styles = [];              // ★ 新增：记录每格 style idx（wantStyles 时）
      _CELL_RE.lastIndex = 0;
      let cm, autoC = 0;
      while ((cm = _CELL_RE.exec(inner))) {
        const cAttrs = cm[1] || '';
        const cInner = cm[2] || '';

        /* ★ 一次扫描 cAttrs 同时取 r= / s= / t=：只在检测到对应标记时才跑正则 */
        let refM = null, sM = null, tM = null;
        if (cAttrs.indexOf('r="') >= 0) refM = _RE_R.exec(cAttrs);
        if (cAttrs.indexOf('s="') >= 0) sM   = _RE_S.exec(cAttrs);
        if (cAttrs.indexOf('t="') >= 0) tM   = _RE_T.exec(cAttrs);

        const colIdx = refM ? colToIdx(refM[1]) : autoC;
        autoC = colIdx + 1;

        const styleIdx = sM ? parseInt(sM[1], 10) : -1;
        if (wantStyles) styles[colIdx] = styleIdx;

        const type = tM ? tM[1] : 'n';

        let value = '';
        let rawV = '';
        if (cInner.indexOf('<v') >= 0) {
          const vM = _RE_V.exec(cInner);
          if (vM) rawV = decodeXml(vM[1]);
        }

        if (type === 's') {
          const i = parseInt(rawV, 10);
          value = (sst[i] != null) ? sst[i] : '';
        } else if (type === 'inlineStr') {
          let t = '';
          if (cInner.indexOf('<t') >= 0) {
            _RE_TAG.lastIndex = 0;
            let tm;
            while ((tm = _RE_TAG.exec(cInner))) t += decodeXml(tm[1]);
          }
          value = t;
        } else if (type === 'str') {
          value = rawV;
        } else if (type === 'b') {
          value = rawV === '1';
        } else {
          if (rawV === '') value = '';
          else {
            const n = parseFloat(rawV);
            if (!isNaN(n) && dateXf.has(styleIdx)) value = serialToISO(n);
            else value = isNaN(n) ? rawV : n;
          }
        }
        cells[colIdx] = value;
      }
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
      rows[rowIdx] = cells;
      if (wantStyles) {
        for (let i = 0; i < cells.length; i++) if (styles[i] === undefined) styles[i] = -1;
        styleRows[rowIdx] = styles;
      }
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return wantStyles ? { rows, styles: styleRows } : rows;
  }

  async function parseWorkbook(arrayBuffer, onProgress) {
    const report = (p, t) => { if (onProgress) onProgress(p, t); };
    report(4, '读取文件…');
    const zip = await unzip(arrayBuffer);

    report(14, '解析工作簿索引…');
    const wbBuf = await zip.read('xl/workbook.xml');
    const wbText = wbBuf ? new TextDecoder('utf-8').decode(wbBuf) : '';
    const relsBuf = await zip.read('xl/_rels/workbook.xml.rels');
    const relsText = relsBuf ? new TextDecoder('utf-8').decode(relsBuf) : '';

    const sheets = [];
    const sheetRe = /<sheet\b([^>]*)\/>/g;
    let m;
    while ((m = sheetRe.exec(wbText))) {
      const nameM = /\bname="([^"]*)"/.exec(m[1]);
      const ridM  = /\br:id="([^"]*)"/.exec(m[1]);
      if (nameM && ridM) sheets.push({ name: decodeXml(nameM[1]), rid: ridM[1] });
    }

    const relMap = {};
    const relRe = /<Relationship\b([^>]*)\/>/g;
    while ((m = relRe.exec(relsText))) {
      const idM = /\bId="([^"]*)"/.exec(m[1]);
      const tM  = /\bTarget="([^"]*)"/.exec(m[1]);
      if (idM && tM) relMap[idM[1]] = tM[1];
    }

    report(24, '解析共享字符串…');
    const sstBuf = await zip.read('xl/sharedStrings.xml');
    const sst = parseSST(sstBuf ? new TextDecoder('utf-8').decode(sstBuf) : '');

    report(30, '解析样式表…');
    const stBuf = await zip.read('xl/styles.xml');
    const stXml = stBuf ? new TextDecoder('utf-8').decode(stBuf) : '';
    const dateXf = parseStyles(stXml);
    const stylesFull = parseStylesFull(stXml);      // ★ 完整填充色解析

    /* ★ 并行读取：一次性发起所有 sheet 的 zip.read，
       利用 DecompressionStream 的异步特性重叠 I/O 与解压；
       解析（CPU 密集）仍按 sheets 顺序串行执行，保证输出顺序不变。 */
    const total = sheets.length || 1;
    report(35, '并行读取工作表…');

    const targets = sheets.map(s => {
      let target = relMap[s.rid] || '';
      if (!target) return '';
      if (target.startsWith('/')) target = target.slice(1);
      else if (!target.startsWith('xl/')) target = 'xl/' + target;
      return target;
    });

    const bufs = await Promise.all(
      targets.map(t => t ? zip.read(t).catch(() => null) : Promise.resolve(null))
    );

    const decoder = new TextDecoder('utf-8');
    const result = [];
    for (let i = 0; i < sheets.length; i++) {
      const s = sheets[i];
      report(45 + Math.round((i / total) * 50), '解析工作表：' + s.name);
      const sb = bufs[i];
      if (!sb) continue;
      const parsed = parseSheet(decoder.decode(sb), sst, dateXf, true);
      const rows = parsed.rows;
      const styleIdxs = parsed.styles;
      const cellColors = styleIdxs.map(row =>
        (row || []).map(si => {
          if (si < 0) return null;
          const xf = stylesFull.xfs[si];
          if (!xf) return null;
          return stylesFull.fills[xf.fillId] || null;
        })
      );
      result.push({ name: s.name, rows, cellColors });
    }
    report(100, '解析完成');
    return result;
  }

  return { parseWorkbook };
})();