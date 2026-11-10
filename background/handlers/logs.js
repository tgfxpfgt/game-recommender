/**
 * 游戏雷达 Game Radar - 消息处理：运行日志 / Runtime-Log Handlers
 *
 * v14 B10：由 handlers.js 迁出——运行日志读取/清空/导出。
 * Moved from handlers.js (B10): runtime log read/clear/export.
 */
import { getRuntimeLogs, clearRuntimeLogs } from '../storage/logger.js';
import { getSettings } from '../core/settings.js';
import { stripSecrets } from '../core/sanitize.js'; // v14.11 B3：脱敏单源
import { metricsSnapshot } from '../core/metrics.js';
import { getSteamApiStatus, getDomainStatus } from '../core/api-monitor.js';
import { getOutboundAudit } from '../core/outbound-audit.js';
import { getFlushHealth } from '../storage/flush-health.js';
import { getNotifications, markNotificationsRead } from '../storage/notifications.js'; // v14.16.0 N6
import { buildUsageEvidenceReport } from '../storage/usage-evidence.js'; // v14.25.0：使用证据档案

// v14 B10：领域 handler 段（action → handler 单处声明，handlers.js 聚合展开）
export const logsHandlers = {
  GET_RUNTIME_LOGS: async (msg) => ({ logs: await getRuntimeLogs(msg.limit) }),
  CLEAR_RUNTIME_LOGS: async () => {
    await clearRuntimeLogs();
    return { success: true };
  },
  EXPORT_LOGS: async () => ({ logs: await getRuntimeLogs() }),
  GET_NOTIFICATIONS: async () => ({ success: true, ...(await getNotifications()) }),
  MARK_NOTIFICATIONS_READ: async () => markNotificationsRead(),
  // v14.15.0 O7：一键诊断包——设置（stripSecrets 脱敏）+ 运行指标 + API 状态
  //（含 failAttribution 环形缓冲）+ 出站审计 + flush 健康 + 最近日志，一 JSON
  // 下载；issue 一来一回闭环（v10.9.2"用户侧环境不可远程推断"教训的收集端）。
  GET_DIAGNOSTIC_BUNDLE: async () => {
    const [settings, logs, usageEvidence] = await Promise.all([
      getSettings(),
      getRuntimeLogs(),
      buildUsageEvidenceReport() // v14.25.0：使用证据档案随诊断包导出
    ]);
    return {
      success: true,
      bundle: {
        generatedAt: new Date().toISOString(),
        version: chrome.runtime.getManifest().version,
        settings: stripSecrets(settings),
        metrics: metricsSnapshot(),
        apiStatus: getSteamApiStatus(),
        domainStatus: getDomainStatus(),
        outboundAudit: getOutboundAudit(),
        flushHealth: getFlushHealth(),
        usageEvidence,
        logs
      }
    };
  }
};
