/**
 * 游戏雷达 Game Radar - 提交信息校验器 / Commit message linter（Conventional Commits 1.0.0）
 *
 * v14.33.0（提交与版本规范治理，用户指令 2026-11-17）：v4.1.2 的 sh 轻量校验（仅查类型
 * 前缀）升级为全量规则——规则集 = conventionalcommits.org 1.0.0 + commitlint
 * config-conventional 主流约束的零依赖子集：
 *   ① 类型白名单（feat|fix|refactor|perf|docs|test|build|ci|chore|style|revert）
 *   ② scope 单词字符集 [a-z0-9-]+（禁逗号多 scope/大写——保证工具链可解析）
 *   ③ subject 非空、≤72 字符（细节移入 body）、结尾无句号
 *   ④ subject 与 body 之间空行分隔（CC 规范格式）
 *   ⑤ subject 带 !（breaking）时 body/footer 必须含 BREAKING CHANGE: 说明（反向不拦——
 *      仅 footer 声明 breaking 而 subject 无 ! 在 CC 规范中合法）
 * Merge/Revert 自动提交跳过。库模式（lintMessage/collectCommits）供单测导入；
 * CLI 模式供 commit-msg 钩子与 npm run lint:commits 区间复查。
 *
 * 用法 / Usage:
 *   node scripts/commit-lint.mjs <msg-file>      # commit-msg 钩子模式（校验单条提交信息文件）
 *   node scripts/commit-lint.mjs                 # 校验未推送区间（origin/main..HEAD，失败回退 HEAD~1）
 *   node scripts/commit-lint.mjs --range <spec>  # 校验指定区间（如 v14.31.0..HEAD）
 *   node scripts/commit-lint.mjs --last <n>      # 校验最近 n 条
 * npm script: lint:commits。区间模式供发版前复查本批次；历史提交不回溯改写（工具向前看）。
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 提交类型白名单（Conventional Commits 常用类型集） */
export const COMMIT_TYPES = [
  'feat',
  'fix',
  'refactor',
  'perf',
  'docs',
  'test',
  'build',
  'ci',
  'chore',
  'style',
  'revert'
];

/** subject 字符数上限（细节一律移入 body） */
export const SUBJECT_MAX = 72;

/** 首行解析：type(scope)?: subject，! 为 breaking 标记 */
const HEADER_RE = new RegExp(`^(${COMMIT_TYPES.join('|')})(\\([a-z0-9-]+\\))?(!)?: (.*)$`);

/**
 * 校验单条提交信息（完整消息含 body/footer）。
 * @param {string} message 完整提交信息（首行 subject + 可选空行 + body/footer）
 * @returns {{ok: boolean, errors: string[]}} ok=全部规则通过；errors=违规明细（中文，供钩子直接展示）
 */
