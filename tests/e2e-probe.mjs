/**
 * 游戏雷达 Game Radar - E2E 诊断探针 / E2E Diagnostic Probe
 *
 * v10.6.0 E5：由临时脚本工具化为常驻诊断（参数化）——真实 Chromium 加载扩展，
 * 打开目标页后收集：扩展 id/SW 存活、内容脚本 boot 结果、浮窗/徽章渲染、
 * 页面错误、后台 runtimeLog（--dump-logs）。用于定位「E2E 过了但真机不工作」
 * 类问题；不属于门禁，不进 CI。
 * Parameterized diagnostic probe (E5): loads the extension in real Chromium,
 * opens a target page and collects extension id / SW liveness, content boot
 * result, float/badge rendering, page errors and background runtimeLog
 * (--dump-logs). Not part of the gate; for local triage only.
 *
 * 用法 / Usage:
 *   node tests/e2e-probe.mjs [--url <页面URL>] [--count 3] [--timeout 8000]
 *                            [--settings <JSON片段>] [--dump-logs] [--keep-profile]
 * 不带 --url 时使用内置 fixture（xianyudanji 域名映射 + N 个列表项）；
 * --settings 在开页前合并进扩展设置（验证条件加载等设置驱动行为，T3）。
 */
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION_DIR = ROOT;
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'list-page.html');

// --- 参数解析 / arg parsing ---
const argv = process.argv.slice(2);
function argOf(name, fallback = null) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const has = (name) => argv.includes(name);
const TARGET_URL = argOf('--url');
const COUNT = Math.max(1, Number(argOf('--count', '3')) || 3);
const WAIT_MS = Math.max(1000, Number(argOf('--timeout', '8000')) || 8000);
const DUMP_LOGS = has('--dump-logs');
const KEEP_PROFILE = has('--keep-profile');
// v10.6.0 T3：--settings 传 JSON 片段，在打开目标页前合并进设置（验证条件加载等
// 设置驱动的行为）——如 --settings '{"qrUnlockEnabled":false,"xdgridEnabled":false}'
const SETTINGS_PATCH = /** @type {any} */ (
  () => {
    const raw = argOf('--settings');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error('--settings JSON 解析失败:', String(e));
      process.exit(1);
    }
  }
)();

function makeListHtml(count) {
  const items = Array.from(
    { length: count },
    (_, i) => `<li class="game-item"><a class="tit" href="/${100 + i}.html">游戏${i + 1}</a></li>`
  ).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>probe-fixture</title></head>
<body><h2 class="entry-title"><a href="/1.html">游戏A</a></h2>
<ul id="game-list">${items}</ul></body></html>`;
}

// --- 本地 fixture 服务（仅未指定 --url 时）/ local fixture server ---
let server = null;
let targetUrl = TARGET_URL;
if (!targetUrl) {
  fs.writeFileSync(FIXTURE, makeListHtml(COUNT));
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(makeListHtml(COUNT));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  // ?e2e=1 绕过 v10.5.3 首页门控 isHomePageUrl（与 e2e-smoke 同约定）
  targetUrl = `http://www.xianyudanji.gg:${server.address().port}/?e2e=1`;
}
console.log('target:', targetUrl, `(count=${COUNT}, timeout=${WAIT_MS})`);

const userDataDir = path.join(ROOT, '.e2e-probe-profile');
if (!KEEP_PROFILE) fs.rmSync(userDataDir, { recursive: true, force: true });
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: false,
  args: [
    `--disable-extensions-except=${EXTENSION_DIR}`,
    `--load-extension=${EXTENSION_DIR}`,
    `--host-resolver-rules=MAP www.xianyudanji.gg 127.0.0.1`
  ]
});

// --- SW 存活 / extension id ---
let extId = null;
for (let i = 0; i < 40 && !extId; i++) {
  const sw = (await context.serviceWorkers())[0];
  if (sw) extId = new URL(sw.url()).host;
  else await new Promise((r) => setTimeout(r, 250));
}
console.log('extId:', extId || '(未发现 Service Worker —— 扩展加载失败)');
if (!extId) {
  await context.close();
  if (server) server.close();
  process.exit(1);
}

