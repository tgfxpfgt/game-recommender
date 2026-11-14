// @ts-strict
/**
 * game-radar v2 — 构建器
 * Builds: SW (esm) + content (iife) + pages (iife each) + generated manifest,
 * popup.html, content.css (theme vars) — dist/ is a complete loadable extension.
 * 零手写 JSON/HTML/CSS：全部由 typed 源生成。
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const LEGACY_ROOT = path.resolve(ROOT, '..'); // 旧树根（图标资产复制源）

const common = {
  bundle: true,
  minify: false, // alpha：保持可调试
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'silent',
  charset: 'utf8',
  target: ['chrome109']
};

async function buildOne(entry, outfile, format, extra = {}) {
  const res = await esbuild.build({
    ...common,
    entryPoints: [path.join(ROOT, entry)],
    outfile: path.join(DIST, outfile),
    format,
    jsx: 'automatic',
    jsxImportSource: 'preact',
    write: false,
    ...extra
  });
  if (res.errors.length > 0) {
    throw new Error(`${entry} 构建失败: ${res.errors.map((e) => e.text).join('; ')}`);
  }
  fs.mkdirSync(path.dirname(path.join(DIST, outfile)), { recursive: true });
  fs.writeFileSync(path.join(DIST, outfile), res.outputFiles[0].text, 'utf-8');
  console.log(`✓ ${outfile}（${res.outputFiles[0].text.length}B）`);
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  // Chrome manifest version 只接受 1-4 段纯整数（semver 预发布后缀非法）
  const version = pkg.version.split('-')[0];
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  await buildOne('src/background/entry.ts', 'background/service-worker.js', 'esm');
  await buildOne('src/content/entry.ts', 'content/content.js', 'iife');
  await buildOne('src/pages/popup/main.tsx', 'pages/popup/popup.js', 'iife');

  // content.css 由 token 单源生成（v15 生成器替代手写 CSS）
  const { themeCss } = await import('../src/ui/tokens.ts');
  fs.writeFileSync(path.join(DIST, 'content.css'), themeCss() + '\n', 'utf-8');
  console.log('✓ content.css（token 生成）');

  // manifest 由 typed 模板生成
  const { buildManifest } = await import('../src/manifest/manifest.template.ts');
  const manifest = buildManifest(version);
  fs.writeFileSync(path.join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log('✓ manifest.json（模板生成）');

  // popup.html（骨架极简，样式走 content.css vars）
  fs.mkdirSync(path.join(DIST, 'pages/popup'), { recursive: true });
  fs.writeFileSync(
    path.join(DIST, 'pages/popup/popup.html'),
    `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="../../content.css" />
  <style>body { background: var(--gr-dark-bg); margin: 0; }</style>
</head>
<body>
  <div id="gr2-root"></div>
  <script src="popup.js"></script>
</body>
</html>
`,
    'utf-8'
  );
  console.log('✓ pages/popup/popup.html');

  // 图标资产：功能等价可复用旧 PNG（美术替换批次再重绘）
  const legacyIcons = path.join(LEGACY_ROOT, 'icons');
  if (fs.existsSync(legacyIcons)) {
    fs.mkdirSync(path.join(DIST, 'icons'), { recursive: true });
    for (const f of fs.readdirSync(legacyIcons))
      fs.copyFileSync(path.join(legacyIcons, f), path.join(DIST, 'icons', f));
    console.log('✓ icons/（旧资产复用，美术批次重绘）');
  }

  // _locales（chrome.i18n 仅承载显示名）
  fs.mkdirSync(path.join(DIST, '_locales/zh_CN'), { recursive: true });
  fs.writeFileSync(
    path.join(DIST, '_locales/zh_CN/messages.json'),
    JSON.stringify(
      {
        extName: { message: '游戏雷达 Game Radar' },
        extDesc: { message: '下载站 Steam 好评率徽章、限免监控与游戏推荐' }
      },
      null,
      2
    ) + '\n',
    'utf-8'
  );

  // 自检
  const must = [
    'dist/manifest.json',
    'dist/background/service-worker.js',
    'dist/content/content.js',
    'dist/pages/popup/popup.html',
    'dist/pages/popup/popup.js',
    'dist/content.css'
  ];
  const missing = must.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length > 0) throw new Error('dist 缺产物: ' + missing.join(', '));
  console.log(`✅ v2 build 完成 → dist/`);
}

await main();
