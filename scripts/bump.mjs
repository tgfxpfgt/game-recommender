/**
 * 游戏雷达 Game Radar - 版本四处一键 bump / One-Command Version Bump
 *
 * v14.23.0（用户指令 2026-11-10：最小必要收敛——版本号纪律保留，机械编辑消除）：
 * 一条命令完成四处同步：manifest.json + package.json 版本号、README 更新日志
 * 新条目、welcome/changelog.js 新版本块。release:smoke 机器门禁继续兜底漂移。
 * 油猴 @version 有意不动（= 移植基线，仅在功能口径同步后递增，见 AGENTS.md）。
 * Bump manifest/package versions + README changelog + welcome changelog in one step.
 * 用法 / Usage:
 *   npm run bump patch "标题" "要点1" [要点2...]
 *   npm run bump minor "标题" "要点1" [要点2...]
 *   例：npm run bump patch "浮窗菜单修复" "修复折叠按钮无反应" "补 F1 回归"
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const [, , level, title, ...items] = process.argv;
if (!['patch', 'minor'].includes(level) || !title || items.length === 0) {
  console.error('用法 / Usage: npm run bump patch|minor "<标题>" "<要点1>" [要点2...]');
  process.exit(1);
}

// 1. 读取并计算新版本 / Compute next version
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
const version = level === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
// 本地日期（toISOString 是 UTC——UTC+8 凌晨会差一天，与既有条目本地日期口径对齐）
const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 重复 bump 防护（幂等性：同一版本不写两次）
const readmePath = path.join(ROOT, 'README.md');
const changelogPath = path.join(ROOT, 'welcome/changelog.js');
const readme = readFileSync(readmePath, 'utf-8');
const changelog = readFileSync(changelogPath, 'utf-8');
if (readme.includes(`### v${version}（`) || changelog.includes(`ver: '${version}'`)) {
  console.error(`❌ v${version} 条目已存在（重复 bump？）——如确需重跑请先回退上次变更`);
  process.exit(1);
}

// 2. manifest + package（正则定点替换，不重排整文件）
writeFileSync(manifestPath, manifest.replace(m[0], `"version": "${version}"`));
const mp = /"version":\s*"(\d+)\.(\d+)\.(\d+)"/.exec(pkg);
if (!mp) {
  console.error('❌ package.json 未找到 version 字段');
  process.exit(1);
}
writeFileSync(pkgPath, pkg.replace(mp[0], `"version": "${version}"`));

// 3. README 更新日志：新条目插入到「## 更新日志」下首个条目之前（保持倒序）
const anchor = readme.indexOf('## 更新日志');
const entryStart = anchor >= 0 ? readme.indexOf('### v', anchor) : -1;
if (entryStart < 0) {
  console.error('❌ README 未找到「## 更新日志」下的既有条目锚点');
  process.exit(1);
}
const readmeEntry = `### v${version}（${title}）\n\n${items.map((i) => `- ${i}`).join('\n')}\n\n`;
writeFileSync(readmePath, readme.slice(0, entryStart) + readmeEntry + readme.slice(entryStart));

// 4. welcome/changelog.js：versions 头部插入新块（缩进对齐既有条目；welcome 页动态渲染）
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
console.log('   - manifest.json / package.json / README 更新日志 / welcome changelog');
console.log('   - 油猴 @version 未动（移植基线，仅功能口径同步后递增）');
console.log('   - 提交前跑 `npm run release:smoke` 校验四处同步（机器门禁兜底）');
