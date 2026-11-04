const fs = require('fs');
const filePath = 'd:\\代码程序\\creator-analytics-web\\dashboard-report.js';
let content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');
// 删除第 581 行（索引 580）：残留的 tableHtml 代码片段
const filtered = lines.filter((_, i) => i !== 580);
fs.writeFileSync(filePath, filtered.join('\n'));
console.log('Cleaned line 581. New line count:', filtered.length);
