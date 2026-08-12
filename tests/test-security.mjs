/**
 * Game Recommender - 测试：安全与存储 / Security & Storage Tests
 *
 * SSRF 校验（isSafeFetchUrl）、ND-JSON 编解码、TDZ 扫描、模块链模拟。
 */
'use strict';

import { createReporter } from './helpers/assert.mjs';
const reporter = createReporter();
const { check } = reporter;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 1. SSRF 校验（加载真实 utils 模块）
const utils = await import(new URL('../background/core/utils.js', import.meta.url).href + '?t=' + Date.now());
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
// v3.4.1：SSRF 加固用例（尾点域名 / IPv6 / 编码变体）
check('尾点 localhost. 拒绝', utils.isSafeFetchUrl('http://localhost.:8080/'), false);
check('尾点 127.0.0.1. 拒绝', utils.isSafeFetchUrl('http://127.0.0.1.:8080/'), false);
check('IPv4 八进制变体拒绝', utils.isSafeFetchUrl('http://0177.0.0.1:8080/'), false);
check('IPv4 十六进制变体拒绝', utils.isSafeFetchUrl('http://0x7f000001/'), false);
check('IPv4 单整数变体拒绝', utils.isSafeFetchUrl('http://2130706433/'), false);
check('IPv6 环回 ::1 拒绝', utils.isSafeFetchUrl('http://[::1]/'), false);
check('IPv6 长格式环回拒绝', utils.isSafeFetchUrl('http://[0:0:0:0:0:0:0:1]/'), false);
check('IPv6 未指定 :: 拒绝', utils.isSafeFetchUrl('http://[::]/'), false);
check('IPv6 ULA fd00::/8 拒绝', utils.isSafeFetchUrl('http://[fd00::1]/'), false);
check('IPv6 链路本地 fe80::/10 拒绝', utils.isSafeFetchUrl('http://[fe80::1]/'), false);
check('IPv6 链路本地带 zone 拒绝', utils.isSafeFetchUrl('http://[fe80::1%25eth0]/'), false);
check('IPv6 6to4 嵌入 127.0.0.1 拒绝', utils.isSafeFetchUrl('http://[2002:7f00:1::]/'), false);
check('IPv6 Teredo 拒绝', utils.isSafeFetchUrl('http://[2001:0:0:1::1]/'), false);
check('IPv6 v4-mapped 127.0.0.1 拒绝', utils.isSafeFetchUrl('http://[::ffff:127.0.0.1]/'), false);
check('IPv6 v4-mapped 公网放行', utils.isSafeFetchUrl('http://[::ffff:8.8.8.8]/'), true);
check('IPv6 组播 ff02 拒绝', utils.isSafeFetchUrl('http://[ff02::1]/'), false);
check('IPv6 公网放行', utils.isSafeFetchUrl('http://[2606:4700:4700::1111]/'), true);
check('IPv6 文档段放行', utils.isSafeFetchUrl('http://[2001:db8::1]/'), true);

// 2. ND-JSON 编解码（加载真实 ndjson 模块）
const ndjson = await import(new URL('../lib/ndjson.js', import.meta.url).href + '?t=' + Date.now());
console.log('2. ND-JSON 编解码');
const entries = [{ a: 1 }, { b: '中文' }, { c: [1, 2] }];
const encoded = ndjson.NDJSON.encode(entries);
check('编码行数', encoded.split('\n').length, 3);
check('解码还原', ndjson.NDJSON.decode(encoded), entries);
check('损坏行跳过', ndjson.NDJSON.decode('{bad}\n{"ok":1}\n').length, 1);
check('空输入', ndjson.NDJSON.decode(''), []);

// 2.5 regexExecAll（Symbol.matchAll 标准符号，v3.2.5 修复）
console.log('2.5 regexExecAll');
check('迭代提取', utils.regexExecAll('a1 b22 c333', /\d+/g).map(m => m[0]), ['1', '22', '333']);
check('自动补 g 标志', utils.regexExecAll('a1 b2', /\d+/).length, 2);
check('无匹配返回空', utils.regexExecAll('abc', /\d+/g).length, 0);

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

