/**
 * Game Recommender - 调试模块 / Debug Module
 *
 * 调试状态、日志、调试面板与列表页诊断条（页面右下角统计浮条）。
 * Debug state, logs, the floating debug panel and the list-page diagnostic strip.
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

  // 防抖更新调试面板：高频日志时避免每次都重建 DOM，降低 CPU 占用。
  // Debounced debug-panel update (avoids rebuilding the DOM on every log)
  let debugPanelTimer = null;
  function scheduleDebugUpdate() {
    if (!debugPanel) return; // 面板未创建则跳过 / Skip if panel not created
    if (debugPanelTimer) return; // 已有待刷新则跳过 / Skip if a refresh is pending
    debugPanelTimer = setTimeout(() => {
      debugPanelTimer = null;
      updateDebugPanel();
    }, 250);
  }

  // 记录调试日志（带时间戳，最多 20 条）/ Record a debug log line (max 20)
  function dbg(msg) {
    DEBUG.logs.unshift(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (DEBUG.logs.length > 20) DEBUG.logs.pop();
    scheduleDebugUpdate();
  }

  // ============ 列表页诊断条 / List-Page Diagnostic Strip ============
  // 统计浮条（提取/查询/徽章/未找到/错误），8 秒后自动消失或点击 ✕ 关闭。
  // A transient stats strip; auto-dismissed after 8s or on ✕ click.
  let diagStripTimer = null;
  function showDiagStrip({ extracted, queried, shown, notFound, notFoundNames, error }) {
    try {
      if (document.getElementById('gr-diag-strip')) return;
      const strip = document.createElement('div');
      strip.id = 'gr-diag-strip';
      strip.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:380px;background:rgba(15,15,26,0.95);border:1px solid #2a475e;border-radius:6px;padding:10px 12px;font:12px/1.6 monospace;color:#c7d5e0;box-shadow:0 4px 16px rgba(0,0,0,0.5);';
      strip.innerHTML = `
        <div style="font-weight:bold;color:#66c0f4;margin-bottom:4px;">🎮 列表页诊断 <span id="gr-diag-close" style="cursor:pointer;float:right;color:#666;">✕</span></div>
        <div>提取: <b>${extracted}</b> 游戏 | 查询: <b>${queried}</b> | 徽章: <b>${shown}</b> | 未找到: <b>${notFound}</b></div>
        ${error ? `<div style="color:#e74c3c;">错误: ${GR.common.escapeHtml(error)}</div>` : ''}
        ${notFoundNames && notFoundNames.length ? `<div style="color:#f39c12;margin-top:2px;">未找到: ${GR.common.escapeHtml(notFoundNames.slice(0, 5).join('、'))}${notFoundNames.length > 5 ? '...' : ''}</div>` : ''}
      `;
      document.body.appendChild(strip);
      const close = strip.querySelector('#gr-diag-close');
      if (close) close.addEventListener('click', () => { if (strip.parentNode) strip.remove(); });
      if (diagStripTimer) clearTimeout(diagStripTimer);
      diagStripTimer = setTimeout(() => { if (strip.parentNode) strip.remove(); }, 8000);
    } catch (e) { /* 诊断条渲染失败不影响主流程 */ }
  }

  // ============ 浮动调试窗口 / Floating Debug Panel ============
  let debugPanel = null;

  function initDebugPanel() {
    debugPanel = document.createElement('div');
    debugPanel.id = 'gr-debug-panel';
    debugPanel.style.cssText = `
      position:fixed;top:10px;left:10px;z-index:2147483647;
      width:300px;max-height:400px;overflow-y:auto;
      background:rgba(15,15,26,0.95);border:1px solid #333;
      border-radius:8px;padding:12px;font-size:12px;
      font-family:monospace;color:#aaa;line-height:1.5;
      box-shadow:0 4px 20px rgba(0,0,0,0.5);
      transition:opacity 0.3s;
    `;
    document.body.appendChild(debugPanel);
    updateDebugPanel();
    dbg('调试面板已加载');
  }

  function updateDebugPanel() {
    if (!debugPanel) return;
    const statusColor = (s) => s.startsWith('✅') ? '#2ecc71' : s.startsWith('❌') ? '#e74c3c' : s.startsWith('⚠️') ? '#f39c12' : '#66c0f4';

    debugPanel.innerHTML = `
      <button id="gr-debug-min-btn" style="position:absolute;top:4px;right:8px;background:none;border:none;color:#666;cursor:pointer;font-size:16px;">—</button>
      <div style="color:#66c0f4;font-weight:bold;margin-bottom:8px;font-size:13px">🎮 Game Recommender 调试</div>
      <div>页面类型: <span style="color:${statusColor(DEBUG.pageType === '未检测' ? '⚠️' : '✅')}">${DEBUG.pageType}</span></div>
      <div>适配器: <span style="color:#66c0f4">${DEBUG.adapter}</span></div>
      <div>网站追踪: <span style="color:${DEBUG.siteTracked ? '#2ecc71' : '#e74c3c'}">${DEBUG.siteTracked ? '是' : '否'}</span></div>
      <div>游戏名: <span style="color:#fff">${GR.common.escapeHtml(DEBUG.gameName || '未检测')}</span></div>
      <div>Steam: <span style="color:${statusColor(DEBUG.steamStatus)}">${DEBUG.steamStatus}</span></div>
      <div>下载事件: <span style="color:${DEBUG.downloadEvents > 0 ? '#2ecc71' : '#aaa'}">${DEBUG.downloadEvents}</span></div>
      <div style="margin-top:8px;border-top:1px solid #333;padding-top:6px;color:#666;font-size:11px">
        ${(DEBUG.logs || []).slice(0, 8).map(l => `<div>${GR.common.escapeHtml(l)}</div>`).join('')}
      </div>
    `;

    // 绑定最小化/展开按钮（内联 onclick 会被页面 CSP 拦截，改为 JS 绑定）
    // Bind minimize/expand (inline onclick is blocked by page CSP)
    const minBtn = debugPanel.querySelector('#gr-debug-min-btn');
    if (minBtn) {
      minBtn.addEventListener('click', () => {
        const isCollapsed = debugPanel.style.height === '30px';
        debugPanel.style.height = isCollapsed ? 'auto' : '30px';
        debugPanel.style.overflow = isCollapsed ? 'visible' : 'hidden';
        minBtn.textContent = isCollapsed ? '—' : '+';
      });
    }
  }

  GR.debug = {
    DEBUG,
    dbg,
    scheduleDebugUpdate,
    initDebugPanel,
    updateDebugPanel,
    showDiagStrip
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
