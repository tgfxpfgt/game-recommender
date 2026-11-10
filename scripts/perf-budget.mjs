/**
 * 游戏雷达 Game Radar - 体积预算门禁 / Bundle Budget Gate
 *
 * v14.26.0（优化方案 P1-2 后半 + P2-12）：把"每版本涨一点"的滑坡变成可拦截的
 * 数字——三个指标全部从源码静态推导，无需浏览器：
 *   M-1 SW 静态图：service-worker.js 的静态 import 递归（字节 + 文件数）
 *   M-3a 内容静态注入：manifest content_scripts 的 js/css（每页必付）
 *   M-3b 内容闭包：静态注入 + 按页面场景（list/detail）动态装载模块的闭包
 *
 * 用法 / Usage:
 *   node scripts/perf-budget.mjs            # 打印当前值（不判定）
 *   node scripts/perf-budget.mjs --assert   # 超预算退出 1（gate / CI）
 *   node scripts/perf-budget.mjs --json     # 机器可读（CI 归档）
 *
 * 阈值 = 实测基线锁定：任何增长即红。要放宽必须显式改本文件并说明理由
 * （回滚：把断言降级为 warning）。
 * Thresholds pin the measured baseline; growth fails the gate on purpose.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 方案目标值（M-1/M-3）：只用于打印差距，不做断言。
 * Plan targets (M-1/M-3): printed as a gap, never asserted.
 */
export const TARGETS = {
  swGraphBytes: 780 * 1024,
  swGraphFiles: 98,
  staticInjectionBytes: 47 * 1024,
  closureBytes: 300 * 1024
};

/**
 * 预算上限（v14.26.0 首次锁定实测值）。
 * 目标值（方案 M-1/M-3）：SW 图 ≤ 780KB、静态注入 ≤ 47KB、闭包 ≤ 300KB——
 * 当前 SW 图仍高于目标（待 SW 瘦身批次），故基线取实测值，只做"禁止变差"。
 * Budgets: pinned to the measured baseline; targets are noted in the plan.
 *
 * v14.28.0（S3 P1-2 后半结项）：目标值经实测判定为**当前架构不可达**，
 * 依据见 docs/reports/archive 对应执行记录：
 *   - SW 图需再减 42.9KB；6 个站点 adapter + index 合计 18.1KB，即使全部
 *     移出静态图仍差 24.8KB；
 *   - MV3 ServiceWorkerGlobalScope 禁止 import()（AGENTS 铁律 2），静态图
 *     字节 = 源码字节之和，静态导入的文件无法既"保留"又"不计入"；
 *   - 剩余体积均由启动即用的消息/存储/业务模块构成，删减即改行为。
 *   静态注入同理：需减 1.7KB，注入集是 3 个 shared + 7 个 adapter + tracker
 *   + CSS 的最小可用面，任何"挪出静态注入"的做法只是把成本搬到闭包
 *   （闭包预算同权），不产生净收益。
 *   结论：预算锁在实测值（只禁止变差）；目标差距由本文件在非断言模式下
 *   打印，作为后续拆分批次的可视化依据。不改行为、不做为凑数的拆包。
 */
export const BUDGETS = {
  // v14.28.0（P3-1/P3-2）：msg.js 补 clearTimeout（+约 340B，静态注入与闭包同步
  // 计入）、cache-manager 换 createTtlCache 并引入 mechanisms 导入（SW 图 +548B）
  // ——按新实测值重锁，均为修复性净增，无冗余代码。
  // v14.29.0（SW 饱和修复）：批量追加 appendModuleBatch（data-store +~600B）、
  // 重试轮退避/单并发（ratings-batch）、缓存读去重（orchestrator-list）——
  // SW 图 +693B，均为修复性净增（去重后运行期往返反而减少），按实测重锁。
  swGraphBytes: 842819,
  swGraphFiles: 105,
  staticInjectionBytes: 50164,
  closureBytes: 294466
};

const STATIC_IMPORT_RE = /(?:import|export)[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;

/** 抽出一个文件的静态 import 说明符 / static import specifiers of a file */
function staticImportsOf(src) {
  const out = [];
  for (const m of src.matchAll(STATIC_IMPORT_RE)) {
    const spec = m[1] || m[2];
    if (spec && spec.startsWith('.')) out.push(spec);
  }
  return out;
}

/**
 * 从入口集合递归收集相对 import 闭包。
 * @param {string[]} entries 仓库相对 POSIX 路径
 * @returns {{files: string[], bytes: number, missing: string[]}}
 */
export function walk(entries) {
  const seen = new Set();
  const missing = [];
  const stack = [...entries];
  while (stack.length > 0) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    const src = fs.readFileSync(abs, 'utf-8');
    for (const spec of staticImportsOf(src)) {
      stack.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)));
    }
  }
  const files = [...seen].filter((f) => !missing.includes(f)).sort();
  const bytes = files.reduce((acc, f) => acc + fs.statSync(path.join(ROOT, f)).size, 0);
  return { files, bytes, missing };
}

