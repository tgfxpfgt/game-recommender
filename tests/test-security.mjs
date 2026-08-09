/**
 * Game Recommender - 测试：安全与存储 / Security & Storage Tests
 *
 * SSRF 校验（isSafeFetchUrl）、ND-JSON 编解码、TDZ 扫描、模块链模拟。
 */
'use strict';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = 'F:/data/browser extension/game-recommender';
let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, '→ 实际:', JSON.stringify(actual), '期望:', JSON.stringify(expected)); }
}

// 1. SSRF 校验（加载真实 utils 模块）
const utils = await import('file:///F:/data/browser%20extension/game-recommender/background/core/utils.js?t=' + Date.now());
console.log('1. SSRF 校验 isSafeFetchUrl');
check('https 公网', utils.isSafeFetchUrl('https://store.steampowered.com/app/1/'), true);
check('http 公网', utils.isSafeFetchUrl('http://xdgame.com/'), true);
check('localhost 拒绝', utils.isSafeFetchUrl('http://localhost:11434/'), false);
check('127.0.0.1 拒绝', utils.isSafeFetchUrl('http://127.0.0.1/x'), false);
check('10.x 私有拒绝', utils.isSafeFetchUrl('http://10.0.0.1/'), false);
check('192.168 私有拒绝', utils.isSafeFetchUrl('http://192.168.1.1/'), false);
check('172.16 私有拒绝', utils.isSafeFetchUrl('http://172.16.0.1/'), false);
check('js 协议拒绝', utils.isSafeFetchUrl('javascript:alert(1)'), false);
check('非字符串拒绝', utils.isSafeFetchUrl(123), false);

// 2. ND-JSON 编解码（加载真实 ndjson 模块）
const ndjson = await import('file:///F:/data/browser%20extension/game-recommender/lib/ndjson.js?t=' + Date.now());
console.log('2. ND-JSON 编解码');
const entries = [{ a: 1 }, { b: '中文' }, { c: [1, 2] }];
const encoded = ndjson.NDJSON.encode(entries);
check('编码行数', encoded.split('\n').length, 3);
check('解码还原', ndjson.NDJSON.decode(encoded), entries);
check('损坏行跳过', ndjson.NDJSON.decode('{bad}\n{"ok":1}\n').length, 1);
check('空输入', ndjson.NDJSON.decode(''), []);

// 3. TDZ 静态扫描（全部 JS 文件）
console.log('3. TDZ 扫描');
const jsFiles = [];
function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (f === '.git' || f === '.mimosa' || f === 'node_modules') continue;
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.js')) jsFiles.push(p);
  }
}
walk(ROOT);
let tdzCount = 0;
for (const file of jsFiles) {
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  const decls = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
    if (!m) continue;
    let end = i, depth = 0;
    let text = lines[i].substring(lines[i].indexOf('='));
    for (const ch of text) { if (ch === '{' || ch === '[' || ch === '(') depth++; if (ch === '}' || ch === ']' || ch === ')') depth--; }
    while (depth > 0 && end < lines.length - 1) {
      end++;
      for (const ch of lines[end]) { if (ch === '{' || ch === '[' || ch === '(') depth++; if (ch === '}' || ch === ']' || ch === ')') depth--; }
    }
    decls.push({ name: m[1], line: i + 1, body: lines.slice(i, end + 1).join('\n') });
  }
  for (let idx = 0; idx < decls.length; idx++) {
    for (let j = idx + 1; j < decls.length; j++) {
      if (new RegExp('\\b' + decls[j].name + '\\b').test(decls[idx].body)) tdzCount++;
    }
  }
}
check('TDZ 后向引用', tdzCount, 0);

// 4. 全部 JS 语法
console.log('4. JS 语法检查');
let syntaxFail = 0;
for (const f of jsFiles) {
  try { execSync(`node --check "${f}"`, { stdio: 'pipe' }); }
  catch (e) { syntaxFail++; console.log('  ❌', path.relative(ROOT, f)); }
}
check('语法错误数', syntaxFail, 0);
check('JS 文件数', jsFiles.length >= 40, true);

// 5. manifest 引用存在性
console.log('5. manifest 引用');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf-8'));
const refs = [];
if (manifest.background?.service_worker) refs.push(manifest.background.service_worker);
for (const cs of manifest.content_scripts || []) { for (const j of cs.js || []) refs.push(j); for (const c of cs.css || []) refs.push(c); }
for (const v of Object.values(manifest.action?.default_icon || {})) refs.push(v);
for (const v of Object.values(manifest.icons || {})) refs.push(v);
if (manifest.options_page) refs.push(manifest.options_page);
if (manifest.action?.default_popup) refs.push(manifest.action.default_popup);
const missing = refs.filter(r => !fs.existsSync(path.join(ROOT, r)));
check('manifest 引用缺失', missing.length, 0);
check('manifest 版本', manifest.version, '2.0.0');

console.log('\n===== 安全与存储测试结果 =====');
console.log(pass + ' 通过, ' + fail + ' 失败');

// 导出结果供 run-tests.js 聚合 / Export results for the test runner
export const testResult = { pass, fail, ok: fail === 0 };
