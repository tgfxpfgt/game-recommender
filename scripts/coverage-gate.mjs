/**
 * 游戏雷达 Game Radar - 覆盖率门禁 / Coverage Gate
 *
 * v7.0.5：对相对 origin/main 的**新增业务文件**（A 状态 .js/.mjs）跑 vitest
 * 覆盖率，断言行覆盖率 ≥ 阈值（默认 50%）。无新增文件直接通过。
 * 防止新增代码无测试直接上线（全局硬门槛易流于形式，新增文件门槛更精准）。
 * Run: npm run coverage:gate
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_LINES = Number(process.env.COVERAGE_MIN_LINES || 50);
// v14.2.0：补齐 UI 目录（补充轮 P0-1）——此前 options/dashboard/popup/
// freegames/hub/welcome/sidepanel 的新增文件永远不进门禁，v14 拆分 8/11
// 新文件逃逸、4492 行 UI 代码在覆盖率视野之外。
const COVERED_DIRS = [
  'background',
  'content',
  'adapters',
  'data',
  'shared',
  'dashboard',
  'options',
  'popup',
  'freegames',
  'hub',
  'welcome',
  'sidepanel'
];

// v14.3.0（第五轮 B3/B6）：classic 页面胶水豁免清单——这些文件 90%+ 为仅浏览
// 器可执行的 DOM 绑定/挂载（函数定义 + OPTS/window attach），单测行覆盖无法
// 达标且意义有限；其验收通道为 settings-sync 扫描 + visual 基线 + E2E。
// 注意：仅豁免"纯胶水"，含逻辑的页面层文件（如 reset-defaults.js/sidepanel.js）
// 不入清单——新增逻辑文件请配套单测而非加豁免。
const COVERAGE_EXEMPT = [
  'options/panels/settings-render.js',
  'options/panels/settings-bind.js',
  'options/panels/cache-formatters.js',
  'popup/popup-status.js',
  'popup/popup-weights.js',
  'popup/popup-search.js',
  // xdgrid-panel：纯面板 DOM 胶水（齿轮面板 + 双标签绑定）；纯逻辑已外移
  // filter-presets.js / xdgrid-layout.js（均有单测），豁免理由同 B3 胶水
  'content/list/xdgrid-panel.js'
];

function run(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    // v14.2.0（复审轮 P0-2-b）：捕获退出码友好报错——此前 execSync 异常直接
    // 冒泡，门禁以"崩溃"形态出现且覆盖率表格根本不产出。
    const out = (String(e.stdout || '') + '\n' + String(e.stderr || '')).slice(-2000);
    console.error(`❌ 命令失败（exit ${e.status}）: ${cmd}\n${out}`);
    process.exit(1);
  }
}

// 1. 基线解析（v14.24.1）：优先 **.coverage-gate-base 标记**（上次成功门禁的
//    HEAD，gitignored 本地状态）——消除"未推送提交堆积导致 origin/main 陈旧、
//    新增文件误判、每批全量 vitest 跑覆盖率（~4min）"的成本；已门禁过的文件
//    不再重复门禁（每批增量语义不变）。标记失效/缺失回退 origin/main，
//    再回退 HEAD~1（CI 浅克隆——防止门禁被静默跳过）。
//    Baseline: last-gated-HEAD marker first; origin/main and HEAD~1 fallbacks.
const MARKER_FILE = path.join(ROOT, '.coverage-gate-base');
/** @returns {string|null} */
function resolveBase() {
  try {
    const marker = readFileSync(MARKER_FILE, 'utf-8').trim();
    // v14.24.1 修正：勿用 ^{commit} 后缀——cmd.exe 把 ^ 当转义符吃掉导致校验
    // 恒败、标记恒失效（首发版实测）。裸 sha 校验：rev-parse 产物为 40 位全哈希，
    // cat-file -e 直接可校验；歧义/不存在 → 异常走远端基线（保守方向）。
    if (/^[0-9a-f]{40}$/.test(marker)) {
      execSync(`git cat-file -e ${marker}`, { cwd: ROOT, stdio: 'ignore' }); // 校验提交存在
      console.log(`ℹ️ 基线 = 上次已门禁提交 ${marker.slice(0, 10)}（.coverage-gate-base）`);
      return marker;
    }
  } catch {
    /* 标记缺失/失效 → 走远端基线 */
  }
  try {
    const base = run('git merge-base HEAD origin/main').trim();
    console.log('ℹ️ 基线 = origin/main 合并点（无本地标记）');
    return base;
  } catch {
    try {
      const base = run('git rev-parse HEAD~1').trim();
      console.log('⚠️ 无 origin/main 基线，回退 HEAD~1');
      return base;
    } catch {
      console.log('⚠️ 无法确定基线，跳过覆盖率门禁');
      process.exit(0);
    }
  }
}
let newFiles = [];
try {
  const base = resolveBase();
  const diff = run(`git diff --name-only --diff-filter=A ${base}`);
  newFiles = diff
    .split('\n')
    .map((f) => f.trim())
    .filter(
      (f) => /\.(js|mjs)$/.test(f) && COVERED_DIRS.some((d) => f.startsWith(d + '/')) && !COVERAGE_EXEMPT.includes(f)
    )
    .filter((f) => !f.includes('/test') && !f.startsWith('tests/'));
} catch {
  console.log('⚠️ 基线 diff 失败，跳过覆盖率门禁');
  process.exit(0);
}

