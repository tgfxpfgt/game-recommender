/**
 * 游戏雷达 Game Radar - 引用路径存在性门禁 / Referenced Path Gate
 *
 * v14.26.0（优化方案 P1-5）：扫描 `package.json` scripts 里 `node scripts/*.mjs`、
 * 文档（AGENTS.md / CONTRIBUTING.md / docs/playbooks.md）与 welcome/changelog.js
 * 中出现的仓库路径，逐个 `fs.existsSync`——断链会让 AI 助手/新人按文档读到空
 * 文件后回退探索式读码（2026-11-10 审查实际发生过：AGENTS.md 指向未入库的
 * docs/playbooks.md）。
 *
 * 用法 / Usage:
 *   node scripts/check-referenced-paths.mjs
 *
 * 只认"从仓库根可直接定位"的路径：以已知顶层目录开头 + 已知扩展名。
 * 局部相对写法（如 `core/metrics.js`）与占位示例不在此校验范围。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 扫描目标：入口脚本 + 常被 AI/新人当导航图的文档
const TARGETS = ['package.json', 'AGENTS.md', 'CONTRIBUTING.md', 'docs/playbooks.md', 'welcome/changelog.js'];

const TOP_DIRS = [
  'background',
  'content',
  'shared',
  'data',
  'docs',
  'popup',
  'options',
  'dashboard',
  'hub',
  'freegames',
  'tests',
  'scripts',
  'userscript',
  'welcome',
  'styles',
  'icons',
  'lib'
];
const ROOT_FILES = ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'PRIVACY.md', 'STORE.md', 'CHANGELOG.md', 'LICENSE'];

const EXT = '(?:js|mjs|json|md|sh|html|css|png|svg)';
// 顶层目录 + 路径 + 扩展名（排除 npm 包名/URL 片段：前置字符不能是 / 或字母数字）
// 扩展名后加 (?![\w]) 边界——否则 `.json` 会被 `.js` 前缀匹配截断成假路径
const PATH_RE = new RegExp(`(?<![\\w/.-])((?:${TOP_DIRS.join('|')})/[A-Za-z0-9_./-]+\\.${EXT})(?![\\w])`, 'g');
const ROOT_FILE_RE = new RegExp(`(?<![\\w/.-])(${ROOT_FILES.map((f) => f.replace('.', '\\.')).join('|')})`, 'g');

// 有意不存在的引用（占位示例 / 计划中的文件）——每条必须写明理由
// v14.37.3：welcome/changelog.js 为**历史日志文本**（v6.x~v14.33 条目叙述当年
// 文件路径，非活引用）——旧 E2E 编排层退役删除后其历史提及按叙述豁免。
const ALLOWLIST = new Map([
  ['tests/e2e/run.mjs', 'welcome/changelog.js 历史日志叙述（旧编排层 v14.37.3 退役）'],
  ['tests/e2e-smoke.mjs', 'welcome/changelog.js 历史日志叙述（旧编排层 v14.37.3 退役）'],
  ['scripts/e2e-dist.mjs', 'welcome/changelog.js 历史日志叙述（旧入口 v14.36.0 切换后退役）']
]);

const problems = [];
const seen = new Set();

for (const rel of TARGETS) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    // 扫描目标本身缺失也是问题（文档被删/改名后门禁应提醒维护本脚本）
    problems.push(`${rel}（扫描目标不存在，请更新 scripts/check-referenced-paths.mjs 的 TARGETS）`);
    continue;
  }
  const text = fs.readFileSync(abs, 'utf-8');
  for (const re of [PATH_RE, ROOT_FILE_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const ref = m[1].replace(/[.,;:]+$/, '');
      const key = `${rel} → ${ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (ALLOWLIST.has(ref)) continue;
      if (!fs.existsSync(path.join(ROOT, ref))) problems.push(key);
    }
  }
}

console.log(`[check:refs] 扫描 ${TARGETS.length} 个文件，引用 ${seen.size} 条`);

if (problems.length === 0) {
  console.log('✅ 所有引用路径均存在');
  process.exit(0);
}

console.error('❌ 引用路径不存在（文档断链 / 脚本指向缺失文件）:');
for (const p of problems) console.error('   ' + p);
console.error('   → 若为有意保留的占位示例，加入本脚本 ALLOWLIST 并写明理由。');
process.exit(1);
