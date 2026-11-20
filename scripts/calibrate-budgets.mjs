/**
 * 游戏雷达 Game Radar - 套件墙钟基线统计化校准 / Suite Budget Calibration
 *
 * v14.34.3（理论最优清单 B2）：用 hyperfine 多轮实测替换「单次跑数定基线」——
 * 「cap = 本机实测×1.5」的"实测"此前是一次性采样（AGENTS 墙钟预算节），偶发
 * 抖动会被固化：采到低值 → cap 偏低 → 环境噪音假红；采到高值 → cap 偏高 →
 * 缓慢漂移漏警。hyperfine N 轮取 mean（自带轮间隔离与统计口径），依同公式
 * capMs = ceil(mean×1.5/5000)×5000 回写 scripts/suite-budgets.json（预算单源）。
 *
 * 口径说明：
 * - 默认校准 unit/sim/e2eMock/visual（确定性套件口径）。coverageGate 耗时随
 *   变更面浮动（空集跳过 112s→0），非确定口径，默认排除、可 --steps 显式指定。
 * - gateFast/gateFull 为整链口径（含受影响测试面，非确定性），**不参与自动
 *   校准**——仅在完整发版批次跑 npm run gate 后人工按记录更新（AGENTS 发布节）。
 * - Windows 执行口径：hyperfine 位置参数 = 逐条命令（多段会被当成多条基准），
 *   故整串单参经 shell 执行；环境变量（E2E_MOCK）经 spawnSync env 注入父进程
 *   链——cmd 不支持 `VAR=1 npm ...` 前缀语法，env 注入对 hyperfine 子进程透明。
 * - 失败即中止（不带 --ignore-failure）：失败步骤的耗时是垃圾数据，不得入库。
 *
 * 用法 / Usage:
 *   node scripts/calibrate-budgets.mjs                # dry-run：实测并打印，不回写
 *   node scripts/calibrate-budgets.mjs --write        # 实测并回写 suite-budgets.json
 *   node scripts/calibrate-budgets.mjs --runs 5 --steps unit,sim --write
 *   node scripts/calibrate-budgets.mjs --report       # 只看当前预算表
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_FILE = path.join(ROOT, 'scripts', 'suite-budgets.json');

/** id → 校准命令与注入环境（与 budgets[].label 口径一致；整串经 shell 执行）。
 * 命令须包 cmd /c：hyperfine 对基准命令走 CreateProcess（不做 PATHEXT 解析），
 * npm/npx 是 .cmd shim 裸名会 "program not found"（B2 实测）。 */
const CALIBRATION_COMMANDS = {
  unit: { cmd: 'cmd /c npx vitest run tests/unit' },
  sim: { cmd: 'cmd /c npm run test:sim' },
  e2eMock: { cmd: 'cmd /c npm run e2e:pw', env: { E2E_MOCK: '1' } },
  visual: { cmd: 'cmd /c npm run visual' },
  coverageGate: { cmd: 'cmd /c npm run coverage:gate' }
};
/** 默认校准集：确定性套件口径（coverageGate 变更面依赖；gateFast/gateFull 整链人工） */
const DEFAULT_STEPS = ['unit', 'sim', 'e2eMock', 'visual'];

const args = process.argv.slice(2);
const dryRun = !args.includes('--write');
const runs = Math.max(2, Number(args[args.indexOf('--runs') + 1]) || 3);
const stepsArgIdx = args.indexOf('--steps');
const steps = stepsArgIdx >= 0 ? args[stepsArgIdx + 1].split(',') : DEFAULT_STEPS;

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

