// 诊断探针：读取 chrome://extensions 面板，检查扩展是否加载/报错
import { chromium } from 'playwright-core';
import path from 'node:path';
const DIST = path.resolve(process.cwd(), 'dist');
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: false,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`]
});
const page = await ctx.newPage();
await page.goto('chrome://extensions/');
await new Promise((r) => setTimeout(r, 1200));
const info = await page.evaluate(() => {
  const mgr = document.querySelector('extensions-manager');
  if (!mgr) return 'no-manager';
  const list = mgr.shadowRoot.querySelector('extensions-item-list');
  const items = list ? list.shadowRoot.querySelectorAll('extensions-item') : [];
  return [...items].map((it) => {
    const sr = it.shadowRoot;
    return {
      name: sr.querySelector('#name')?.textContent?.trim()?.slice(0, 40),
      errors: sr.querySelector('#errors-button')?.textContent?.trim() ?? null,
      enabled: !!sr.querySelector('cr-toggle[checked]')
    };
  });
});
console.log(JSON.stringify(info, null, 1));
await ctx.close();
