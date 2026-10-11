/**
 * 游戏雷达 Game Radar - E2E 冒烟：dashboard 趋势与运行指标 / E2E smoke: dashboard
 *
 * 第五轮 B9 自 e2e-smoke.mjs 拆出（5b：趋势图 SVG 渲染 + v10.8 E1 运行指标卡）。
 * state: { context, extId, check } — 由 run.mjs 注入。
 */
('use strict');

export async function runDashboard(state) {
  const { context, extId, check } = state;

  // 5b. dashboard 趋势图（第 4 节详情页访问已产生当天 view_detail）
  console.log('5b. dashboard 趋势图');
  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extId}/dashboard/dashboard.html`);
  await dash.waitForTimeout(800);
  const trendInfo = await dash.evaluate(() => ({
    svgCount: document.querySelectorAll('#trendChart svg').length,
    stats: (document.getElementById('trendStats') || { textContent: '' }).textContent
  }));
  check('dashboard 趋势图 SVG 渲染', trendInfo.svgCount > 0);
  check('趋势统计显示浏览数据', /浏览/.test(trendInfo.stats), `(${trendInfo.stats})`);
  // v10.8 E1：dashboard 运行指标卡 + 指标框架存活（v10.7.0 新面）
  const metricsInfo = await dash.evaluate(() => ({
    batchCard: !!document.getElementById('diagBatchMs'),
    opfsCard: !!document.getElementById('diagOpfsWrites'),
    msgCard: !!document.getElementById('diagMsgTotal'),
    mode: (document.getElementById('diagOpfsMode') || { textContent: '?' }).textContent
  }));
  check('dashboard 运行指标卡渲染（v10.7.0）', metricsInfo.batchCard && metricsInfo.opfsCard && metricsInfo.msgCard);
  const metricsSnap = await dash.evaluate(async () => {
    const r = await window.__GR_MSG__.sendMessage({ action: 'GET_RUNTIME_METRICS' });
    return r && r.metrics;
  });
  check(
    '运行指标框架存活（消息计数 + OPFS 写计数非零）',
    !!metricsSnap &&
      Object.keys(metricsSnap.counters || {}).length > 0 &&
      Object.entries(metricsSnap.counters || {}).some(([k, v]) => k.startsWith('msg.') && v > 0) &&
      Object.entries(metricsSnap.counters || {}).some(([k, v]) => k.startsWith('opfs.writeCount.') && v > 0),
    `(mode=${metricsInfo.mode}, counterKeys=${metricsSnap ? Object.keys(metricsSnap.counters || {}).length : 0})`
  );
  await dash.close();
}
