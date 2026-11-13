/**
 * 游戏雷达 Game Radar - 受影响测试选择器 / Affected-Test Selector
 *
 * v14.23.0（用户指令 2026-11-10：最小必要收敛——测试规模与变更面成正比）：
 * gate:fast 的测试步。按工作区变更计算最小必要测试集，规则：
 *   1) 版本/文档/样式/工具脚本类变更（manifest/package/README/welcome/docs/
 *      styles/icons/scripts）不触发 vitest（visual/package/lint 步已覆盖）；
 *   2) 触碰宽爆炸半径单源（FULL_TRIGGERS/FULL_PREFIXES 白名单）→ 升级定向
 *      验证（related + 扫描器套件；测试基建例外仍全量）；相关文件 >15 →
 *      升级全量 npm test（大批次整体验证）；
 *   3) 其余按变更面：unit/integration 走 `vitest related`（静态 import 图）；
 *      sim 走显式路径映射——sim 套件经 __grImport eval 装载 content 模块，
 *      不在静态 import 图上（vitest.config.js v6.0.0 同源原因）；
 *   4) 变更的测试文件自身直跑（related 只覆盖"引用方"，不覆盖文件本身）；
 *   5) 非测试文件（tests/fixtures/*.json 等）经 FIXTURE_MAP 映射到消费套件——
 *      未登记即红；不允许把夹具路径直接交给 vitest（"No test files found" 假绿）。
 * 兜底：git 不可用/异常 → 全量 npm test（保守方向）。
 * Affected-test selection for gate:fast; git failure degrades to full npm test.
 * Run: node scripts/test-changed.mjs [--base <ref>] [--to <ref>] [<file...>]
 *   --base：对指定基线（如 origin/main）校验，默认含工作区变更；配 --to 则为纯提交区间
 *   --to：与 --base 连用，校验已提交区间（base..to），不含工作区（历史批次补验）
 *   <file...>：显式文件清单（自测/复现），跳过 git 变更检测
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// sim 全量（content 根文件/core/tracking 等宽影响面变更时全跑——sim 仅 4 套件，成本可控）
const SIM_ALL = [
  'tests/sim/sim-list.mjs',
  'tests/sim/sim-badges.mjs',
  'tests/sim/sim-detail.mjs',
  'tests/sim/sim-float-menu.mjs'
];

// 宽爆炸半径单源白名单：改动一处波及全项目，触碰即升级全量 vitest
// （settings-sync/test-integrity/契约/词表 golden 等兜底网随之必然运行）
const FULL_TRIGGERS = [
  'background/core/constants.js',
  'background/core/settings.js',
  'background/core/message-contract.js',
  'background/core/mechanisms.js',
  'background/core/rules.js',
  'background/handlers.js',
  'background/service-worker.js',
  'data/data-store.js',
  'data/storage-registry.js',
  'content/tracker.js',
  'content/module-manifest.js',
  'tests/sim/sim-harness.mjs',
  'vitest.config.js'
];
const FULL_PREFIXES = ['shared/', 'tests/helpers/', 'data/'];

// 不触发 vitest 的变更（版本样板/文档/样式/工具——各有专属门禁步覆盖）
const SKIP_PREFIXES = [
  'README.md',
  'docs/',
  'welcome/',
  'styles/',
  'icons/',
  'manifest.json',
  'package.json',
  'package-lock.json',
  'scripts/',
  'eslint.config.js',
  'tsconfig',
  '.github/'
];

// sim 显式映射（prefix → 套件；首个命中即生效，宽前缀放后面兜底）
const SIM_MAP = [
  { prefix: 'content/detail/', suites: ['tests/sim/sim-detail.mjs'] },
  { prefix: 'content/list/', suites: ['tests/sim/sim-list.mjs'] },
  { prefix: 'content/core/', suites: SIM_ALL },
  { prefix: 'content/tracking/', suites: SIM_ALL },
  { prefix: 'adapters/', suites: SIM_ALL },
  { prefix: 'content/', suites: SIM_ALL }
];

// 特例映射：不在静态 import 图上的定向回归（userscript 纯函数防漂移门禁）
const EXTRA_MAP = [{ prefix: 'userscript/', suites: ['tests/unit/test-userscript-pure.mjs'] }];

// v14.28.9（L3 D 类假绿修复）：非测试文件（夹具 JSON）→ 消费它的测试套件。
// 此前把 fixtures 路径直接传给 vitest，vitest 报 "No test files found"，脚本
// 按"空匹配"判绿——夹具改了却没有任何断言跑过。**未登记的非 .mjs 变更直接红**
// （拒绝空匹配通过），映射缺失即要求补这一行。
// Fixture → consumer-suite map; unmapped non-test files under tests/ are a hard fail.
const FIXTURE_MAP = [
  {
    file: 'tests/fixtures/mismatch-samples.json',
    // 直读：test-mismatch-samples；锚点表：test-mismatch-anchors；回放运行器（helpers/mismatch-replay）：test-vocab-pack-gate
    suites: [
      'tests/unit/test-mismatch-samples.mjs',
      'tests/unit/test-mismatch-anchors.mjs',
      'tests/unit/test-vocab-pack-gate.mjs'
    ]
  },
  {
    file: 'tests/fixtures/baseline-firstpage.json',
    // 直读：test-baseline-firstpage；回放运行器（helpers/mismatch-replay）第三源之外的第二源
    suites: ['tests/unit/test-baseline-firstpage.mjs', 'tests/unit/test-vocab-pack-gate.mjs']
  },
  // xd3 只被 test-baseline-firstpage 以双基准形式直读（NOT in helpers/mismatch-replay）
  { file: 'tests/fixtures/baseline-xd3.json', suites: ['tests/unit/test-baseline-firstpage.mjs'] },
  // 仅经 helpers/mismatch-replay 的第三源进入回放池
  { file: 'tests/fixtures/wrong-report-samples.json', suites: ['tests/unit/test-vocab-pack-gate.mjs'] }
];

// 显式文件清单（自测/复现）：`node scripts/test-changed.mjs <file...>`——
// 跳过 git 变更检测，直接用给定文件走同一套选择逻辑（gate 调用不带该参数）。
const explicitFiles = (() => {
  const args = process.argv.slice(2);
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--base' || a === '--to') {
      i++; // 跳过选项值
      continue;
    }
    if (a.startsWith('--')) continue;
    out.push(a.replace(/\\/g, '/'));
  }
  return out;
})();

function git(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8' });
}

// 变更文件：默认工作区（含暂存+未跟踪）优先，全净时回退校验上一个提交；
// --base <ref>：显式基线（git diff <ref> = 已提交+工作区合并视图，用于批次补验）
function changedFiles() {
  const norm = (s) =>
    s
      .split('\n')
      .map((f) => f.trim().replace(/\\/g, '/'))
      .filter(Boolean);
  if (explicitFiles.length > 0) {
    console.log(`ℹ️ 显式文件清单（自测/复现，${explicitFiles.length} 个）：${explicitFiles.join(', ')}`);
    return [...new Set(explicitFiles)];
  }
  const baseIdx = process.argv.indexOf('--base');
  const base = baseIdx > 0 ? process.argv[baseIdx + 1] : null;
  const toIdx = process.argv.indexOf('--to');
  const to = toIdx > 0 ? process.argv[toIdx + 1] : null;
  let files;
  if (base && to) {
    files = [...norm(git(`git diff --name-only ${base} ${to}`))];
    console.log(`ℹ️ 校验提交区间 ${base}..${to}（不含工作区）`);
  } else if (base) {
    files = [...norm(git(`git diff --name-only ${base}`))];
    console.log(`ℹ️ 校验基线 ${base}（已提交+工作区合并视图）`);
  } else {
    files = [...norm(git('git diff --name-only HEAD')), ...norm(git('git ls-files --others --exclude-standard'))];
    if (files.length === 0) {
      files = norm(git('git diff --name-only HEAD~1 HEAD'));
      if (files.length > 0) console.log('ℹ️ 工作区干净，回退校验上一个提交（HEAD~1）');
    }
  }
  return [...new Set(files)];
}

function runVitest(label, cmd) {
  console.log(`\n▶ ${label}\n  ${cmd}`);
  const r = spawnSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  const out = String(r.stdout || '') + String(r.stderr || '');
  console.log(out.slice(-6000));
  // "无相关测试"是正常空集而非失败（related/直跑均可能空匹配）
  if (r.status !== 0 && /no related tests found|no test files found/i.test(out)) {
    console.log('✅ 空匹配按通过处理');
    return true;
  }
  if (r.status !== 0) {
    console.error(`❌ ${label} 失败（exit ${r.status}）`);
    return false;
  }
  console.log(`✅ ${label} 通过`);
  return true;
}

function runFull(reason) {
  console.log(`\n⬆️ 升级全量 vitest：${reason}`);
  const r = spawnSync('npm test', { cwd: ROOT, stdio: 'inherit', shell: true });
  process.exit(r.status || 0);
}

// v14.24.1（token/时间收敛）：白名单单源升级改**定向集**——不再全量 npm test
//（87 文件 100-270s），改 ① vitest related（静态 import 图上的全部引用方，
// 精确覆盖"改了谁影响谁"）+ ② 扫描器套件（覆盖 import 图之外的消费者：
// action 字面量/设置键/存储键——契约/设置同步/完整性扫描）。覆盖面论证：
// background 单源不被 sim 装载（sim 用 presets mock 后台），related+扫描器
// 即完整闭环；>15 文件大批次仍走全量（整体验证语义）。
// v14.24.1: whitelist escalation now runs `vitest related` + scanner suites
// (contract consumers off the import graph) instead of the full run.
const SCANNER_SUITES = [
  'tests/unit/test-contract.mjs', // 消息契约规则
  'tests/unit/test-settings-sync.mjs', // 设置键全链同步
  'tests/unit/test-reset-defaults.mjs', // 设置键恢复默认映射
  'tests/unit/test-handlers.mjs', // action 消费链路
  'tests/unit/test-orchestrator.mjs', // 检索管线
  'tests/integration/test-integrity.mjs', // 静态完整性扫描
  'tests/integration/test-integrity-security.mjs'
];

async function runTargeted(triggerFiles, reason) {
  console.log(`\n⬆️ 升级定向验证（related + 扫描器）：${reason}`);
  let ok = true;
  const quoted = triggerFiles.map((f) => `"${f}"`).join(' ');
  ok = runVitest('vitest related（白名单文件静态引用方）', `npx vitest related ${quoted} --run`) && ok;
  const scannerList = SCANNER_SUITES.map((f) => `"${f}"`).join(' ');
  ok = runVitest('vitest 扫描器套件（import 图外消费者）', `npx vitest run ${scannerList}`) && ok;
  process.exit(ok ? 0 : 1);
}

// ---- 主流程 / Main ----
let files;
try {
  files = changedFiles();
} catch (e) {
  console.error('⚠️ git 变更检测失败，保守回退全量：', String(e).slice(0, 200));
  runFull('git 检测异常（保守兜底）');
}

const relevant = files.filter((f) => !f.endsWith('.md') && !SKIP_PREFIXES.some((p) => f === p || f.startsWith(p)));
if (relevant.length === 0) {
  console.log(`✅ 变更 ${files.length} 个文件均不触发 vitest（版本/文档/样式/工具类），跳过测试步`);
  process.exit(0);
}

// 白名单 → 定向升级（related + 扫描器）；大批次 → 全量（test-settings-sync/
// test-integrity 等兜底网随扫描器套件必然运行）
const whitelistHits = relevant.filter((f) => FULL_TRIGGERS.includes(f) || FULL_PREFIXES.some((p) => f.startsWith(p)));
if (whitelistHits.length > 0) {
  // 测试基建本身（影响所有套件的运行方式）仍全量——related 对配置/装载器无引用边
  const infraHit = whitelistHits.find(
    (f) => ['vitest.config.js', 'tests/sim/sim-harness.mjs'].includes(f) || f.startsWith('tests/helpers/')
  );
  if (infraHit) {
    runFull(`触碰测试基建：${infraHit}`);
  }
  await runTargeted(whitelistHits, `触碰宽爆炸半径单源：${whitelistHits.join(', ')}`);
}
if (relevant.length > 15) runFull(`相关文件 ${relevant.length} 个（大批次整体验证）`);

// 变更面分类：related 集（静态图）+ sim 映射 + 变更测试文件直跑 + 夹具映射
const related = [];
const directUnit = []; // 变更的 unit/integration 套件自身 + userscript 特例映射 + 夹具消费方
const simSet = new Set();
const unmappedFixtures = []; // 非 .mjs 测试资产但无消费方映射（必须红，不许假绿）
for (const f of relevant) {
  if (f.startsWith('tests/sim/')) {
    simSet.add(f);
    continue;
  }
  if (f.startsWith('tests/')) {
    if (f.endsWith('.mjs')) {
      directUnit.push(f); // 只把真实测试文件交给 vitest
      continue;
    }
    const mapped = FIXTURE_MAP.find((m) => m.file === f);
    if (mapped) mapped.suites.forEach((s) => directUnit.push(s));
    else unmappedFixtures.push(f);
    continue;
  }
  if (existsSync(path.join(ROOT, f))) related.push(f); // 已删除文件不进 related
  for (const m of EXTRA_MAP) {
    if (f.startsWith(m.prefix)) directUnit.push(...m.suites);
  }
  for (const m of SIM_MAP) {
    if (f.startsWith(m.prefix)) {
      m.suites.forEach((s) => simSet.add(s));
      break;
    }
  }
}

if (unmappedFixtures.length > 0) {
  console.error('\n❌ 非测试文件变更缺少"消费套件"映射（拒绝空匹配通过，夹具改了必须有断言跑）：');
  for (const f of unmappedFixtures) console.error(`  - ${f}`);
  console.error('  修法：在 scripts/test-changed.mjs 的 FIXTURE_MAP 补一行 { file, suites:[消费它的 tests/**/*.mjs] }');
  process.exit(1);
}

