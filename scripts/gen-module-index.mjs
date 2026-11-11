/**
 * 游戏雷达 Game Radar - 模块索引生成器 / Module Index Generator
 *
 * v14.30.0 R4-C（用户裁决 4/5）：把"职责 / 依赖 / 导出 / 不变式"从代码里
 * 抽出来生成 `docs/modules/INDEX.md`。职责与依赖能从代码看出，**不变式看不出**
 * （顺序依赖、并发假设、幂等要求、单位约定），那才是最容易被踩坏的部分——
 * 故第五列单独要求 `@invariant` 显式声明。
 * 豁免走带原因的 stub-ok 标记（唯一关键词，格式见 pickStubs；无原因文本不算豁免），
 * 并在索引「豁免登记」段集中登记——未登记的豁免视为未实现。
 *
 * Generates docs/modules/INDEX.md (职责 / 依赖 / 导出 / 不变式). Invariants are
 * the part code cannot express; exemptions require a stub-ok marker + reason.
 *
 * 用法 / Usage:
 *   node scripts/gen-module-index.mjs           # 重写索引
 *   node scripts/gen-module-index.mjs --check   # 只校验（等价 check:modules）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_REL = 'docs/modules/INDEX.md';
// 索引覆盖的模块目录（其余目录的 stub-ok 标记视为"未登记"）
// 覆盖所有随包发布的 JS（含页面层）；lib/vendor 是第三方代码，扫描时跳过。
export const SCAN_DIRS = [
  'background',
  'content',
  'data',
  'lib',
  'shared',
  'adapters',
  'options',
  'dashboard',
  'popup',
  'freegames',
  'hub',
  'welcome'
];

const MAX_DEPS = 8;
const MAX_EXPORTS = 6;

/** 递归列出目录下所有 .js（按路径排序，保证生成确定性） */
function listJs(dirAbs) {
  if (!fs.existsSync(dirAbs)) return [];
  /** @type {string[]} */
  const out = [];
  for (const ent of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (ent.name === 'vendor') continue; // 第三方 vendored 代码不入索引
    const abs = path.join(dirAbs, ent.name);
    if (ent.isDirectory()) out.push(...listJs(abs));
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(abs);
  }
  return out.sort();
}

/** 首个块注释（文件头）内容行 / header block comment lines */
function headerLines(src) {
  const m = src.match(/\/\*\*([\s\S]*?)\*\//);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean);
}

/** 职责：文件头 "游戏雷达 Game Radar - <中文> / <English>" 的中文段 */
function pickDuty(lines) {
  for (const l of lines) {
    const i = l.indexOf('游戏雷达 Game Radar - ');
    if (i === -1) continue;
    const rest = l.slice(i + '游戏雷达 Game Radar - '.length);
    const zh = rest.split(/\s+\/\s+/)[0].trim();
    if (zh) return zh;
  }
  // 兜底：头注释首行（去掉 "游戏雷达 Game Radar" 前缀）
  const first = lines.find((l) => !l.startsWith('游戏雷达 Game Radar')) || '';
  return first.replace(/^游戏雷达 Game Radar\s*[-–—]?\s*/, '').trim() || '—';
}

/** 静态依赖（相对说明符 → 仓库相对路径，去 .js） */
function pickDeps(src, fileAbs) {
  const re = /(?:^|\n)\s*(?:import|export)\s[\s\S]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  const deps = new Set();
  let m;
  while ((m = re.exec(src)) !== null) {
    const spec = m[1] || m[2];
    if (!spec || !spec.startsWith('.')) continue;
    const abs = path.resolve(path.dirname(fileAbs), spec);
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/').replace(/\.js$/, '');
    deps.add(rel);
  }
  return [...deps].sort();
}

/** 导出符号 / exported symbols */
function pickExports(src) {
  const names = new Set();
  const re = /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm;
  let m;
  while ((m = re.exec(src)) !== null) names.add(m[1]);
  const listRe = /^export\s*\{([^}]*)\}/gm;
  while ((m = listRe.exec(src)) !== null) {
    for (const part of m[1].split(',')) {
      const n = part
        .trim()
        .split(/\s+as\s+/)
        .pop();
      if (n) names.add(n.trim());
    }
  }
  return [...names];
}

/** @invariant 声明 / invariant declarations */
function pickInvariants(src) {
  const out = [];
  const re = /@invariant\s+(.+)/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1].trim());
  return out;
}

/** 豁免标记（冒号 + 原因文本必填；与 check-stubs 同一口径）/ stub exemptions */
function pickStubs(src) {
  const out = [];
  const re = /@stub-ok:\s*([^\n]*)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const reason = m[1].replace(/\s*\*\/\s*$/, '').trim();
    out.push(reason);
  }
  return out;
}

function cell(s) {
  return String(s).replace(/\|/g, '\\|');
}

function compress(list, max, fmt = (x) => x) {
  if (list.length === 0) return '—';
  const head = list.slice(0, max).map(fmt).join('<br>');
  return list.length > max ? `${head}<br>…+${list.length - max}` : head;
}

