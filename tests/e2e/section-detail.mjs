/**
 * 游戏雷达 Game Radar - E2E 冒烟：详情页报错流程 / E2E smoke: detail report flow
 *
 * 第五轮 B9 自 e2e-smoke.mjs 拆出（v3.3.11 真实点击报错 → 清缓存重检索；
 * v5.1.0 E2E_FAST 离线跳过 / v7.3.0 E2E_MOCK=1 时经录制 fixture 照跑）。
 * 返回 false = 触发 runner 断链（原 runChecks 的 return 语义：跳过其后全部节）。
 * Returns false to stop the pipeline (was: return inside runChecks).
 * state: { context, extId, check, MOCK, FAST, FIXTURE_ROOT } — 由 run.mjs 注入。
 */
('use strict');

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
  await page3.waitForSelector('#gr-report-issue-btn', { timeout: 20000 }).catch(() => {});
  const hasReportBtn = await page3.evaluate(() => !!document.querySelector('#gr-report-issue-btn'));
  check('浮窗报错按钮存在', hasReportBtn);
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
    await page3.click('#gr-report-issue-btn', { force: true });
    // 清缓存 + 重新检索：同 appid → 自动手动选择；不同 appid → 渲染纠正结果
    await page3
      .waitForFunction(
        () => {
          const btn = document.querySelector('#gr-report-issue-btn');
          return !btn || !btn.textContent.includes('重新检索中');
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
  await page3.close();
  return true;
}
