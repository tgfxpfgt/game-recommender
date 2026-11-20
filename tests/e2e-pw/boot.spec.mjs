import { test } from './extension-fixture.mjs';
import { expect } from '@playwright/test';
/**
 * 游戏雷达 Game Radar - Playwright E2E boot 冒烟（B4 阶段 1）
 *
 * 移植自 tests/e2e/section-install.mjs + section-pages.mjs 的安装/页面族最小
 * 面（SW 装载/popup 冒烟/options 零 console error/fixture 页装载）；深度列表
 * /详情/滚动批次语义留在现役管线，B4 阶段 2 逐节移植。
 */

test('MV3 SW 装载且 API 状态可应答（安装冒烟）', async ({ ext }) => {
  const { sw } = ext;
  expect(sw, 'service-worker.js 应在 30s 内装载').not.toBeNull();
  const version = await sw.evaluate(() => chrome.runtime.getManifest().version);
  expect(version).toMatch(/^\d+\.\d+\.\d+/);
});

test('popup 冒烟：标题/版本号渲染', async ({ ext }) => {
  const { context, extId } = ext;
  expect(extId, 'extId 应已解析').toBeTruthy();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/popup/popup.html`);
  await expect(page.locator('h1')).toHaveText(/游戏智能推荐/);
  await expect(page.locator('#extVersion')).toContainText('v');
  await page.close();
});

test('options 页装载零 console error', async ({ ext }) => {
  const { context, extId } = ext;
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(`chrome-extension://${extId}/options/options.html`);
  await page.waitForTimeout(1000); // 装载链完成窗（options 异步初始化）
  expect(consoleErrors, `console error 应为空:\n  ${consoleErrors.join('\n  ')}`).toEqual([]);
  await page.close();
});

test('fixture 列表页装载零 console error（内容脚本环境）', async ({ ext, fixture }) => {
  const { context } = ext;
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(fixture.FIXTURE_URL);
  await page.waitForTimeout(2000); // tracker 动态装载链完成窗
  expect(consoleErrors, `console error 应为空:\n  ${consoleErrors.join('\n  ')}`).toEqual([]);
  await page.close();
});
