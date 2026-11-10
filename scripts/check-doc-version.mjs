/**
 * 游戏雷达 Game Radar - 文档版本与索引一致性门禁 / Docs version & index gate
 *
 * v14.28.0（优化方案 S3 P2-17）三个断言：
 *   ① 根目录 md 数量 ≤ MAX_ROOT_MD（P2-3 归档纪律：历史文档进 docs/reports/archive/）
 *   ② "当前版本"类表述若带版本字面量，必须等于 manifest.version；
 *      活文档中任何版本字面量都不得**超前**于 manifest（防"未来版本"文案）
 *   ③ docs/INDEX.md 中的相对链接目标必须存在（归档/索引不腐烂）
 *
 * 只查"活文档"（根目录 6 份 + docs/INDEX.md + docs/playbooks.md + docs/KNOWLEDGE.md）；
 * 归档文档不做版本断言（历史快照本就落后）。
 *
 * 用法：node scripts/check-doc-version.mjs（gate / CI 直接失败退出 1）
 * npm script: check:docs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_ROOT_MD = 7;
const LIVING_DOCS = [
  'README.md',
  'CHANGELOG.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'PRIVACY.md',
  'STORE.md',
  'docs/INDEX.md',
  'docs/playbooks.md',
  'docs/KNOWLEDGE.md'
];

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf-8'));
const version = manifest.version;
const vParts = version.split('.').map(Number);

const errors = [];

/** 版本字面量是否超前于 manifest / whether a literal is newer than manifest */
function isAhead(literal) {
  const p = String(literal).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((p[i] || 0) !== (vParts[i] || 0)) return (p[i] || 0) > (vParts[i] || 0);
  }
  return false;
}

// ① 根目录 md 数量
const rootMd = fs.readdirSync(ROOT).filter((f) => f.endsWith('.md'));
if (rootMd.length > MAX_ROOT_MD) {
  errors.push(
    `根目录 md ${rootMd.length} 份 > ${MAX_ROOT_MD}（历史文档请归档到 docs/reports/archive/ 并登记 docs/INDEX.md）`
  );
}

// ② 版本表述
// "当前版本"断言只查现役文档；CHANGELOG 是历史流水（条目里出现"当前版本"属
// 历史语境），仅参与"不得超前"检查。
const CLAIM_DOCS = LIVING_DOCS.filter((f) => f !== 'CHANGELOG.md');
const CURRENT_CLAIM_RE = /(当前版本|现版本|最新版本)[^\n]{0,40}?v(\d+\.\d+\.\d+)/g;
const VERSION_LITERAL_RE = /\bv(\d+\.\d+\.\d+)\b/g;
for (const rel of LIVING_DOCS) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    errors.push(`活文档缺失: ${rel}`);
    continue;
  }
  const src = fs.readFileSync(abs, 'utf-8');
  if (CLAIM_DOCS.includes(rel)) {
    for (const m of src.matchAll(CURRENT_CLAIM_RE)) {
      if (m[2] !== version) errors.push(`${rel}: "当前版本" 写作 v${m[2]}，manifest 为 v${version}`);
    }
  }
  for (const m of src.matchAll(VERSION_LITERAL_RE)) {
    if (isAhead(m[1])) errors.push(`${rel}: 出现超前版本 v${m[1]}（manifest v${version}）`);
  }
}

// ③ 索引相对链接存在性（只查 docs/INDEX.md 的本地 md 链接）
const indexPath = path.join(ROOT, 'docs/INDEX.md');
if (fs.existsSync(indexPath)) {
  const idxSrc = fs.readFileSync(indexPath, 'utf-8');
  for (const m of idxSrc.matchAll(/\]\((\.\.?\/[^)#]+)\)/g)) {
    const target = path.resolve(path.dirname(indexPath), m[1]);
    if (!fs.existsSync(target)) errors.push(`docs/INDEX.md 链接失效: ${m[1]}`);
  }
}

if (errors.length > 0) {
  console.error('❌ 文档门禁失败:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✅ 文档门禁通过（manifest v${version}，根目录 md ${rootMd.length} 份）`);
