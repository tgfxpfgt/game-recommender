import { test, expect } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：项目完整性 / Project Integrity Tests
 *
 * v4.2.0：合并原 test-layers（依赖分层单向校验 + Mermaid --print）与
 * test-security 的静态扫描节（TDZ / 噪声双源 / JS 语法 / manifest 引用），
 * 版本断言改为 manifest 为唯一权威 + 与 package.json 互比（去硬编码——
 * 发版不再需要改测试）。
 */
('use strict');

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BG = path.join(ROOT, 'background');

// 目标模块 → 所属层 / target path (relative to background/) → layer
function layerOf(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (p.startsWith('../data/')) return 'data';
  if (p.startsWith('../lib/')) return 'lib';
  if (p.startsWith('../adapters/')) return 'adapters';
  if (p === 'service-worker.js') return 'entry';
  if (p === 'handlers.js' || p.startsWith('handlers/')) return 'handlers'; // v5.0.0：handlers/ 子目录
  const first = p.split('/')[0];
  if (first === 'core') return 'core';
  if (first === 'storage') return 'storage';
  if (first === 'steam' || first === 'recommend' || first === 'sites' || first === 'freegames') return 'biz';
  return 'other';
}

// 允许矩阵：源层 → 可依赖的目标层集合 / allowed targets per source layer
const ALLOWED = {
  core: new Set(['core', 'data', 'lib']),
  storage: new Set(['storage', 'core', 'data', 'lib']),
  biz: new Set(['biz', 'storage', 'core', 'data', 'lib']),
  handlers: new Set(['core', 'storage', 'biz', 'data', 'lib', 'adapters', 'handlers', 'entry']),
  entry: new Set(['core', 'storage', 'biz', 'data', 'lib', 'adapters', 'handlers', 'entry']),
  data: new Set(['data', 'lib']),
  lib: new Set(['lib']),
  adapters: new Set(['entry'])
};

// 递归收集目录下全部 .js / collect all JS files under a dir
function collectJs(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) collectJs(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const violations = [];
const edges = []; // [srcLayer, targetLayer]（--print 模式用）
const importRe = /import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const scannedFiles = collectJs(BG, []).concat(
  collectJs(path.join(ROOT, 'data'), []),
  collectJs(path.join(ROOT, 'lib'), [])
);
for (const file of scannedFiles) {
  const rel = path.relative(BG, file);
  const src = fs.readFileSync(file, 'utf-8');
  const srcLayer = layerOf(rel);
  if (srcLayer === 'other') {
    violations.push(`${rel}: 未知层`);
    continue;
  }
  const allowed = ALLOWED[srcLayer];
  let m;
  while ((m = importRe.exec(src)) !== null) {
    const spec = m[1];
    if (!spec.startsWith('.') && !spec.startsWith('..')) continue;
    const target = path.normalize(path.join(path.dirname(rel), spec));
    const targetLayer = layerOf(target);
    edges.push([srcLayer, targetLayer]);
    if (!allowed.has(targetLayer)) {
      violations.push(`${rel} → ${target}（${targetLayer}，源层 ${srcLayer} 不允许）`);
    }
  }
}
// --print 模式输出 Mermaid 依赖图（README 附图用）/ Mermaid dependency graph
const LAYER_LABELS = {
  core: 'core(工具/常量)',
  storage: 'storage(数据)',
  biz: '业务层(steam/recommend/sites/freegames)',
  handlers: 'handlers(分发)',
  entry: 'service-worker(入口)',
  data: 'data(OPFS)',
  lib: 'lib(工具)',
  adapters: 'adapters(站点规则)'
};
if (process.argv.includes('--print')) {
  const unique = [...new Set(edges.map((e) => e[0] + '>' + e[1]))].map((e) => e.split('>'));
  console.log('\n```mermaid');
  console.log('flowchart LR');
  for (const [s, t] of unique) {
    console.log(`  ${s}["${LAYER_LABELS[s] || s}"] --> ${t}["${LAYER_LABELS[t] || t}"]`);
  }
  console.log('```');
  process.exit(0);
}
for (const v of violations) console.log('  ⚠', v);
test('分层违规数（应为 0）', () => {
  expect(violations.length).toEqual(0);
});
test('core/title-parser.js 存在（下沉后）', () => {
  expect(fs.existsSync(path.join(BG, 'core/title-parser.js'))).toEqual(true);
});
test('storage/reset.js 存在（归位后）', () => {
  expect(fs.existsSync(path.join(BG, 'storage/reset.js'))).toEqual(true);
});
test('旧 steam/title-parser.js 已移除', () => {
  expect(fs.existsSync(path.join(BG, 'steam/title-parser.js'))).toEqual(false);
});
test('旧 core/reset.js 已移除', () => {
  expect(fs.existsSync(path.join(BG, 'core/reset.js'))).toEqual(false);
});

const jsFiles = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (f === '.git' || f === '.mimosa' || f === 'node_modules' || f === '.extension-js') continue;
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.js')) jsFiles.push(p);
  }
})(ROOT);
let tdzCount = 0;
for (const file of jsFiles) {
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  const decls = [];
  for (let i = 0; i < lines.length; i++) {
    // 仅顶层声明（无缩进）且含赋值；body 为声明语句本身（多行对象/数组展开），
    // 检测"初始化表达式引用后声明的标识符"——不含注释，避免注释单词误报
    const m = lines[i].match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
    if (!m) continue;
    let end = i,
      depth = 0;
    let text = lines[i].substring(lines[i].indexOf('='));
    for (const ch of text) {
      if (ch === '{' || ch === '[' || ch === '(') depth++;
      if (ch === '}' || ch === ']' || ch === ')') depth--;
    }
    while (depth > 0 && end < lines.length - 1) {
      end++;
      for (const ch of lines[end]) {
        if (ch === '{' || ch === '[' || ch === '(') depth++;
        if (ch === '}' || ch === ']' || ch === ')') depth--;
      }
    }
    decls.push({ name: m[1], line: i + 1, body: lines.slice(i, end + 1).join('\n') });
  }
  for (let idx = 0; idx < decls.length; idx++) {
    for (let j = idx + 1; j < decls.length; j++) {
      if (new RegExp('\\b' + decls[j].name + '\\b').test(decls[idx].body)) tdzCount++;
    }
  }
}
test('TDZ 后向引用', () => {
  expect(tdzCount).toEqual(0);
});

