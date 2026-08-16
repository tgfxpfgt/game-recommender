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
import { getSettings, saveSettings } from './core/settings.js';
import { saveAdapterRules, deleteAdapterRules, getAllRules } from './core/rules.js';
import { syncSiteScripts } from './core/site-scripts.js';
import { Logger, getRuntimeLogs, clearRuntimeLogs } from './storage/logger.js';
import {
  addBehaviorLog,
  updateGameProfile,
  maybeUpdatePreferences,
  readProfiles,
  readKeywordWeights
} from './storage/behavior.js';
import { recordDownloadHistory } from './storage/history.js';
import { handleGetSteamRatings, handlePrefetchSteamRatings } from './steam/ratings-batch.js';
import { calculateRecommendation } from './recommend/engine.js';
import { getFreeGamesData, claimFreeGame } from './freegames/manager.js';
import { getSteamApiStatus } from './core/api-monitor.js';
import { getOutboundAudit, resetOutboundAudit } from './core/outbound-audit.js';
import { validateMessage } from './core/message-contract.js';
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

// --- 行为追踪 / Behavior tracking ---
async function handleTrackEvent(message) {
  await addBehaviorLog(message.data);

  if (message.data.type === 'click_download') {
    await updateGameProfile({
      name: message.data.gameName,
      event: 'download',
      keywords: message.data.keywords
    });
    await recordDownloadHistory(message.data);
    Logger.info('Download', `下载"${message.data.gameName}"`, {
      method: message.data.method,
      domain: message.data.domain
    });
  }
  if (message.data.type === 'view_detail') {
    await updateGameProfile({
      name: message.data.gameName,
      event: 'view',
      keywords: message.data.keywords
    });
  }
  // Steam标签回写
  // v6.3.2 C3：不感兴趣标记（推荐反馈循环负信号）
  if (message.data.type === 'dislike_game') {
    await updateGameProfile({ name: message.data.gameName, event: 'dislike', keywords: message.data.keywords });
  }
  if (message.data.type === 'steam_tags_update') {
    await updateGameProfile({
      name: message.data.gameName,
      event: 'view',
      keywords: message.data.keywords,
      steamAppId: message.data.steamAppId,
      steamRating: message.data.steamRating
    });
  }
  // 节流更新偏好模型；下载事件强制刷新（更具信号价值）
  await maybeUpdatePreferences(message.data.type === 'click_download');
  return { success: true };
}

async function handleGetRecommendations(message) {
  const games = message.games || [];
  const useBuiltinOnly = games.length > 1; // 批量时强制内置算法
  // v3.4.1：批量（列表页徽章）时共享只读数据——画像/关键词权重/设置仅读
  // 一次，避免每款游戏各读两次盘（此前 N 款游戏 = 2N 次模块读取）
  // Shared read for batch mode: profiles/keyword weights/settings loaded once
  // (previously N games triggered 2N module reads)
  const shared =
    games.length > 1
      ? await (async () => {
          const [profiles, keywordWeights, settings] = await Promise.all([
            readProfiles(),
            readKeywordWeights(),
            getSettings()
          ]);
          return { profiles, keywordWeights, settings };
        })()
      : null;
  const results = [];
  for (const game of games) {
    const score = await calculateRecommendation(game, useBuiltinOnly, shared);
    results.push({ ...game, recommendation: score });
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
  await saveSettings(DEFAULT_SETTINGS);
  return { success: true };
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
  return { success: true };
}

// --- Steam API 状态监测（v3.3.0）---
async function handleGetApiStatus() {
  // v6.4.10：扁平返回（popup 读顶层 anomaly/total/failed——此前嵌套 {status} 导致
  // 状态永远显示采样中）
  return getSteamApiStatus();
}

// v9.1.0：性能上报（内容脚本 boot 耗时等 → Perf 日志落盘）
async function handleLogPerf(message) {
  const source = message.source || 'content';
  Logger.info(
    'Perf',
    `${source} ${message.metric || ''} 耗时: ${message.durationMs}ms${message.detail ? ' (' + message.detail + ')' : ''}`
  );
  return { success: true };
}

// v7.4.0：打开设置中心（欢迎页/弹窗跳转用）
async function handleOpenHub() {
  const url = chrome.runtime.getURL('hub/hub.html');
  const [tab] = await chrome.tabs.query({ url });
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
  } else {
    await chrome.tabs.create({ url });
  }
  return { success: true };
}

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
  GET_OUTBOUND_AUDIT: async (msg) => getOutboundAudit(msg && msg.limit),
  CLEAR_OUTBOUND_AUDIT: async () => {
    resetOutboundAudit();
    return { success: true };
  }
};

// 消息统一入口 / Message entry
export async function handleMessage(message, sender) {
  if (!message || !message.action) return { error: 'missing action' };
  // v4.0.0：消息契约校验（高风险 action 入参白名单，违规直接拒绝）
  const v = validateMessage(message.action, message);
  if (!v.ok) return { error: 'invalid-message: ' + v.error };
  const handler = MESSAGE_HANDLERS[message.action];
  if (handler) return await handler(message, sender);
  return { error: 'Unknown action: ' + message.action };
}
