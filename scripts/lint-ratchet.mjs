/**
 * 游戏雷达 Game Radar - 类型债棘轮 / Type-Debt Ratchet
 *
 * v14.2.0（补充轮 P0-2）：lint-baseline.json 的 tsNoImplicitAnyErrors 此前是
 * 纯文档（全仓零程序读取），"禁止上调"仅靠自觉。本脚本把它变成机器约束：
 * 实测三份 tsconfig 的 noImplicitAny（TS7006）错误数，超过基线即失败。
 * 接入 npm run gate（check 之后的独立步骤）。
 * v14.14.0（报告 D P0-2 + 重构研究报告 §3.1）：计数扩为**隐式 any 全家族**
 *（TS7005/7006/7011/7015/7017/7018/7019/7022/7023/7031/7034/7053）——此前只数
 * TS7006，写 `function f(x: any)` 可让计数下降而债务未还（形态绕过）。
 * 全家族基线（878/347/444）一次锁定，只降不升。
 * Run: node scripts/lint-ratchet.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(readFileSync(path.join(ROOT, 'scripts/lint-baseline.json'), 'utf-8'));

const CONFIGS = [
  ['tsconfig.json', 'main'],
  ['tsconfig.ui.json', 'ui'],
  ['tsconfig.content.json', 'content']
];

// 隐式 any 全家族错误码（报告 D P0-2 清单）
const IMPLICIT_ANY_CODES = [
  'TS7005',
  'TS7006',
  'TS7011',
  'TS7015',
  'TS7017',
  'TS7018',
  'TS7019',
  'TS7022',
  'TS7023',
  'TS7031',
  'TS7034',
  'TS7053'
];

let failed = false;
for (const [cfg, key] of CONFIGS) {
  const famBase = Number(baseline.tsImplicitAnyFamily?.[key] ?? Infinity);
  const ts7006Base = Number(baseline.tsNoImplicitAnyErrors?.[key] ?? 0);
  let output = '';
  try {
    execSync(`npx tsc --noEmit --noImplicitAny -p ${cfg}`, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (e) {
    output = String(e.stdout || '');
  }
  const n7006 = (output.match(/error TS7006/g) || []).length;
  let family = 0;
  for (const code of IMPLICIT_ANY_CODES) {
    family += (output.match(new RegExp(`error ${code}\\b`, 'g')) || []).length;
  }
  // 全家族基线未建立时（首次运行）自动锁定当前值
  const famLimit = Number.isFinite(famBase) ? famBase : family;
  if (!Number.isFinite(famBase)) {
    baseline.tsImplicitAnyFamily = baseline.tsImplicitAnyFamily || {};
    baseline.tsImplicitAnyFamily[key] = family;
    writeFileSync(path.join(ROOT, 'scripts/lint-baseline.json'), JSON.stringify(baseline, null, 2) + '\n');
    console.log(`📌 ${key}: 全家族基线首次锁定 ${family}`);
  }
  const tagFam = family <= famLimit ? '✅' : '❌';
  const tag7006 = n7006 <= ts7006Base ? '✅' : '❌';
  console.log(`${tagFam} ${key}: 隐式any全家族 ${family} ≤ ${famLimit} ｜ ${tag7006} TS7006 ${n7006} ≤ ${ts7006Base}`);
  if (family > famLimit || n7006 > ts7006Base) failed = true;
}

if (failed) {
  console.error('❌ 类型债棘轮失败：隐式 any 超基线（禁止上调）——补类型或与基线一起下调并说明');
  process.exit(1);
}
console.log('✅ 类型债棘轮通过');