// 3.5 噪声词双源一致性（v3.3.9：shared/patterns.js 为权威源，后台副本防漂移）
console.log('3.5 噪声词双源一致性（shared/patterns.js ↔ title-parser.js）');
const sharedPatterns = fs.readFileSync(path.join(ROOT, 'shared/patterns.js'), 'utf-8');
const titleParserSrc = fs.readFileSync(path.join(ROOT, 'background/core/title-parser.js'), 'utf-8');
// shared 侧是 JS 字符串字面量（\\d 双反斜杠），title-parser 侧是正则字面量（\d 单反斜杠）——
// 归一化后再比较（字符串字面量转义还原）。v3.4.1 后正则无 g 标志（防 .test() 状态残留）
const sharedSource = ((sharedPatterns.match(/noisePatternSource = '([^']+)'/) || [])[1] || '').replace(/\\\\/g, '\\');
const parserSource = (titleParserSrc.match(/const noisePattern = \/([\s\S]*?)\/(?:gi|i);/) || [])[1] || '';
check('双源正则一致（无漂移）', sharedSource === parserSource, true);
check('权威源非空', sharedSource.length > 50, true);
// v3.4.0：detail-page 的噪声词必须经 __GR_PATTERNS__ 权威源构造（移除漂移副本）
const detailPageSrc = fs.readFileSync(path.join(ROOT, 'content/detail/detail-page.js'), 'utf-8');
check('detail-page 引用权威源（无独立副本）', detailPageSrc.includes('__GR_PATTERNS__.noisePatternSource'), true);
check('detail-page 不含完整漂移副本', !detailPageSrc.includes('抢先试玩|抢先体验'), true);

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
check('manifest 版本', manifest.version, '4.1.2');
// v4.1.0：版本三源一致（manifest / package.json / 本测试）——发布时手改易漏
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
check('package.json 版本与 manifest 一致', pkg.version, manifest.version);
check('CSP 显式声明（extension_pages 默认基线）', JSON.stringify(manifest.content_security_policy || {}), JSON.stringify({ extension_pages: "script-src 'self'; object-src 'self'" }));

// 6. 缓存 TTL 单位解析（加载真实 constants 模块）
console.log('6. 缓存 TTL 单位解析');
const constants = await import(new URL('../background/core/constants.js', import.meta.url).href + '?t=' + Date.now());
check('24 小时 → 24h', constants.resolveTtlMs('steamDynamic', { value: 24, unit: 'hours' }), 24 * 3600e3);
check('30 天 → 30d', constants.resolveTtlMs('registryConfirm', { value: 30, unit: 'days' }), 30 * 86400e3);
check('1 月 → 30d', constants.resolveTtlMs('steamDynamic', { value: 1, unit: 'months' }), 30 * 86400e3);
check('1 年 → 365d', constants.resolveTtlMs('negativeCache', { value: 1, unit: 'years' }), 365 * 86400e3);
check('0 = 长期 Infinity', constants.resolveTtlMs('steamDynamic', { value: 0, unit: 'days' }) === Infinity, true);
check('旧数字格式兼容（steamDynamic=小时）', constants.resolveTtlMs('steamDynamic', 24), 24 * 3600e3);
check('旧数字格式兼容（registryConfirm=天）', constants.resolveTtlMs('registryConfirm', 30), 30 * 86400e3);
check('缺省值', constants.resolveTtlMs('steamDynamic', null), 24 * 3600e3);

// 7. 中英文名异常检测（导入 utils.js 真实谓词，不再复制被测逻辑）
console.log('7. 中英文名异常检测（utils.js 真实谓词）');
const utilsMod = await import(new URL('../background/core/utils.js', import.meta.url).href);
const validEn = (enName) => !enName || utilsMod.hasLatinLetters(enName, 2);
const validCn = (cnName) => !cnName || utilsMod.hasChineseChars(cnName);
check('正常英文名', validEn('Worship Demon'), true);
check('英文名中文占位异常', validEn('奉魔'), false);
check('混合名含英文', validEn('Demeo x Dungeons'), true);
check('正常中文名', validCn('奉魔'), true);
check('中文名英文占位异常', validCn('Worship Demon'), false);
check('中文名空值', validCn(''), true);

// 8. 版本后缀补搜（v4.1.1：封面旧版 + 标题"增强版" → 升级新版；mock 网络）
console.log('8. 版本后缀补搜 findVersionVariant（mock Steam）');
const apiMod = await import(new URL('../background/steam/api.js', import.meta.url).href + '?t=' + Date.now());
const realFetch = globalThis.fetch;
// mock：appdetails 返回英文名（Legacy 后缀）；storesearch 返回增强版条目
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/api/appdetails')) {
    return { ok: true, json: async () => ({ '271590': { success: true, data: { name: 'Grand Theft Auto V Legacy' } } }) };
  }
  if (u.includes('/api/storesearch')) {
    return { ok: true, json: async () => ({ items: [{ id: 3240220, name: 'Grand Theft Auto V 增强版', type: 'app' }] }) };
  }
  return { ok: false };
};
try {
  const v = await apiMod.findVersionVariant(271590, '侠盗猎车手V 增强版|中字-国语|V1.0.1158.13');
  check('封面旧版+增强版标题 → 命中新版 3240220', v ? String(v.appId) : 'null', '3240220');
  check('无版本后缀标题 → 不触发', await apiMod.findVersionVariant(271590, '侠盗猎车手V'), null);
  check('标题为空 → 不触发', await apiMod.findVersionVariant(271590, ''), null);
} finally {
  globalThis.fetch = realFetch;
}

console.log('\n===== 安全与存储测试结果 =====');
const finalResult = reporter.getResult();
console.log(finalResult.pass + ' 通过, ' + finalResult.fail + ' 失败');

// 导出结果供 run-tests.js 聚合 / Export results for the test runner
export const testResult = reporter.getResult();
