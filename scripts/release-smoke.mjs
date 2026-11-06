/**
 * 游戏雷达 Game Radar - 发布产物一致性门禁 / Release artifact consistency gate
 *
 * v14.15.0（功能建议报告 O4 执行期替位项）：版本号纪律（每次改动 bump
 * manifest/package/README/welcome 四处，v14.14.1 起油猴脚本为第 5 落点）此前
 * 全靠人工核对——v14.6.3 曾漏 README 条目。本脚本机器化四处同步断言：
 *   ① manifest.version == package.json.version
 *   ② README 更新日志头条版本 == manifest.version
 *   ③ welcome/changelog.js 头条版本 == manifest.version
 *   ④ 油猴 @version == 脚本内 SCRIPT_VERSION（内部一致）且 ≤ manifest.version
 *   ⑤ release zip 存在且含 manifest/service-worker、无 node_modules/tests 泄漏
 * Run: node scripts/release-smoke.mjs（发版流程 package 之后；CI release-smoke job 同源调用）
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf-8'));
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const ver = manifest.version;

// ① manifest == package.json
if (pkg.version !== ver) {
  errors.push(`package.json.version (${pkg.version}) != manifest.version (${ver})`);
}

// ② README 更新日志头条 == manifest.version
const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf-8');
const readmeHead = readme.match(/^### v(\d+\.\d+\.\d+)/m);
if (!readmeHead) {
  errors.push('README 更新日志未找到头条版本（### vX.Y.Z）');
} else if (readmeHead[1] !== ver) {
  errors.push(`README 更新日志头条 v${readmeHead[1]} != manifest ${ver}（版本号纪律：bump 须同步 README changelog）`);
}

// ③ welcome/changelog.js 头条 == manifest.version
const changelogSrc = readFileSync(path.join(ROOT, 'welcome/changelog.js'), 'utf-8');
const changelogHead = changelogSrc.match(/ver:\s*'(\d+\.\d+\.\d+)'/);
if (!changelogHead) {
  errors.push('welcome/changelog.js 未找到头条版本（ver:）');
} else if (changelogHead[1] !== ver) {
  errors.push(
    `welcome changelog 头条 v${changelogHead[1]} != manifest ${ver}（版本号纪律：bump 须同步 welcome changelog）`
  );
}

// ④ 油猴脚本：内部一致 + 不超前于 manifest
const userscriptPath = path.join(ROOT, 'userscript/game-radar.user.js');
if (!existsSync(userscriptPath)) {
  errors.push('userscript/game-radar.user.js 缺失');
} else {
  const us = readFileSync(userscriptPath, 'utf-8');
  const headerVer = (us.match(/@version\s+(\d+\.\d+\.\d+)/) || [])[1];
  const constVer = (us.match(/const SCRIPT_VERSION = '(\d+\.\d+\.\d+)'/) || [])[1];
  if (!headerVer) errors.push('油猴脚本缺 @version');
  if (constVer !== headerVer) {
    errors.push(`油猴 SCRIPT_VERSION (${constVer}) != @version (${headerVer})——内部不一致`);
  }
  if (headerVer && cmpVer(headerVer, ver) > 0) {
    errors.push(`油猴 @version (${headerVer}) 超前于 manifest (${ver})——油猴移植基线不得高于扩展当前版`);
  }
}

// ⑤ release zip（存在时校验内容；package 之前运行则跳过并提示）
const zipPath = path.join(ROOT, `release/game-recommender-v${ver}.zip`);
if (!existsSync(zipPath)) {
  console.log(`ℹ️ 未找到 ${path.basename(zipPath)}——跳过 zip 校验（发版流程 npm run package 后重跑本脚本）`);
} else {
  const { execSync } = await import('node:child_process');
  const raw = execSync(`unzip -l "${zipPath}"`, { encoding: 'utf-8' });
  const list = raw.split('\\').join('/'); // Windows 打包 zip 路径为反斜杠——归一后断言（CI Linux 正斜杠同过）
  if (!list.includes('manifest.json')) errors.push('zip 缺 manifest.json');
  if (!list.includes('background/service-worker.js')) errors.push('zip 缺 service-worker');
  if (/node_modules\/|\stests\//.test(list)) errors.push('zip 泄漏 node_modules/tests');
}

/** 版本三元组比较：a>b → 1，a<b → -1，相等 → 0 */
function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

if (errors.length > 0) {
  console.error('❌ 发布产物一致性门禁失败：');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✅ 发布产物一致性通过：manifest=${ver}（package/README/welcome/油猴 四处同步）`);