console.log(
  `📦 变更 ${files.length} 文件（相关 ${relevant.length}）→ related ${related.length} 源文件 / 直跑 ${directUnit.length} 套件 / sim ${simSet.size} 套件`
);
const onlyStyles = related.length === 0 && directUnit.length === 0 && simSet.size === 0;
if (onlyStyles) {
  // "空匹配通过"只允许出现在**变更根本没碰测试面**的批次（docs/scripts/页面层）；
  // 测试文件或夹具变更映射后仍为空 = 选择器漏配，必须红。
  const testSide = relevant.filter((f) => f.startsWith('tests/'));
  if (testSide.length > 0) {
    console.error(`\n❌ 变更含测试面但未匹配到可运行套件（选择器漏配）：${testSide.join(', ')}`);
    process.exit(1);
  }
  console.log('✅ 无受影响测试（页面层/样式变更由 visual 步覆盖），跳过');
  process.exit(0);
}

// B8 两阶段纪律：unit/integration 先行，sim 独立新进程批次收尾
//（pool 级 isolate:true 强制每文件新进程，unit 与 integration 同批安全）
// v14.29.0（整批门禁恒红根治）：related 阶段显式排除 sim 套件——sim-list
// 等静态 import 了 content 模块，`vitest related` 会把它们卷进 unit/
// integration 同进程（AGENTS B8 明载跨文件同进程连跑推送丢失 20-50%；
// 本次升级面 9 套件连跑 sim-list 节 2/2b/12 五连恒红实证）。sim 套件由
// SIM_MAP 显式映射进下方独立 fresh 进程批次——不丢覆盖，只归位纪律。
// Related phase excludes sim suites (they run isolated in the sim phase
// below) — restores the designed B8 two-phase discipline.
let ok = true;
if (related.length > 0) {
  const quoted = related.map((f) => `"${f}"`).join(' ');
  ok = runVitest(
    'vitest related（静态 import 图受影响套件，sim 归独立批次）',
    `npx vitest related ${quoted} --run --exclude "tests/sim/**"`
  );
}
if (ok && directUnit.length > 0) {
  const quoted = [...new Set(directUnit)].map((f) => `"${f}"`).join(' ');
  ok = runVitest('vitest 直跑（变更的测试套件 + 特例映射）', `npx vitest run ${quoted}`);
}
if (ok && simSet.size > 0) {
  const quoted = [...simSet].map((f) => `"${f}"`).join(' ');
  ok = runVitest('vitest sim（fresh 进程批次）', `npx vitest run ${quoted}`);
}
process.exit(ok ? 0 : 1);
