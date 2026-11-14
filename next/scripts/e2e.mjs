// @ts-strict
/**
 * game-radar v2 — E2E（真实 Chromium，fixture 列表页）
 * Proves the vertical slice end-to-end: build output loads, content script
 * scans the fixture listing, typed messaging reaches the SW, Preact badges
 * render with expected three-state semantics.
 */
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const FIXTURE = path.join(ROOT, 'e2e');

// 前置构建：e2e 变体（fixture 供配商）——确定性徽章断言的前提
console.log('build (variant=fixture)…');
execSync('node scripts/build.mjs --variant fixture', { cwd: ROOT, stdio: 'inherit' });

if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
  console.error('❌ 缺 dist——先 npm run build');
  process.exit(1);
}

// fixture HTTP 服务（localhost 列表页）
const server = createServer((req, res) => {
  const file = req.url === '/listing' ? 'fixture-listing.html' : (req.url?.replace(/^\//, '') ?? '');
  const abs = path.join(FIXTURE, file);
  if (fs.existsSync(abs)) {
    res.writeHead(200, {
      'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream'
    });
    res.end(fs.readFileSync(abs));
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
console.log(`fixture server: http://127.0.0.1:${port}/listing`);

// 与旧树 helper 同款 launch（channel 'chromium' = playwright 自带 chromium——
// 本机已实证可用；executablePath 显式指 1243 反而 headful 挂起，原因未定位）
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: false,
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    // fixture 页经域名映射走 xianyudanji.gg（content_scripts matches 内——
    // 127.0.0.1 不在 matches，直接导航 content script 不注入）
    `--host-resolver-rules=MAP www.xianyudanji.gg 127.0.0.1`
  ]
});

let extId = '';
for (let i = 0; i < 40; i++) {
  const workers = ctx.serviceWorkers();
  if (workers.length > 0) {
    extId = workers[0].url().match(/chrome-extension:\/\/([^/]+)\//)?.[1] ?? '';
    if (extId) break;
  }
  await new Promise((r) => setTimeout(r, 500));
}
if (!extId) {
  console.error('❌ SW 未唤醒（扩展加载失败）');
  await ctx.close();
  server.close();
  process.exit(1);
}
console.log(`extension: ${extId}`);

const page = await ctx.newPage();
const failures = [];
page.on('pageerror', (e) => failures.push('pageerror: ' + String(e).slice(0, 120)));

await page.goto(`http://www.xianyudanji.gg:${port}/listing`);
await page.waitForSelector('.gr2-badge-host', { timeout: 20000 });
await new Promise((r) => setTimeout(r, 800)); // 渲染稳定

// 断言集
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` (${detail})`}`);
};

const badges = await page.$$eval('.gr2-badge-host .gr-badge', (els) => els.map((e) => e.textContent?.trim() ?? ''));
check('徽章数量 = 条目数', badges.length === 8, `got ${badges.length}`);

const joined = badges.join('\n');
check(
  'Steam 命中徽章（艾尔登法环 94%）',
  badges.some((b) => b.includes('94%')),
  joined.slice(0, 200)
);
check(
  'Steam 命中徽章（星露谷 98%）',
  badges.some((b) => b.includes('98%')),
  ''
);
check('推测徽章标注（suspected）', joined.includes('推测'), '');
check(
  '模拟器平台徽章',
  badges.some((b) => b.includes('模拟器')),
  ''
);
check(
  '未找到徽章（三态：确认无）',
  badges.some((b) => b.includes('未找到')),
  ''
);

const themeApplied = await page.evaluate(() => !!document.getElementById('gr2-theme'));
check('主题 token 注入', themeApplied, '');

const consoleClean = failures.length === 0;
check('页面零 JS 错误', consoleClean, failures.join(' | ').slice(0, 200));

const passed = checks.filter((c) => c.ok).length;
console.log(`\n${passed}/${checks.length} 通过`);

await ctx.close();
server.close();
if (passed !== checks.length) process.exit(1);
console.log('✅ v2 垂直切片 E2E 全绿');
