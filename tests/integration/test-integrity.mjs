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
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';

// v14 B10：P2-D 改运行时装配校验——handlers.js 导入链需要 chrome 存根
//（与 test-handlers 同模式；导入在测试体内，存根须先于其装载）
installChromeStorageMock(createStorageMock());

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BG = path.join(ROOT, 'background');

// 目标模块 → 所属层 / target path (relative to background/) → layer
function layerOf(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (p.startsWith('../data/')) return 'data';
  if (p.startsWith('../lib/')) return 'lib';
  if (p.startsWith('../adapters/')) return 'adapters';
  if (p.startsWith('../shared/')) return 'shared'; // v14.0.0：SW 消费共享纯工具（msg.js 错误归一）
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
  // v14.2.0：core → shared 开放（shared 为最底层纯数据/纯工具层——fm-keys/
  // spy-scales 单源下沉；handlers/entry → shared 已先行，方向一致无环）
  core: new Set(['core', 'data', 'lib', 'shared']),
  storage: new Set(['storage', 'core', 'data', 'lib']),
  biz: new Set(['biz', 'storage', 'core', 'data', 'lib']),
  // v14.0.0：handlers/entry 允许 → shared（msg.js 统一错误归一，SW 侧经 global 消费）
  handlers: new Set(['core', 'storage', 'biz', 'data', 'lib', 'adapters', 'handlers', 'entry', 'shared']),
  entry: new Set(['core', 'storage', 'biz', 'data', 'lib', 'adapters', 'handlers', 'entry', 'shared']),
  data: new Set(['data', 'lib']),
  lib: new Set(['lib']),
  shared: new Set(['lib']),
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
  shared: 'shared(跨侧共享)',
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
    const text = lines[i].substring(lines[i].indexOf('='));
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

// v14.2.0：spawn 假阳性根治（主报告 P1-1）——哨兵自检 + 区分"环境不可用"
// 与"语法错误"。此前 catch 把 spawn 失败（沙箱 cmd.exe EBUSY，status=null）
// 当语法错误计数，一挂就是全量 N/N 假红且与真实语法错误输出无法区分。
let spawnBroken = false;
try {
  execSync(`node --check "${jsFiles[0]}"`, { stdio: 'pipe' }); // 哨兵：已知合法文件
} catch (e) {
  spawnBroken = e.status === null || e.status === undefined;
}
const syntaxFails = [];
if (!spawnBroken) {
  for (const f of jsFiles) {
    try {
      execSync(`node --check "${f}"`, { stdio: 'pipe' });
    } catch (e) {
      if (e.status === null || e.status === undefined) {
        spawnBroken = true; // 中途环境劣化：本轮结果不可信，转跳过
        break;
      }
      syntaxFails.push(path.relative(ROOT, f));
    }
  }
}
test('语法错误数（spawn 不可用时显式跳过，typecheck 仍全量覆盖）', () => {
  if (spawnBroken) {
    console.warn('  ⚠ node --check spawn 不可用（环境限制）——语法检查本轮跳过');
    expect(true).toEqual(true);
    return;
  }
  expect(syntaxFails, `语法错误文件: ${syntaxFails.join(', ')}`).toEqual([]);
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
if (manifest.side_panel?.default_path) refs.push(manifest.side_panel.default_path); // v14.2.0：SidePanel 入口
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
// v14.2.0：单源改动态 import（此前硬编码 7 域名正则——新增内置站漏改正则
// 时该域名静默逃过一致性校验，补充轮 P2-1）
const siteScriptsMod = await import(new URL('../../background/core/site-scripts.js', import.meta.url).href);
const builtinDomains = [...siteScriptsMod.BUILTIN_DOMAINS].sort();
const siteRuleDomains = [
  ...collectJs(path.join(ROOT, 'adapters/sites'), [])
    .map((f) => fs.readFileSync(f, 'utf-8'))
    .join('\n')
    // v10.4.4：支持多域名数组（gamer520 双域名此前被单元素正则漏解析）
    .matchAll(/domains:\s*\[([^\]]+)\]/g)
]
  .flatMap((m) => m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')))
  .filter(Boolean)
  .sort();
test('网站范围三方一致（manifest matches = site-scripts 内置 = 规则 domains）', () => {
  expect(JSON.stringify(manifestDomains)).toEqual(JSON.stringify(builtinDomains));
  expect(JSON.stringify(manifestDomains)).toEqual(JSON.stringify(siteRuleDomains));
});
// v10.9：内容侧 sender 门禁一致性——内容脚本发出的每个 action 字面量必须在
// CONTENT_ALLOWED_ACTIONS 白名单。漏登记曾使两个功能真机静默失效
//（GET_ITAD_LOWEST→ITAD 行恒隐藏；FETCH_IMAGE_DATA_URL→跨域二维码解码仍死，
// v10.7.1 只修了契约正则没补门禁——同一盲区两次踩中，此测试根治该类回归）
const contractMod = await import(
  new URL('../../background/core/message-contract.js', import.meta.url).href + '?t=' + Date.now()
);
test('内容侧发送 action ⊆ CONTENT_ALLOWED_ACTIONS（sender 门禁一致性）', () => {
  const sent = new Set();
  for (const f of collectJs(path.join(ROOT, 'content'), [])) {
    const src = fs.readFileSync(f, 'utf-8');
    for (const m of src.matchAll(/action:\s*'([A-Z_]+)'/g)) sent.add(m[1]);
  }
  expect(sent.size, '内容侧应至少发出 20 个 action（结构哨兵）').toBeGreaterThan(20);
  const missing = [...sent].filter((a) => !contractMod.CONTENT_ALLOWED_ACTIONS.has(a));
  expect(missing, '内容侧发送但不在白名单（真机将被 forbidden-sender 静默拒绝）:\n  ' + missing.join('\n  ')).toEqual(
    []
  );
});

// v10.7.0 批次4：内容模块清单（module-manifest.js）中每个文件必须真实存在
// ——tracker 装载/测试加载/integrity 校验三处消费同一清单，杜绝漂移
test('内容模块清单文件齐全（module-manifest）', async () => {
  const manifestMod = await import(
    new URL('../../content/module-manifest.js', import.meta.url).href + '?t=' + Date.now()
  );
  const missing = [...manifestMod.CORE_MODULES, ...manifestMod.OPTIONAL_MODULES]
    .filter((mod) => !fs.existsSync(path.join(ROOT, mod.file)))
    .map((mod) => `${mod.key}→${mod.file}`);
  expect(missing, '清单中文件不存在:\n  ' + missing.join('\n  ')).toEqual([]);
  // 可选模块的 setting 键必须在 DEFAULT_SETTINGS 中（防改键名后条件加载失效）
  const swKeys = Object.keys(constantsMod.DEFAULT_SETTINGS);
  const badSettings = manifestMod.OPTIONAL_MODULES.filter((mod) => !swKeys.includes(mod.setting)).map(
    (mod) => `${mod.key}→${mod.setting}`
  );
  expect(badSettings, '可选模块 setting 键不在 DEFAULT_SETTINGS:\n  ' + badSettings.join('\n  ')).toEqual([]);
});

// v10.7.0 批次4：web_accessible_resources.matches 是域名的第 4 份拷贝且此前
// 无一致性测试覆盖——漏改会导致动态 import 的内容模块在该站加载失败
// WAR matches must cover every content-script domain (4th copy of the domain
// list; a missed entry breaks dynamic module loading on that site).
test('web_accessible_resources.matches 覆盖全部注入域名', () => {
  const warMatches = (manifest.web_accessible_resources || []).flatMap((r) => r.matches || []);
  const warDomains = new Set(
    warMatches.filter((m) => m.startsWith('http')).map((m) => m.replace(/^https?:\/\/\*\./, '').replace(/\/\*$/, ''))
  );
  // WAR ⊇ content_scripts（WAR 可额外含 steampowered.com——Steam 页浮窗资源）
  const missing = manifestDomains.filter((d) => !warDomains.has(d));
  expect(missing, 'WAR 缺少注入域名（动态模块在该站将加载失败）:\n  ' + missing.join('\n  ')).toEqual([]);
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

// ============ 8. v10.5.0 安全 / 健壮接线静态断言（防未来静默移除） ============
const handlersSrc = fs.readFileSync(path.join(BG, 'handlers.js'), 'utf-8');
const contractSrc = fs.readFileSync(path.join(BG, 'core/message-contract.js'), 'utf-8');
const rulesSrc = fs.readFileSync(path.join(BG, 'core/rules.js'), 'utf-8');
const swSrc8 = fs.readFileSync(path.join(BG, 'service-worker.js'), 'utf-8');
const loggerSrc8 = fs.readFileSync(path.join(BG, 'storage/logger.js'), 'utf-8');

test('P0-A：sender 来源门已接线（拒绝非扩展页特权 action）', () => {
  expect(handlersSrc.includes('isTrustedSender')).toEqual(true);
  expect(handlersSrc.includes('CONTENT_ALLOWED_ACTIONS')).toEqual(true);
  expect(handlersSrc.includes('forbidden-sender')).toEqual(true);
});
test('P0-A：内容白名单不含特权 action', () => {
  const block = contractSrc.slice(
    contractSrc.indexOf('CONTENT_ALLOWED_ACTIONS'),
    contractSrc.indexOf('export function isTrustedSender')
  );
  // v10.9：改为提取 Set 条目字面量（源码子串检查会被注释文本误触发）
  const entries = [...block.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  expect(entries).not.toContain('SAVE_SETTINGS');
  expect(entries).not.toContain('CLEAR_DATA');
  expect(entries).not.toContain('IMPORT_DATA');
  expect(entries).not.toContain('SAVE_ADAPTER_RULES');
  expect(entries).toContain('TRACK_EVENT');
});
test('P0-C：站点域名严格校验已接线（裸主机名，防全站注入）', () => {
  expect(rulesSrc.includes('export function isValidSiteDomain')).toEqual(true);
  expect(rulesSrc.includes('if (!isValidSiteDomain(d))')).toEqual(true);
});
test('P1-B：周期性兜底落盘 alarm 已接线', () => {
  expect(swSrc8.includes("ensureAlarm('grPeriodicFlush'")).toEqual(true);
  expect(swSrc8.includes("alarm.name === 'grPeriodicFlush'")).toEqual(true);
  expect(swSrc8.includes('flushAllCaches')).toEqual(true);
});
test('P1-B：日志写失败回滚后重排一次', () => {
  expect(loggerSrc8.includes('writer.scheduleWrite()')).toEqual(true);
});
test('P2-D：每个 MESSAGE_HANDLERS action 都有契约规则（默认拒绝前提）', async () => {
  // v14 B10：MESSAGE_HANDLERS 改领域段聚合展开——源码正则无法提取键，改运行时
  // 装配取 Object.keys（不变量更强：绑定与契约规则直接比对）。handlers.js 导入
  // 链需要 chrome 存根（文件顶部已装，与 test-handlers 同模式）
  const handlersMod = await import(new URL('../../background/handlers.js', import.meta.url).href);
  const handlerKeys = Object.keys(handlersMod.MESSAGE_HANDLERS);
  const ruleKeys = new Set([...contractSrc.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s/gm)].map((m) => m[1]));
  const missing = [...new Set(handlerKeys)].filter((k) => !ruleKeys.has(k));
  expect(
    missing,
    '以下 action 缺契约规则（validateMessage 现默认拒绝，会导致其被挡）:\n  ' + missing.join('\n  ')
  ).toEqual([]);
  expect(handlerKeys.length).toBeGreaterThan(40); // 聚合完整性兜底（防段展开遗漏归零）
  expect(contractSrc.includes('未契约化')).toEqual(true);
});

// v10.5.0 P2：存储模块新增需同步 4 处（constants DB_KEYS/DATA_MODULES、data-store
// MODULE_FILES、reset/backups）。此前漂移静默。此处强制 DATA_MODULES ⊆ DB_KEYS ∩
// MODULE_FILES——新增模块漏登记即在 check 失败（把"演进税"变成构建护栏）。
const constantsMod = await import(
  new URL('../../background/core/constants.js', import.meta.url).href + '?t=' + Date.now()
);
// v10.7.0 批次2：MODULE_FILES 由 data/storage-registry.js 派生——断言对象
// 改为注册表源（data-store.js 只是消费者，不再含字面量表）
const regSrc = fs.readFileSync(path.join(ROOT, 'data/storage-registry.js'), 'utf-8');
const moduleFileKeys = new Set([...regSrc.matchAll(/^  ([A-Za-z0-9_]+):\s*\{/gm)].map((m) => m[1]));
const dbKeyValues = new Set(Object.values(constantsMod.DB_KEYS));
test('P2：DATA_MODULES 每个 storageKey 均在 DB_KEYS 值集合中', () => {
  const bad = constantsMod.DATA_MODULES.filter((m) => !dbKeyValues.has(m.storageKey)).map(
    (m) => `${m.key}→${m.storageKey}`
  );
  expect(bad, 'storageKey 不在 DB_KEYS（漏登记）:\n  ' + bad.join('\n  ')).toEqual([]);
});
test('P2：DATA_MODULES 每个 storageKey 均在 MODULE_FILES 中', () => {
  const bad = constantsMod.DATA_MODULES.filter((m) => !moduleFileKeys.has(m.storageKey)).map(
    (m) => `${m.key}→${m.storageKey}`
  );
  expect(bad, 'storageKey 不在 data-store MODULE_FILES（漏文件映射）:\n  ' + bad.join('\n  ')).toEqual([]);
});

// ============ 10. vitest include 清单自检（v14.2.0，补充轮 P0-3） ============
// 显式清单漏加新测试文件时 npm test 静默不跑且门禁全绿——把约定升级为不变量。
const vitestCfgSrc = fs.readFileSync(path.join(ROOT, 'vitest.config.js'), 'utf-8');
const declaredSuites = [...vitestCfgSrc.matchAll(/'(tests\/(?:unit|integration)\/test-[^']+\.mjs)'/g)].map((m) => m[1]);
const onDiskSuites = collectJs(path.join(ROOT, 'tests/unit'), [])
  .concat(collectJs(path.join(ROOT, 'tests/integration'), []))
  .map((f) => 'tests/' + path.relative(path.join(ROOT, 'tests'), f).replace(/\\/g, '/'))
  .filter((f) => /test-[^/]+\.mjs$/.test(f))
  .sort();
test('vitest include 清单覆盖全部测试文件（漏登记 = 静默不跑）', () => {
  const missing = onDiskSuites.filter((f) => !declaredSuites.includes(f));
  expect(missing, '漏加 vitest.config.js include 的测试文件:\n  ' + missing.join('\n  ')).toEqual([]);
});

// ============ 11. SITE_SCRIPT_FILES 真单源（v14.2.0，补充轮 P0-4） ============
// 此前 manifest js 清单与 site-scripts.js 各一份手工副本（零测试守护）——
// 漂移时内置站静态注入与自定义站动态注册一半失灵且 check 全绿。
test('manifest content_scripts js 清单 = SITE_SCRIPT_FILES（顺序敏感单源断言）', () => {
  const manifestJs = (manifest.content_scripts || []).flatMap((cs) => cs.js || []);
  expect(JSON.stringify(manifestJs)).toEqual(JSON.stringify(siteScriptsMod.SITE_SCRIPT_FILES));
});

// ============ 12. XSS 转义静态扫描（v14.2.0，主报告 P1-2——铁律 #1 机器护栏） ============
// 扫描生产 JS 中 innerHTML 模板串的 ${...} 插值：不含引号的纯数字/布尔/变量
// 运算视为低风险跳过；其余（字符串拼接数据）未经 esc/escapeHtml/escapeAttr
// 包裹的计为"未防护插值"。当前总数记入 scripts/lint-baseline.json
// xssUnescapedInterpolations 棘轮（只降不升）——先落基线，后续批次清零。
const XSS_SCAN_DIRS = [
  'content',
  'options',
  'dashboard',
  'popup',
  'sidepanel',
  'welcome',
  'hub',
  'freegames',
  'shared'
];
const SAFE_INTERP_RE = /^\s*(?:[\w.]*\.)?(?:esc|escA|esc2|escapeHtml|escapeAttr)\s*\(/;
function scanXssInterpolations(file) {
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/innerHTML\s*(?:\+=|=)/.test(lines[i])) continue;
    let tpl = lines[i];
    let j = i;
    while (j + 1 < lines.length && (tpl.match(/`/g) || []).length % 2 === 1) {
      j += 1;
      tpl += '\n' + lines[j];
    }
    i = j; // 模板整体消费
    for (const m of tpl.matchAll(/\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
      const expr = m[1];
      if (!/['"`]/.test(expr)) continue; // 纯数字/布尔/变量运算（${size}px 等）
      if (SAFE_INTERP_RE.test(expr)) continue; // 已被转义包裹
      out.push({
        file: path.relative(ROOT, file).replace(/\\/g, '/'),
        line: i + 1,
        expr: expr.replace(/\s+/g, ' ').slice(0, 90)
      });
    }
  }
  return out;
}
const xssFindings = XSS_SCAN_DIRS.flatMap((d) => collectJs(path.join(ROOT, d), [])).flatMap((f) =>
  scanXssInterpolations(f)
);
const lintBaseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/lint-baseline.json'), 'utf-8'));
const xssBaseline = Number(lintBaseline.xssUnescapedInterpolations || 0);
// ============ 13. 内容 ESM import 链的 WAR 覆盖（v14.2.0） ============
// content 模块经 chrome.runtime.getURL 动态 import，其静态 import 的 shared
// 模块必须命中 web_accessible_resources 通配——此前 spy-scales/fm-keys 下沉
// shared 后不在 WAR，真机动态 import 全链失败而单测全绿（环境差异型盲区）。
test('content 静态 import 的 shared 模块均在 WAR 覆盖内', () => {
  const warRes = (manifest.web_accessible_resources || []).flatMap((w) => w.resources || []);
  const sharedImports = new Set();
  for (const f of collectJs(path.join(ROOT, 'content'), [])) {
    const src = fs.readFileSync(f, 'utf-8');
    for (const m of src.matchAll(/from\s+'[^']*\/\/shared\/([a-z0-9-]+\.js)'/g)) {
      sharedImports.add('shared/' + m[1]);
    }
  }
  const hit = (res) => warRes.some((w) => w.endsWith('*') && res.startsWith(w.slice(0, -1)));
  const uncovered = [...sharedImports].filter((r) => !warRes.includes(r) && !hit(r));
  expect(uncovered, 'WAR 未覆盖的内容侧共享依赖:\n  ' + uncovered.join('\n  ')).toEqual([]);
});

test('XSS 未防护插值 ≤ 棘轮基线（只降不升——铁律 #1 机器护栏）', () => {
  if (xssFindings.length > xssBaseline) {
    const detail = xssFindings
      .slice(0, 15)
      .map((f) => '  ' + f.file + ':' + f.line + ' ${' + f.expr + '}')
      .join('\n');
    console.error(`❌ XSS 未防护插值 ${xssFindings.length} > 基线 ${xssBaseline}:\n${detail}`);
  }
  expect(xssFindings.length).toBeLessThanOrEqual(xssBaseline);
});
