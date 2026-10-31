/**
 * 游戏雷达 Game Radar - E2E 冒烟：列表页注入与滚动批次 / E2E smoke: list injection & scroll
 *
 * 第五轮 B9 自 e2e-smoke.mjs 拆出：内容脚本注入（默认禁用状态浮窗 3）、
 * popup 开启后重验（3b）、扩展更新自检 toast（3c）、滚动批次按需扫描（5a，
 * 原位于详情节之后——run.mjs 保持原执行位次）。
 * state: { context, extId, check, FIXTURE_URL, FIXTURE_ROOT } — 由 run.mjs 注入。
 */
('use strict');

export async function runListChecks(state) {
  const { context, extId, check, FIXTURE_URL } = state;

  // 3. 内容脚本注入 fixture 页。v3.3.15：状态/诊断浮窗默认禁用——先验证
  //    默认不渲染，再通过 popup 开启后验证渲染与列表页流程
  console.log('3. 内容脚本注入（默认禁用状态浮窗，v3.3.15）');
  const page2 = await context.newPage();
  const errors2 = [];
  page2.on('console', (msg) => {
    if (msg.type() === 'error') errors2.push(msg.text());
  });
  page2.on('pageerror', (e) => errors2.push(String(e)));
  await page2.goto(FIXTURE_URL);
  await page2.waitForTimeout(1500);
  const domInfo = await page2.evaluate(() => ({
    hasStatusBar: !!document.getElementById('gr-status-bar'),
    badgeCount: document.querySelectorAll('.gr-rating-badge').length
  }));
  check('状态浮窗默认禁用（不渲染）', !domInfo.hasStatusBar);
  check('无 console error', errors2.length === 0, `(${errors2.slice(0, 3).join(' | ')})`);
  await page2.close();

  // 3b. 通过 popup 开启状态浮窗后重新验证
  console.log('3b. 开启状态浮窗后内容脚本注入');
  const popup2 = await context.newPage();
  await popup2.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup2.waitForTimeout(500);
  await popup2.evaluate(async () => {
    const s = (await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' })).settings;
    s.showStatusBar = true;
    s.showDebugPanel = true; // v14.8.1：诊断视图内含 DEBUG.logs（失败现场可读内容侧日志）
    await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings: s });
  });
  await popup2.close();
  const page2b = await context.newPage();
  const errors2b = [];
  page2b.on('console', (msg) => {
    if (msg.type() === 'error') errors2b.push(msg.text());
  });
  page2b.on('pageerror', (e) => errors2b.push(String(e)));
  await page2b.goto(FIXTURE_URL);
  await page2b.waitForTimeout(1500);
  const domInfo2 = await page2b.evaluate(() => ({
    hasStatusBar: !!document.getElementById('gr-status-bar'),
    badgeCount: document.querySelectorAll('.gr-rating-badge').length
  }));
  check('开启后状态浮窗渲染', domInfo2.hasStatusBar);
  // v3.4.1：原先 `badgeCount >= 0` 恒真属空断言。改轮询等待真实徽章出现：
  // 成功/未找到均渲染徽章，网络失败不阻塞（不依赖 Steam 可用性）
  let badgeCount = domInfo2.badgeCount;
  for (let i = 0; i < 120 && badgeCount === 0; i++) {
    // v10.3.0：60→120（真实网络模式 Bing 兜底链路可超 30s）
    await new Promise((r) => setTimeout(r, 500));
    badgeCount = await page2b.evaluate(() => document.querySelectorAll('.gr-rating-badge').length);
  }
  if (badgeCount === 0) {
    // v10.3.0：失败现场诊断——读取后台 runtimeLog（徽章流程卡点可见）
    // v14.8.1：page.evaluate 跑在主世界（chrome.runtime undefined）→ 改经扩展页读
    try {
      const diagPage = await context.newPage();
      await diagPage.goto(`chrome-extension://${extId}/popup/popup.html`);
      const diagLogs = await diagPage.evaluate(async () => {
        const resp = await chrome.runtime.sendMessage({ action: 'GET_RUNTIME_LOGS', limit: 300 });
        return (resp && resp.logs) || [];
      });
      await diagPage.close();
      console.log('  ⚠️ 3b 失败现场 runtimeLog:');
      for (const l of diagLogs.slice(-25))
        console.log(`    [${l.module}] ${l.level} ${String(l.message).slice(0, 130)}`);
    } catch (e) {
      console.log('  ⚠️ 诊断读取失败:', String(e).slice(0, 80));
    }
    // v14.8.1：内容侧现场——状态浮窗统计文本 + 各类徽章计数（区分"没收到
    // 推送"与"收到未渲染"；主世界读 DOM，无需 chrome API）
    const contentState = await page2b
      .evaluate(() => ({
        statusBar: (document.getElementById('gr-status-bar') || {}).textContent || '(无浮窗)',
        badgeGroups: document.querySelectorAll('.gr-rating-badge').length,
        anyBadge: document.querySelectorAll('[class*="gr-badge"]').length
      }))
      .catch((e) => ({ err: String(e).slice(0, 80) }));
    console.log('  ⚠️ 3b 内容侧现场:', JSON.stringify(contentState));
  }
  check('列表页好评率流程已启动（徽章渲染）', badgeCount > 0, `(徽章 ${badgeCount} 个)`);
  check('无 console error', errors2b.length === 0, `(${errors2b.slice(0, 3).join(' | ')})`);
  await page2b.close();

  // 3c. 扩展更新自检（v7.3.0：旧版本问题根治——版本变化提示刷新）
  console.log('3c. 扩展更新自检（版本变化 → toast 提示）');
  const updPage = await context.newPage();
  await updPage.goto(FIXTURE_URL);
  await updPage.waitForTimeout(600);
  // 预置旧版本记录（扩展页主世界才有 chrome API）→ 刷新触发更新提示
  const extPage = await context.newPage();
  await extPage.goto(`chrome-extension://${extId}/popup/popup.html`);
  await extPage.evaluate(() => chrome.storage.local.set({ extLastInjectedVersion: '0.0.0' }));
  await extPage.close();
  await updPage.reload();
  await updPage.waitForTimeout(600);
  const toastSeen = await updPage.evaluate(() => !!document.getElementById('gr-update-toast'));
  check('旧版本记录 → 更新提示条出现', toastSeen);
  // 再次加载：版本一致 → 不再提示
  await updPage.reload();
  await updPage.waitForTimeout(600);
  const toastGone = await updPage.evaluate(() => !document.getElementById('gr-update-toast'));
  check('版本一致 → 不再提示', toastGone);
  await updPage.close();
}

// 5a. 滚动批次：130 项大列表 → 滚动底部触发 IO 哨兵 → 第二批徽章（v4.1.0）
export async function runScrollBatch(state) {
  const { context, check, FIXTURE_ROOT } = state;
  console.log('5a. 滚动批次（按需扫描）');
  const page4 = await context.newPage();
  await page4.goto(`${FIXTURE_ROOT}?scroll=1`);
  await page4.waitForTimeout(1200); // 首屏批（60 项）发起
  const badgesBefore = await page4.evaluate(() => document.querySelectorAll('.gr-rating-badge').length);
  await page4.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  let badgesAfter = badgesBefore;
  for (let i = 0; i < 80 && badgesAfter <= badgesBefore; i++) {
    // v10.3.0：40→80（真实网络模式冗余）
    await new Promise((r) => setTimeout(r, 500));
    badgesAfter = await page4.evaluate(() => document.querySelectorAll('.gr-rating-badge').length);
  }
  check('滚动触发第二批徽章（按需扫描）', badgesAfter > badgesBefore, `(${badgesBefore} → ${badgesAfter})`);
  await page4.close();
}
