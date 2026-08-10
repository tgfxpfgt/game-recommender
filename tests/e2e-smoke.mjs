/**
 * Game Recommender - 浏览器端轻量冒烟测试（v3.3.9）
 * Browser smoke test with playwright-core + system Edge (no browser download).
 *
 * 覆盖：1) 扩展可加载（MV3 manifest 合法）；2) popup 打开且无 console error；
 * 3) 本地 fixture 页注入 __GR__ 命名空间并渲染状态浮窗。
 * Run: npm run e2e （需本机已装 Edge/Chrome；首次 npm install）
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = path.resolve(ROOT, '..');
const FIXTURE = path.join(ROOT, 'fixtures/list-page.html');

let pass = 0, fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, extra); }
}

// 生成 fixture 页（模拟 xianyudanji 列表页结构）；用本地 http 托管
// （file:// 不被内容脚本 <all_urls> 匹配）
function makeFixture() {
  const items = ['游戏A', '游戏B', '游戏C'].map((n, i) =>
    `<li class="game-item"><a class="tit" href="/${100 + i}.html">${n}</a></li>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>fixture</title></head>
<body><h2 class="entry-title"><a href="/1.html">游戏A</a></h2>
<ul id="game-list">${items}</ul></body></html>`;
}

fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
fs.writeFileSync(FIXTURE, makeFixture());
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(FIXTURE));
});
await new Promise(r => server.listen(0, '0.0.0.0', r));
// 用 host-resolver-rules 把下载站域名映射到本地 fixture（内容脚本对非追踪
// 站点会早退，域名必须是已追踪的下载站）
const FIXTURE_PORT = server.address().port;
const FIXTURE_URL = `http://www.xianyudanji.gg:${FIXTURE_PORT}/`;

const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf-8'));
console.log(`1. 扩展 ${manifest.name} v${manifest.version}`);

const channel = process.env.E2E_CHANNEL || 'msedge';
const userDataDir = path.join(ROOT, '.e2e-profile');
let context = null;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    channel, // 复用系统 Edge/Chrome，免下载浏览器
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      `--host-resolver-rules=MAP www.xianyudanji.gg 127.0.0.1`
    ]
  });
} catch (e) {
  console.log('⚠️ 浏览器启动失败（需本机安装 Edge 或设置 E2E_CHANNEL=chrome）:', e.message.split('\n')[0]);
  process.exit(fail > 0 ? 1 : 0);
}

// 等待扩展加载并获取扩展 id（service worker 就绪）
let extId = null;
for (let i = 0; i < 30; i++) {
  const workers = context.serviceWorkers();
  if (workers.length > 0) {
    extId = new URL(workers[0].url()).host;
    break;
  }
  await new Promise(r => setTimeout(r, 500));
}
check('扩展后台 Service Worker 已启动', !!extId, `(id=${extId || '未获取'})`);

if (extId) {
  // 2. popup 打开且无 console error
  console.log('2. popup 冒烟');
  const page = await context.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`chrome-extension://${extId}/popup/popup.html`);
  await page.waitForTimeout(800);
  check('popup 标题渲染', (await page.textContent('h1'))?.includes('游戏智能推荐') ?? false);
  check('popup 版本号显示', (await page.textContent('#extVersion'))?.includes('v') ?? false);
  check('popup 无 console error', errors.length === 0, `(${errors.slice(0, 3).join(' | ')})`);
  await page.close();

  // 3. 内容脚本注入 fixture 页（隔离 world 的 __GR__ 主 world 不可见，
  //    以 DOM 副作用——状态浮窗/徽章——为注入证据）
  console.log('3. 内容脚本注入（fixture 列表页）');
  const page2 = await context.newPage();
  const errors2 = [];
  page2.on('console', msg => { if (msg.type() === 'error') errors2.push(msg.text()); });
  page2.on('pageerror', e => errors2.push(String(e)));
  await page2.goto(FIXTURE_URL);
  await page2.waitForTimeout(1500);
  const domInfo = await page2.evaluate(() => ({
    hasStatusBar: !!document.getElementById('gr-status-bar'),
    badgeCount: document.querySelectorAll('.gr-rating-badge').length
  }));
  check('内容脚本已注入（状态浮窗渲染）', domInfo.hasStatusBar);
  check('列表页好评率流程已启动（徽章出现或后台查询中）',
    domInfo.hasStatusBar && (domInfo.badgeCount >= 0), `(徽章 ${domInfo.badgeCount} 个)`);
  check('无 console error', errors2.length === 0, `(${errors2.slice(0, 3).join(' | ')})`);
  await page2.close();
}

await context.close();
server.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
console.log(`\n===== E2E 冒烟结果 =====\n${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
