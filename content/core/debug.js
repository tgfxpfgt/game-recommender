/**
 * 游戏雷达 Game Radar - 调试模块 / Debug Module
 *
 * 调试状态与日志；诊断视图渲染到统一状态浮窗（status-bar）中，
 * 开启调试（showDebugPanel）时统计显示 3 秒后自动切换为诊断视图。
 * Debug state & logs; the debug view renders inside the unified status bar —
 * with debugging enabled it replaces the stats after 3 seconds.
 */
import * as common from './common.js';
import * as status from './status-bar.js';

// ============ Debug State / 调试状态 ============
export const DEBUG = {
  pageType: '未检测',
  adapter: '无',
  siteTracked: false,
  steamStatus: '未查询',
  downloadEvents: 0,
  gameName: '',
  logs: []
};

// 防抖更新诊断视图 / Debounced debug-view refresh
let debugViewTimer = null;
export function scheduleDebugUpdate() {
  if (debugViewTimer) return;
  debugViewTimer = setTimeout(() => {
    debugViewTimer = null;
    refreshInBar();
  }, 250);
}

// 记录调试日志（带时间戳，最多 20 条）/ Record a debug log line (max 20)
export function dbg(msg) {
  DEBUG.logs.unshift(`[${new Date().toLocaleTimeString()}] ${msg}`);
  if (DEBUG.logs.length > 20) DEBUG.logs.pop();
  scheduleDebugUpdate();
}

// 构建诊断视图 HTML / Build the debug-view HTML
export function buildDebugHtml() {
  const stateCls = (s) =>
    s.startsWith('✅')
      ? 'gr-debug-state-ok'
      : s.startsWith('❌')
        ? 'gr-debug-state-bad'
        : s.startsWith('⚠️')
          ? 'gr-debug-state-warn'
          : 'gr-debug-state-info';
  // v8.1.0：诊断视图类化（.gr-debug-*，content.css）
  return `
      <div class="gr-debug-view">
        <div class="gr-debug-row">页面类型: <span class="${stateCls(DEBUG.pageType === '未检测' ? '⚠️' : '✅')}">${common.escapeHtml(DEBUG.pageType)}</span></div>
        <div class="gr-debug-row">适配器: <span class="gr-debug-state-info">${common.escapeHtml(DEBUG.adapter)}</span></div>
        <div class="gr-debug-row">网站追踪: <span class="${DEBUG.siteTracked ? 'gr-debug-state-ok' : 'gr-debug-state-bad'}">${DEBUG.siteTracked ? '是' : '否'}</span></div>
        <div class="gr-debug-row">游戏名: <span style="color:var(--gr-float-text-bright, #fff)">${common.escapeHtml(DEBUG.gameName || '未检测')}</span></div>
        <div class="gr-debug-row">Steam: <span class="${stateCls(DEBUG.steamStatus)}">${common.escapeHtml(DEBUG.steamStatus)}</span></div>
        <div class="gr-debug-row">下载事件: <span class="${DEBUG.downloadEvents > 0 ? 'gr-debug-state-ok' : 'gr-debug-state-warn'}">${DEBUG.downloadEvents}</span></div>
        <div class="gr-debug-log">
          ${(DEBUG.logs || [])
            .slice(0, 8)
            .map((l) => `<div>${common.escapeHtml(l)}</div>`)
            .join('')}
        </div>
      </div>
    `;
}

// 在统一浮窗中刷新诊断视图（浮窗存在时）/ Refresh the debug view in the status bar
export function refreshInBar() {
  if (status) status.showDebugView(buildDebugHtml());
}
