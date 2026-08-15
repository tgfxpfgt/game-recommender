/**
 * 游戏雷达 Game Radar - 覆盖率门禁 / Coverage Gate
 *
 * v7.0.5：对相对 origin/main 的**新增业务文件**（A 状态 .js/.mjs）跑 vitest
 * 覆盖率，断言行覆盖率 ≥ 阈值（默认 50%）。无新增文件直接通过。
 * 防止新增代码无测试直接上线（全局硬门槛易流于形式，新增文件门槛更精准）。
 * Run: npm run coverage:gate
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_LINES = Number(process.env.COVERAGE_MIN_LINES || 50);
const COVERED_DIRS = ['background', 'content', 'adapters', 'data', 'shared'];

function run(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
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

// 2. 跑 vitest 覆盖率（仅统计新增文件）
const includes = newFiles.map((f) => `--coverage.include=${f}`).join(' ');
const output = run(`npx vitest run --coverage ${includes} --coverage.reporter=text`);
console.log(output.slice(-3000));

// 3. 解析文本表格：filename | stmts | branch | funcs | lines
const lines = output.split('\n');
const failed = [];
const tableRe = /^\s*([\w./-]+\.(?:js|mjs))\s+\|\s+([\d.]+|—)\s+\|\s+([\d.]+|—)\s+\|\s+([\d.]+|—)\s+\|\s+([\d.]+|—)/;
for (const line of lines) {
  const m = tableRe.exec(line);
  if (!m) continue;
  const file = m[1].replace(/\\/g, '/');
  if (!newFiles.some((f) => file.endsWith(path.basename(f)))) continue;
  const linesPct = m[5] === '—' ? 0 : Number(m[5]);
  if (linesPct < MIN_LINES) failed.push(`${file}: ${linesPct}%`);
}

if (failed.length > 0) {
  console.error(`❌ 覆盖率门禁失败（行覆盖 < ${MIN_LINES}%）：\n  ${failed.join('\n  ')}`);
  console.error('提示：为新增文件补充单元测试，或调整阈值（COVERAGE_MIN_LINES）');
  process.exit(1);
}
console.log(`✅ 覆盖率门禁通过（全部新增文件行覆盖 ≥ ${MIN_LINES}%）`);
