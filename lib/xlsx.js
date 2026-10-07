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

  function parseSST(xml) {
    const out = [];
    if (!xml) return out;
    const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(xml))) {
      let txt = '';
      const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
      let tm;
      while ((tm = tRe.exec(m[1]))) txt += decodeXml(tm[1]);
      out.push(txt);
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

  function parseSheet(xml, sst, dateXf) {
    const rows = [];
    const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    let rm, autoR = 0;
    while ((rm = rowRe.exec(xml))) {
      const attrs = rm[1] || '';
      const inner = rm[2] || '';
      const rM = /\br="(\d+)"/.exec(attrs);
      const rowIdx = rM ? parseInt(rM[1], 10) - 1 : autoR;
      autoR = rowIdx + 1;
      if (!inner) { rows[rowIdx] = []; continue; }

      const cells = [];
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cm, autoC = 0;
      while ((cm = cellRe.exec(inner))) {
        const cAttrs = cm[1] || '';
        const cInner = cm[2] || '';
        const refM = /\br="([A-Z]+)\d+"/.exec(cAttrs);
        const colIdx = refM ? colToIdx(refM[1]) : autoC;
        autoC = colIdx + 1;

        const tM = /\bt="([^"]+)"/.exec(cAttrs);
        const sM = /\bs="(\d+)"/.exec(cAttrs);
        const type = tM ? tM[1] : 'n';
        const styleIdx = sM ? parseInt(sM[1], 10) : -1;

        let value = '';
        const vM = /<v[^>]*>([\s\S]*?)<\/v>/.exec(cInner);
        const rawV = vM ? decodeXml(vM[1]) : '';

        if (type === 's') {
          const i = parseInt(rawV, 10);
          value = (sst[i] != null) ? sst[i] : '';
        } else if (type === 'inlineStr') {
          let t = '';
          const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
          let tm;
          while ((tm = tRe.exec(cInner))) t += decodeXml(tm[1]);
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
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
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
    const dateXf = parseStyles(stBuf ? new TextDecoder('utf-8').decode(stBuf) : '');

    const result = [];
    const total = sheets.length || 1;
    for (let i = 0; i < sheets.length; i++) {
      const s = sheets[i];
      report(35 + Math.round((i / total) * 55), '解析工作表：' + s.name);
      let target = relMap[s.rid] || '';
      if (!target) continue;
      if (target.startsWith('/')) target = target.slice(1);
      else if (!target.startsWith('xl/')) target = 'xl/' + target;
      const sb = await zip.read(target);
      if (!sb) continue;
      const rows = parseSheet(new TextDecoder('utf-8').decode(sb), sst, dateXf);
      result.push({ name: s.name, rows });
    }
    report(100, '解析完成');
    return result;
  }

  return { parseWorkbook };
})();