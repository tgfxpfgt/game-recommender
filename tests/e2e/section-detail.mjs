/**
 * 游戏雷达 Game Radar - E2E 冒烟：详情页报错流程 / E2E smoke: detail report flow
 *
 * 第五轮 B9 自 e2e-smoke.mjs 拆出（v3.3.11 真实点击报错 → 清缓存重检索；
 * v5.1.0 E2E_FAST 离线跳过 / v7.3.0 E2E_MOCK=1 时经录制 fixture 照跑）。
 * 返回 false = 触发 runner 断链（原 runChecks 的 return 语义：跳过其后全部节）。
 * Returns false to stop the pipeline (was: return inside runChecks).
 * state: { context, extId, check, MOCK, FAST, FIXTURE_ROOT } — 由 run.mjs 注入。
 */

import { withTimeout, isTimeout } from './helpers.mjs';

export async function runDetail(state) {
  const { context, check, MOCK, FAST, FIXTURE_ROOT } = state;

  // 4. 详情页报错按钮（v3.3.11：真实点击 → 清缓存重检索）
  // v5.1.0：E2E_FAST 离线模式跳过本段（依赖真实 Steam 网络）
  // v7.3.0：E2E_MOCK=1 时本段也跑（网络来自录制 fixture，离线可复现）
  console.log(FAST && !MOCK ? '4. 详情页报错按钮（E2E_FAST 离线跳过）' : '4. 详情页报错按钮（真实点击/录制回放）');
  const page3 = await context.newPage();
  const errors3 = [];
  page3.on('console', (msg) => {
    if (msg.type() === 'error') errors3.push(msg.text());
  });
  page3.on('pageerror', (e) => errors3.push(String(e)));
  if (FAST && !MOCK) {
    check('E2E_FAST 离线模式跳过真实网络段', true);
    await page3.close();
    return false; // 断链：其后节全部跳过（原 runChecks return 语义）
  }
  await page3.goto(`${FIXTURE_ROOT}16598.html`);
  // 等浮窗渲染（真实 Steam 搜索 + 完整详情拉取需数秒）
  // v14.24.0：动作按钮迁入 ⚙ 菜单——数据就绪信号改 gr-detail-title，
  // 重检索动作经菜单按钮 + data-menu-action 菜单项触发
  await page3.waitForSelector('#gr-steam-float .gr-detail-title', { timeout: 20000 }).catch(() => {});
  const hasReportBtn = await page3.evaluate(() => !!document.querySelector('#gr-steam-float .gr-float-menu-btn'));
  if (!hasReportBtn) {
    // v14.11 B1：失败现场诊断（与 3b/5a 同构——runtimeLog 经扩展页读取）
    try {
      const { extId } = state;
      // v14.28.1：SW 饱和期 newPage 可能永久挂起——必须加超时兜底
      const diagPage = await withTimeout(context.newPage(), 10000, '4 diag newPage');
      if (isTimeout(diagPage)) throw new Error('诊断页创建超时 10s（浏览器无响应）');
      const diagNav = await withTimeout(
        diagPage.goto(`chrome-extension://${extId}/popup/popup.html`, { timeout: 10000 }),
        15000,
        '4 diag goto'
      );
      if (isTimeout(diagNav)) throw new Error('诊断页打开超时 15s（浏览器无响应）');
      const diagLogs = await withTimeout(
        diagPage.evaluate(async () => {
          const timeout = new Promise((resolve) =>
            setTimeout(() => resolve(['(SW 3s 无响应——疑似事件循环阻塞)']), 3000)
          );
          const resp = await Promise.race([
            chrome.runtime.sendMessage({ action: 'GET_RUNTIME_LOGS', limit: 300 }).then((x) => (x && x.logs) || []),
            timeout
          ]);
          return resp;
        }),
        8000,
        '4 diag eval'
      );
      if (isTimeout(diagLogs)) throw new Error('诊断读取超时 8s（SW 无应答）');
      await withTimeout(
        diagPage.close().catch(() => {}),
        5000,
        '4 diag close'
      );
      console.log('  ⚠️ 4 失败现场 runtimeLog:', JSON.stringify(diagLogs.slice(-30)).slice(0, 1500));
    } catch (e) {
      console.log('  ⚠️ 4 诊断读取失败:', String(e).slice(0, 80));
    }
  }
  check('浮窗 ⚙ 菜单存在（动作项已迁入菜单 v14.24.0）', hasReportBtn);
  // v3.3.14：主内容区图（1213700）应优先于侧边推荐图（2001760）
  const shownText = await page3.evaluate(
    () => (document.querySelector('#gr-steam-float') || { textContent: '' }).textContent || ''
  );
  check(
    '浮窗显示主内容区游戏（非侧边推荐）',
    (shownText.includes('1213700') || shownText.includes('Spirit of the North')) && !shownText.includes('2001760'),
    `(${shownText.substring(0, 50).replace(/\n/g, ' ')})`
  );
  if (hasReportBtn) {
    // force: 状态浮窗（右下）可能遮挡按钮区域，强制点击（真实场景两区域不重叠）
    await page3.click('#gr-steam-float .gr-float-menu-btn', { force: true });
    await page3.click('#gr-steam-float [data-menu-action="steam-research"]', { force: true });
    // 清缓存 + 重新检索：同 appid → 自动手动选择；不同 appid → 渲染纠正结果
    await page3
      .waitForFunction(
        () => {
          const item = document.querySelector('#gr-steam-float [data-menu-action="steam-research"]');
          return !item || !item.textContent.includes('重新检索中');
        },
        null,
        { timeout: 30000 }
      )
      .catch(() => {});
  }
  const manualShown = await page3.evaluate(() => !!document.querySelector('#gr-manual-search-input'));
  const panelText = await page3.evaluate(
    () => (document.querySelector('#gr-steam-float') || { textContent: '' }).textContent || ''
  );
  // 正确行为二选一：同 appid 自动进入手动选择；或重检索纠正为新结果
  const resorted = panelText.includes('手动选择游戏') || /App ID|好评率|Steam 总体/.test(panelText);
  check(
    '报错重检索流程完成（手动选择或纠正渲染）',
    manualShown || resorted,
    `(手动选择=${manualShown} | 内容=${panelText.substring(0, 40).replace(/\n/g, ' ')})`
  );
  check('报错流程无 console error', errors3.length === 0, `(${errors3.slice(0, 3).join(' | ')})`);
  // v14.28.1：实测 SW 饱和期 page.close() 会永久挂起（CDP 无回包）——加超时兜底
  await withTimeout(
    page3.close().catch(() => {}),
    10000,
    '4 page.close'
  );
  return true;
}
