import { dataStore } from '../../data/data-store.js';
import { readProfiles, readKeywordWeights, getBehaviorLog } from '../storage/behavior.js';
import { getCacheStats } from '../storage/steam-cache.js';
import { DB_KEYS } from '../core/constants.js';
import { aggregateTrends } from '../core/trends.js';
import { fetchSteamTagRecommendations } from '../steam/api-search.js';
import { Logger } from '../storage/logger.js';

/**
 * Game Recommender - 消息处理：统计与趋势 / Stats Handlers
 *
 * v5.0.0：由 handlers.js 拆分——统计/趋势/偏好推荐。
 */

// --- 统计 / Stats ---
export async function handleGetStats() {
  const log = await getBehaviorLog();
  const [profiles, keywordWeights] = await Promise.all([readProfiles(), readKeywordWeights()]);

  const viewDetailCount = log.filter((e) => e.type === 'view_detail').length;
  const downloadCount = log.filter((e) => e.type === 'click_download').length;
  const listViewCount = log.filter((e) => e.type === 'view_list').length;

  const gameList = Object.values(profiles)
    .sort((a, b) => b.downloads - a.downloads || b.views - a.views)
    .slice(0, 50);

  const downloadMethods = {};
  log
    .filter((e) => e.type === 'click_download')
    .forEach((e) => {
      const method = e.method || 'unknown';
      downloadMethods[method] = (downloadMethods[method] || 0) + 1;
    });

  return {
    totalEvents: log.length,
    totalGames: Object.keys(profiles).length,
    viewDetailCount,
    downloadCount,
    listViewCount,
    downloadRate: viewDetailCount > 0 ? Math.round((downloadCount / viewDetailCount) * 100) : 0,
    topKeywords: Object.entries(keywordWeights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([kw, weight]) => ({ keyword: kw, weight })),
    gameList,
    downloadMethods,
    recentLog: log.slice(-30).reverse(),
    cacheStats: getCacheStats()
  };
}

// 行为趋势（按天/周浏览·下载·转化率，v4.0.0 起；v4.1.0 支持周粒度）
// Behavior trends (daily/weekly views · downloads · rate)

// 行为趋势（按天/周浏览·下载·转化率，v4.0.0 起；v4.1.0 支持周粒度）
// Behavior trends (daily/weekly views · downloads · rate)
export async function handleGetTrends(message) {
  const log = await getBehaviorLog();
  const granularity = message && message.granularity === 'week' ? 'week' : 'day';
  return { daily: aggregateTrends(log, granularity), granularity };
}

// 基于用户偏好标签的 Steam 推荐
// v5.0.0：网络逻辑下沉至 api-search.js 的 fetchSteamTagRecommendations
export async function handleGetSteamRecommendations() {
  const kwData = await dataStore.readModule(DB_KEYS.KEYWORD_WEIGHTS);
  const weights = kwData || {};
  const topTags = Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([kw]) => kw);

  if (topTags.length === 0) {
    return { games: [], message: '还没有足够的学习数据，请先浏览一些游戏网站' };
  }

  try {
    const recGames = await fetchSteamTagRecommendations(topTags, 9);
    return { games: recGames, basedOnTags: topTags };
  } catch (e) {
    Logger.error('Steam', '标签推荐失败', String(e));
    return { games: [], error: '获取Steam推荐失败: ' + String(e) };
  }
}

// --- 数据清除 / Data clearing ---
// v3.4.0：语义统一——"清除学习数据"同时删除 learnedNoise 存储（此前仅清
// 内存、存储保留导致下次加载恢复）；wrongReports（人工纠正知识库）为有意
// 保留的长期数据，不随本操作删除。
