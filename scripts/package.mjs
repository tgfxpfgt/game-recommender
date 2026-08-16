/**
 * 游戏雷达 Game Radar - 发布打包脚本 / Release Packaging
 *
 * v8.2.0：产出商店就绪 zip（manifest 引用文件 + 运行时目录）。
 * 输出：release/game-recommender-v<版本>.zip（不入库）。
 * Run: node scripts/package.mjs
 *
 * 打包范围 = manifest.json + _locales/ + manifest 引用的全部资源 +
 * 运行时依赖目录（background/data/lib 为 SW 静态依赖）。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf-8'));
const version = manifest.version;

// 运行时固定目录（后台静态 import / 内容脚本动态 import）
const RUNTIME_DIRS = ['background', 'content', 'data', 'lib', 'shared', 'adapters', 'styles', '_locales'];
// 扩展页面目录（manifest 引用）
const PAGE_DIRS = ['popup', 'options', 'dashboard', 'freegames', 'hub', 'welcome', 'icons'];
// manifest 引用的散落文件
const MANIFEST_FILES = ['manifest.json'];

const STAGING = path.join(ROOT, 'release', `staging-v${version}`);
const OUT = path.join(ROOT, 'release', `game-recommender-v${version}.zip`);

fs.rmSync(STAGING, { recursive: true, force: true });
fs.rmSync(OUT, { force: true });
fs.mkdirSync(STAGING, { recursive: true });

// 1. 收集清单（目录递归复制 + manifest 顶层文件）
const include = [...RUNTIME_DIRS, ...PAGE_DIRS, ...MANIFEST_FILES];
for (const item of include) {
  const src = path.join(ROOT, item);
  if (!fs.existsSync(src)) {
    console.warn('  ⚠ 缺失（跳过）:', item);
    continue;
  }
  fs.cpSync(src, path.join(STAGING, item), { recursive: true });
}

// 2. 压缩（zip → powershell Compress-Archive 兜底）
function run(cmd) {
  return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}
try {
  run(`cd release/staging-v${version} && zip -qr "../game-recommender-v${version}.zip" .`);
} catch {
  try {
    run(
      `powershell -NoProfile -Command "Compress-Archive -Path 'release/staging-v${version}/*' -DestinationPath '${OUT.replace(/\\/g, '\\\\')}' -Force"`
    );
  } catch (e) {
    console.error('❌ 压缩失败（需 zip 或 PowerShell）:', String(e).slice(0, 120));
    process.exit(1);
  }
}
fs.rmSync(STAGING, { recursive: true, force: true });

const size = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`✅ 打包完成: release/game-recommender-v${version}.zip (${size} KB)`);
