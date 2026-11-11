/**
 * 游戏雷达 Game Radar - 套件时长预算门禁 / Suite Wall-Clock Budget Gate
 *
 * v14.29.1（L3 测试体系量化）：测试体系最大的隐性成本是"没人知道它跑多久"——
 * 单测从 60s 涨到 180s 不会有任何门禁变红，只会让日常批次悄悄放弃跑测试。
 * 本脚本读 scripts/suite-budgets.json（实测墙钟 ×1.5 为 cap），提供：
 *   · `--report`：打印 id/实测/cap/余量 表（永远 exit 0，供人读与报告引用）
 *   · `--assert-step <id> --ms <n>`：n 超 cap → exit 1（gate.mjs 逐步骤调用）
 *   · 未知 id → exit 2（防"拼错 id 静默通过"）
 * 超预算不是"代码错"，先排除机器负载（并行编译/杀毒/争核）再复跑，仍超才调基线。
 * Budgets are measured x1.5; over-budget is a load signal first, not a code error.
 *
 * Usage:
 *   node scripts/check-suite-budget.mjs --report
 *   node scripts/check-suite-budget.mjs --assert-step coverageGate --ms 112270
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUDGET_FILE = path.join(ROOT, 'scripts', 'suite-budgets.json');

/** 读取预算单源（缺文件/坏 JSON 直接抛——门禁不应静默降级）。 */
export function loadBudgets(file = BUDGET_FILE) {
  const raw = JSON.parse(readFileSync(file, 'utf-8'));
  return { generatedAt: raw.generatedAt || '', note: raw.note || '', budgets: raw.budgets || [] };
}

/** 按 id 查预算条目 / Look up one budget entry by id. */
export function findBudget(id, data = loadBudgets()) {
  return data.budgets.find((b) => b.id === id) || null;
}

const fmtMs = (ms) => (typeof ms === 'number' ? `${ms.toLocaleString('en-US')}ms` : '—');

/** 余量（cap - measured）+ 百分比 / Headroom against measurement. */
function headroom(entry) {
  if (typeof entry.measuredMs !== 'number' || typeof entry.capMs !== 'number') return '—';
  const rest = entry.capMs - entry.measuredMs;
  const pct = entry.measuredMs > 0 ? ((rest / entry.measuredMs) * 100).toFixed(0) : '0';
  return `${fmtMs(rest)}（+${pct}%）`;
}

/** 报告表（id | measured | cap | 余量）/ Human-readable table. */
export function reportTable(data = loadBudgets()) {
  const rows = data.budgets.map((b) => ({
    id: b.id,
    measured: fmtMs(b.measuredMs),
    cap: fmtMs(b.capMs),
    headroom: headroom(b)
  }));
  const head = ['id', 'measured', 'cap', '余量'];
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => Object.values(r)[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(width[i])).join(' | ');
  return [
    `套件墙钟预算（生成于 ${data.generatedAt}）/ Suite budgets`,
    line(head),
    width.map((w) => '-'.repeat(w)).join('-+-'),
    ...rows.map((r) => line(Object.values(r))),
    '',
    `说明：${data.note}`
  ].join('\n');
}

/**
 * 判定一次实测是否超预算。
 * @param {string} id 套件 id
 * @param {number} ms 实测墙钟
 * @returns {{code:number, capMs:number|null, measuredMs:number|null, over:boolean, message:string}}
 *   code: 0 通过/无预算，1 超预算，2 未知 id
 */
export function evaluateStep(id, ms, data = loadBudgets()) {
  const entry = findBudget(id, data);
  if (!entry) {
    const known = data.budgets.map((b) => b.id).join('/');
    return {
      code: 2,
      capMs: null,
      measuredMs: null,
      over: false,
      message: `未知套件 id: ${id}——可用 id: ${known}（预算单源 scripts/suite-budgets.json）`
    };
  }
  if (typeof entry.capMs !== 'number') {
    return {
      code: 0,
      capMs: null,
      measuredMs: entry.measuredMs ?? null,
      over: false,
      message: `${id} 暂无预算（measuredMs/capMs 为 null，未实测）——跳过`
    };
  }
  const over = ms > entry.capMs;
  return {
    code: over ? 1 : 0,
    capMs: entry.capMs,
    measuredMs: entry.measuredMs ?? null,
    over,
    message: over
      ? `墙钟超预算：${ms} ms > ${entry.capMs} ms（${id}，基线实测 ${fmtMs(entry.measuredMs)}），先排除环境负载再重跑` +
        `；排除负载后仍超 → 更新 scripts/suite-budgets.json 的 measuredMs/capMs 并在 spec 记录原因`
      : `${id} 墙钟 ${ms} ms ≤ 预算 ${entry.capMs} ms`
  };
}

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx > 0 ? process.argv[idx + 1] : null;
}

function main() {
  if (process.argv.includes('--report')) {
    console.log(reportTable());
    process.exit(0);
  }
  const id = argValue('--assert-step');
  if (id) {
    const rawMs = argValue('--ms');
    const ms = Number(rawMs);
    if (!rawMs || !Number.isFinite(ms)) {
      console.error('❌ --assert-step 需要 --ms <数字>');
      process.exit(2);
    }
    const r = evaluateStep(id, ms);
    const log = r.code === 0 ? console.log : console.error;
    log(`${r.code === 0 ? '✅' : '❌'} ${r.message}`);
    process.exit(r.code);
  }
  console.error(
    '用法 / Usage:\n' +
      '  node scripts/check-suite-budget.mjs --report\n' +
      '  node scripts/check-suite-budget.mjs --assert-step <id> --ms <n>'
  );
  process.exit(2);
}

// CLI 入口守卫：gate.mjs 静态 import 本文件时不得执行到 process.exit
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) main();
