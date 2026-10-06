/**
 * 游戏雷达 Game Radar - Steam 编排共享件 / Orchestrator Shared Helpers
 *
 * v14.3.0（第五轮 B4）：由 orchestrator.js 拆分——detail 与 list 两条管线
 * 共用的 Demo 缓存判定与统一缓存命中返回（幂等补写注册表 + 中英文名自愈 +
 * 三段式字段构造）。
 * Shared by both pipelines: demo-cache detection and the unified cache-hit
 * result (registry backfill + name self-heal + 3-badge fields).
 */
import {
  DEMO_NAME_PATTERN,
  ensureRegistryEntry,
  ensureValidRegistryNames
} from './api.js';

// 判断缓存条目是否为"Demo 版且无评测"——需清除并重新搜索完整版（自愈）
// Whether a cached entry is a "Demo edition without reviews" (needs re-search)
export function isDemoCacheWithoutRating(cachedData) {
  if (!cachedData) return false;
  if (cachedData.positiveRate !== null && cachedData.positiveRate !== undefined) return false;
  return DEMO_NAME_PATTERN.test(cachedData.name || '');
}

// v5.0.0：缓存命中统一返回（幂等补写注册表 + 中英文名自愈 + 三段式字段构造），
// getSteamRatingsFromCacheOnly 与 getSteamPositiveRate 两处重复收敛于此
// Unified cache-hit result (registry backfill + name self-heal + 3-badge fields).
export async function applyCacheHit(merged, appId, gameName) {
  await ensureRegistryEntry(
    merged.appId || appId,
    merged.name,
    merged.englishName,
    gameName,
    merged.headerImage || '',
    merged.type
  );
  // v10.5.2：名称自愈改为后台执行（不阻塞返回）——缓存命中路径（列表页第一波
  // getSteamRatingsFromCacheOnly 的"零网络请求"契约）此前会同步 await 最多 2 次
  // Steam API 调用；Steam 不可达/官方无英文名时每次命中都阻塞数秒并空耗配额。
  // 自愈结果非徽章渲染依赖，失败由退避机制兜底（见 api-registry-heal.js）。
  // Name self-heal now runs in the background: the cache-hit path previously
  // awaited up to 2 Steam API calls, breaking the zero-network wave-1 contract
  // and burning quota on every hit when Steam is unreachable or has no EN name.
  ensureValidRegistryNames(merged.appId || appId, merged.name, merged.englishName, gameName).catch(() => {});
  return {
    positiveRate: merged.positiveRate,
    ratingDesc: merged.ratingDesc || null,
    appId: merged.appId || appId,
    name: merged.name || gameName,
    type: merged.type || 'game',
    // v3.3.6：近 30 天好评率/最近更新随缓存返回（徽章三段式）
    totalReviews: merged.totalReviews || 0,
    // v10.5.3：好评/差评原始条数随缓存返回——列表页综合评分徽章（XDGame
    // 同口径修正口碑÷10）数据源；旧缓存缺失 → null，内容侧按整数好评率回退
    positiveReviews: merged.positiveReviews ?? null,
    negativeReviews: merged.negativeReviews ?? null,
    recentPositiveRate: merged.recentPositiveRate ?? null,
    recentTotalReviews: merged.recentTotalReviews ?? 0,
    lastUpdate: merged.lastUpdate || null,
    releaseDate: merged.releaseDate || ''
  };
}
