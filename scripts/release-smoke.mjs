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
import { listZipEntries } from './zip-entries.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf-8'));
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const ver = manifest.version;

// ① manifest == package.json
if (pkg.version !== ver) {
  errors.push(`package.json.version (${pkg.version}) != manifest.version (${ver})`);
}

// ② CHANGELOG.md 头条 == manifest.version
// v14.28.0（S3 P2-2）：版本流水自 README 拆到 CHANGELOG.md（README ≤ 400 行），
// 头条断言随之改读 CHANGELOG.md
const readme = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf-8');
const readmeHead = readme.match(/^### v(\d+\.\d+\.\d+)/m);
if (!readmeHead) {
  errors.push('CHANGELOG.md 未找到头条版本（### vX.Y.Z）');
} else if (readmeHead[1] !== ver) {
  errors.push(`CHANGELOG 头条 v${readmeHead[1]} != manifest ${ver}（版本号纪律：bump 须同步 CHANGELOG.md）`);
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
  // ⑥ v14.28.0（S3 P2-18 / M-7）：移植基线差距门禁
  // 油猴 @version 是"移植基线"（AGENTS：≠ 扩展 patch 联动），差距天然存在；
  // 本门禁只防差距继续扩大：>3 minor 告警，> 基线（实测锁定值）失败。基线随
  // "功能口径同步"下降，不下调（防止用放宽阈值掩盖漂移）。
  const USERSCRIPT_GAP_BASELINE = 14;
  if (headerVer) {
    const gap = minorIndexOf(ver) - minorIndexOf(headerVer);
    if (gap > USERSCRIPT_GAP_BASELINE) {
      errors.push(`油猴移植基线落后 ${gap} 个 minor（> 基线 ${USERSCRIPT_GAP_BASELINE}）——须同步 shared 纯逻辑快照`);
    } else if (gap > 3) {
      console.warn(`⚠️ 油猴移植基线落后 ${gap} 个 minor（> 3，未超基线 ${USERSCRIPT_GAP_BASELINE}）——建议排期同步`);
    }
  }
}

// ⑤ release zip（存在时校验内容；package 之前运行则跳过并提示）
const zipPath = path.join(ROOT, `release/game-recommender-v${ver}.zip`);
if (!existsSync(zipPath)) {
  console.log(`ℹ️ 未找到 ${path.basename(zipPath)}——跳过 zip 校验（发版流程 npm run package 后重跑本脚本）`);
} else {
  // P2-13：原 `unzip -l` 依赖外部命令（Windows 默认无 unzip → 发版门禁在本机
  // 必红）。改纯 JS 读 zip central directory（scripts/zip-entries.mjs），零依赖
  // 跨平台。路径统一正斜杠后断言（Windows 打包可能写反斜杠）。
  const names = listZipEntries(readFileSync(zipPath)).map((n) => n.split('\\').join('/').replace(/^\.\//, ''));
  const has = (target) => names.some((n) => n === target || n.endsWith('/' + target));
  if (!has('manifest.json')) errors.push('zip 缺 manifest.json');
  if (!has('background/service-worker.js')) errors.push('zip 缺 service-worker');
  if (names.some((n) => n.startsWith('node_modules/') || n.startsWith('tests/'))) {
    errors.push('zip 泄漏 node_modules/tests');
  }
}

/** 单调 minor 序号（major*1000+minor），用于油猴移植基线差距 / minor index */
function minorIndexOf(v) {
  const [ma, mi] = String(v).split('.').map(Number);
  return (ma || 0) * 1000 + (mi || 0);
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
