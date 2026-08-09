/**
 * Game Recommender - 工作状态/诊断统一浮窗 / Unified Status & Debug Bar
 *
 * 单一右下角浮窗，按先后关系展示：
 *   1. 进行中：任务标题 + 进度条
 *   2. 完成：统计数据 + 耗时（⏱）
 *   3. 3 秒后：若开启调试（showDebugPanel）则切换为诊断视图常驻（✕ 关闭），
 *      否则浮窗消失
 * 弹窗可通过"显示最近统计"显式重显；总开关（showStatusBar）控制自动显示。
 * A single bottom-right bar showing, in order: in-progress status with a
 * progress bar → completion stats with elapsed time → (3s later) the debug
 * view when debugging is enabled (dismissible), otherwise it disappears.
 */
(function (global) {
  'use strict';

  const GR = (global.__GR__ = global.__GR__ || {});

  let statusEl = null;
  let hideTimer = null;
  let lastStats = null; // 最近一次统计（供 popup 重新显示）/ latest stats
  let startTime = 0;    // 本次任务开始时间（计时器）/ task start time
  let enabled = true;   // 总开关（showStatusBar）/ master switch
  let debugMode = false; // 调试模式（showDebugPanel）/ debug mode

  // 格式化耗时 / Format elapsed time
  function formatElapsed() {
    if (!startTime) return '';
    const secs = ((Date.now() - startTime) / 1000).toFixed(1);
    return secs + 's';
  }

  // 创建浮窗元素（右下角）/ Create the bar (bottom-right)
  function ensureEl() {
    if (statusEl && statusEl.parentNode) return statusEl;
    statusEl = document.createElement('div');
    statusEl.id = 'gr-status-bar';
    statusEl.style.cssText = `
      position:fixed;right:12px;bottom:12px;z-index:2147483647;
      min-width:220px;max-width:380px;
      background:rgba(15,15,26,0.95);border:1px solid #2a475e;border-radius:6px;
      padding:10px 12px;font:12px/1.6 sans-serif;color:#c7d5e0;
      box-shadow:0 4px 16px rgba(0,0,0,0.5);
      transition:opacity 0.3s;
    `;
    document.body.appendChild(statusEl);
    return statusEl;
  }

  // 显示进行中状态（title, current/total 进度, detail）
  function showStatus(title, current, total, detail) {
    if (!enabled) return;
    if (!startTime) startTime = Date.now();
    const el = ensureEl();
    const pct = total > 0 ? Math.round(current / total * 100) : null;
    const progressHtml = pct === null
      ? `<div style="height:4px;background:#2a475e;border-radius:2px;margin-top:6px;overflow:hidden;"><div style="width:40%;height:100%;background:#66c0f4;border-radius:2px;animation:gr-status-slide 1.2s ease-in-out infinite;"></div></div>`
      : `<div style="height:4px;background:#2a475e;border-radius:2px;margin-top:6px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:#66c0f4;border-radius:2px;transition:width 0.3s;"></div></div>`;
    ensureKeyframes();
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;color:#fff;font-weight:bold;font-size:12px;">
        <span>🎮</span><span>${GR.common.escapeHtml(title)}</span>
      </div>
      ${progressHtml}
      ${pct !== null ? `<div style="font-size:10px;color:#8f98a0;margin-top:3px;">${current}/${total} · ${pct}%</div>` : ''}
      ${detail ? `<div style="font-size:11px;color:#8f98a0;margin-top:2px;">${GR.common.escapeHtml(detail)}</div>` : ''}
    `;
    clearTimeout(hideTimer); // 进行中不自动消失
  }

  // 显示完成统计（3 秒后按调试模式切换为诊断视图或消失）
  function showStats(stats) {
    lastStats = stats || null;
    const elapsed = formatElapsed();
    startTime = 0;
    if (!enabled) return;
    const el = ensureEl();
    const rows = (stats && stats.rows && stats.rows.length > 0)
      ? stats.rows.map(r => `<div style="font-size:11px;color:#8f98a0;">${GR.common.escapeHtml(r)}</div>`).join('')
      : '';
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;color:#fff;font-weight:bold;font-size:12px;">
        <span>✅</span><span>${GR.common.escapeHtml(stats ? (stats.title || '完成') : '完成')}</span>
        ${elapsed ? `<span style="margin-left:auto;font-size:10px;color:#8f98a0;">⏱ ${GR.common.escapeHtml(elapsed)}</span>` : ''}
      </div>
      ${stats && stats.summary ? `<div style="font-size:12px;color:#66c0f4;margin-top:4px;">${GR.common.escapeHtml(stats.summary)}</div>` : ''}
      ${rows}
    `;
    clearTimeout(hideTimer);
    // 3 秒后：调试模式 → 切换诊断视图；否则消失
    hideTimer = setTimeout(() => {
      if (debugMode && GR.debug) {
        GR.debug.refreshInBar();
      } else {
        hide();
      }
    }, 3000);
  }

  // 渲染诊断视图（调试模式常驻，✕ 关闭）
  // Render the debug view (persistent in debug mode; ✕ dismisses)
  function showDebugView(html) {
    const el = ensureEl();
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;color:#fff;font-weight:bold;font-size:12px;">
        <span>🔧</span><span>Game Recommender 调试</span>
        <span id="gr-status-close" style="margin-left:auto;cursor:pointer;color:#666;font-size:14px;">✕</span>
      </div>
      ${html}
    `;
    const close = el.querySelector('#gr-status-close');
    if (close) close.addEventListener('click', hide);
    clearTimeout(hideTimer); // 诊断视图常驻 / persistent
  }

  // 调试模式开关（由设置 showDebugPanel 控制）
  // Debug-mode switch (controlled by settings.showDebugPanel)
  function setDebugMode(v) {
    debugMode = !!v;
    if (debugMode && GR.debug) GR.debug.refreshInBar();
  }

  // 隐藏浮窗 / Hide the bar
  function hide() {
    if (statusEl && statusEl.parentNode) {
      statusEl.style.opacity = '0';
      setTimeout(() => { if (statusEl && statusEl.parentNode) statusEl.remove(); }, 300);
    }
  }

  // 重新显示最近统计（弹窗显式调用，忽略总开关）
  function showLastStats() {
    if (!lastStats) return;
    const wasEnabled = enabled;
    enabled = true;
    showStats(lastStats);
    enabled = wasEnabled;
  }

  // 进度条动画关键帧（仅注入一次）/ Progress keyframes (once)
  function ensureKeyframes() {
    if (document.getElementById('gr-status-keyframes')) return;
    const style = document.createElement('style');
    style.id = 'gr-status-keyframes';
    style.textContent = `@keyframes gr-status-slide { 0%,100% { margin-left:0; } 50% { margin-left:60%; } }`;
    document.head.appendChild(style);
  }

  GR.status = {
    showStatus, showStats, showLastStats, hide,
    setEnabled: (v) => { enabled = !!v; },
    setDebugMode,
    showDebugView
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
