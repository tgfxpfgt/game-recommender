/**
 * 游戏雷达 Game Radar - 消息处理 / Message Handlers
 *
 * v5.0.0：由单文件拆分为按领域子模块（handlers/steam.js · cache-manager.js ·
 * data-modules.js · stats.js · download-sites.js），本文件保留核心 handler
 * （追踪/批量推荐/设置/规则/API 状态）与 MESSAGE_HANDLERS 聚合注册表。
 * Message handlers split by domain (v5.0.0); this file keeps the core handlers,
 * the aggregated dispatch map and the unified message entry.
 */
import { DEFAULT_SETTINGS } from './core/constants.js';
import { getSettings, saveSettings, saveRatingFilterCfg } from './core/settings.js'; // v10.9：窄化过滤持久化
import { metricsSnapshot, metricInc } from './core/metrics.js'; // v10.7.0：运行指标
import { saveAdapterRules, deleteAdapterRules, getAllRules } from './core/rules.js';
import { syncSiteScripts } from './core/site-scripts.js';
import { Logger, getRuntimeLogs, clearRuntimeLogs } from './storage/logger.js';
import { readProfiles, readKeywordWeights } from './storage/behavior.js';
import { handleGetSteamRatings, handlePrefetchSteamRatings } from './steam/ratings-batch.js';
import { calculateRecommendation } from './recommend/engine.js';
import { getFreeGamesData, claimFreeGame } from './freegames/manager.js';
import { handleGetApiStatus, handleGetSteam250Rank, handleSiteAdapterAlert, handleGetSiteHealth, handleGetStorageHealth, handleLogPerf, handleOpenHub } from './handlers/diag-status.js'; // v14 B10：诊断迁出
import { getAppStats } from './storage/app-stats.js'; // v10.1.0：批量共享读
import { getOutboundAudit, resetOutboundAudit } from './core/outbound-audit.js';
import { toggleFavorite, getFavorites } from './storage/favorites.js'; // v10.6.0 F2 收藏
import { validateMessage, CONTENT_ALLOWED_ACTIONS, isTrustedSender } from './core/message-contract.js';
// v5.0.0：领域子模块 / domain-split handler modules
import {
  handleSearchSteam,
  handleRefreshSteamCache,
  handleGetSteamByAppId,
  handleSaveManualMapping,
  handleSearchSteamCandidates,
  handleClearCacheForPage,
  handleCacheSteamPage,
  handleReportWrongAppId,
  handleHealRegistryNames
} from './handlers/steam.js';
import {
  handleCleanExpiredCache,
  handleGetGameCacheList,
  handleDeleteGameCacheEntry,
  handleClearGameCache,
  handleRefreshGameCacheEntry
} from './handlers/cache-manager.js';
import {
  handleClearData,
  handleGetDataModules,
  handleExportData,
  handleImportData,
  handleCreateBackup,
  handleGetBackups,
  handleRestoreBackup,
  handleDeleteBackup
} from './handlers/data-modules.js';
import { handleGetStats, handleGetTrends, handleGetSteamRecommendations } from './handlers/stats.js';
import {
  handleSearchDownloadSites,
  handleGetDownloadHistory,
  handleTrackDownloadSiteVisit,
  handleRecordDownloadUrlsBatch
} from './handlers/download-sites.js';
import { handleTrackEvent } from './handlers/track-event.js'; // v10.7.0：行为追踪迁出
import { handleFetchImageDataUrl } from './handlers/image-fetch.js'; // v10.7.0：图片代取迁出

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

// --- 设置三件套 / Settings ---
async function handleGetSettings() {
  return { settings: await getSettings() };
}

async function handleSaveSettings(message) {
  await saveSettings(message.settings);
  return { success: true };
}

async function handleResetSettings() {
  const settings = DEFAULT_SETTINGS;
  await saveSettings(settings);
  // v9.7.0：返回 settings 供 UI 立即重渲染——此前只回 {success} 而 UI 判
  // resp.settings，恒走失败分支；且失败分支不重渲染时旧 DOM 值会被下一次
  // saveSettings 整包覆盖回去
  return { success: true, settings };
}

// --- 适配规则三件套 / Adapter rules ---
async function handleGetAdapterRules() {
  return { rules: await getAllRules() };
}

async function handleSaveAdapterRules(message) {
  const result = await saveAdapterRules(message.rules);
  // v7.4.0：规则变化后同步自定义站点内容脚本注册（新增站点立即生效，
  // 无需等下一次 SW 启动）
  if (result.ok) syncSiteScripts().catch(() => {});
  return result;
}

async function handleDeleteAdapterRules() {
  await deleteAdapterRules();
  // 规则删除后自定义站点脚本残留注册无碍（tracker 按规则早退兜底）——
  // 不注销，保持幂等简单；仍同步以补注册其他新站点
  syncSiteScripts().catch(() => {});
  // v9.7.0：补 ok 字段——UI（panels/rules.js）判 resp.ok，此前恒 undefined
  // 导致"恢复内置规则"成功后无任何反馈
  return { ok: true, success: true };
}

