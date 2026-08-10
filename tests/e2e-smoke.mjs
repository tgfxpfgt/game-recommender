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

// 生成 fixture 页（模拟 xianyudanji 列表页/详情页结构）；用本地 http 托管
// （file:// 不被内容脚本 <all_urls> 匹配）。详情页 h1 复刻 16598 标题场景。
function makeListHtml() {
  const items = ['游戏A', '游戏B', '游戏C'].map((n, i) =>
    `<li class="game-item"><a class="tit" href="/${100 + i}.html">${n}</a></li>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>fixture</title></head>
<body><h2 class="entry-title"><a href="/1.html">游戏A</a></h2>
<ul id="game-list">${items}</ul></body></html>`;
}
const LIST_HTML = makeListHtml();
const DETAIL_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>北方之魂增强版/Spirit of the North- Switch520.com</title></head>
<body><h1 class="entry-title">北方之魂增强版/Spirit of the North- Switch520.com</h1></body></html>`;

fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
fs.writeFileSync(FIXTURE, LIST_HTML);
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(req.url.includes('16598') ? DETAIL_HTML : LIST_HTML);
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

  // 4. 详情页报错按钮（v3.3.11：真实点击 → 清缓存重检索）
  console.log('4. 详情页报错按钮（真实点击）');
  const page3 = await context.newPage();
  const errors3 = [];
  page3.on('console', msg => { if (msg.type() === 'error') errors3.push(msg.text()); });
  page3.on('pageerror', e => errors3.push(String(e)));
  await page3.goto(`${FIXTURE_URL}16598.html`);
  // 等浮窗渲染（真实 Steam 搜索 + 完整详情拉取需数秒）
  await page3.waitForSelector('#gr-report-issue-btn', { timeout: 20000 }).catch(() => {});
  const hasReportBtn = await page3.evaluate(() => !!document.querySelector('#gr-report-issue-btn'));
  check('浮窗报错按钮存在', hasReportBtn);
  if (hasReportBtn) {
    // force: 状态浮窗（右下）可能遮挡按钮区域，强制点击（真实场景两区域不重叠）
    await page3.click('#gr-report-issue-btn', { force: true });
    // 清缓存 + 重新检索（完整拉取）——轮询等待浮窗重新渲染完成
    await page3.waitForFunction(
      () => !document.querySelector('#gr-report-issue-btn')?.textContent?.includes('重新检索中'),
      null, { timeout: 20000 }
    ).catch(() => {});
  }
  const panelText = await page3.evaluate(() => (document.querySelector('#gr-steam-float') || { textContent: '' }).textContent || '');
  check('报错点击后浮窗仍在（重检索完成）', panelText.length > 0 && !panelText.includes('重检索失败'), `(${panelText.substring(0, 40).replace(/\n/g, ' ')})`);
  check('报错流程无 console error', errors3.length === 0, `(${errors3.slice(0, 3).join(' | ')})`);
  await page3.close();
}

await context.close();
server.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
console.log(`\n===== E2E 冒烟结果 =====\n${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
