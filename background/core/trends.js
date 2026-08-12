/**
 * Game Recommender - 行为趋势聚合 / Behavior Trend Aggregation
 *
 * v4.0.0：将行为日志（ND-JSON ≤500 条）按天分桶，输出"浏览/下载/转化率"
 * 时间序列，供 dashboard 趋势图渲染。纯函数、零依赖（core 层，可单测）。
 * Daily bucketing of the behavior log (ND-JSON, ≤500 entries) into a
 * views/downloads/conversion-rate time series for the dashboard chart.
 * Pure and dependency-free (core layer, unit-testable).
 */

// 按天聚合行为日志：返回按日期升序的 [{date, views, downloads, rate}]
// Aggregate the behavior log by calendar day (ascending [{date,views,downloads,rate}]).
export function aggregateDailyTrends(log) {
  const byDay = new Map();
  for (const e of log || []) {
    if (!e || !e.timestamp) continue;
    const d = new Date(e.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    const key = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    let day = byDay.get(key);
    if (!day) { day = { date: key, views: 0, downloads: 0 }; byDay.set(key, day); }
    if (e.type === 'view_detail') day.views++;
    else if (e.type === 'click_download') day.downloads++;
  }
  return [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(day => ({
      date: day.date,
      views: day.views,
      downloads: day.downloads,
      rate: day.views > 0 ? Math.round((day.downloads / day.views) * 100) : 0
    }));
}