/** manifest 内容脚本条目 / content_scripts entries from manifest */
export function contentScriptAssets() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf-8'));
  const js = [];
  let cssBytes = 0;
  for (const entry of manifest.content_scripts || []) {
    for (const f of entry.js || []) js.push(f);
    for (const f of entry.css || []) {
      const abs = path.join(ROOT, f);
      if (fs.existsSync(abs)) cssBytes += fs.statSync(abs).size;
    }
  }
  const jsBytes = js.reduce((acc, f) => {
    const abs = path.join(ROOT, f);
    return acc + (fs.existsSync(abs) ? fs.statSync(abs).size : 0);
  }, 0);
  return { files: [...new Set(js)], bytes: jsBytes + cssBytes, cssBytes };
}

/** tracker 内的动态装载目标（getURL 字面量）/ dynamic getURL literals in tracker */
export function trackerDynamicTargets() {
  const src = fs.readFileSync(path.join(ROOT, 'content/tracker.js'), 'utf-8');
  const out = [];
  for (const m of src.matchAll(/getURL\(\s*'([^']+)'/g)) {
    if (m[1].endsWith('.js')) out.push(m[1]);
  }
  return out;
}

/** 页面场景对应的内容闭包入口 / entry list for a page scope */
function scopeEntries(modules, scope) {
  return modules.filter((m) => m.scope === 'all' || m.scope === scope).map((m) => m.file);
}

async function main() {
  const assertMode = process.argv.includes('--assert');
  const jsonMode = process.argv.includes('--json');

  const swGraph = walk(['background/service-worker.js']);
  const staticAssets = contentScriptAssets();
  const manifestMod = await import(new URL('../content/module-manifest.js', import.meta.url).href);
  const modules = [...manifestMod.CORE_MODULES, ...manifestMod.OPTIONAL_MODULES];
  const dynamicTargets = trackerDynamicTargets();

  const baseEntries = [...new Set([...staticAssets.files, ...dynamicTargets])];
  const closures = {};
  for (const scope of ['list', 'detail']) {
    closures[scope] = walk([...baseEntries, ...scopeEntries(modules, scope)]);
  }

  const report = {
    swGraph: { bytes: swGraph.bytes, files: swGraph.files.length, missing: swGraph.missing },
    staticInjection: { bytes: staticAssets.bytes, files: staticAssets.files.length },
    closure: {
      list: { bytes: closures.list.bytes, files: closures.list.files.length, missing: closures.list.missing },
      detail: { bytes: closures.detail.bytes, files: closures.detail.files.length, missing: closures.detail.missing }
    }
  };

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const kb = (n) => (n / 1024).toFixed(1) + 'KB';
    console.log('=== 体积预算 / Bundle budget ===');
    console.log(
      `SW 静态图        ${kb(report.swGraph.bytes)} / ${report.swGraph.files} 文件   (预算 ${kb(BUDGETS.swGraphBytes)} / ${BUDGETS.swGraphFiles})`
    );
    console.log(
      `内容静态注入      ${kb(report.staticInjection.bytes)} (${report.staticInjection.files} 文件)   (预算 ${kb(BUDGETS.staticInjectionBytes)})`
    );
    console.log(
      `内容闭包 list     ${kb(report.closure.list.bytes)} / ${report.closure.list.files} 文件   (预算 ${kb(BUDGETS.closureBytes)})`
    );
    console.log(
      `内容闭包 detail   ${kb(report.closure.detail.bytes)} / ${report.closure.detail.files} 文件   (预算 ${kb(BUDGETS.closureBytes)})`
    );
    const missing = [...swGraph.missing, ...closures.list.missing, ...closures.detail.missing];
    if (missing.length > 0) console.log(`⚠ 未解析路径: ${missing.join(', ')}`);
    // 目标差距（只打印，不断言）——见 TARGETS 注释：目标值当前架构不可达
    const gap = (value, target) => `目标 ${kb(target)}，差 ${kb(Math.max(0, value - target))}`;
    console.log('--- 方案目标差距（仅参考）---');
    console.log(`SW 图            ${gap(report.swGraph.bytes, TARGETS.swGraphBytes)}`);
    console.log(`内容静态注入      ${gap(report.staticInjection.bytes, TARGETS.staticInjectionBytes)}`);
    console.log(`内容闭包(list)   ${gap(report.closure.list.bytes, TARGETS.closureBytes)}`);
  }

  if (!assertMode) return;

  const fails = [];
  const check = (label, value, budget) => {
    if (value > budget)
      fails.push(`${label} ${value} > ${budget}（+${(((value - budget) / budget) * 100).toFixed(1)}%）`);
  };
  check('SW 静态图字节', report.swGraph.bytes, BUDGETS.swGraphBytes);
  check('SW 静态图文件数', report.swGraph.files, BUDGETS.swGraphFiles);
  check('内容静态注入字节', report.staticInjection.bytes, BUDGETS.staticInjectionBytes);
  check('内容闭包字节(list)', report.closure.list.bytes, BUDGETS.closureBytes);
  check('内容闭包字节(detail)', report.closure.detail.bytes, BUDGETS.closureBytes);
  const missing = [...new Set([...swGraph.missing, ...closures.list.missing, ...closures.detail.missing])];
  for (const f of missing) fails.push(`路径不存在: ${f}`);

  if (fails.length > 0) {
    console.error('\n❌ 体积预算失败:');
    for (const f of fails) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('\n✅ 体积预算通过');
}

// 仅直接执行时跑主流程；被其他脚本 import（如 gen-war.mjs 复用 walk）时不执行
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('perf-budget 执行失败:', e);
    process.exit(1);
  });
}
