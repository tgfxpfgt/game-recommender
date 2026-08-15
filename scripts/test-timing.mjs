/**
 * 游戏雷达 Game Radar - 测试耗时度量 / Test Timing
 *
 * v7.1.0：运行 vitest 并解析耗时构成（transform/import/tests），追加到
 * tests/.timing.jsonl（不入库），输出最近 10 次趋势——为测试基建提速
 * 提供基线（报告 §5.3：import 占 66%）。
 * v7.3.0：--budget <秒> 参数——总耗时超预算时非零退出（CI 性能预算门禁，
 * 防测试基建随功能增长悄悄退化）。
 * Run: npm run test:timed [-- --budget 90]
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG = path.join(ROOT, 'tests', '.timing.jsonl');

const budgetArg = process.argv.indexOf('--budget');
const budget = budgetArg > -1 ? Number(process.argv[budgetArg + 1]) : null;

const output = execSync('npx vitest run', { cwd: ROOT, encoding: 'utf-8' });
// 剥离 ANSI 颜色码后解析（vitest 默认彩色输出）
const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
const m = plain.match(
  /Duration\s+([\d.]+)s \(transform ([\d.]+)s, setup [\d.]+(?:ms|s), import ([\d.]+)s, tests ([\d.]+)s/
);
if (!m) {
  console.error('❌ 无法解析 vitest 耗时输出');
  process.exit(1);
}
const [total, transform, imports, tests] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
const entry = { ts: Date.now(), total, transform, imports, tests };
fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');

// 输出最近 10 次趋势
const rows = fs
  .readFileSync(LOG, 'utf-8')
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .slice(-10);

console.log(
  `✅ 全量 ${total.toFixed(1)}s（transform ${transform.toFixed(1)} · import ${imports.toFixed(1)} · tests ${tests.toFixed(1)}）——已记录`
);
console.log('\n最近趋势（日期 · 总耗时 · import 占比）:');
for (const r of rows) {
  const d = new Date(r.ts).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  const pct = Math.round((r.imports / r.total) * 100);
  console.log(`  ${d} · ${r.total.toFixed(1)}s · import ${pct}%`);
}

// 性能预算门禁：超预算非零退出（CI 可见失败）
// Performance budget gate: exit non-zero when over budget (CI-visible failure)
if (budget !== null && total > budget) {
  console.error(`❌ 性能预算超限：全量 ${total.toFixed(1)}s > 预算 ${budget}s`);
  process.exit(1);
}
if (budget !== null) {
  console.log(`✅ 性能预算内：全量 ${total.toFixed(1)}s ≤ 预算 ${budget}s`);
}
