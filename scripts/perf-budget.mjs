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
  // v14.29.1：重试轮快照副本 + 根因注释（ratings-batch）再 +752B，同批修复性净增。
  // v14.28.4（第二轮落地）：日志连续写入上界（mechanisms debounce maxWaitMs +
  // logger/debounced-store 传参）与 R2-04 根因注释 +1.4KB；其中主体是双语
  // 根因注释（UTF-8 中文 3B/字），代码增量约 0.2KB。按实测重锁。
  // v14.28.5（第三轮 R3）：T1 LLM 超时 25s + T2 站点脚本同步移出冷启动，双语根因
  // 注释 +2,157B（HEAD 提交态实测 847,145B；工作区含用户侧未提交 adapter 改动
  // −718B，若其回退则正好等于本值）。
  // staticInjection 口径同时修正：拆分后改锁**单条最坏页面**注入量（38,407B），
  // 不再把全部条目的并集（任何单页都不会全量加载）当作"每页必付"。
  // v14.28.5: budgets re-locked after the per-site content_scripts split; the
  // static-injection metric now measures the worst single page, not the union.
  // v14.28.6（第四轮 R4-B）：新增 background/steam/match-confidence.js（三要素
  // 置信度 + 身份段标题核对，~4.0KB，主体是双语根因注释）+ 徽章推测样式
  // （styles/content.css +256B）；SW 图 857,074B/106 文件、静态注入 38,663B，
  // 按实测重锁（新增模块，无冗余代码）。
  // v14.28.6 (R4-B): new match-confidence module + suspected-badge CSS; re-locked
  // to the measured values.
  // v14.28.6（第四轮 R4-A）：单条目两级看门狗——mechanisms 新增 withWatchdog 与
  // withLock 可选超时、constants 两级阈值（含实测依据注释）、ratings-batch 在途表/
  // 心跳/软硬阈值接线、orchestrator-list 阶段回调；SW 图 +13.2KB（主体是双语
  // 根因注释），按实测重锁（新增能力，无冗余代码）。
  // v14.28.6 (R4-A): two-level per-item watchdog; re-locked to the measured value.
  // v14.28.6（第四轮 R4-C）：四处模块头新增 @invariant 注释（orchestrator-list /
  // ratings-batch / mechanisms / badge-base），SW 图 +1,197B 全为文档注释、零运行时
  // 代码；按实测重锁。
  // v14.28.6 (R4-C): @invariant header comments only (no runtime code); re-locked.
  // v14.28.7（R4-B2/B3 口径校准）：置信度规则重写（平台最优先/年份 >1 年才降级/
  // 标题相似度主门槛 + 序号护栏）+ 详情管线挂置信度（来源链/页面标题身份）+
  // platform-detect 移动/云标记；SW 图 881,676B/106 文件（+10,154B，主体为
  // 双语根因注释）。工作区含用户侧未提交 adapter 改动（不计入本批语义）。
  // 按实测重锁——新增能力，无冗余代码。
  // v14.28.7 (R4-B2/B3): recalibrated confidence rules + detail-side evidence,
  // re-locked to the measured graph size.
  // adapter 延迟装配批次（未 bump 版本）：8 个 adapter 顶层只注册工厂/懒 getter，
  // 注册表首次读取才装配——SW 图 895,136B → 890,346B（净 −4,790B = 装配代码
  // +415B − 注释/空行收敛 5,205B），静态注入 41,197B → 38,663B（−2,534B），
  // 内容闭包 297,720B → 292,930B（−4,790B）。
  // 注意：3fcf6c4（详情缓存完整性修复）当时未重锁，HEAD 本身已 895,136B >
  // 881,676B；本值只是按实测重锁，仍包含该批 +8,670B 待后续批次回收，
  // 不计入本批收益。
  // Adapter lazy-assembly batch: the registry is built on first read; measured
  // graph shrinks by 4,790B net. The remaining +8,670B above the old lock is
  // pre-existing debt from 3fcf6c4, not attributed to this batch.
  // v14.28.8（三修复批次 e4ac881）：ratings-batch 停滞边沿心跳（+49 行）、
  // orchestrator-list 网络故障哨兵（+41 行）、app-list-index 多源装载/解析
  // 抽取（+47 行）、content 侧故障徽章分支（+22/+19 行）——SW 图 +5,698B、
  // 内容闭包 list +596B，主体是双语根因注释；按实测重锁（新增能力，无冗余
  // 代码）。静态注入未变（38,663B）。
  // v14.28.8 (three-fix batch): stall heartbeat, network-failure sentinel and
  // multi-source dump loader; re-locked to the measured values.
  swGraphBytes: 896044,
  swGraphFiles: 106,
  staticInjectionBytes: 38663,
  closureBytes: 295062
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
  const cssFiles = new Set();
  let cssBytes = 0;
  // v14.28.5：content_scripts 按站点拆分后，"每家页面都付"的成本不再等于各条目
  // js 之和（那是全部条目的并集，任何单页都不会全量加载）。改为逐条目求和取最大
  // ——worstPageBytes 才是真实单页注入成本，也是预算该锁的口径。
  // After splitting content_scripts per site, the per-page cost is the largest
  // single entry, not the union of all entries.
  let worstPageBytes = 0;
  for (const entry of manifest.content_scripts || []) {
    for (const f of entry.js || []) js.push(f);
    let entryBytes = 0;
    for (const f of [...(entry.js || []), ...(entry.css || [])]) {
      const abs = path.join(ROOT, f);
      if (fs.existsSync(abs)) entryBytes += fs.statSync(abs).size;
    }
    for (const f of entry.css || []) cssFiles.add(f);
    worstPageBytes = Math.max(worstPageBytes, entryBytes);
  }
  for (const f of cssFiles) {
    const abs = path.join(ROOT, f);
    if (fs.existsSync(abs)) cssBytes += fs.statSync(abs).size;
  }
  const uniqueJs = [...new Set(js)];
  const jsBytes = uniqueJs.reduce((acc, f) => {
    const abs = path.join(ROOT, f);
    return acc + (fs.existsSync(abs) ? fs.statSync(abs).size : 0);
  }, 0);
  return {
    files: uniqueJs,
    bytes: worstPageBytes, // 单页最坏注入量（预算口径）
    unionBytes: jsBytes + cssBytes, // 全部条目并集（仅参考，任何单页都不会全量加载）
    cssBytes,
    entries: (manifest.content_scripts || []).length
  };
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
      `内容静态注入      ${kb(report.staticInjection.bytes)} 单页最坏 (${report.staticInjection.files} 文件 / ${staticAssets.entries} 条 content_scripts，并集 ${kb(staticAssets.unionBytes)})   (预算 ${kb(BUDGETS.staticInjectionBytes)})`
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
