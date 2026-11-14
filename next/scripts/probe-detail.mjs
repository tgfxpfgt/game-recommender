// 诊断：fixture-detail 页的浮窗挂载现场（console + DOM 状态）
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const FIXTURE = path.join(ROOT, 'e2e');

execSync('node scripts/build.mjs --variant fixture', { cwd: ROOT, stdio: 'inherit' });

const server = createServer((req, res) => {
  const file = req.url === '/detail' ? 'fixture-detail.html' : (req.url?.replace(/^\//, '') ?? '');
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

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: false,
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
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
console.log('extId:', extId);

const page = await ctx.newPage();
const events = [];
page.on('console', (m) => events.push(`[${m.type()}] ${m.text().slice(0, 150)}`));
page.on('pageerror', (e) => events.push(`[pageerror] ${String(e).slice(0, 150)}`));
page.on('requestfailed', (r) => events.push(`[reqfail] ${r.url().slice(0, 120)}`));

await page.goto(`http://www.xianyudanji.gg:${port}/detail`);
await new Promise((r) => setTimeout(r, 3000));

const dom = await page.evaluate(() => ({
  markers: document.querySelectorAll('[data-gr-detail]').length,
  floatHosts: document.querySelectorAll('.gr2-float-host').length,
  hostsHtml: [...document.querySelectorAll('.gr2-float-host')].map((h) => h.innerHTML.slice(0, 120)),
  themeInj: !!document.getElementById('gr2-theme')
}));
console.log('DOM:', JSON.stringify(dom, null, 1));
console.log('events:', events.slice(0, 12));
await ctx.close();
server.close();
process.exit(0);
