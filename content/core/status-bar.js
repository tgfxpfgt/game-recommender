/**
 * Game Recommender - 工作状态浮窗 / Work Status Bar
 *
 * 所有扩展工作的页面（列表/详情/Steam 页）显示当前工作状态与进度，
 * 完成后显示统计数据，3 秒后自动消失；可通过弹窗重新显示最近统计。
 * Shows current work status with progress on every page the extension works
 * on; displays stats when done, auto-dismisses after 3s; the popup can
 * re-show the latest stats.
 */
(function (global) {
  'use strict';

  const GR = (global.__GR__ = global.__GR__ || {});

  let statusEl = null;
  let hideTimer = null;
  let lastStats = null; // 最近一次统计（供 popup 重新显示）/ latest stats

  // 创建浮窗元素（右下角）/ Create the status bar element (bottom-right)
  function ensureEl() {
    if (statusEl && statusEl.parentNode) return statusEl;
    statusEl = document.createElement('div');
    statusEl.id = 'gr-status-bar';
    statusEl.style.cssText = `
      position:fixed;right:12px;bottom:12px;z-index:2147483647;
      min-width:220px;max-width:360px;
      background:rgba(15,15,26,0.95);border:1px solid #2a475e;border-radius:6px;
      padding:10px 12px;font:12px/1.6 sans-serif;color:#c7d5e0;
      box-shadow:0 4px 16px rgba(0,0,0,0.5);
      transition:opacity 0.3s;
    `;
    document.body.appendChild(statusEl);
    return statusEl;
  }

  // 显示进行中状态（title 标题, current/total 进度, detail 附加信息）
  // Show an in-progress status (title, progress, optional detail)
  function showStatus(title, current, total, detail) {
    const el = ensureEl();
    const pct = total > 0 ? Math.round(current / total * 100) : null;
    const progressHtml = pct === null
      ? `<div style="height:4px;background:#2a475e;border-radius:2px;margin-top:6px;overflow:hidden;"><div style="width:40%;height:100%;background:#66c0f4;border-radius:2px;animation:gr-status-slide 1.2s ease-in-out infinite;"></div></div>`
      : `<div style="height:4px;background:#2a475e;border-radius:2px;margin-top:6px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:#66c0f4;border-radius:2px;transition:width 0.3s;"></div></div>`;
    if (!document.getElementById('gr-status-keyframes')) {
      const style = document.createElement('style');
      style.id = 'gr-status-keyframes';
      style.textContent = `@keyframes gr-status-slide { 0%,100% { margin-left:0; } 50% { margin-left:60%; } }`;
      document.head.appendChild(style);
    }
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;color:#fff;font-weight:bold;font-size:12px;">
        <span>🎮</span><span>${GR.common.escapeHtml(title)}</span>
      </div>
      ${progressHtml}
      ${pct !== null ? `<div style="font-size:10px;color:#8f98a0;margin-top:3px;">${current}/${total} · ${pct}%</div>` : ''}
      ${detail ? `<div style="font-size:11px;color:#8f98a0;margin-top:2px;">${GR.common.escapeHtml(detail)}</div>` : ''}
    `;
    // 进行中不自动消失 / in-progress bars don't auto-dismiss
    clearTimeout(hideTimer);
  }

  // 显示完成统计（3 秒后自动消失）/ Show completion stats (auto-dismiss in 3s)
  function showStats(stats) {
    lastStats = stats || null;
    const el = ensureEl();
    const rows = (stats && stats.rows && stats.rows.length > 0)
      ? stats.rows.map(r => `<div style="font-size:11px;color:#8f98a0;">${GR.common.escapeHtml(r)}</div>`).join('')
      : '';
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;color:#fff;font-weight:bold;font-size:12px;">
        <span>✅</span><span>${GR.common.escapeHtml(stats ? (stats.title || '完成') : '完成')}</span>
      </div>
      ${stats && stats.summary ? `<div style="font-size:12px;color:#66c0f4;margin-top:4px;">${GR.common.escapeHtml(stats.summary)}</div>` : ''}
      ${rows}
    `;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 3000);
  }

  // 隐藏浮窗 / Hide the status bar
  function hide() {
    if (statusEl && statusEl.parentNode) {
      statusEl.style.opacity = '0';
      setTimeout(() => { if (statusEl && statusEl.parentNode) statusEl.remove(); }, 300);
    }
  }

  // 重新显示最近统计（弹窗调用）/ Re-show the latest stats (called by the popup)
  function showLastStats() {
    if (lastStats) showStats(lastStats);
  }

  GR.status = { showStatus, showStats, showLastStats, hide };
})(typeof globalThis !== 'undefined' ? globalThis : this);
