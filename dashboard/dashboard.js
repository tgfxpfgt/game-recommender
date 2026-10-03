/* global loadStats loadRuntimeLogs loadBackups loadOutboundAudit renderOutboundAudit loadTrends loadSteamRecommendations exportLogs clearLogs clearAudit createBackup exportTrendsCsv exportGamesCsv exportInsightsJson exportLogsCsv exportAuditCsv */
/**
 * 游戏雷达 Game Radar - Dashboard 壳 / Dashboard Shell
 *
 * v14 B1：dashboard.js 拆分后仅保留壳——DOMContentLoaded 装配（初始加载 +
 * 事件绑定，数据获取经 window.__GR_MSG__.sendMessage）与跨模块工具。
 * 经典脚本按 dashboard.html 加载顺序共享全局作用域（无构建体系）。
 *
 * 模块地图 / Module map：
 * - dash-export.js      CSV/JSON 导出（trends/games/insights/logs/audit 用其 toCsv/downloadCsv）
 * - dash-insights.js    标签云 / 推荐反馈 / 收藏清单 / Steam 推荐 / 跨缓存搜索
 * - dash-stats.js       概览统计 / 行为趋势图 / 下载方式 / 游戏明细表 / 行为日志表
 * - dash-logs.js        运行日志查看 + 统一分页（三表共用）
 * - dash-diagnostics.js 出站审计 / 健康卡 / API 限流 / 启动耗时 / 运行指标
 * - dash-backups.js     备份列表与创建/恢复/删除
 */

document.addEventListener('DOMContentLoaded', () => {
  // v6.4.19：应用皮肤主题
  (async () => {
    try {
      const r = await window.__GR_MSG__.sendMessage({ action: 'GET_SETTINGS' });
      const s = r && r.settings;
      if (s && globalThis.__GR_SETTINGS_UTILS__) {
        const u = globalThis.__GR_SETTINGS_UTILS__;
        if (u.applyPageTheme) u.applyPageTheme(s);
        // v10.7.0：旧入口兜底（工具文件过旧时）
        else {
          if (u.applyThemeAuto) u.applyThemeAuto(s);
          else if (u.applyTheme) u.applyTheme(s.uiTheme);
          if (u.applyCustomTheme) u.applyCustomTheme(s.customThemeCss);
        }
      }
    } catch {}
  })();
  loadStats();
  loadRuntimeLogs();
  loadBackups();

  // v6.4.11：返回设置中心（hub 内切面板 / 独立打开新标签）
  const hubBtn = document.getElementById('hubBtn');
  if (hubBtn) {
    hubBtn.addEventListener('click', () => {
      const utils = globalThis.__GR_SETTINGS_UTILS__;
      if (utils && utils.goHub) utils.goHub('dashboard');
    });
  }

  document.getElementById('refreshBtn').addEventListener('click', loadStats);
  document.getElementById('steamRecBtn').addEventListener('click', loadSteamRecommendations);

  // 运行日志 / Runtime logs
  document.getElementById('logLevelFilter').addEventListener('change', loadRuntimeLogs);
  document.getElementById('exportLogsBtn').addEventListener('click', exportLogs);
  document.getElementById('clearLogsBtn').addEventListener('click', clearLogs);

  // 出站请求审计 / Outbound audit
  loadOutboundAudit();
  document.getElementById('refreshAuditBtn').addEventListener('click', loadOutboundAudit);
  document.getElementById('clearAuditBtn').addEventListener('click', clearAudit);

  // 备份 / Backups
  document.getElementById('createBackupBtn').addEventListener('click', createBackup);

  // 行为趋势 / Trends (v4.0.0)
  loadTrends();
  document.getElementById('trendGranularity').addEventListener('change', loadTrends);
  document.getElementById('exportTrendsCsvBtn').addEventListener('click', exportTrendsCsv);
  document.getElementById('exportGamesCsvBtn').addEventListener('click', exportGamesCsv);
  const jsonBtn = document.getElementById('exportInsightsJsonBtn');
  if (jsonBtn) jsonBtn.addEventListener('click', exportInsightsJson); // v11.0 B7
  document.getElementById('exportLogsCsvBtn').addEventListener('click', exportLogsCsv);

  // 出站审计筛选/导出 (v4.1.0)
  document.getElementById('auditHostFilter').addEventListener('input', renderOutboundAudit);
  document.getElementById('exportAuditCsvBtn').addEventListener('click', exportAuditCsv);
});

// v10.9.1：日期安全格式化（Invalid Date → '-'，跨边界时间戳异型兜底）
// Date-safe formatting helper (P3 cleanup: no more "Invalid Date" literals).
// 供 stats/logs/diagnostics/backups 各模块按名调用（跨文件全局）
// Used by stats/logs/diagnostics/backups via classic-script global scope.
// eslint-disable-next-line no-unused-vars -- 跨文件使用，本文件无消费方
function safeDateText(ts, fmt) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '-';
  return fmt ? d.toLocaleString('zh-CN', fmt) : d.toLocaleDateString('zh-CN');
}
