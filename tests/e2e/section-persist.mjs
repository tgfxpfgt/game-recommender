import { chromium } from 'playwright-core';
/**
 * 游戏雷达 Game Radar - E2E 冒烟：重启持久化 / E2E smoke: restart persistence
 *
 * 第五轮 B9 自 e2e-smoke.mjs 拆出（v6.4.14 回归：OPFS move() 对已存在目标
 * 不替换的 bug 曾致所有模块写入从未落盘——保存后内存看似成功、重启全丢）。
 * 保存 → 关闭浏览器 → 同一 profile 重启——**重赋 state.context/state.extId**，
 * 其后节（custom-site）使用新浏览器实例。
 * Saves a setting, closes the browser and relaunches on the same profile,
 * reassigning state.context/state.extId for the sections that follow.
 * state: { context, extId, check, userDataDir } — 由 run.mjs 注入。
 */
('use strict');

import { launchOpts } from './helpers.mjs';

export async function runPersist(state) {
  const { check, userDataDir } = state;
  let context = state.context;
  const extId = state.extId;

  // 6. 重启持久化（v6.4.14 回归：OPFS move() 对已存在目标不替换的 bug
  // 曾致所有模块写入从未落盘——保存后内存看似成功、重启全丢；
  // 本段必须与保存配合：保存 → 关闭浏览器 → 同一 profile 重启验证）
  console.log('6. 重启持久化（保存 → 关闭浏览器 → 同一 profile 重启）');
  const persistPage = await context.newPage();
  await persistPage.goto(`chrome-extension://${extId}/options/options.html`);
  await persistPage.waitForTimeout(1200);
  await persistPage.evaluate(() => {
    document.querySelector('.gr-nav-item[data-panel="filters"]').click();
    document.getElementById('minRating').value = 55;
    document.getElementById('minRating').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('saveBtn').click();
  });
  await persistPage.waitForTimeout(2000);
  await persistPage.close();
  // 关闭浏览器（持久 context 关闭即浏览器退出）
  await context.close().catch(() => {});
  context = null;
  state.context = null;
  await new Promise((r) => setTimeout(r, 1000));
  // 同一 profile 重启
  context = await chromium.launchPersistentContext(userDataDir, launchOpts());
  state.context = context;
  let extId2 = null;
  for (let i = 0; i < 30; i++) {
    const workers = context.serviceWorkers();
    if (workers.length > 0) {
      extId2 = new URL(workers[0].url()).host;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  state.extId = extId2;
  const persistPage2 = await context.newPage();
  await persistPage2.goto(`chrome-extension://${extId2}/options/options.html`);
  await persistPage2.waitForTimeout(1500);
  const persisted = await persistPage2.evaluate(() => {
    document.querySelector('.gr-nav-item[data-panel="filters"]').click();
    return Number(document.getElementById('minRating').value);
  });
  check('重启后过滤设置持久化（写盘成功）', persisted === 55, `(got ${persisted})`);
  await persistPage2.close();
}