// --- 诊断 handler 已迁至 handlers/diag-status.js（v14 B10）---
// handleGetApiStatus / handleGetSteam250Rank / handleSiteAdapterAlert /
// handleGetSiteHealth / handleGetStorageHealth / handleLogPerf / handleOpenHub
// 以及 warmupSiteAlertPersist 均从 diag-status.js 导入

// --- 消息分发映射表 / Message dispatch map ---
export const MESSAGE_HANDLERS = {
  TRACK_EVENT: handleTrackEvent,
  GET_RECOMMENDATIONS: handleGetRecommendations,
  SEARCH_STEAM: handleSearchSteam,
  REFRESH_STEAM_CACHE: handleRefreshSteamCache,
  GET_STEAM_BY_APPID: handleGetSteamByAppId,
  SAVE_MANUAL_MAPPING: handleSaveManualMapping,
  SEARCH_STEAM_CANDIDATES: handleSearchSteamCandidates,
  GET_STEAM_RATINGS: handleGetSteamRatings,
  PREFETCH_STEAM_RATINGS: handlePrefetchSteamRatings,
  GET_SETTINGS: handleGetSettings,
  SAVE_SETTINGS: handleSaveSettings,
  RESET_SETTINGS: handleResetSettings,
  GET_STATS: handleGetStats,
  GET_TRENDS: handleGetTrends,
  GET_STEAM_RECOMMENDATIONS: handleGetSteamRecommendations,
  CLEAR_DATA: handleClearData,
  SEARCH_DOWNLOAD_SITES: handleSearchDownloadSites,
  GET_FREE_GAMES: async (msg) => getFreeGamesData(msg.force === true),
  CLAIM_FREE_GAME: async (msg) => claimFreeGame(msg.gameId),
  GET_DOWNLOAD_HISTORY: handleGetDownloadHistory,
  TRACK_DOWNLOAD_SITE_VISIT: handleTrackDownloadSiteVisit,
  RECORD_DOWNLOAD_URLS_BATCH: handleRecordDownloadUrlsBatch,
  GET_GAME_CACHE_LIST: handleGetGameCacheList,
  DELETE_GAME_CACHE_ENTRY: handleDeleteGameCacheEntry,
  CLEAR_GAME_CACHE: handleClearGameCache,
  REFRESH_GAME_CACHE_ENTRY: handleRefreshGameCacheEntry,
  GET_RUNTIME_LOGS: async (msg) => ({ logs: await getRuntimeLogs(msg.limit) }),
  CLEAR_RUNTIME_LOGS: async () => {
    await clearRuntimeLogs();
    return { success: true };
  },
  EXPORT_LOGS: async () => ({ logs: await getRuntimeLogs() }),
  GET_DATA_MODULES: handleGetDataModules,
  EXPORT_DATA: handleExportData,
  IMPORT_DATA: handleImportData,
  CREATE_BACKUP: handleCreateBackup,
  GET_BACKUPS: handleGetBackups,
  RESTORE_BACKUP: handleRestoreBackup,
  DELETE_BACKUP: handleDeleteBackup,
  GET_ADAPTER_RULES: handleGetAdapterRules,
  SAVE_ADAPTER_RULES: handleSaveAdapterRules,
  DELETE_ADAPTER_RULES: handleDeleteAdapterRules,
  CLEAN_EXPIRED_CACHE: handleCleanExpiredCache,
  CLEAR_CACHE_FOR_PAGE: handleClearCacheForPage,
  CACHE_STEAM_PAGE: handleCacheSteamPage,
  REPORT_WRONG_APPID: handleReportWrongAppId,
  HEAL_REGISTRY_NAMES: handleHealRegistryNames,
  GET_API_STATUS: handleGetApiStatus,
  OPEN_HUB: handleOpenHub,
  LOG_PERF: handleLogPerf,
  SITE_ADAPTER_ALERT: handleSiteAdapterAlert,
  FETCH_IMAGE_DATA_URL: handleFetchImageDataUrl,
  GET_STEAM250_RANK: handleGetSteam250Rank,
  TOGGLE_FAVORITE: async (msg) => toggleFavorite(msg && msg.appId, msg && msg.name, msg && msg.releaseDate),
  GET_FAVORITES: async () => ({ favorites: await getFavorites() }),
  GET_ITAD_LOWEST: async (msg) => {
    const { getItadLowest } = await import('./freegames/manager.js');
    const info = await getItadLowest(msg && msg.appId);
    return { info };
  },
  SEARCH_CACHED_GAMES: async (msg) => {
    const { searchCachedGames } = await import('./handlers/stats.js');
    return searchCachedGames(msg);
  },
  GET_SITE_HEALTH: handleGetSiteHealth,
  GET_RUNTIME_METRICS: async () => ({ metrics: metricsSnapshot() }),
  SAVE_RATING_FILTER_CFG: (m) => saveRatingFilterCfg(m.enabled, m.minRating), // v10.9：xdgrid 过滤滑块
  GET_STORAGE_HEALTH: handleGetStorageHealth,
  GET_OUTBOUND_AUDIT: async (msg) => getOutboundAudit(msg && msg.limit),
  CLEAR_OUTBOUND_AUDIT: async () => {
    resetOutboundAudit();
    return { success: true };
  }
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
