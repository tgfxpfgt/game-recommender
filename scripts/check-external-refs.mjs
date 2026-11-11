/**
 * 游戏雷达 Game Radar - 外部引用锁门禁 / External Reference Lock Gate
 *
 * v14.28.9（A 类缺陷制度性根治）：代码里的第三方托管 URL（GitHub raw / jsDelivr）
 * 全部登记在 scripts/external-refs.json，且 branch 必须等于仓库真实默认分支。
 * 背景实证：appListIndex 的 dump URL 写死 `main`（仓库默认分支是 `master`）→
 * v14.6 起 404 从未生效、五个月零运行，而 lint/typecheck/测试全绿——因为
 * **没有任何检查把"外部引用的分支是不是真分支"当成可验证事实**。
 *
 * 离线模式（gate 内跑）：登记完整性 + 声明/使用一致 + URL 分支结构 + 保鲜期。
 * --refresh（人工/发布前）：GitHub API 读 default_branch 比对 + 实测 HTTP 状态
 * 与字节数，通过后回写 validatedAt。网络不可用即红（"没验过"≠"验过了"）。
 *
 * Usage: node scripts/check-external-refs.mjs [--refresh]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REFS_PATH = path.join(ROOT, 'scripts', 'external-refs.json');
const refresh = process.argv.includes('--refresh');

/** 代码扫描范围（测试/文档/构建产物不在内：它们不是出站引用） */
const SCAN_DIRS = [
  'background',
  'content',
  'data',
  'shared',
  'userscript',
  'popup',
  'options',
  'dashboard',
  'hub',
  'styles'
];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', 'docs', 'tests', 'scripts']);
/** 视为"外部托管引用"的宿主（新增托管方时在此登记，否则视为未覆盖） */
const HOSTED_HOSTS = [
  'raw.githubusercontent.com',
  'cdn.jsdelivr.net',
  'raw.github.com',
  'objects.githubusercontent.com'
];
const URL_RE = /\bhttps?:\/\/[^\s'"`<>)\]}]+/g;

/** @type {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      out.push(...walk(abs));
    } else if (/\.(js|mjs)$/.test(ent.name)) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * 解析托管 URL 的 owner/repo/branch/path（只为结构性比对，不用来发请求）。
 * @param {string} url
 * @returns {{owner: string, repo: string, branch: string, rest: string}|null}
 */
function parseHostedUrl(url) {
  const u = new URL(url);
  const seg = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (u.hostname === 'cdn.jsdelivr.net') {
    // /gh/<owner>/<repo>@<branch>/<path>
    if (seg[0] !== 'gh' || seg.length < 3) return null;
    const at = seg[2].indexOf('@');
    if (at < 0) return null;
    return { owner: seg[1], repo: seg[2].slice(0, at), branch: seg[2].slice(at + 1), rest: seg.slice(3).join('/') };
  }
  // raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>
  if (seg.length < 4) return null;
  return { owner: seg[0], repo: seg[1], branch: seg[2], rest: seg.slice(3).join('/') };
}

const errors = [];
const warnings = [];

const refsDoc = JSON.parse(fs.readFileSync(REFS_PATH, 'utf-8'));
/** @type {Array<any>} */
const refs = refsDoc.refs || [];
const allow = new Set((refsDoc.allow || []).map((a) => a.url));
const declared = new Map(refs.map((r) => [r.url, r]));

// ---- 1) 扫描代码中的托管 URL ----
/** @type {Map<string, string[]>} */
const found = new Map();
for (const dir of SCAN_DIRS) {
  for (const abs of walk(path.join(ROOT, dir))) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    const text = fs.readFileSync(abs, 'utf-8');
    for (const m of text.matchAll(URL_RE)) {
      const url = m[0].replace(/[.,;:]+$/, '');
      let host = '';
      try {
        host = new URL(url).hostname;
      } catch {
        continue;
      }
      if (!HOSTED_HOSTS.includes(host)) continue;
      const list = found.get(url) || [];
      list.push(rel);
      found.set(url, list);
    }
  }
}

// ---- 2) 登记完整性：代码里出现的托管 URL 必须已登记 ----
for (const [url, files] of found) {
  if (declared.has(url) || allow.has(url)) continue;
  errors.push(
    `未登记的外部引用: ${url}\n     出现于 ${[...new Set(files)].join('、')}\n     → 在 scripts/external-refs.json 登记并能通过 --refresh 校验`
  );
}

