/**
 * 游戏雷达 Game Radar - 油猴同源构建器（阶段 4）
 *
 * userscript/game-radar.user.js 的 §1 词表快照块由 shared/retrieval-vocab.js
 * 编译产物**生成**（构建期同步，防漂移门禁由 test-userscript-pure 兜底）：
 *   - 生成段以 GR-GENERATED-BEGIN/END 锚点包裹
 *   - 源模式（仓库内手工文件）与构建产物并存：`node scripts/build-userscript.mjs`
 *     就地刷新快照段（bump/发版流程调用）
 * Stage-4 same-source builder: regenerate the userscript vocab snapshot block
 * from shared/retrieval-vocab.js compiled output (anchors delimit the section).
 *
 * 词条形状口径（与 test-userscript-pure 对齐）：
 *   - VocabEntry = [kind, value] 二元组（w=字面词 re=正则片段 b=边界词）——
 *     快照统一取 value 列（测试 missingFrom(map(([,v])=>v), set) 同口径）
 *   - titleTailStripWords / noiseEnWords / editionWords = string[]
 *   - versionSuffixes = [cn, en] 对数组
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'userscript/game-radar.user.js');

// 1) 装载 shared/retrieval-vocab.js（ESM import——构建脚本可 Node ESM）
const { RETRIEVAL_VOCAB } = await import(new URL('../shared/retrieval-vocab.js', import.meta.url).href);

// 2) 形状辅助：tuple 取 value 列（全部 kind），string[] 直接 join
const BS = String.fromCharCode(92);
/** JS 单引号串字面转义（反斜杠与引号——re 片段入串后经 new RegExp 重建） */
function jsStr(v) {
  return String(v)
    .replace(/\\/g, BS + BS)
    .replace(/'/g, BS + "'");
}
/** @param {any[]} entries [kind, value] 对 → value 全列（w/re/b 一并，与防漂移测试同口径） */
function allValues(entries) {
  return entries.map((e) => jsStr(e[1])).join('|');
}
/** @param {string[]} words */
function joinWords(words) {
  return words.join('|');
}

const vocabBlock = [
  '  // prettier-ignore',
  '  const VOCAB = {',
  '    // GR-GENERATED-BEGIN（由 scripts/build-userscript.mjs 从 shared/retrieval-vocab.js 生成——勿手改）',
  '    // 中文标题噪声序列（RETRIEVAL_VOCAB.noiseTitle 快照：字面词 + 正则片段分离）',
  "    noiseWords: '" +
    RETRIEVAL_VOCAB.noiseTitle
      .filter((/** @type {any[]} */ e) => e[0] === 'w')
      .map((/** @type {any[]} */ e) => e[1])
      .join('|') +
    "',",
  '    noiseRe: ' +
    JSON.stringify(
      RETRIEVAL_VOCAB.noiseTitle.filter((/** @type {any[]} */ e) => e[0] === 're').map((/** @type {any[]} */ e) => e[1])
    ) +
    ',',
  "    tailStrip: '" + joinWords(RETRIEVAL_VOCAB.titleTailStripWords) + "',",
  "    editionWords: '" + joinWords(RETRIEVAL_VOCAB.editionWords) + "',",
  "    junkCandidate: '" + allValues(RETRIEVAL_VOCAB.junkCandidateWords) + "',",
  "    addonPattern: '" + allValues(RETRIEVAL_VOCAB.addonKeywords) + "',",
  "    demoPattern: '" + allValues(RETRIEVAL_VOCAB.demoKeywords) + "',",
  "    enNoiseWords: '" + joinWords(RETRIEVAL_VOCAB.noiseEnWords) + "',",
  '    versionPairs: ' +
    JSON.stringify(RETRIEVAL_VOCAB.versionSuffixes.map((/** @type {any[]} */ p) => [p[0], p[1]])) +
    ',',
  '    // GR-GENERATED-END',
  '  };'
].join('\n');

// 3) 替换 OUT 中的 VOCAB 块（GR-GENERATED 锚点间；无锚点时替换整个 const VOCAB = {...}; 块）
// 括号配平：const VOCAB = { 的块到**首个 ^2 缩进的 };**（v14 手写块实际止于
// versionPairs 行后的 '  };'）。anchor 逻辑先验证配平再写入——防重复堆叠。
let out = fs.readFileSync(OUT, 'utf-8');
const anchorBegin = out.indexOf('// GR-GENERATED-BEGIN');
const anchorEnd = out.indexOf('// GR-GENERATED-END');
if (anchorBegin >= 0 && anchorEnd > anchorBegin) {
  // 幂等：先清掉已生成块（连同 const VOCAB = { 行与配对 };），再插入新块
  let declStart = out.lastIndexOf('  const VOCAB = {', anchorBegin);
  if (declStart === -1) throw new Error('已生成块缺少 const VOCAB 声明');
  // 声明行上方的 prettier-ignore 注释属生成块——并入删除区间（防 regen 堆叠）
  const ignIdx = out.lastIndexOf('  // prettier-ignore', declStart);
  if (ignIdx !== -1 && out.indexOf('\n', ignIdx) + 1 === declStart) declStart = ignIdx;
  const endLineEnd = out.indexOf('\n', anchorEnd + 1);
  const closeDecl = out.indexOf('\n  };', anchorEnd);
  if (closeDecl === -1 || closeDecl > endLineEnd) throw new Error('已生成块结尾未配平');
  const afterClose = out.indexOf('\n', closeDecl + 1);
  out = out.slice(0, declStart) + vocabBlock + out.slice(afterClose);
} else {
  // 旧文件无锚点：定位 const VOCAB = { ... };（到首个 ^2 缩进 };）
  const vStart = out.indexOf('  const VOCAB = {');
  if (vStart === -1) throw new Error('VOCAB 块未找到');
  const vEnd = out.indexOf('\n  };', vStart);
  if (vEnd === -1) throw new Error('VOCAB 块结尾未找到');
  out = out.slice(0, vStart) + vocabBlock + out.slice(vEnd + '\n  };'.length);
}
// 写入前配平自检（双保险）
const declCount = (out.match(/const VOCAB = \{/g) || []).length;
if (declCount !== 1) throw new Error('VOCAB 声明数异常: ' + declCount + '（配平失败，拒绝写入）');
fs.writeFileSync(OUT, out, 'utf-8');
console.log('✓ userscript 词表快照已从 retrieval-vocab 同源刷新（GR-GENERATED 锚点）');