export function lintMessage(message) {
  const errors = [];
  const lines = String(message).replace(/\r\n/g, '\n').split('\n');
  const first = (lines[0] || '').replace(/\s+$/, '');
  // Merge/Revert 自动提交（git merge/revert 生成）不走本规范
  if (/^(merge|revert) /i.test(first)) return { ok: true, errors: [] };
  const m = HEADER_RE.exec(first);
  if (!m) {
    errors.push(`首行不符合 type(scope)?: subject 格式（类型白名单：${COMMIT_TYPES.join('|')}）`);
    return { ok: false, errors };
  }
  const subject = m[4];
  if (!subject.trim()) errors.push('subject 为空');
  if (subject.length > SUBJECT_MAX) {
    errors.push(`subject ${subject.length} 字符 > 上限 ${SUBJECT_MAX}（细节移入 body）`);
  }
  if (/[.。]$/.test(subject.trim())) errors.push('subject 结尾不得带句号');
  // CC 规范：subject 与 body 之间必须空行分隔
  if (lines.length > 1 && lines[1].trim() !== '') {
    errors.push('subject 与 body 之间须空行分隔');
  }
  // breaking 标记与说明必须成对：subject 带 ! 则 footer 必须有 BREAKING CHANGE:
  if (m[3] === '!' && !/^BREAKING[ -]CHANGE[:：]/m.test(message)) {
    errors.push('subject 带 !（breaking）但 body/footer 缺 BREAKING CHANGE: 说明');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * git 调用（execFileSync 数组参数——不经 shell，消除注入面；v14.31.3 教训）。
 * @param {string[]} args git 参数
 * @returns {string} stdout
 */
function git(args) {
  return execFileSync('git', args, { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024, cwd: ROOT });
}

/**
 * 收集区间内提交（%B = 完整消息含 body/footer，\x1f/\x1e 分段解析）。
 * @param {string} range git 区间表达式（如 origin/main..HEAD）
 * @param {number=} limit 可选条数上限（--last 模式，git log -n）
 * @returns {Array<{hash: string, message: string}>}
 */
export function collectCommits(range, limit) {
  const args = ['log', range, '--format=%H%x1f%B%x1e'];
  if (limit) args.splice(1, 1, '-n', String(limit), range);
  const out = git(args);
  const commits = [];
  for (const chunk of out.split('\x1e')) {
    const t = chunk.replace(/^\s+|\s+$/g, '');
    if (!t) continue;
    const sep = t.indexOf('\x1f');
    if (sep < 0) continue;
    commits.push({ hash: t.slice(0, sep), message: t.slice(sep + 1) });
  }
  return commits;
}

/**
 * 区间规格白名单校验（execFileSync 已不经 shell，此处为纵深防御 + 防误传奇值）。
 * @param {string} spec
 * @returns {boolean}
 */
function isSafeRange(spec) {
  return /^[0-9A-Za-z._~^/-]{1,120}$/.test(spec);
}

/**
 * CLI：钩子模式（单文件）或区间模式。
 * @returns {void}
 */
function main() {
  const argv = process.argv.slice(2);
  // 钩子模式：commit-msg 传入信息文件路径
  if (argv[0] && !argv[0].startsWith('--')) {
    const { ok, errors } = lintMessage(readFileSync(argv[0], 'utf-8'));
    if (!ok) {
      console.error('❌ 提交信息不符合 Conventional Commits 1.0.0 规范（.githooks/commit-msg）：');
      for (const e of errors) console.error('  - ' + e);
      console.error('   规范详见 CONTRIBUTING.md「提交信息规范」；跳过钩子请勿养成习惯（--no-verify 仅应急）。');
      process.exit(1);
    }
    return;
  }
  // 区间模式：--range <spec> / --last <n> / 默认未推送区间
  let range;
  let limit;
  const rangeIdx = argv.indexOf('--range');
  const lastIdx = argv.indexOf('--last');
  if (rangeIdx >= 0) {
    range = argv[rangeIdx + 1] || '';
    if (!isSafeRange(range)) {
      console.error(`❌ 区间规格不合法：${range}`);
      process.exit(1);
    }
  } else if (lastIdx >= 0) {
    const n = Number(argv[lastIdx + 1]);
    if (!Number.isInteger(n) || n <= 0 || n > 500) {
      console.error('❌ --last 需为 1-500 的整数');
      process.exit(1);
    }
    range = 'HEAD';
    limit = n;
  } else {
    // 默认未推送区间；origin/main 缺失（浅克隆/无远端）回退 HEAD~1
    try {
      git(['rev-parse', '--verify', '--quiet', 'origin/main']);
      range = 'origin/main..HEAD';
    } catch {
      range = 'HEAD~1..HEAD';
    }
  }
  const commits = collectCommits(range, limit);
  const rangeLabel = limit ? `${range}（最近 ${limit} 条）` : range;
  const violations = [];
  for (const c of commits) {
    const { ok, errors } = lintMessage(c.message);
    if (!ok) violations.push({ hash: c.hash.slice(0, 8), errors });
  }
  if (violations.length > 0) {
    console.error(`❌ ${violations.length} 条提交不符合 Conventional Commits 1.0.0（区间 ${rangeLabel}）：`);
    for (const v of violations) for (const e of v.errors) console.error(`  - ${v.hash} ${e}`);
    console.error('   历史提交不回溯改写；新提交请守规范（CONTRIBUTING.md「提交信息规范」）。');
    process.exit(1);
  }
  console.log(`✅ ${commits.length} 条提交符合 Conventional Commits 1.0.0（区间 ${rangeLabel}）`);
}

// main 守卫：仅直接运行时执行 CLI（import 时零副作用，供单测导入纯函数）
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
