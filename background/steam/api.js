/**
 * 游戏雷达 Game Radar - Steam API 聚合入口 / Steam API Barrel
 *
 * v5.0.0：由 858 行单文件按职能拆分（api-search · api-details ·
 * api-reviews · api-supplement · api-assemble · api-registry-heal），
 * 本文件作为 barrel 再导出保持既有调用方与测试零改动。
 * Split by concern (v5.0.0); this barrel re-exports everything so existing
 * callers and tests keep working unchanged.
 */
export * from './api-search.js';
export * from './api-details.js';
export * from './api-reviews.js';
export * from './api-supplement.js';
export * from './api-assemble.js';
export * from './api-registry-heal.js';
