/**
 * 游戏雷达 Game Radar - 规则文件防腐门禁 / Living rules freshness gate
 *
 * v14.33.2（AI 协作调研落地 A3，用户裁决 2026-11-18）：AGENTS.md / CONTRIBUTING.md /
 * docs/playbooks.md 是 AI 编码助手每次会话默认加载的"活规则"——其中引用的命令与
 * 文件路径一旦腐烂（脚本改名/删除、npm script 移除），AI 会带着失效指令工作并
 * 反复踩坑。本门禁机器化保鲜：
 *   ① 行内代码中的 `npm run <name>`（含 `|` 分割多选）必须存在于 package.json scripts
 *      ——含 …/.../<占位> 的可变形态只校验首个命令 token
 *   ② 行内代码中的 `node scripts/<file>` 必须存在
 *   ③ 行内代码中的仓库路径（.mjs/.js/.md/.json/.yml 后缀）必须存在（目录与占位符跳过）
 * 只查三个活规则文件（CHANGELOG 是历史流水不校验；docs/INDEX.md 链接由 check:docs 管）。
 *
 * 用法：node scripts/check-agents-docs.mjs（gate:fast 步骤；违规 exit 1）
 * npm script: check:agents-docs
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULE_FILES = ['AGENTS.md', 'CONTRIBUTING.md', 'docs/playbooks.md'];

/** 行内代码提取：反引号包裹片段（不跨行） */
const INLINE_CODE_RE = /`([^`\n]+)`/g;
/** npm run 命令提取（首个 token 为命令名） */
const NPM_RUN_RE = /^npm run ([a-z0-9:_-]+)/;
/** node scripts/… 直调形态 */
const NODE_SCRIPT_RE = /^node (scripts\/[\w/.-]+\.(?:mjs|js))/;
/** 仓库路径形态（可校验后缀白名单） */
const REPO_PATH_RE = /^(\.{0,2}\/[\w@/.-]+\.(?:mjs|js|md|json|yml|yaml))$/;

/** @param {string} s 含占位/可变标记（…、...、<>、{x}、中文括注空格形态）则视为可变引用 */
function isVariableRef(s) {
  return /…|\.\.\.<|<[a-zA-Z\u4e00-\u9fff]+>|\{[a-z]+\}/u.test(s) || /\s[（(]/.test(s);
}

/** @param {string} rel 相对路径是否为存在文件（目录不算——规则引用的应是具体文件） */
function isExistingFile(rel) {
  const abs = path.join(ROOT, rel);
  try {
    return existsSync(abs) && statSync(abs).isFile();
  } catch {
    return false;
  }
}

/**
 * 单片段校验（npm run 命令 / node scripts 直调 / 仓库路径）。
 * @param {string} frag 候选片段（已 trim）
 * @param {string} rel 来源文档（错误定位）
 * @param {Set<string>} scripts package.json scripts 名集合
 * @returns {{checked: number, errors: string[]}}
 */
function checkFrag(frag, rel, scripts) {
  const errors = [];
  let checked = 0;
  // ① npm run <name>——只校验首个命令 token（参数部分如 bump patch|minor 不校验，
  //    参数位含 | 是取值枚举非命令多选——首跑实证，v14.33.2）
  const runM = NPM_RUN_RE.exec(frag);
  if (runM) {
    checked++;
    if (!scripts.has(runM[1])) {
      errors.push(`${rel}: \`npm run ${runM[1]}\` 不存在于 package.json scripts（规则腐烂）`);
    }
    return { checked, errors };
  }
  // ② node scripts/<file> 直调
  const nodeM = NODE_SCRIPT_RE.exec(frag);
  if (nodeM) {
    checked++;
    if (!isExistingFile(nodeM[1])) errors.push(`${rel}: \`node ${nodeM[1]}\` 文件不存在（规则腐烂）`);
    return { checked, errors };
  }
  // ③ 仓库文件路径
  const pathM = REPO_PATH_RE.exec(frag);
  if (pathM) {
    checked++;
    const p = pathM[1].replace(/^\.\//, '');
    if (!isExistingFile(p)) errors.push(`${rel}: 引用路径 \`${p}\` 不存在（规则腐烂）`);
  }
  return { checked, errors };
}

/**
 * 收集待校验片段：fenced code block 逐行（bash 块的 npm run 行——AGENTS 常用命令
 * 区即此形态，负例自证暴露的盲区 v14.33.2）+ 行内反引号片段。
 * @param {string} src 文档全文
 * @returns {Array<{frag: string, line: number}>}
 */
function collectFrags(src) {
  const frags = [];
  const lines = src.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      frags.push({ frag: line.trim(), line: i + 1 });
    }
    for (const m of line.matchAll(INLINE_CODE_RE)) {
      frags.push({ frag: m[1].trim(), line: i + 1 });
    }
  }
  return frags;
}

/** @returns {{errors: string[], checked: number}} */
function checkRules() {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  const scripts = new Set(Object.keys(pkg.scripts || {}));
  const errors = [];
  let checked = 0;
  for (const rel of RULE_FILES) {
    const src = readFileSync(path.join(ROOT, rel), 'utf-8');
    for (const { frag, line } of collectFrags(src)) {
      if (isVariableRef(frag)) continue;
      const r = checkFrag(frag, rel, scripts);
      checked += r.checked;
      for (const e of r.errors) errors.push(`${rel}:${line} ${e.replace(rel + ': ', '')}`);
    }
  }
  return { errors, checked };
}

/** @returns {void} main（gate 调用） */
function main() {
  const { errors, checked } = checkRules();
  if (errors.length > 0) {
    console.error(`❌ 活规则文件引用失效 ${errors.length} 处：`);
    for (const e of errors) console.error('  - ' + e);
    console.error('   规则腐烂 = AI 助手带失效指令工作；修正文档或恢复被引用的命令/文件。');
    process.exit(1);
  }
  console.log(`✅ 活规则文件保鲜通过（${RULE_FILES.length} 份，引用校验 ${checked} 处）`);
}

// main 守卫：导入时零副作用（供单测调用 checkRules）
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}

export { checkRules, isVariableRef, isExistingFile };