const sharedPatterns = fs.readFileSync(path.join(ROOT, 'shared/patterns.js'), 'utf-8');
const titleParserSrc = fs.readFileSync(path.join(ROOT, 'background/core/title-parser.js'), 'utf-8');
// v5.1.0：提取正则支持跨行（prettier 会把长定义拆到多行）
const sharedSource = ((sharedPatterns.match(/noisePatternSource\s*=\s*'([^']+)'/) || [])[1] || '').replace(
  /\\\\/g,
  '\\'
);
const parserSource = (titleParserSrc.match(/const noisePattern\s*=\s*\/([\s\S]*?)\/(?:gi|i);/) || [])[1] || '';
test('双源正则一致（无漂移）', () => {
  expect(sharedSource === parserSource).toEqual(true);
});
test('权威源非空', () => {
  expect(sharedSource.length > 50).toEqual(true);
});
const detailPageSrc = fs.readFileSync(path.join(ROOT, 'content/detail/detail-page.js'), 'utf-8');
test('detail-page 引用权威源（无独立副本）', () => {
  expect(detailPageSrc.includes('__GR_PATTERNS__.noisePatternSource')).toEqual(true);
});
test('detail-page 不含完整漂移副本', () => {
  expect(!detailPageSrc.includes('抢先试玩|抢先体验')).toEqual(true);
});

let syntaxFail = 0;
for (const f of jsFiles) {
  try {
    execSync(`node --check "${f}"`, { stdio: 'pipe' });
  } catch (e) {
    syntaxFail++;
    console.log('  ❌', path.relative(ROOT, f));
  }
}
test('语法错误数', () => {
  expect(syntaxFail).toEqual(0);
});
test('JS 文件数', () => {
  expect(jsFiles.length >= 40).toEqual(true);
});

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf-8'));
const refs = [];
if (manifest.background?.service_worker) refs.push(manifest.background.service_worker);
for (const cs of manifest.content_scripts || []) {
  for (const j of cs.js || []) refs.push(j);
  for (const c of cs.css || []) refs.push(c);
}
for (const v of Object.values(manifest.icons || {})) refs.push(v);
if (manifest.options_page) refs.push(manifest.options_page);
if (manifest.action?.default_popup) refs.push(manifest.action.default_popup);
const missing = refs.filter((r) => !fs.existsSync(path.join(ROOT, r)));
test('manifest 引用缺失', () => {
  expect(missing.length).toEqual(0);
});
test('manifest 版本为 x.y.z 格式', () => {
  expect(/^\d+\.\d+\.\d+$/.test(manifest.version)).toEqual(true);
});
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
test('package.json 版本与 manifest 一致', () => {
  expect(pkg.version).toEqual(manifest.version);
});
test('CSP 显式声明（extension_pages 默认基线）', () => {
  expect(JSON.stringify(manifest.content_security_policy || {})).toEqual(
    JSON.stringify({ extension_pages: "script-src 'self'; object-src 'self'" })
  );
});

