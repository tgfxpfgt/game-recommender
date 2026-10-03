/**
 * 游戏雷达 Game Radar - Dashboard 导出模块 / Dashboard Export Module
 *
 * v14 B1：由 dashboard.js 拆分——CSV/JSON 导出函数（自足，依赖全局缓存变量）。
 * Split from dashboard.js (B1): CSV/JSON export functions.
 * 依赖全局：cachedTrends, cachedGameList（dash-stats.js 定义，调用时已初始化）
 */
/* global cachedTrends, cachedGameList */
/* eslint-disable no-unused-vars */
// （以上函数通过 dashboard.js 的事件绑定按名调用——经典脚本跨文件全局作用域）
// ============ CSV 导出 / CSV Export (v4.0.0) ============
// CSV 转义（引号/逗号/换行）；值含特殊字符时加引号并双写引号
// CSV escaping: quote values containing commas/quotes/newlines ("" doubling)
function toCsv(headers, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
}

// Blob 下载（BOM 防 Excel 中文乱码）/ Blob download with UTF-8 BOM for Excel
function downloadCsv(filename, csv) {
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// 导出趋势 CSV（按天）/ Export daily trends as CSV
function exportTrendsCsv() {
  if (cachedTrends.length === 0) {
    alert('暂无趋势数据');
    return;
  }
  downloadCsv(
    `game-recommender-trends-${new Date().toISOString().slice(0, 10)}.csv`,
    toCsv(
      ['日期', '浏览', '下载', '转化率%'],
      cachedTrends.map((d) => [d.date, d.views, d.downloads, d.rate])
    )
  );
}

// v11.0 B7：JSON 全量导出（画像 + 收藏 + 趋势）——结构化备份/跨设备迁移
async function exportInsightsJson() {
  try {
    const [stats, favs, trends] = await Promise.all([
      window.__GR_MSG__.sendMessage({ action: 'GET_STATS' }),
      window.__GR_MSG__.sendMessage({ action: 'GET_FAVORITES' }),
      window.__GR_MSG__.sendMessage({ action: 'GET_TRENDS', granularity: 'week' })
    ]);
    const payload = {
      format: 'game-recommender-insights',
      version: 1,
      exportedAt: new Date().toISOString(),
      gameList: (stats && stats.gameList) || [],
      topKeywords: (stats && stats.topKeywords) || [],
      favorites: (favs && favs.favorites) || {},
      trends: (trends && trends.daily) || []
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `game-recommender-insights-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('导出失败: ' + window.__GR_MSG__.toUserMessage(e));
  }
}

// 导出游戏明细 CSV（当前 GET_STATS 返回的前 50 画像）/ Export game profiles as CSV
function exportGamesCsv() {
  if (cachedGameList.length === 0) {
    alert('暂无游戏数据');
    return;
  }
  downloadCsv(
    `game-recommender-games-${new Date().toISOString().slice(0, 10)}.csv`,
    toCsv(
      ['游戏名称', '浏览', '下载', 'Steam标签', 'AppID', '评分', '最后时间'],
      cachedGameList.map((g) => [
        g.name,
        g.views ?? 0,
        g.downloads ?? 0,
        (g.keywords || []).join('; '),
        g.steamAppId || '',
        g.steamRating ?? '',
        g.lastSeen || ''
      ])
    )
  );
}

// 导出行为日志 CSV（全量，经 EXPORT_DATA 获取）/ Export the full behavior log as CSV
async function exportLogsCsv() {
  try {
    const response = await window.__GR_MSG__.sendMessage({ action: 'EXPORT_DATA', moduleKeys: ['behaviorLog'] });
    const entries = (response && response.data && response.data.modules && response.data.modules.behaviorLog) || [];
    if (!entries || entries.length === 0) {
      alert('暂无行为日志');
      return;
    }
    downloadCsv(
      `game-recommender-behavior-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        ['时间', '类型', '游戏', '方式', '网站', 'URL'],
        entries.map((e) => [
          new Date(e.timestamp).toLocaleString('zh-CN'),
          e.type,
          e.gameName || '',
          e.method || '',
          e.domain || '',
          e.url || ''
        ])
      )
    );
  } catch (e) {
    alert('导出失败: ' + window.__GR_MSG__.toUserMessage(e));
  }
}
