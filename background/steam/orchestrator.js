/**
 * 游戏雷达 Game Radar - Steam API 编排器（装配壳）/ Steam API Orchestrator (shell)
 *
 * 详情页查询（searchSteamGame）与列表页轻量好评率查询（getSteamPositiveRate）：
 * 缓存优先 → Demo 自愈重搜 → 0 评测验证 → 三层缓存写入。
 * v14.3.0（第五轮 B4）：497 行按管线拆分——orchestrator-detail.js（详情页
 * 全流程）/ orchestrator-list.js（列表页两波查询）/ orchestrator-shared.js
 * （Demo 缓存判定 + 统一命中返回）；本文件仅 re-export——handlers/steam.js、
 * ratings-batch.js 等消费面零改动。
 * Split by pipeline (detail/list/shared); this shell re-exports everything so
 * existing callers keep working unchanged.
 */
export { searchSteamGame } from './orchestrator-detail.js';
export { getSteamRatingsFromCacheOnly, getSteamPositiveRate } from './orchestrator-list.js';
export { isDemoCacheWithoutRating, applyCacheHit } from './orchestrator-shared.js';
