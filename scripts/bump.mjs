/**
 * 游戏雷达 Game Radar - 版本四处一键 bump / One-Command Version Bump
 *
 * v14.23.0（用户指令 2026-11-10：最小必要收敛——版本号纪律保留，机械编辑消除）：
 * 一条命令完成四处同步：manifest.json + package.json 版本号、CHANGELOG.md
 * 新条目、welcome/changelog.js 新版本块。release:smoke 机器门禁继续兜底漂移。
 * 油猴 @version 有意不动（= 移植基线，仅在功能口径同步后递增，见 AGENTS.md）。
 * v14.33.0（提交与版本规范治理，用户指令 2026-11-17）：
 *   ① 级别支持 auto 推导——从上次 bump 提交以来的提交类型按 semver 推导
 *     （BREAKING CHANGE→major、feat→minor、其余→patch），推导依据逐条打印；
 *   ② 级别支持 major（架构级）；③ 显式级别低于推导级别 = 拦截（防 feat 批
 *     按 patch bump 的 semver 漂移复发，--force 显式兜底）；④ CHANGELOG.md
 *     条目带日期（Keep a Changelog 必备字段）；⑤ 成功输出打 tag 提醒
 *     （每版一 tag 纪律：版本号必须可溯 commit）。
 * Bump manifest/package versions + CHANGELOG.md + welcome changelog in one step.
 * 用法 / Usage:
 *   npm run bump auto   "标题" "要点1" [要点2...]   # 级别由区间提交类型推导
 *   npm run bump patch  "标题" "要点1" [要点2...]
 *   npm run bump minor  "标题" "要点1" [要点2...]
 *   npm run bump major  "标题" "要点1" [要点2...]   # 架构级/破坏性
 *   尾部 --force：显式级别低于推导级别时强制放行（应仅记录理由后使用）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const RANK = { patch: 0, minor: 1, major: 2 };

/** 解析 CLI：level auto|patch|minor|major；尾部 --force 过滤出 title/items */
function parseArgs() {
  const [, , levelArg, titleArg, ...rest] = process.argv;
  const forceIdx = rest.indexOf('--force');
  const force = forceIdx >= 0;
  if (force) rest.splice(forceIdx, 1);
  const items = rest;
  if (!['auto', 'patch', 'minor', 'major'].includes(levelArg) || !titleArg || items.length === 0) {
    console.error('用法 / Usage: npm run bump auto|patch|minor|major "<标题>" "<要点1>" [要点2...] [尾部 --force]');
    process.exit(1);
  }
  return { levelArg, title: titleArg, items, force };
}

/**
 * 上次 bump 提交锚点：manifest.json 最近一次 version 行变更的提交（-G 只命中
 * diff 中出现该 pattern 的行——其他键改动不误中）。区间 = 该提交..HEAD。
 * @returns {{baseHash: string} | null} 无历史锚点（首次 bump）时返回 null
 */
function lastBumpCommit() {
  const out = execFileSync('git', ['log', '-G', '"version":', '--format=%H%x1e', '--', 'manifest.json'], {
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
    cwd: ROOT
  });
  const first = out
    .split('\x1e')
    .map((s) => s.trim())
    .filter(Boolean)[0];
  return first ? { baseHash: first } : null;
}

/**
 * 从上次 bump 以来的提交类型推导 bump 级别（semver 2.0.0：BREAKING→major、
 * feat→minor、其余→patch；Merge/Revert 自动提交跳过）。
 * @returns {{level: 'patch'|'minor'|'major', evidence: string[], count: number, hasCommits: boolean}}
 */
function deriveBumpLevel() {
  const anchor = lastBumpCommit();
  const range = anchor ? `${anchor.baseHash}..HEAD` : 'HEAD';
  const fmt = '%H%x1f%B%x1e';
  const out = execFileSync('git', ['log', range, `--format=${fmt}`], {
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
    cwd: ROOT
  });
  const evidence = [];
  let level = 'patch';
  let count = 0;
  for (const chunk of out.split('\x1e')) {
    const t = chunk.replace(/^\s+|\s+$/g, '');
    if (!t) continue;
    const sep = t.indexOf('\x1f');
    if (sep < 0) continue;
    const hash = t.slice(0, sep).slice(0, 8);
    const message = t.slice(sep + 1);
    const subject = (message.split('\n')[0] || '').trim();
    if (/^(merge|revert) /i.test(subject)) continue;
    count++;
    const m = /^(\w+)(\([^)]*\))?(!)?:/.exec(subject);
    const type = m ? m[1] : '';
    const breaking = Boolean(m && m[3]) || /^BREAKING[ -]CHANGE[:：]/m.test(message);
    if (breaking) {
      level = 'major';
      evidence.push(`${hash} BREAKING → major  ${subject}`);
    } else if (type === 'feat' && level !== 'major') {
      level = 'minor';
      evidence.push(`${hash} feat → minor  ${subject}`);
    }
  }
  return { level, evidence, count, hasCommits: count > 0 };
}