// --- 设置注入（T3：--settings 在开页前生效，条件加载按新设置决策）---
// Settings injection (T3): applied before the target page opens so conditional
// loading decisions use the patched values.
if (SETTINGS_PATCH) {
  const popup0 = await context.newPage();
  await popup0.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup0.waitForTimeout(500);
  const applied = await popup0.evaluate(async (patch) => {
    const r = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    const s = Object.assign({}, r && r.settings, patch);
    await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings: s });
    return Object.keys(patch);
  }, SETTINGS_PATCH);
  console.log('settings patched:', JSON.stringify(applied));
  await popup0.close();
}

// --- 打开目标页并收集信号 / open target & collect signals ---
const page = await context.newPage();
// v10.6.0 T3：内容脚本 boot 状态在隔离世界（主世界 evaluate 读不到）——改用
// 网络层信号：记录扩展模块文件的实际加载（条件加载 = 禁用模块零请求，权威证据）
// Boot state lives in the isolated world (not visible to main-world evaluate);
// use the network layer instead: record which extension modules actually load
// (conditional loading = zero requests for disabled modules).
const moduleRequests = [];
page.on('request', (req) => {
  const u = req.url();
  if (u.startsWith(`chrome-extension://${extId}/`)) {
    moduleRequests.push(u.replace(`chrome-extension://${extId}/`, ''));
  }
});
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') pageErrors.push('[' + m.type() + '] ' + m.text().slice(0, 220));
});
await page.goto(targetUrl);
await page.waitForTimeout(WAIT_MS);

const probe = await page.evaluate(() => {
  const grStatusBar = document.getElementById('gr-status-bar');
  const grFloat = document.querySelector('[id^="gr-float"], [class*="gr-float"]');
  const badges = document.querySelectorAll('.gr-badge').length;
  return {
    hasStatusBar: !!grStatusBar,
    hasFloat: !!grFloat,
    badgeCount: badges,
    title: document.title
  };
});
console.log('page signals:', JSON.stringify(probe));
console.log('module requests:', JSON.stringify(moduleRequests.filter((m) => m.startsWith('content/')).sort()));

const bootInfo = await page.evaluate(async () => {
  if (!window.__grBootPromise) return { noBoot: true };
  try {
    const r = await window.__grBootPromise;
    return {
      ok: true,
      modules: Object.keys(r.M || {}).length,
      moduleKeys: Object.keys(r.M || {}).sort(), // v10.6.0 T3：模块键全量（验证条件加载）
      settingsEnabled: r.settings && r.settings.enabled,
      showStatusBar: r.settings && r.settings.showStatusBar
    };
  } catch (e) {
    return { bootRejected: String(e).slice(0, 200) };
  }
});
console.log('boot:', JSON.stringify(bootInfo));
console.log('page errors:', JSON.stringify(pageErrors.slice(0, 5)));

// --- 后台可达性 + runtimeLog / background liveness + logs ---
const popup = await context.newPage();
await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
await popup.waitForTimeout(800);
const bg = await popup.evaluate(async () => {
  try {
    const r = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    const out = { ping: true, enabled: !!(r && r.settings && r.settings.enabled) };
    try {
      const logs = await chrome.runtime.sendMessage({ action: 'GET_RUNTIME_LOGS', limit: 30 });
      out.logs = (logs && logs.logs) || logs || [];
    } catch (e) {
      out.logsError = String(e).slice(0, 120);
    }
    return out;
  } catch (e) {
    return { ping: false, error: String(e).slice(0, 120) };
  }
});
console.log('background ping:', JSON.stringify({ ping: bg.ping, enabled: bg.enabled }));
if (DUMP_LOGS) {
  const logs = bg.logs || [];
  console.log('--- runtimeLog（最近 ' + logs.length + ' 条）---');
  for (const l of logs) {
    const t = l && (l.t || l.time || l.ts);
    console.log(
      `[${t || '?'}] ${l && l.tag ? l.tag : '?'}: ${(l && (l.msg || l.message)) || JSON.stringify(l).slice(0, 160)}`
    );
  }
}
await popup.close();
await context.close();
if (server) server.close();
if (!KEEP_PROFILE) fs.rmSync(userDataDir, { recursive: true, force: true });
process.exit(0);
