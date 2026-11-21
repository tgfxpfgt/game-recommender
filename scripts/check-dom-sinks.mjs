/**
 * 游戏雷达 Game Radar - DOM sink 基线锁门禁 / DOM sink baseline gate
 *
 * v14.33.2（AI 协作调研落地 C2，用户裁决 2026-11-18）：铁律 1 要求动态内容一律
 * escapeHtml/escapeAttr、新 UI 面优先 Preact 组件——innerHTML 渐进退役进行中
 * （v15 阶段 3 已退役 12 处，存量 ~119 处为模板字面量形态，经 escape 消费）。
 * 本门禁锁**基线只减不增**：任何新增 sink 点（新文件/存量文件加 sink）即红——
 * 强制新代码走 Preact 组件或 escapeHtml 链路；退役（减少）自动通过。
 * 配套 Semgrep 自定义规则 .semgrep/gr-dom-sinks.yml 供发版深度扫描（发版时人工
 * 定性，见 docs/playbooks.md §7）——本门禁常态化于 gate:fast（零误报，基线为
 * 逐文件实点计数）。
 *
 * 用法：node scripts/check-dom-sinks.mjs [--write]（--write 重新生成基线——退役
 *       收紧基线时使用；生成内容须人工复核后入库）
 * npm script: check:dom-sinks
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'scripts/dom-sinks-baseline.json');
/** 生产代码目录（与构建产物源一致；dist/tests/scripts/docs 不在生产面） */
const SCAN_DIRS = [
  'background',
  'content',
  'popup',
  'options',
  'dashboard',
  'hub',
  'freegames',
  'welcome',
  'sidepanel',
  'shared',
  'lib',
  'adapters',
  'data'
];
/** sink 形态（铁律 1 管辖面） */
const SINK_RE = /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(/g;
/** 跳过文件：Preact 组件（文本插值天然转义）与生成物（preact-globals 为
 * vendor 产物——内部 sink 是 preact 自身的 DOM 实现，非我方代码） */
const SKIP_FILE_RE = /\.preact\.mjs$|^shared\/preact-globals\.js$/;

/** @param {string} dir @param {string[]} out @returns {string[]} 递归收集 .js/.mjs */
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else if (/\.(js|mjs)$/.test(name) && !SKIP_FILE_RE.test(name)) out.push(abs);
  }
  return out;
}

/** @returns {Record<string, number>} 文件相对路径 → sink 计数 */
function countSinks() {
  /** @type {Record<string, number>} */
  const files = {};
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const f of walk(abs, [])) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      const n = (readFileSync(f, 'utf-8').match(SINK_RE) || []).length;
      if (n > 0) files[rel] = n;
    }
  }
  return files;
}

/** @returns {void} */
function main() {
  const write = process.argv.includes('--write');
  const current = countSinks();
  if (write) {
    const total = Object.values(current).reduce((a, b) => a + b, 0);
    writeFileSync(
      BASELINE,
      JSON.stringify(
        {
          _meta:
            'DOM sink 基线（铁律 1——innerHTML 渐进退役只减不增锁；check-dom-sinks.mjs --write 生成，退役后收紧须人工复核入库）',
          generatedOn: new Date().toISOString().slice(0, 10),
          total,
          files: current
        },
        null,
        2
      ) + '\n',
      'utf-8'
    );
    console.log(`✅ 基线已生成：${Object.keys(current).length} 文件 / ${total} 个 sink 点（人工复核后入库）`);
    return;
  }
  if (!existsSync(BASELINE)) {
    console.error('❌ 基线缺失：先 `node scripts/check-dom-sinks.mjs --write` 生成并人工复核入库');
    process.exit(1);
  }
  const base = JSON.parse(readFileSync(BASELINE, 'utf-8')).files;
  /** @type {string[]} */
  const errors = [];
  for (const [f, n] of Object.entries(current)) {
    if (!(f in base)) {
      errors.push(
        `${f}: 新文件出现 ${n} 个 DOM sink（基线无此文件）——用 Preact 组件或 escapeHtml 链路；确属必要则更新基线并写明理由`
      );
    } else if (n > base[f]) {
      errors.push(`${f}: sink ${base[f]} → ${n} 增加——铁律 1：动态内容一律 escapeHtml；新 UI 面优先 Preact 组件`);
    }
  }
  if (errors.length > 0) {
    console.error(`❌ DOM sink 基线锁触发 ${errors.length} 处：`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  const curTotal = Object.values(current).reduce((a, b) => a + b, 0);
  const baseTotal = Object.values(base).reduce((a, b) => a + b, 0);
  console.log(`✅ DOM sink 基线锁通过：${curTotal}/${baseTotal}（退役 ${baseTotal - curTotal} 处可 --write 收紧基线）`);
}

// main 守卫：导入时零副作用
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