/** @returns {{levelArg: string, title: string, items: string[], force: boolean}} */
const { levelArg, title, items, force } = parseArgs();

// 1. 推导级别并做一致性校验（显式级别低于推导 = semver 漂移，拦截）
const derived = deriveBumpLevel();
let level;
if (levelArg === 'auto') {
  level = derived.level;
  console.log(
    `ℹ️ auto 推导：区间 ${derived.count} 条提交 → ${level}` +
      (derived.hasCommits ? '' : '（上次 bump 后无新提交，默认 patch）')
  );
  for (const e of derived.evidence) console.log(`   ${e}`);
} else {
  level = levelArg;
  if (RANK[level] < RANK[derived.level] && !force) {
    console.error(`❌ 显式级别 ${level} 低于区间提交推导级别 ${derived.level}（semver 漂移防护）：`);
    for (const e of derived.evidence) console.error(`   ${e}`);
    console.error('   请改用 auto 或与推导一致的级别；确需降级：尾部加 --force 并在提交说明记录理由。');
    process.exit(1);
  }
  if (RANK[level] > RANK[derived.level]) {
    console.log(`ℹ️ 显式级别 ${level} 高于推导 ${derived.level}（提前量/批次语义，允许）`);
  }
}

// 2. 读取并计算新版本 / Compute next version
const manifestPath = path.join(ROOT, 'manifest.json');
const pkgPath = path.join(ROOT, 'package.json');
const manifest = readFileSync(manifestPath, 'utf-8');
const pkg = readFileSync(pkgPath, 'utf-8');
const m = /"version":\s*"(\d+)\.(\d+)\.(\d+)"/.exec(manifest);
if (!m) {
  console.error('❌ manifest.json 未找到 version 字段');
  process.exit(1);
}
const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
const version =
  level === 'major' ? `${maj + 1}.0.0` : level === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
// 本地日期（toISOString 是 UTC——UTC+8 凌晨会差一天，与既有条目本地日期口径对齐）
const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 重复 bump 防护（幂等性：同一版本不写两次）
// v14.28.0（S3 P2-2）：版本流水自 README 拆到 CHANGELOG.md（README ≤ 400 行），
// 新条目仍插入到首个 `### v` 之前（保持倒序）
const changelogMdPath = path.join(ROOT, 'CHANGELOG.md');
const changelogPath = path.join(ROOT, 'welcome/changelog.js');
const changelogMd = readFileSync(changelogMdPath, 'utf-8');
const changelog = readFileSync(changelogPath, 'utf-8');
if (changelogMd.includes(`### v${version}（`) || changelog.includes(`ver: '${version}'`)) {
  console.error(`❌ v${version} 条目已存在（重复 bump？）——如确需重跑请先回退上次变更`);
  process.exit(1);
}

// 3. manifest + package（正则定点替换，不重排整文件）
writeFileSync(manifestPath, manifest.replace(m[0], `"version": "${version}"`));
const mp = /"version":\s*"(\d+)\.(\d+)\.(\d+)"/.exec(pkg);
if (!mp) {
  console.error('❌ package.json 未找到 version 字段');
  process.exit(1);
}
writeFileSync(pkgPath, pkg.replace(mp[0], `"version": "${version}"`));

// 4. CHANGELOG.md：新条目插入到首个 `### v` 之前（保持倒序；v14.33.0 起条目带日期）
const entryStart = changelogMd.indexOf('### v');
if (entryStart < 0) {
  console.error('❌ CHANGELOG.md 未找到既有条目锚点（### v）');
  process.exit(1);
}
const changelogEntry = `### v${version}（${title}，${today}）\n\n${items.map((i) => `- ${i}`).join('\n')}\n\n`;
writeFileSync(changelogMdPath, changelogMd.slice(0, entryStart) + changelogEntry + changelogMd.slice(entryStart));

// 5. welcome/changelog.js：versions 头部插入新块（缩进对齐既有条目；welcome 页动态渲染）
const anchorCh = changelog.indexOf('versions: [');
if (anchorCh < 0) {
  console.error('❌ welcome/changelog.js 未找到 versions: [ 锚点');
  process.exit(1);
}
const insertAt = anchorCh + 'versions: ['.length;
const quote = (s) => `'${s.replace(/'/g, "\\'")}'`;
const chEntry =
  `\n      {\n        ver: '${version}',\n        date: '${today}',\n        items: [\n` +
  items.map((i) => `          ${quote(i)}`).join(',\n') +
  `\n        ]\n      },`;
writeFileSync(changelogPath, changelog.slice(0, insertAt) + chEntry + changelog.slice(insertAt));

console.log(`✅ 四处同步完成 / 4-place bump done: v${version}（${level}, ${today}）`);
console.log('   - manifest.json / package.json / CHANGELOG.md / welcome changelog');
console.log('   - 油猴 @version 未动（移植基线，仅功能口径同步后递增）');
console.log(`   - 每版一 tag（版本号必须可溯 commit）：git tag v${version} && git push origin main v${version}`);
console.log('   - 提交前跑 `npm run release:smoke` 校验四处同步（机器门禁兜底）');
