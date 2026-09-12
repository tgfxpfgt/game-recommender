/**
 * 诊断探针（临时）：SW 启动/内容注入/错误定位。
 */
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const ROOT = 'F:/data/browser extension/game-recommender';
const EXTENSION_DIR = ROOT;
const FIXTURE = path.join(ROOT, 'tests/fixtures/list-page.html');

function makeListHtml(count = 3) {
  const items = Array.from(
    { length: count },
    (_, i) => `<li class="game-item"><a class="tit" href="/${100 + i}.html">游戏${i + 1}</a></li>`
  ).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>fixture</title></head>
<body><h2 class="entry-title"><a href="/1.html">游戏A</a></h2>
<ul id="game-list">${items}</ul></body></html>`;
}
fs.writeFileSync(FIXTURE, makeListHtml());
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(makeListHtml());
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const FIXTURE_URL = `http://www.xianyudanji.gg:${server.address().port}/`;

const userDataDir = path.join(ROOT, '.e2e-probe-profile');
fs.rmSync(userDataDir, { recursive: true, force: true });
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: false,
  args: [
    `--disable-extensions-except=${EXTENSION_DIR}`,
    `--load-extension=${EXTENSION_DIR}`,
    `--host-resolver-rules=MAP www.xianyudanji.gg 127.0.0.1`
  ]
});
let extId = null;
for (let i = 0; i < 40 && !extId; i++) {
  const sw = (await context.serviceWorkers())[0];
  if (sw) extId = new URL(sw.url()).host;
  else await new Promise((r) => setTimeout(r, 250));
}
console.log('extId:', extId);

// 复刻 E2E 3b：popup 开启 showStatusBar → 新开列表页 → 浮窗应渲染
const popup0 = await context.newPage();
await popup0.goto(`chrome-extension://${extId}/popup/popup.html`);
await popup0.waitForTimeout(500);
await popup0.evaluate(async () => {
  const s = (await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' })).settings;
  s.showStatusBar = true;
  await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings: s });
});
await popup0.close();
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') pageErrors.push('[' + m.type() + '] ' + m.text().slice(0, 220));
});
await page.goto(FIXTURE_URL);
await page.waitForTimeout(8000);
const hasStatusBar = await page.evaluate(() => !!document.getElementById('gr-status-bar'));
console.log('status bar (after enable):', hasStatusBar);
const bootInfo = await page.evaluate(async () => {
  if (!window.__grBootPromise) return { noBoot: true };
  try {
    const r = await window.__grBootPromise;
    return {
      ok: true,
      modules: Object.keys(r.M || {}).length,
      settingsEnabled: r.settings && r.settings.enabled,
      showStatusBar: r.settings && r.settings.showStatusBar
    };
  } catch (e) {
    return { bootRejected: String(e).slice(0, 200) };
  }
});
console.log('boot:', JSON.stringify(bootInfo));
console.log('page errors:', JSON.stringify(pageErrors.slice(0, 3)));

// SW 控制台错误抓不到——改从扩展页发 GET_SETTINGS 看后台是否响应
const popup = await context.newPage();
await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
await popup.waitForTimeout(800);
const ping = await popup.evaluate(async () => {
  try {
    const r = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    return { ok: true, enabled: r && r.settings && r.settings.enabled };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) };
  }
});
console.log('background ping:', JSON.stringify(ping));
await popup.close();
await context.close();
server.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
process.exit(0);