/** hyperfine 单条命令实测，返回 { meanMs, minMs, maxMs, runs }（命令整串经 shell） */
function measure(id, spec) {
  const jsonPath = path.join(ROOT, 'scripts', `.calibrate-${id}.json`);
  // 基准命令必须整体引号成单个 argv：hyperfine 位置参数 = 逐条命令，裸串会被
  // cmd shell 拆词、每词各当一条基准（'/c' program not found——B2 实测三连坑）。
  const hf = [
    'hyperfine',
    '--min-runs',
    String(runs),
    '--style',
    'none',
    '--export-json',
    `"${jsonPath}"`,
    '--',
    `"${spec.cmd}"`
  ].join(' ');
  const r = spawnSync(hf, { cwd: ROOT, stdio: 'inherit', shell: true, env: { ...process.env, ...(spec.env || {}) } });
  if (r.status !== 0) fail(`hyperfine 校准 ${id} 失败（exit ${r.status}）——失败步骤耗时不得入库`);
  const j = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  fs.rmSync(jsonPath, { force: true });
  const res = j.results[0];
  // hyperfine 2.x export-json = 逐轮原始值 results[].measurements[].time_wall_clock
  // {value,unit}，无预聚合字段——自行取 mean/min/max（1.x 的 mean/stddev 键不再存在）
  const sec = (res.measurements || []).map((m) => {
    const t = m.time_wall_clock;
    return typeof t === 'number' ? t : t?.value;
  });
  if (!sec.length || sec.some((v) => !Number.isFinite(v)))
    fail(`hyperfine 校准 ${id} 输出无有效测量值（schema 漂移？）——不得入库`);
  const mean = sec.reduce((a, b) => a + b, 0) / sec.length;
  return {
    meanMs: Math.round(mean * 1000),
    minMs: Math.round(Math.min(...sec) * 1000),
    maxMs: Math.round(Math.max(...sec) * 1000),
    runs: sec.length
  };
}

if (args.includes('--report')) {
  const data = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf-8'));
  for (const b of data.budgets)
    console.log(`${b.id.padEnd(14)} measured ${b.measuredMs}ms  cap ${b.capMs}ms  (${b.label})`);
  process.exit(0);
}

for (const id of steps) {
  if (!CALIBRATION_COMMANDS[id]) fail(`未知校准 id: ${id}——可用: ${Object.keys(CALIBRATION_COMMANDS).join('/')}`);
}

const data = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf-8'));
const results = [];
for (const id of steps) {
  const budget = data.budgets.find((b) => b.id === id);
  if (!budget) fail(`suite-budgets.json 缺少条目 ${id}`);
  console.log(
    `\n⏳ 校准 ${id}（${runs} 轮）: ${CALIBRATION_COMMANDS[id].cmd}${CALIBRATION_COMMANDS[id].env ? ` env=${JSON.stringify(CALIBRATION_COMMANDS[id].env)}` : ''}`
  );
  const m = measure(id, CALIBRATION_COMMANDS[id]);
  const capMs = Math.ceil((m.meanMs * 1.5) / 5000) * 5000;
  const delta = budget.measuredMs ? Math.round(((m.meanMs - budget.measuredMs) / budget.measuredMs) * 100) : 0;
  console.log(
    `   mean ${m.meanMs}ms（min ${m.minMs} / max ${m.maxMs}）· 旧基线 ${budget.measuredMs}ms（Δ${delta >= 0 ? '+' : ''}${delta}%）· cap ${budget.capMs}ms → ${capMs}ms`
  );
  results.push({ id, budget, meanMs: m.meanMs, capMs, detail: m });
}

if (dryRun) {
  console.log('\nℹ️ dry-run 完成（加 --write 回写 scripts/suite-budgets.json）');
  process.exit(0);
}

for (const r of results) {
  r.budget.measuredMs = r.meanMs;
  r.budget.capMs = r.capMs;
}
data.generatedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
data.note =
  data.note.replace(/\s*校准来源.*$/, '') +
  ` 校准来源：hyperfine ${runs} 轮 mean（${data.generatedAt}，calibrate-budgets.mjs）。`;
fs.writeFileSync(BUDGET_FILE, JSON.stringify(data, null, 2) + '\n');
console.log(`\n✅ 已回写 ${path.relative(ROOT, BUDGET_FILE)}（${steps.join('/')}，hyperfine ${runs} 轮 mean 口径）`);