/**
 * 构建索引文本（纯函数，供 check 复用）。
 * @returns {{text: string, modules: number, withInvariant: number, stubs: Array<{file: string, reason: string}>, errors: string[]}}
 */
export function buildIndex() {
  /** @type {string[]} */
  const errors = [];
  /** @type {Array<{file: string, reason: string}>} */
  const stubs = [];
  const groups = new Map();
  let modules = 0;
  let withInvariant = 0;

  const files = SCAN_DIRS.flatMap((d) => listJs(path.join(ROOT, d)));

  for (const abs of files) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    const src = fs.readFileSync(abs, 'utf-8');
    const head = headerLines(src);
    const inv = pickInvariants(src);
    const duty = pickDuty(head);
    const deps = pickDeps(src, abs);
    const exps = pickExports(src);
    for (const reason of pickStubs(src)) {
      if (!reason) errors.push(`${rel}: @stub-ok 缺少原因文本（无原因不等于豁免）`);
      else stubs.push({ file: rel, reason });
    }
    const row =
      `| \`${rel}\` | ${cell(duty)} | ${cell(compress(deps, MAX_DEPS, (d) => '`' + d + '`'))} | ` +
      `${cell(compress(exps, MAX_EXPORTS))} | ${cell(compress(inv, 4))} |`;
    const group = rel.split('/').slice(0, 2).join('/');
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row);
    modules += 1;
    if (inv.length > 0) withInvariant += 1;
  }

  const out = [
    '# 模块索引 / Module Index',
    '',
    '> **自动生成，勿手改**——`node scripts/gen-module-index.mjs` 重写，',
    '> `npm run check:modules` 校验漂移（门禁内）。',
    '> 五列：模块 / 职责 / 依赖 / 导出 / **不变式**。不变式 = 改动前必须知道、',
    '> 但从代码里看不出来的约束（顺序依赖、并发假设、幂等要求、单位约定）；',
    '> 无则 `—`。新增不变式在模块文件头写 `@invariant …`。',
    `> 模块数 ${modules}，其中声明不变式 ${withInvariant}。`,
    ''
  ];

  for (const group of [...groups.keys()].sort()) {
    out.push(`## ${group}`, '', '| 模块 | 职责 | 依赖 | 导出 | 不变式 |', '| --- | --- | --- | --- | --- |');
    out.push(...groups.get(group));
    out.push('');
  }

  out.push('## 豁免登记 / Stub Exemptions', '');
  out.push('> `@stub-ok: <原因文本>` 是唯一豁免关键词；**无原因文本不算豁免**，');
  out.push('> 且必须出现在本表（索引未覆盖目录里的豁免视为未实现，`check:modules` 直接红）。', '');
  if (stubs.length === 0) {
    out.push('当前无豁免。', '');
  } else {
    out.push('| 模块 | 原因 |', '| --- | --- |');
    for (const s of stubs.sort((a, b) => a.file.localeCompare(b.file))) {
      out.push(`| \`${s.file}\` | ${cell(s.reason)} |`);
    }
    out.push('');
  }

  return { text: out.join('\n'), modules, withInvariant, stubs, errors };
}

/** 索引未覆盖目录里出现 @stub-ok → 未登记 / unregistered exemptions */
export function findUnregisteredStubs() {
  const bad = [];
  // tests/ 是夹具（门禁测试自身要写标记字面量），不是随包发布的实现代码
  const skip = new Set(['node_modules', 'dist', 'coverage', '.git', 'release', '.extension-js', 'tests']);
  // 标记定义自身（生成器/校验器）不参与扫描——它们的正则字面量与说明必须出现该词
  const selfFiles = new Set([
    'scripts/gen-module-index.mjs',
    'scripts/check-module-index.mjs',
    'scripts/check-stubs.mjs'
  ]);
  const walk = (dirAbs) => {
    for (const ent of fs.readdirSync(dirAbs, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      const abs = path.join(dirAbs, ent.name);
      if (ent.isDirectory()) {
        if (!skip.has(ent.name)) walk(abs);
        continue;
      }
      if (!/\.(js|mjs)$/.test(ent.name)) continue;
      const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
      if (selfFiles.has(rel)) continue;
      if (SCAN_DIRS.some((d) => rel.startsWith(d + '/'))) continue;
      if (fs.readFileSync(abs, 'utf-8').includes('@stub-ok')) bad.push(rel);
    }
  };
  walk(ROOT);
  return bad.sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { text, modules, withInvariant, errors } = buildIndex();
  if (errors.length > 0) {
    console.error('❌ 生成中止：');
    for (const e of errors) console.error('   ' + e);
    process.exit(1);
  }
  const outAbs = path.join(ROOT, OUT_REL);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, text, 'utf-8');
  console.log(`✅ 已生成 ${OUT_REL}（模块 ${modules}，声明不变式 ${withInvariant}）`);
}
