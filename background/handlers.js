/**
 * 游戏雷达 Game Radar - 消息入口与分发聚合 / Message Entry & Dispatch Aggregation
 *
 * v5.0.0：handler 按领域拆分至 handlers/ 子模块。
 * v14 B10：绑定同表终态——各领域模块导出 HANDLERS 段（action → handler
 * 单处声明），本文件仅聚合展开 + 统一入口（契约校验/sender 门禁/指标）。
 * Domain modules export their own handler segments; this file only
 * aggregates them and keeps the unified entry (contract/sender/metrics).
 */
import { metricInc } from './core/metrics.js';
import { validateMessage, CONTENT_ALLOWED_ACTIONS, isTrustedSender } from './core/message-contract.js';
import { Logger } from './storage/logger.js';
import { trackEventHandlers } from './handlers/track-event.js';
import { recommendHandlers } from './handlers/recommend.js';
import { steamHandlers } from './handlers/steam.js';
import { settingsHandlers } from './handlers/settings.js';
import { statsHandlers } from './handlers/stats.js';
import { freegamesHandlers } from './handlers/freegames.js';
import { logsHandlers } from './handlers/logs.js';
import { dataModulesHandlers } from './handlers/data-modules.js';
import { adapterRulesHandlers } from './handlers/adapter-rules.js';
import { cacheManagerHandlers } from './handlers/cache-manager.js';
import { downloadSitesHandlers } from './handlers/download-sites.js';
import { favoritesHandlers } from './handlers/favorites.js';
import { diagStatusHandlers } from './handlers/diag-status.js';
import { imageFetchHandlers } from './handlers/image-fetch.js';

// 消息分发映射表（领域段聚合；契约规则在 core/message-contract.js RULES）
// Aggregated dispatch map; contract rules live in message-contract RULES.
export const MESSAGE_HANDLERS = {
  ...trackEventHandlers,
  ...recommendHandlers,
  ...steamHandlers,
  ...settingsHandlers,
  ...statsHandlers,
  ...freegamesHandlers,
  ...logsHandlers,
  ...dataModulesHandlers,
  ...adapterRulesHandlers,
  ...cacheManagerHandlers,
  ...downloadSitesHandlers,
  ...favoritesHandlers,
  ...diagStatusHandlers,
  ...imageFetchHandlers
};

// 扩展自身 origin（chrome-extension://<id>/）——getURL('') 返回前缀；单测无
// getURL 时降级空串（此时任何带 url 的 sender 均按内容脚本处理，无 url 视为内部）
// The extension's own origin; empty when getURL is unavailable (unit tests).
function extensionOrigin() {
  try {
    if (chrome.runtime && typeof chrome.runtime.getURL === 'function') return chrome.runtime.getURL('');
  } catch {
    /* ignore */
  }
  return '';
}

// 消息统一入口 / Message entry
export async function handleMessage(message, sender) {
  if (!message || !message.action) return { error: 'missing action' };
  // v4.0.0：消息契约校验（高风险 action 入参白名单，违规直接拒绝）
  const v = validateMessage(message.action, message);
  if (!v.ok) return { error: 'invalid-message: ' + v.error };
  // v10.5.0 P0-A：sender 来源门——非扩展页来源（内容脚本 http 源）仅可发白名单
  // 读/埋点 action，阻断被注入内容脚本伪造特权 action（SAVE_SETTINGS/CLEAR_DATA/
  // IMPORT_DATA/SAVE_ADAPTER_RULES/CREATE_BACKUP…）。无 sender（内部/CLI/测试）放行。
  // Sender-origin gate: web-origin senders are limited to the content allowlist;
  // privileged actions require an extension-page/internal sender.
  if (!isTrustedSender(sender, extensionOrigin()) && !CONTENT_ALLOWED_ACTIONS.has(message.action)) {
    Logger.warn('Security', `拒绝非扩展页来源的特权 action: ${message.action}`, String((sender && sender.url) || ''));
    return { error: 'forbidden-sender: ' + message.action };
  }
  const handler = MESSAGE_HANDLERS[message.action];
  if (handler) {
    // v10.7.0 批次5：消息量指标（按 action 计数——N1 会话计数的明细维度）
    metricInc('msg.' + message.action);
    return await handler(message, sender);
  }
  return { error: 'Unknown action: ' + message.action };
}
