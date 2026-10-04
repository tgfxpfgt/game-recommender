/**
 * 游戏雷达 Game Radar - 消息处理：内置推荐 / Recommendation Handler
 *
 * v14 B10：由 handlers.js 迁出——GET_RECOMMENDATIONS（内置算法批量推荐，
 * 共享只读数据一次加载）。
 * Moved from handlers.js (B10): built-in recommendation with shared reads.
 */
import { getSettings } from '../core/settings.js';
import { Logger } from '../storage/logger.js';
import { readProfiles, readKeywordWeights } from '../storage/behavior.js';
import { calculateRecommendation } from '../recommend/engine.js';
import { getAppStats } from '../storage/app-stats.js'; // v10.1.0：批量共享读

async function handleGetRecommendations(message) {
  // v10.3.0：推荐功能独立开关——关闭后返回空结果（内容侧不渲染推荐徽章，
  // 列表页其余流程/显示不受影响）
  {
    const s = await getSettings();
    if (s.enableRecommendations === false) return { results: [] };
  }
  const games = message.games || [];
  const useBuiltinOnly = games.length > 1; // 批量时强制内置算法
  // v3.4.1：批量（列表页徽章）时共享只读数据——画像/关键词权重/设置仅读
  // 一次，避免每款游戏各读两次盘（此前 N 款游戏 = 2N 次模块读取）
  // Shared read for batch mode: profiles/keyword weights/settings loaded once
  // (previously N games triggered 2N module reads)
  const shared =
    games.length > 1
      ? await (async () => {
          // v10.1.0：AppID 行为统计并入批量共享只读数据（推荐引擎信号）
          const [profiles, keywordWeights, settings, appStats] = await Promise.all([
            readProfiles(),
            readKeywordWeights(),
            getSettings(),
            getAppStats()
          ]);
          return { profiles, keywordWeights, settings, appStats };
        })()
      : null;
  const results = [];
  for (const game of games) {
    // v10.0.0：per-game 防御——单个游戏画像/数据畸形（如历史坏数据）
    // 导致 calculateRecommendation 抛错时，跳过该游戏而非炸掉整批推荐
    try {
      const score = await calculateRecommendation(game, useBuiltinOnly, shared);
      results.push({ ...game, recommendation: score });
    } catch (e) {
      Logger.warn('Recommend', `推荐计算失败（跳过）: ${String((game && game.name) || '?')}`, String(e));
    }
  }
  return { results };
}

// v14 B10：领域 handler 段（action → handler 单处声明，handlers.js 聚合展开）
export const recommendHandlers = {
  GET_RECOMMENDATIONS: handleGetRecommendations
};
