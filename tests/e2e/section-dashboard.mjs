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
  // v14.26.0（P2-12）：冷启动预算——SW 模块图就绪（timeOrigin → 入口顶层执行完，
  // 含全部静态 import 的取载+求值）。体积字节预算在 gate 硬拦，这里是真机软观测：
  // 取本次会话最小样本（重负载机的单次慢启动不应判红），CI 可用
  // GR_BOOT_BUDGET_MS 放宽（Linux xvfb 冷启动比本地 Windows 慢）。
  const bootBudget = Number(process.env.GR_BOOT_BUDGET_MS) || 600;
  const bootSamples = await dash
    .evaluate(async () => {
      const timeout = new Promise((resolve) => setTimeout(() => resolve([]), 5000));
      const read = chrome.runtime
        .sendMessage({ action: 'GET_RUNTIME_LOGS', limit: 1000 })
        .then((r) => (r && r.logs) || [])
        .catch(() => []);
      const logs = await Promise.race([read, timeout]);
      return logs
        .filter((l) => l && l.module === 'Perf')
        .map((l) => String(l.message || '').match(/模块图就绪:\s*(\d+)ms/))
        .filter(Boolean)
        .map((m) => Number(m[1]));
    })
    .catch(() => []);
  if (bootSamples.length === 0) {
    // 软观测：SW 无响应或日志被淘汰时跳过判定，不给假红（硬红线是 gate 的体积断言）
    console.log('  ⚠️ 冷启动样本不可读（SW 无响应/日志已淘汰）——跳过预算判定');
  } else {
    const bootBest = Math.min(...bootSamples);
    check(
      `SW 模块图就绪预算（≤ ${bootBudget}ms）`,
      bootBest > 0 && bootBest <= bootBudget,
      `(最小值 ${bootBest}ms，样本 ${bootSamples.join('/')})`
    );
  }
  await dash.close();
}
