/**
 * 游戏雷达 Game Radar - 模块索引校验 / Module Index Gate
 *
 * v14.28.6 R4-C：`docs/modules/INDEX.md` 与代码不同步即红（漂移 = 索引开始腐烂，
 * 比没有索引更危险）；`@stub-ok` 无原因文本即红；豁免出现在索引未覆盖目录即红
 * （未登记的豁免视为未实现）。修复一律 `node scripts/gen-module-index.mjs`。
 *
 * Fails on index drift, reason-less `@stub-ok`, and exemptions outside the
 * indexed directories.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, findUnregisteredStubs } from './gen-module-index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_REL = 'docs/modules/INDEX.md';

const { text, modules, withInvariant, stubs, errors } = buildIndex();
let failed = false;

if (errors.length > 0) {
  failed = true;
  console.error('❌ 豁免标记不合法:');
  for (const e of errors) console.error('   ' + e);
}

const unregistered = findUnregisteredStubs();
if (unregistered.length > 0) {
  failed = true;
  console.error('❌ 以下文件含 @stub-ok 但不在模块索引覆盖目录（未登记 = 未实现）:');
  for (const f of unregistered) console.error('   ' + f);
  console.error('   → 移入索引目录或删除豁免标记。');
}

const outAbs = path.join(ROOT, OUT_REL);
const normalize = (s) => s.replace(/\r\n/g, '\n').trimEnd();
const current = fs.existsSync(outAbs) ? normalize(fs.readFileSync(outAbs, 'utf-8')) : '';
if (!current) {
  failed = true;
  console.error(`❌ 缺少 ${OUT_REL} → 运行 node scripts/gen-module-index.mjs`);
} else if (current !== normalize(text)) {
  failed = true;
  // 只提示首个差异附近内容，避免整表刷屏
  const a = current.split('\n');
  const b = normalize(text).split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  console.error(`❌ ${OUT_REL} 与代码不一致（首个差异在第 ${i + 1} 行）:`);
  console.error(`   索引: ${a[i] === undefined ? '<缺失>' : a[i]}`);
  console.error(`   实际: ${b[i] === undefined ? '<缺失>' : b[i]}`);
  console.error('   → 运行 node scripts/gen-module-index.mjs 重生成后一并提交。');
}

if (failed) process.exit(1);
console.log(`✅ 模块索引一致（模块 ${modules}，声明不变式 ${withInvariant}，豁免 ${stubs.length}）`);
