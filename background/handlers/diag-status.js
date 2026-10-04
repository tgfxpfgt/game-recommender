/**
 * 游戏雷达 Game Radar - 消息处理：诊断与状态 / Diagnostic & Status Handlers
 *
 * v14 B10：由 handlers.js 迁出——API 状态（含分域可达性）/ Steam250 排名 /
 * 站点告警 / 站点健康 / 存储健康 / 性能上报 / 打开设置中心。
 * Moved from handlers.js (B10): API status, Steam250 rank, site alerts,
 * health probes, perf logging and hub navigation.
 */
import { createSessionPersist } from '../core/session-persist.js';
import { metricsSnapshot } from '../core/metrics.js'; // v14 B10：运行指标归口
import { getOutboundAudit, resetOutboundAudit } from '../core/outbound-audit.js'; // v14 B10
import { getSteamApiStatus, getDomainStatus } from '../core/api-monitor.js';
import { getSteam250Info } from '../steam/steam250.js';
import { getSiteHealth, recordSiteAlert } from '../storage/site-health.js';
import { getFlushHealth } from '../storage/flush-health.js';
import { Logger } from '../storage/logger.js';

// --- Steam API 状态监测（v3.3.0）+ 分域名可达性（v11.0 B2）---
export async function handleGetApiStatus() {
  const status = getSteamApiStatus();
  status.domains = getDomainStatus();
  return status;
}

// v10.4.4：Steam250 排名查询（appId → {rank, score, votes}；无记录 null）
export async function handleGetSteam250Rank(message) {
  const appId = message && message.appId;
  if (!appId) return { info: null };
  const info = await getSteam250Info(appId);
  return { info };
}

// v9.3.0：站点规则失效告警（内容侧提取 0 上报——站点改版可感知；每站点 24h 限频）
// v10.0.0：限频表持久化 storage.session（防抖）——SW 冷启动后 24h 限频连续
const siteAlertPersist = createSessionPersist('grSiteAlertLast', { initial: {} });
export async function warmupSiteAlertPersist() {
  await siteAlertPersist.load();
}
export async function handleSiteAdapterAlert(message) {
  const siteKey = String(message.siteKey || 'unknown');
  const now = Date.now();
  const lastMap = siteAlertPersist.peek();
  const last = lastMap[siteKey] || 0;
  if (now - last < 24 * 60 * 60 * 1000) return { success: true, throttled: true };
  lastMap[siteKey] = now;
  siteAlertPersist.scheduleSave();
  await recordSiteAlert(siteKey, message.host || '');
  Logger.warn('SiteAdapter', '站点规则疑似失效: ' + siteKey + ' (' + (message.host || '?') + ') -- 列表项提取为 0');
  return { success: true };
}

// v10.0.0：站点适配器健康（dashboard 看板/规则面板自检）
export function handleGetSiteHealth() {
  return getSiteHealth();
}

// v10.0.0：存储健康（写失败计数 + OPFS 模式态）
export function handleGetStorageHealth() {
  return getFlushHealth();
}

// v9.1.0：性能上报（内容脚本 boot 耗时等 → Perf 日志落盘）
export async function handleLogPerf(message) {
  const source = (message && message.source) || 'content';
  const metric = (message && message.metric) || '';
  const durationMs = (message && message.durationMs) || 0;
  const detail = message && message.detail ? ' (' + message.detail + ')' : '';
  Logger.info('Perf', source + ' ' + metric + ' 耗时: ' + durationMs + 'ms' + detail);
  return { success: true };
}

// v7.4.0：打开设置中心（欢迎页/弹窗跳转用）
export async function handleOpenHub() {
  const url = chrome.runtime.getURL('hub/hub.html');
  const tabs = await chrome.tabs.query({ url: url });
  if (tabs && tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
  } else {
    await chrome.tabs.create({ url: url });
  }
  return { success: true };
}

// v14 B10：运行指标与出站审计 handler 归位（原 handlers.js 内联）
export async function handleGetRuntimeMetrics() {
  return { metrics: metricsSnapshot() };
}

export async function handleGetOutboundAudit(message) {
  return getOutboundAudit(message && message.limit);
}

export async function handleClearOutboundAudit() {
  resetOutboundAudit();
  return { success: true };
}

// v14 B10：领域 handler 段（action → handler 单处声明，handlers.js 聚合展开）
export const diagStatusHandlers = {
  GET_API_STATUS: handleGetApiStatus,
  OPEN_HUB: handleOpenHub,
  LOG_PERF: handleLogPerf,
  SITE_ADAPTER_ALERT: handleSiteAdapterAlert,
  GET_STEAM250_RANK: handleGetSteam250Rank,
  GET_SITE_HEALTH: handleGetSiteHealth,
  GET_STORAGE_HEALTH: handleGetStorageHealth,
  GET_RUNTIME_METRICS: handleGetRuntimeMetrics,
  GET_OUTBOUND_AUDIT: handleGetOutboundAudit,
  CLEAR_OUTBOUND_AUDIT: handleClearOutboundAudit
};