// ---- 3) 声明/使用一致：登记了但代码里没有 = 声明与实现不符 ----
for (const ref of refs) {
  if (found.has(ref.url)) continue;
  errors.push(`登记的引用在代码中不存在: ${ref.id} (${ref.url})\n     → 删除该登记或修正代码中的 URL`);
}

// ---- 4) 结构比对：URL 里的 owner/repo/branch 必须与登记的默认分支一致 ----
for (const ref of refs) {
  const parsed = parseHostedUrl(ref.url);
  if (!parsed) {
    errors.push(`无法解析托管 URL 结构: ${ref.id} (${ref.url})`);
    continue;
  }
  const wantRepo = `${ref.repo}`.toLowerCase();
  const gotRepo = `${parsed.owner}/${parsed.repo}`.toLowerCase();
  if (wantRepo !== gotRepo) {
    errors.push(`仓库不一致: ${ref.id} 登记 ${wantRepo}，URL 实为 ${gotRepo}`);
  }
  if (parsed.branch !== ref.branch) {
    // 这正是 appListIndex 死功能的形态：URL 分支 ≠ 仓库默认分支
    errors.push(
      `分支不一致: ${ref.id} 登记默认分支「${ref.branch}」，URL 使用「${parsed.branch}」\n     → 分支写错会让引用 404 且所有静态检查保持全绿`
    );
  }
}

// ---- 5) 保鲜期：超期未复核 = 红（"上次能用"不能当"现在能用"） ----
const today = new Date();
for (const ref of refs) {
  const t = Date.parse(ref.validatedAt || '');
  if (!Number.isFinite(t)) {
    errors.push(`缺少有效 validatedAt: ${ref.id}`);
    continue;
  }
  const days = Math.floor((today.getTime() - t) / 86400000);
  if (days > (refsDoc.maxAgeDays || 30)) {
    errors.push(
      `引用已过期未复核: ${ref.id}（${days} 天 > ${refsDoc.maxAgeDays} 天）\n     → npm run check:ext-refs -- --refresh`
    );
  }
}

// ---- 6) --refresh：向 GitHub API 求证真实默认分支 + 实测可达性 ----
if (refresh) {
  const timeoutMs = 20000;
  /** @param {string} url @param {string} [accept] */
  const get = async (url, accept = 'application/vnd.github+json') => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: ctl.signal, headers: { accept, 'user-agent': 'game-radar-ext-ref-check' } });
    } finally {
      clearTimeout(timer);
    }
  };
  /** @type {Map<string, string>} */
  const branchCache = new Map();
  for (const ref of refs) {
    try {
      if (!branchCache.has(ref.repo)) {
        const r = await get(`https://api.github.com/repos/${ref.repo}`);
        if (!r.ok) throw new Error(`GitHub API HTTP ${r.status}`);
        const j = await r.json();
        branchCache.set(ref.repo, String(j.default_branch || ''));
      }
      const defaultBranch = branchCache.get(ref.repo);
      if (defaultBranch !== ref.branch) {
        errors.push(
          `默认分支漂移: ${ref.id} 登记「${ref.branch}」，GitHub 实际「${defaultBranch || '<空>'}」\n     → 修正 URL 与登记后重跑`
        );
        continue;
      }
      const head = await get(ref.url, '*/*');
      if (!head.ok) {
        errors.push(`引用不可达: ${ref.id} HTTP ${head.status}`);
        continue;
      }
      const len = Number(head.headers.get('content-length'));
      ref.httpStatus = head.status;
      if (Number.isFinite(len) && len > 0) ref.bytes = len;
      ref.validatedAt = new Date().toISOString().slice(0, 10);
    } catch (e) {
      errors.push(`刷新失败（网络不可用 = 未验证，按红处理）: ${ref.id} ${String(e).slice(0, 120)}`);
    }
  }
  if (errors.length === 0) {
    fs.writeFileSync(REFS_PATH, JSON.stringify(refsDoc, null, 2) + '\n', 'utf-8');
  }
}

for (const w of warnings) console.warn('⚠️ ' + w);
if (errors.length > 0) {
  console.error(`❌ 外部引用门禁失败（${errors.length} 项）:`);
  for (const e of errors) console.error('   - ' + e);
  process.exit(1);
}
console.log(
  `✅ 外部引用一致（${refs.length} 条，扫描 ${found.size} 个托管 URL，保鲜期 ${refsDoc.maxAgeDays} 天${refresh ? '，已刷新' : ''}）`
);