if (newFiles.length === 0) {
  console.log('✅ 无新增业务文件，覆盖率门禁通过');
  process.exit(0);
}

console.log(`📁 新增文件 ${newFiles.length} 个，运行覆盖率门禁（行覆盖 ≥ ${MIN_LINES}%）...`);
newFiles.forEach((f) => console.log('   -', f));

// 2. 跑 vitest 覆盖率（仅统计新增文件）——显式关闭全局 thresholds，本脚本自带逐文件门槛
const includes = newFiles.map((f) => `--coverage.include=${f}`).join(' ');
const noThresh =
  '--coverage.thresholds.lines=0 --coverage.thresholds.statements=0 --coverage.thresholds.functions=0 --coverage.thresholds.branches=0';
const output = run(`npx vitest run --coverage ${includes} ${noThresh} --coverage.reporter=text`);
console.log(output.slice(-3000));

// 3. 解析文本表格：filename | stmts | branch | funcs | lines
// v14.2.0（复审轮 P0-2-c）：此前"找不到匹配行就 continue"构成假放行通道——
// 输出格式一变则 failed 恒空、门禁恒绿。现改为：每个新增文件必须找到表格行，
// 找不到或 basename 歧义（handlers/settings.js vs panels/settings.js 同名）
// 一律按失败处理（保守方向）。
const lines = output.split('\n');
const failed = [];
const tableRe = /^\s*([\w./\\-]+\.(?:js|mjs))\s+\|\s+([\d.]+|—)\s+\|\s+([\d.]+|—)\s+\|\s+([\d.]+|—)\s+\|\s+([\d.]+|—)/;
const rows = [];
for (const line of lines) {
  const m = tableRe.exec(line);
  if (m) rows.push({ file: m[1].replace(/\\/g, '/'), linesPct: m[5] === '—' ? 0 : Number(m[5]) });
}
for (const f of newFiles) {
  // v8 text reporter 会把长路径缩写为 "...xxx.js"（省略公共前缀）——三种形态都接：
  // 全路径 / 目录省略（f 尾段）/ 缩写行（去掉 "..." 前缀后 f 以其结尾）
  const candidates = rows.filter((r) => {
    if (r.file === f) return true;
    if (f.endsWith('/' + r.file) || r.file.endsWith('/' + f)) return true;
    if (r.file.startsWith('...') && f.endsWith(r.file.slice(3))) return true;
    return false;
  });
  if (candidates.length === 0) {
    failed.push(`${f}: 未在覆盖率输出中找到表格行（reporter 格式变更？按失败处理）`);
    continue;
  }
  if (candidates.length > 1) {
    failed.push(`${f}: 覆盖率表格匹配到 ${candidates.length} 行（basename 歧义），无法归属`);
    continue;
  }
  if (candidates[0].linesPct < MIN_LINES) failed.push(`${candidates[0].file}: ${candidates[0].linesPct}%`);
}

if (failed.length > 0) {
  console.error(`❌ 覆盖率门禁失败（行覆盖 < ${MIN_LINES}%）：\n  ${failed.join('\n  ')}`);
  console.error('提示：为新增文件补充单元测试，或调整阈值（COVERAGE_MIN_LINES）');
  process.exit(1);
}
console.log(`✅ 覆盖率门禁通过（全部新增文件行覆盖 ≥ ${MIN_LINES}%）`);
// v14.24.1：记录本次已门禁 HEAD（含工作区语义——diff 基于 base 含未提交文件，
// 通过即代表当前工作区状态已验证），下次从此处增量
try {
  writeFileSync(MARKER_FILE, run('git rev-parse HEAD').trim());
} catch {
  /* 写标记失败不影响门禁结果 */
}
