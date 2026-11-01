#!/usr/bin/env node
/**
 * 游戏雷达 Game Radar - 全局覆盖率快照棘轮（v14.11 B10，报告 B P1-01）
 *
 * coverage:gate 只检查"相对 origin/main 的新增文件"——push 后 merge-base 到
 * HEAD 的新增文件为空 → 门禁恒绿，存量文件改动完全无覆盖率约束。本脚本补
 * **全局行覆盖率快照**：跑 unit-only coverage（避开 sim 插桩超时——隔离实测
 * 1.8s 全绿、插桩后 20s 信号预算不足），对比 scripts/coverage-baseline.json
 * 的 total.lines.pct，低于基线即失败（棘轮：只降不升；更新走 --update 并
 * 在 notes 说明）。
 * Global coverage ratchet: unit-only coverage vs a checked-in baseline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASELINE = path.join(ROOT, 'scripts', 'coverage-baseline.json');

async function runCoverage() {
  // unit-only：sim 套件对插桩敏感（GR_SIM_SIGNAL_TIMEOUT_MS 20s 预算在插桩
  // 下不足，报告 B P1-02），unit 覆盖率即可代表全局趋势
  // vitest 编程式 API 进程内运行——沙箱宿主拦截一切脚本内 spawn（cmd.exe/
  // node 均 ENOENT，第三方报告 B'exec 全局不可用'同源），进程内 import 是
  // 唯一通路；signal 提额防插桩下 sim 级超时（本跑 unit-only 无 sim）
  process.env.GR_SIM_SIGNAL_TIMEOUT_MS = process.env.GR_SIM_SIGNAL_TIMEOUT_MS || '60000';
  const { startVitest } = await import('vitest/node');
  const vitest = await startVitest(
    'test',
    ['tests/unit'],
    {
      watch: false,
      run: true,
      // 阈值置零：vitest.config 的全局阈值按 all:true 口径测得（47/46/43/42），
      // unit-only 自然低于之——快照自身的棘轮对比就是门禁，防双门禁打架
      coverage: {
        enabled: true,
        reporter: [['json-summary'], ['text']],
        thresholds: { lines: 0, statements: 0, functions: 0, branches: 0 }
      }
    },
    { watch: false }
  );
  await vitest.close();
  const summaryPath = path.join(ROOT, 'coverage', 'coverage-summary.json');
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
  return summary.total.lines.pct;
}

const update = process.argv.includes('--update');
const current = await runCoverage();

if (update || !fs.existsSync(BASELINE)) {
  const prev = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf-8')) : null;
  fs.writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString().slice(0, 10),
        linesPct: current,
        note: '全局行覆盖率快照棘轮（unit-only）；下调需 --update 并在 note 说明原因'
      },
      null,
      2
    ) + '\n'
  );
  console.log(`✅ 覆盖率基线${prev ? ` 更新: ${prev.linesPct} → ${current}` : ` 建立: ${current}`}%`);
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'));
const EPS = 0.05; // 浮点容差
if (current < baseline.linesPct - EPS) {
  console.error(`❌ 全局行覆盖率 ${current}% 低于基线 ${baseline.linesPct}%——新增/改动代码缺测试`);
  console.error('   修复：补测试，或（确有理由时）npm run coverage:snapshot -- --update 并说明原因');
  process.exit(1);
}
console.log(`✅ 全局行覆盖率 ${current}% ≥ 基线 ${baseline.linesPct}%`);
