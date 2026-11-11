/**
 * 游戏雷达 Game Radar - 占位实现 / 契约缺口门禁（D 类）
 *
 * v14.28.6 R4-D：两类"看着像做完了、其实没做"的缺口：
 *  1. 占位实现——`TODO` / `FIXME` / `XXX` 标记，或 `throw new Error('…未实现')`；
 *  2. 契约→handler 缺口——消息契约里声明了 action，但 background 全树没有实现
 *     （反方向 handler→契约 已由 test-integrity 覆盖，本项补上另一半）。
 * 唯一豁免：`@stub-ok: <原因文本>`（无原因文本不算豁免）；且该标记必须登记在
 * `docs/modules/INDEX.md` 的豁免登记表（由 check:modules 强制）。
 *
 * Two gates: placeholder implementations and contract→handler gaps. The only
 * exemption is a stub-ok marker WITH a reason, registered in the module index.
 *
 * 扫描范围 = 模块索引覆盖目录（gen-module-index.mjs 的 SCAN_DIRS，已排除
 * lib/vendor 第三方代码）。页面层（options/dashboard/…）在 SCAN_DIRS 内。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCAN_DIRS } from './gen-module-index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = 'background/core/message-contract.js';

/** 占位标记（单行注释里的 TODO/FIXME/XXX，或显式的"未实现"抛错） */
const PLACEHOLDER_RES = [
  /\/\/\s*(?:TODO|FIXME|XXX)\b/,
  /\/\*\s*(?:TODO|FIXME|XXX)\b/,
  /throw new Error\([^)]*(?:未实现|not implemented)/i
];
/** 豁免标记（冒号 + 原因文本必填）/ exemption marker (colon + reason mandatory) */
const STUB_OK_RE = /@stub-ok:\s*([^\n]*)/;

/**
 * 单文件文本 → 占位实现命中行（行号从 1 开始）。
 * @param {string} text
 * @returns {Array<{line: number, text: string}>}
 */
export function findPlaceholders(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (PLACEHOLDER_RES.some((re) => re.test(line))) out.push({ line: i + 1, text: line.trim() });
  });
  return out;
}

/**
 * @param {string} text
 * @returns {string} 豁免原因（空串 = 无有效豁免）
 */
export function stubReason(text) {
  const m = text.match(STUB_OK_RE);
  if (!m) return '';
  // 块注释场景去掉行尾 "*/"，仅剩空白同样视为无原因
  return m[1].replace(/\s*\*\/\s*$/, '').trim();
}

/**
 * 契约 action 列表（buildRules 内两空格缩进的大写键）。
 * @param {string} contractSrc
 * @returns {string[]}
 */
export function contractActions(contractSrc) {
  const body = contractSrc.match(/const buildRules[\s\S]*$/);
  if (!body) return [];
  return [...body[0].matchAll(/^\s{2}([A-Z][A-Z0-9_]{2,})\s*:/gm)].map((m) => m[1]);
}

/**
 * 契约→handler 缺口：契约声明但 background 全树（除契约文件）无同名键。
 * @param {string[]} actions
 * @param {Array<{file: string, text: string}>} sources
 * @returns {string[]}
 */
export function missingHandlers(actions, sources) {
  const blob = sources.map((s) => s.text).join('\n');
  return actions.filter((a) => !new RegExp('\\b' + a + '\\s*:').test(blob));
}

/** 递归列出目录下 .js（跳过第三方 vendor）/ list .js files, skipping vendor */
function listJs(dirAbs) {
  if (!fs.existsSync(dirAbs)) return [];
  /** @type {string[]} */
  const out = [];
  for (const ent of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (ent.name === 'vendor') continue;
    const abs = path.join(dirAbs, ent.name);
    if (ent.isDirectory()) out.push(...listJs(abs));
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(abs);
  }
  return out.sort();
}

/** 全量扫描（供 CI/门禁）/ full scan for the gate */
export function scan() {
  const placeholders = [];
  const exempted = [];
  const backgroundSources = [];
  for (const dir of SCAN_DIRS) {
    for (const abs of listJs(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
      const text = fs.readFileSync(abs, 'utf-8');
      if (rel.startsWith('background/') && rel !== CONTRACT) backgroundSources.push({ file: rel, text });
      const hits = findPlaceholders(text);
      if (hits.length === 0) continue;
      const reason = stubReason(text);
      if (reason) exempted.push({ file: rel, reason, hits: hits.length });
      else placeholders.push(...hits.map((h) => ({ file: rel, ...h })));
    }
  }
  const contractSrc = fs.readFileSync(path.join(ROOT, CONTRACT), 'utf-8');
  const gaps = missingHandlers(contractActions(contractSrc), backgroundSources);
  return { placeholders, gaps, exempted };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { placeholders, gaps, exempted } = scan();
  let failed = false;
  if (placeholders.length > 0) {
    failed = true;
    console.error(`❌ 占位实现 ${placeholders.length} 处（未豁免）:`);
    for (const p of placeholders) console.error(`   ${p.file}:${p.line}  ${p.text}`);
    console.error('   → 实现它，或在文件头写「@stub-ok: <原因>」并登记到模块索引。');
  }
  if (gaps.length > 0) {
    failed = true;
    console.error(`❌ 契约→handler 缺口 ${gaps.length} 个（契约已声明、后台无实现）:`);
    for (const a of gaps) console.error(`   ${a}`);
  }
  if (exempted.length > 0) {
    console.log(`ℹ️  已豁免 ${exempted.length} 个文件（须已登记在 docs/modules/INDEX.md）:`);
    for (const e of exempted) console.log(`   ${e.file}（${e.hits} 处）：${e.reason}`);
  }
  if (failed) process.exit(1);
  console.log(`✅ 无未豁免的占位实现；契约 action 全部有实现（豁免 ${exempted.length}）`);
}
