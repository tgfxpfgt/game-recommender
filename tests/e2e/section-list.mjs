/**
 * 游戏雷达 Game Radar - E2E 冒烟：列表页注入与滚动批次 / E2E smoke: list injection & scroll
 *
 * 第五轮 B9 自 e2e-smoke.mjs 拆出：内容脚本注入（默认禁用状态浮窗 3）、
 * popup 开启后重验（3b）、扩展更新自检 toast（3c）、滚动批次按需扫描（5a，
 * 原位于详情节之后——run.mjs 保持原执行位次）。
 * state: { context, extId, check, FIXTURE_URL, FIXTURE_ROOT } — 由 run.mjs 注入。
 */
('use strict');

import { withTimeout, isTimeout } from './helpers.mjs';

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
    // v14.8.1：关闭评分过滤/重排——前序 2b2 节保存的过滤器（阈值40+AND）会
    // 持续到本节把有评分项全部移出 DOM（MOCK fixture 无近期评测 → AND 恒
    // false）；本节断言徽章渲染而非过滤语义，显式关闭保持确定性。
    s.enableRatingFilter = false;
    s.enableRecentFilter = false;
    s.enableSortByRating = false;
    await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings: s });
    // v14.11 B1：保存生效确认轮询——重负载下 SAVE→持久化链（flush 队列）可能
    // 慢于下一个页面的打开，content 侧 GET_SETTINGS 读到旧值 → 状态浮窗不渲染
    //（3b 竞态的根因；FaceFusion 把毫秒窗口放大到秒级）
    for (let i = 0; i < 25; i++) {
      const back = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
      const cur = back && back.settings;
      if (cur && cur.showStatusBar === true && cur.showDebugPanel === true && cur.enableRatingFilter === false) break;
      await new Promise((r) => setTimeout(r, 200));
    }
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
// v14.28.1：本节的 newPage/goto/evaluate 全部经 withTimeout 兜底——SW 批量
// 评分饱和期 Chromium 主进程会被拖到 100% CPU（实测），CDP 不回包时裸
// await 会白等到 120s 节超时并丢失现场（诊断页也一起挂死）。
// All browser-touching awaits here are timeout-guarded: when the SW batch
// starves the browser process, bare awaits burn the full 120s section timeout
// and lose the failure context (the diagnostics page hangs too).
export async function runScrollBatch(state) {
  const { context, check, extId, FIXTURE_ROOT } = state;
  console.log('5a. 滚动批次（按需扫描）');
  const page4 = await withTimeout(context.newPage(), 15000, '5a newPage');
  if (isTimeout(page4)) {
    check('滚动触发第二批徽章（按需扫描）', false, '(新页创建超时 15s——浏览器/CDP 无响应，未进入滚动)');
    return;
  }
  const nav = await withTimeout(page4.goto(`${FIXTURE_ROOT}?scroll=1`, { timeout: 15000 }), 20000, '5a goto');
  if (isTimeout(nav)) {
    check('滚动触发第二批徽章（按需扫描）', false, '(滚动页打开超时 20s——浏览器/CDP 无响应)');
    await withTimeout(
      page4.close().catch(() => {}),
      5000,
      '5a close'
    );
    return;
  }
  const ev = (fn, label, ms = 8000) => withTimeout(page4.evaluate(fn), ms, label);
  await page4.waitForTimeout(1200); // 首屏批（60 项）发起
  const badgesBefore0 = await ev(() => document.querySelectorAll('.gr-rating-badge').length, '5a badgesBefore');
  if (isTimeout(badgesBefore0)) {
    check('滚动触发第二批徽章（按需扫描）', false, '(页面求值超时 8s——内容脚本/渲染进程无响应)');
    await withTimeout(
      page4.close().catch(() => {}),
      5000,
      '5a close'
    );
    return;
  }
  const badgesBefore = badgesBefore0;
  await ev(() => window.scrollTo(0, document.body.scrollHeight), '5a scrollTo');
  let badgesAfter = badgesBefore;
  // v14.10.1：等待轮数可配置（E2E_SCROLL_WAIT_ROUNDS，默认 80 = 40s）——
  // 130 项全 miss 链 ~700 请求经 150ms 限速单趟即超 40s（重负载机更甚），
  // 第二批徽章出现在 1-2 波推送后；提额消除假红（与 GR_SIM_SIGNAL_TIMEOUT_MS
  // /E2E_SECTION_TIMEOUT_MS 同一抗负载家族）。
  const scrollWaitRounds = Number(process.env.E2E_SCROLL_WAIT_ROUNDS) || 80;
  let pageResponsive = true;
  for (let i = 0; i < scrollWaitRounds && badgesAfter <= badgesBefore; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const n = await ev(() => document.querySelectorAll('.gr-rating-badge').length, '5a loop');
    if (isTimeout(n)) {
      pageResponsive = false;
      console.log('  ⚠️ 5a 滚动等待中断：页面求值超时 8s（渲染进程/内容脚本无响应）');
      break;
    }
    badgesAfter = n;
  }
  if (badgesAfter <= badgesBefore) {
    // v14.8.1：失败现场诊断（与 3b 同构——runtimeLog + 内容侧计数）
    // v14.28.1：页面无响应时跳过诊断（诊断页同样会挂在 CDP 上，白等 120s）
    if (pageResponsive) {
      try {
        const diagPage = await withTimeout(context.newPage(), 10000, '5a diag newPage');
        if (isTimeout(diagPage)) throw new Error('诊断页创建超时 10s（浏览器无响应）');
        const diagNav = await withTimeout(
          diagPage.goto(`chrome-extension://${extId}/popup/popup.html`, { timeout: 10000 }),
          15000,
          '5a diag goto'
        );
        if (isTimeout(diagNav)) throw new Error('诊断页打开超时 15s（浏览器无响应）');
        const diagData = await withTimeout(
          diagPage.evaluate(async () => {
            const resp = await chrome.runtime.sendMessage({ action: 'GET_RUNTIME_LOGS', limit: 300 });
            const logs = (resp && resp.logs) || [];
            const qs = await chrome.runtime.sendMessage({ action: 'GET_RATINGS_QUEUE_STATUS' }).catch(() => null);
            return { logs, qs, lifecycle: logs.filter((l) => /评分任务|评分波次/.test(l.message || '')) };
          }),
          15000,
          '5a diag eval'
        );
        if (isTimeout(diagData)) throw new Error('诊断读取超时 15s（SW 无应答）');
        await withTimeout(
          diagPage.close().catch(() => {}),
          5000,
          '5a diag close'
        );
        console.log('  ⚠️ 5a 队列快照:', JSON.stringify(diagData.qs));
        console.log('  ⚠️ 5a 生命周期:', JSON.stringify(diagData.lifecycle).slice(0, 800));
        const diagLogs = diagData.logs;
        console.log('  ⚠️ 5a 失败现场 runtimeLog:');
        for (const l of diagLogs.slice(-20))
          console.log(`    [${l.module}] ${l.level} ${String(l.message).slice(0, 130)}`);
      } catch (e) {
        console.log('  ⚠️ 5a 诊断读取失败:', String(e).slice(0, 80));
      }
    }
    const contentState = pageResponsive
      ? await ev(
          () => ({
            statusBar: (document.getElementById('gr-status-bar') || {}).textContent || '(无浮窗)',
            working: document.querySelectorAll('.gr-working-badge').length,
            badges: document.querySelectorAll('.gr-rating-badge').length
          }),
          '5a contentState'
        ).catch((e) => ({ err: String(e).slice(0, 80) }))
      : { err: '页面无响应，跳过现场读取' };
    console.log('  ⚠️ 5a 内容侧现场:', JSON.stringify(contentState));
  }
  check('滚动触发第二批徽章（按需扫描）', badgesAfter > badgesBefore, `(${badgesBefore} → ${badgesAfter})`);
  await withTimeout(
    page4.close().catch(() => {}),
    5000,
    '5a close'
  );
}
