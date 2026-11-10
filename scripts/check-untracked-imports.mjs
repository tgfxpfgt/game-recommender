/**
 * 游戏雷达 Game Radar - 未跟踪静态导入门禁 / Untracked Static Import Gate
 *
 * v14.26.0（优化方案 P0-1）：从 `background/service-worker.js` 递归解析静态
 * import，与 `git ls-files` 求差集——被已跟踪文件静态引用的文件若尚未入库，
 * 干净克隆装载扩展会直接 404（MV3 SW 静态 import 失败无运行时降级），整个
 * 扩展完全不可用。2026-11-10 实际发生过一次（background/storage/
 * usage-evidence.js 被 8 处静态 import 却未跟踪）。
 *
 * 用法 / Usage:
 *   node scripts/check-untracked-imports.mjs          # 阻断模式（门禁默认）
 *   node scripts/check-untracked-imports.mjs --warn   # 只告警（观察期用）
 *
 * 只解析相对说明符（`./` `../`）；裸模块名（无打包器）不存在于此项目。
 * Resolves relative static imports only (no bundler, no bare specifiers).
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WARN_ONLY = process.argv.includes('--warn');
// 入口：SW 是 MV3 唯一后台入口；内容脚本走 getURL 动态加载，不在静态图内
const ENTRY = 'background/service-worker.js';

const IMPORT_RE = /(?:\bimport\s*(?:[\s\S]*?)\bfrom\s*|\bimport\s*|\bexport\s*(?:[\s\S]*?)\bfrom\s*)['"]([^'"]+)['"]/g;

/** 解析相对说明符为仓库内绝对路径（补 .js / index.js，与浏览器解析一致） */
function resolveSpecifier(fromAbs, spec) {
  if (!spec.startsWith('.')) return null;
  const baseAbs = path.resolve(path.dirname(fromAbs), spec);
  const candidates = [baseAbs, baseAbs + '.js', path.join(baseAbs, 'index.js')];
  return candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile()) || null;
}

const visited = new Set();
const missing = [];
const queue = [path.join(ROOT, ENTRY)];
visited.add(queue[0]);

while (queue.length > 0) {
  const abs = queue.pop();
  const source = fs.readFileSync(abs, 'utf-8');
  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(source)) !== null) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const target = resolveSpecifier(abs, spec);
    if (!target) {
      missing.push(`${path.relative(ROOT, abs)} → ${spec}`);
      continue;
    }
    if (visited.has(target)) continue;
    visited.add(target);
    queue.push(target);
  }
}

const tracked = new Set(
  execSync('git ls-files', { cwd: ROOT, encoding: 'utf-8' })
    .split('\n')
    .map((f) => f.trim().replace(/\\/g, '/'))
    .filter(Boolean)
);

const untracked = [...visited]
  .map((abs) => path.relative(ROOT, abs).replace(/\\/g, '/'))
  .filter((rel) => !tracked.has(rel))
  .sort();

console.log(`[check:imports] 静态图 ${visited.size} 文件（入口 ${ENTRY}）`);

if (missing.length > 0) {
  console.error('❌ 静态 import 指向不存在的文件（装载即 404）:');
  for (const line of missing) console.error('   ' + line);
  process.exit(1);
}

if (untracked.length === 0) {
  console.log('✅ 无未跟踪的静态导入文件');
  process.exit(0);
}

const message = [
  '❌ 以下文件被已跟踪文件静态 import，但尚未纳入 git 跟踪:',
  ...untracked.map((f) => '   ' + f),
  '',
  '   → 干净克隆后扩展装载会失败。请 `git add` 后重新提交。'
].join('\n');

if (WARN_ONLY) {
  console.warn(message.replace('❌', '⚠️'));
  process.exit(0);
}
console.error(message);
process.exit(1);
