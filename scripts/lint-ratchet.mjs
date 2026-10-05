/**
 * 游戏雷达 Game Radar - 类型债棘轮 / Type-Debt Ratchet
 *
 * v14.2.0（补充轮 P0-2）：lint-baseline.json 的 tsNoImplicitAnyErrors 此前是
 * 纯文档（全仓零程序读取），"禁止上调"仅靠自觉。本脚本把它变成机器约束：
 * 实测三份 tsconfig 的 noImplicitAny（TS7006）错误数，超过基线即失败。
 * 接入 npm run gate（check 之后的独立步骤）。
 * Run: node scripts/lint-ratchet.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(readFileSync(path.join(ROOT, 'scripts/lint-baseline.json'), 'utf-8'));

const CONFIGS = [
  ['tsconfig.json', 'main'],
  ['tsconfig.ui.json', 'ui'],
  ['tsconfig.content.json', 'content']
];

let failed = false;
for (const [cfg, key] of CONFIGS) {
  const base = Number(baseline.tsNoImplicitAnyErrors?.[key] ?? 0);
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
  // TS7006 = Parameter implicitly has an "any" 类型（noImplicitAny 开启时的主要形态）
  const n = (output.match(/error TS7006/g) || []).length;
  const tag = n <= base ? '✅' : '❌';
  console.log(`${tag} ${key}: noImplicitAny ${n} ≤ 基线 ${base}`);
  if (n > base) failed = true;
}

if (failed) {
  console.error('❌ 类型债棘轮失败：noImplicitAny 超过基线（禁止上调）——补类型或与基线一起下调并说明');
  process.exit(1);
}
console.log('✅ 类型债棘轮通过');
