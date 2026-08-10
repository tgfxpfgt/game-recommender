/**
 * Game Recommender - 内存缓存重置 / In-Memory Cache Reset
 *
 * 备份恢复/导入/清除数据后调用，聚合重置各存储模块的内存缓存，
 * 避免命中旧数据。
 * Aggregates per-module cache resets (after backup restore / import / clear).
 */
import { resetSettingsCache } from './settings.js';
import { resetRulesCache } from './rules.js';
import { resetSteamCache } from '../storage/steam-cache.js';
import { resetRegistry } from '../storage/registry.js';
import { resetNameIndex } from '../storage/name-index.js';
import { resetLogBuffer } from '../storage/logger.js';
import { resetLearnedNoise } from '../storage/learned-noise.js';
import { resetWrongReports } from '../storage/wrong-reports.js';

// 重置所有内存缓存 / Reset all in-memory caches
export function resetInMemoryCaches() {
  resetSettingsCache();
  resetRegistry();
  resetNameIndex();
  resetSteamCache();
  resetLogBuffer();
  resetRulesCache();
  resetLearnedNoise();
  resetWrongReports(); // v3.4.0：导入/恢复后纠正知识库内存与存储保持一致
}
