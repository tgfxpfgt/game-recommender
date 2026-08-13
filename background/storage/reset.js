/**
 * 游戏雷达 Game Radar - 内存缓存重置 / In-Memory Cache Reset
 *
 * 备份恢复/导入/清除数据后调用，聚合重置各存储模块的内存缓存，
 * 避免命中旧数据。
 * Aggregates per-module cache resets (after backup restore / import / clear).
 *
 * v3.4.1：由 core/ 下沉至 storage/ —— 本模块聚合全部存储层重置，
 * 属 storage 层编排职责，下沉后恢复 core→storage 单向依赖。
 */
import { resetSettingsCache } from '../core/settings.js';
import { resetRulesCache } from '../core/rules.js';
import { resetSteamCache } from './steam-cache.js';
import { resetRegistry } from './registry.js';
import { resetNameIndex } from './name-index.js';
import { resetLogBuffer } from './logger.js';
import { resetLearnedNoise } from './learned-noise.js';
import { resetWrongReports } from './wrong-reports.js';
import { resetBehaviorState } from './behavior.js';
import { resetOutboundAudit } from '../core/outbound-audit.js';
import { resetSearchCache } from './search-cache.js';
import { resetLlmCache } from './llm-cache.js';

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
  resetBehaviorState(); // v5.0.0：偏好模型节流状态一并重置（此前遗漏）
  resetOutboundAudit(); // v3.4.1：出站请求审计缓冲随清理一并清空
  resetSearchCache(); // v6.4.3：下载站搜索缓存
  resetLlmCache(); // v6.4.3：LLM 评分缓存
}
