// @ts-strict
/**
 * 游戏雷达 Game Radar - 行为趋势聚合 / Behavior Trend Aggregation
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
  return aggregateTrends(log, 'day');
}

// v4.1.0：按粒度聚合（day=日历日 / week=自然周，周桶键为该周周一日期）
// Aggregate by granularity ('day' = calendar day, 'week' = ISO-ish week keyed
// by its Monday). Pure, zero-dependency, unit-testable.
export function aggregateTrends(log, granularity = 'day') {
  const byBucket = new Map();
  for (const e of log || []) {
    if (!e || !e.timestamp) continue;
    const d = new Date(e.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    const key = granularity === 'week' ? mondayKey(d) : dayKey(d);
    let bucket = byBucket.get(key);
    if (!bucket) {
      bucket = { date: key, views: 0, downloads: 0 };
      byBucket.set(key, bucket);
    }
    if (e.type === 'view_detail') bucket.views++;
    else if (e.type === 'click_download') bucket.downloads++;
  }
  return [...byBucket.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((b) => ({
      date: b.date,
      views: b.views,
      downloads: b.downloads,
      rate: b.views > 0 ? Math.round((b.downloads / b.views) * 100) : 0
    }));
}

function dayKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 该日期所在周的周一日期（周桶键）/ Monday of the week containing d
function mondayKey(d) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (m.getDay() + 6) % 7; // 周一=0 ... 周日=6
  m.setDate(m.getDate() - dow);
  return dayKey(m);
}

// v10.0.0：推荐反馈信号聚合（纯函数，可单测）——dislike_game 负反馈闭环
// 数据的利用：负反馈总量、按游戏聚合的 top 负反馈与 top 下载（dashboard
// 「推荐反馈信号」区块渲染）。
// Feedback-signal aggregation (pure): dislike totals plus per-game top lists.
export function aggregateFeedback(log, topN = 5) {
  const perGame = new Map();
  let dislikeTotal = 0;
  for (const e of log || []) {
    const name = String((e && e.gameName) || '').trim();
    if (!name) continue;
    if (e.type === 'dislike_game') dislikeTotal++;
    let g = perGame.get(name);
    if (!g) {
      g = { name, views: 0, downloads: 0, dislikes: 0 };
      perGame.set(name, g);
    }
    if (e.type === 'view_detail') g.views++;
    else if (e.type === 'click_download') g.downloads++;
    if (e.type === 'dislike_game') g.dislikes++;
  }
  const games = [...perGame.values()];
  const topDisliked = games
    .filter((g) => g.dislikes > 0)
    .sort((a, b) => b.dislikes - a.dislikes || b.views - a.views)
    .slice(0, topN);
  const topDownloaded = games
    .filter((g) => g.downloads > 0)
    .sort((a, b) => b.downloads - a.downloads)
    .slice(0, topN);
  return { dislikeTotal, gameCount: games.length, topDisliked, topDownloaded };
}
