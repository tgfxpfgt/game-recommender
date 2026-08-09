/**
 * Game Recommender - 调试模块 / Debug Module
 *
 * 调试状态与日志；诊断视图渲染到统一状态浮窗（status-bar）中，
 * 开启调试（showDebugPanel）时统计显示 3 秒后自动切换为诊断视图。
 * Debug state & logs; the debug view renders inside the unified status bar —
 * with debugging enabled it replaces the stats after 3 seconds.
 */
(function (global) {
  'use strict';

  const GR = (global.__GR__ = global.__GR__ || {});

  // ============ Debug State / 调试状态 ============
  const DEBUG = {
    enabled: true,
    pageType: '未检测',
    adapter: '无',
    siteTracked: false,
    steamStatus: '未查询',
    downloadEvents: 0,
    gameName: '',
    errors: [],
    logs: []
  };

  // 防抖更新诊断视图 / Debounced debug-view refresh
  let debugViewTimer = null;
  function scheduleDebugUpdate() {
    if (debugViewTimer) return;
    debugViewTimer = setTimeout(() => {
      debugViewTimer = null;
      refreshInBar();
    }, 250);
  }

  // 记录调试日志（带时间戳，最多 20 条）/ Record a debug log line (max 20)
  function dbg(msg) {
    DEBUG.logs.unshift(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (DEBUG.logs.length > 20) DEBUG.logs.pop();
    scheduleDebugUpdate();
  }

  // 构建诊断视图 HTML / Build the debug-view HTML
  function buildDebugHtml() {
    const statusColor = (s) => s.startsWith('✅') ? '#2ecc71' : s.startsWith('❌') ? '#e74c3c' : s.startsWith('⚠️') ? '#f39c12' : '#66c0f4';
    return `
      <div style="margin-top:6px;font-size:11px;color:#aaa;">
        <div>页面类型: <span style="color:${statusColor(DEBUG.pageType === '未检测' ? '⚠️' : '✅')}">${GR.common.escapeHtml(DEBUG.pageType)}</span></div>
        <div>适配器: <span style="color:#66c0f4">${GR.common.escapeHtml(DEBUG.adapter)}</span></div>
        <div>网站追踪: <span style="color:${DEBUG.siteTracked ? '#2ecc71' : '#e74c3c'}">${DEBUG.siteTracked ? '是' : '否'}</span></div>
        <div>游戏名: <span style="color:#fff">${GR.common.escapeHtml(DEBUG.gameName || '未检测')}</span></div>
        <div>Steam: <span style="color:${statusColor(DEBUG.steamStatus)}">${GR.common.escapeHtml(DEBUG.steamStatus)}</span></div>
        <div>下载事件: <span style="color:${DEBUG.downloadEvents > 0 ? '#2ecc71' : '#aaa'}">${DEBUG.downloadEvents}</span></div>
        <div style="margin-top:6px;border-top:1px solid #333;padding-top:4px;color:#666;font-size:10px;">
          ${(DEBUG.logs || []).slice(0, 8).map(l => `<div>${GR.common.escapeHtml(l)}</div>`).join('')}
        </div>
      </div>
    `;
  }

  // 在统一浮窗中刷新诊断视图（浮窗存在时）/ Refresh the debug view in the status bar
  function refreshInBar() {
    if (GR.status) GR.status.showDebugView(buildDebugHtml());
  }

  GR.debug = {
    DEBUG,
    dbg,
    scheduleDebugUpdate,
    buildDebugHtml,
    refreshInBar
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