// 6. adapters 清单一致性（v6.3.1：manifest/SW/options.html 三处手写同步防漂移）
const swSrc2 = fs.readFileSync(path.join(BG, 'service-worker.js'), 'utf-8');
const optsHtml = fs.readFileSync(path.join(ROOT, 'options/options.html'), 'utf-8');
const manifestAdapters = (manifest.content_scripts || [])
  .flatMap((cs) => cs.js || [])
  .filter((j) => j.startsWith('adapters/'))
  .map((j) => j.replace('adapters/', ''));
const swAdapters = [...swSrc2.matchAll(/import\s+'\.\.\/adapters\/([^']+)'/g)].map((m) => m[1]);
// v9.3.0：options.html 不再注入 adapters 脚本（改为 GET_ADAPTER_RULES 消息获取）
const htmlAdapters = [...optsHtml.matchAll(/<script src="\.\.\/adapters\/([^"]+)"/g)].map((m) => m[1]);
const dirAdapters = collectJs(path.join(ROOT, 'adapters'), [])
  .map((f) => path.relative(path.join(ROOT, 'adapters'), f).replace(/\\/g, '/'))
  .sort();
test('adapters 清单一致（manifest = SW；options 零注入——v9.3.0 改消息获取）', () => {
  const norm = (a) => [...a].sort();
  expect(JSON.stringify(norm(manifestAdapters))).toEqual(JSON.stringify(norm(swAdapters)));
  expect(htmlAdapters.length).toEqual(0);
});
test('adapters 目录文件全部注册（无漏注册）', () => {
  const norm = (a) => [...a].sort();
  expect(JSON.stringify(norm(manifestAdapters))).toEqual(JSON.stringify(norm(dirAdapters)));
});

// ============ 7. 网站范围一致性（v7.4.0） ============
// manifest content_scripts matches ↔ site-scripts BUILTIN_DOMAINS ↔ 内置规则
// domains 三方同步——新增内置站点必须同时改三处（manifest matches、
// background/core/site-scripts.js、adapters/sites/xxx.js）
const manifestMatches = (manifest.content_scripts || []).flatMap((cs) => cs.matches || []);
const manifestDomains = [
  ...new Set(
    manifestMatches
      .filter((m) => m.startsWith('http') && !m.includes('steampowered.com'))
      .map((m) => m.replace(/^https?:\/\/\*\./, '').replace(/\/\*$/, ''))
  )
].sort();
const builtinDomains = [
  ...fs
    .readFileSync(path.join(BG, 'core/site-scripts.js'), 'utf-8')
    .matchAll(/'(xdgame\.com|xianyudanji\.gg|gamer520\.com|3dmgame\.com|ali213\.net|gamersky\.com)'/g)
]
  .map((m) => m[1])
  .sort();
const siteRuleDomains = [
  ...collectJs(path.join(ROOT, 'adapters/sites'), [])
    .map((f) => fs.readFileSync(f, 'utf-8'))
    .join('\n')
    .matchAll(/domains:\s*\['([^']+)'\]/g)
]
  .map((m) => m[1])
  .sort();
test('网站范围三方一致（manifest matches = site-scripts 内置 = 规则 domains）', () => {
  expect(JSON.stringify(manifestDomains)).toEqual(JSON.stringify(builtinDomains));
  expect(JSON.stringify(manifestDomains)).toEqual(JSON.stringify(siteRuleDomains));
});
test('快捷键命令注册（manifest commands + SW onCommand）', () => {
  const cmds = (manifest.commands || {})['gr-force-refresh'];
  expect(!!cmds && !!cmds.suggested_key).toEqual(true);
  const swSrc = fs.readFileSync(path.join(BG, 'service-worker.js'), 'utf-8');
  expect(swSrc.includes('commands.onCommand')).toEqual(true);
  expect(swSrc.includes('gr-force-refresh')).toEqual(true);
});
test('manifest 只注入内置站点 + Steam（无全站匹配）', () => {
  expect(manifestMatches.some((m) => m === 'http://*/*' || m === 'https://*/*')).toEqual(false);
  expect(manifestMatches.filter((m) => m.includes('steampowered.com')).length).toBeGreaterThan(0);
});
