/**
 * 游戏雷达 Game Radar - 覆盖率门禁 / Coverage Gate
 *
 * v7.0.5：对相对 origin/main 的**新增业务文件**（A 状态 .js/.mjs）跑 vitest
 * 覆盖率，断言行覆盖率 ≥ 阈值（默认 50%）。无新增文件直接通过。
 * 防止新增代码无测试直接上线（全局硬门槛易流于形式，新增文件门槛更精准）。
 * Run: npm run coverage:gate
 */
import { execSync } from 'node:child_process';
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

// 1. 找出相对 origin/main 的新增文件（未合并的 A 状态）；无远端基线时
//    回退对比 HEAD~1（CI 浅克隆场景——防止门禁被静默跳过）
let newFiles = [];
try {
  const base = run('git merge-base HEAD origin/main').trim();
  const diff = run(`git diff --name-only --diff-filter=A ${base} HEAD`);
  newFiles = diff
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => /\.(js|mjs)$/.test(f) && COVERED_DIRS.some((d) => f.startsWith(d + '/')))
    .filter((f) => !f.includes('/test') && !f.startsWith('tests/'));
} catch {
  // 无 origin/main（首次克隆/浅克隆）→ 回退 HEAD~1
  try {
    const diff = run('git diff --name-only --diff-filter=A HEAD~1 HEAD');
    newFiles = diff
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => /\.(js|mjs)$/.test(f) && COVERED_DIRS.some((d) => f.startsWith(d + '/')))
      .filter((f) => !f.includes('/test') && !f.startsWith('tests/'));
    console.log('⚠️ 无 origin/main 基线，回退对比 HEAD~1');
  } catch {
    console.log('⚠️ 无法确定基线，跳过覆盖率门禁');
    process.exit(0);
  }
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
