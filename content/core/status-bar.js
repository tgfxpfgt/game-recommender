/**
 * 游戏雷达 Game Radar - 工作状态/诊断统一浮窗 / Unified Status & Debug Bar
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
import * as float from './floats.js';
import * as common from './common.js';

/** @type {HTMLDivElement|null} */
let statusEl = null;
/** @type {ReturnType<typeof setTimeout>|null} */
let hideTimer = null;
/** @type {any} 最近一次统计（供 popup 重新显示；B9 渲染合并读终态） */
let lastStats = null;
let startTime = 0; // 本次任务开始时间（计时器）/ task start time
let enabled = true; // 总开关（showStatusBar）/ master switch
let debugMode = false; // 调试模式（showDebugPanel）/ debug mode
/** @type {ReturnType<typeof setTimeout>|null} */
let renderTimer = null; // v14.5.0 B9：统计渲染合并窗口

// 统计渲染合并窗口（B9）：列表流程"开始→逐波→收尾"连续 showStats，
// 100ms 窗口内只渲染最后一次（DOM 重建 ×N → ×1）
const SHOW_STATS_COALESCE_MS = 100;
// 统计浮窗自动隐藏延时（v14.6.2：具名单点）
const STATS_AUTO_HIDE_MS = 3000;

// 格式化耗时 / Format elapsed time
function formatElapsed() {
  if (!startTime) return '';
  const secs = ((Date.now() - startTime) / 1000).toFixed(1);
  return secs + 's';
}

// 创建浮窗元素（右下角，经 GR.float 统一管理）
// Create the bar (bottom-right, managed by GR.float)
/** @returns {HTMLDivElement} */
function ensureEl() {
  if (statusEl && statusEl.parentNode) return statusEl;
  statusEl = /** @type {HTMLDivElement} */ (
    float.create(float.ZONE.BOTTOM_RIGHT, 'gr-status-bar', {
      chrome: false,
      width: 380
    })
  );
  return statusEl;
}

// 显示进行中状态（title, current/total 进度, detail）
export function showStatus(title, current, total, detail) {
  if (!enabled) return;
  if (!startTime) startTime = Date.now();
  const el = ensureEl();
  const pct = total > 0 ? Math.round((current / total) * 100) : null;
  // v8.1.0：进度条样式类化（.gr-status-progress 系列，content.css）
  const progressHtml =
    pct === null
      ? `<div class="gr-status-progress"><div class="gr-status-progress-fill" style="width:40%;animation:gr-status-slide 1.2s ease-in-out infinite;"></div></div>`
      : `<div class="gr-status-progress"><div class="gr-status-progress-fill" style="width:${pct}%;"></div></div>`;
  ensureKeyframes();
  el.innerHTML = `
      <div class="gr-status-title"><span>🎮</span><span>${common.escapeHtml(title)}</span></div>
      ${progressHtml}
      ${pct !== null ? `<div class="gr-status-row" style="margin-top:3px;">${current}/${total} · ${pct}%</div>` : ''}
      ${detail ? `<div class="gr-status-row" style="margin-top:2px;">${common.escapeHtml(detail)}</div>` : ''}
    `;
  if (hideTimer) clearTimeout(hideTimer); // 进行中不自动消失
}

// 显示完成统计（3 秒后按调试模式切换为诊断视图或消失）
export function showStats(stats) {
  lastStats = stats || null;
  startTime = 0;
  if (!enabled) return;
  // v14.5.0 B9：渲染合并——100ms 窗口内多次调用只渲染最后一次（读 lastStats
  // 终态）；lastStats 本身保持同步更新（SHOW_LAST_STATS 重显语义不变）
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    renderStats();
  }, SHOW_STATS_COALESCE_MS);
}

// 渲染统计浮窗（B9：由 showStats 的合并窗口调度）
function renderStats() {
  if (!enabled) return; // 合并窗口内被关闭 → 放弃渲染
  const stats = lastStats;
  const elapsed = formatElapsed();
  const el = ensureEl();
  // v7.4.0：行支持 {text, click} 对象——可点击行（如"恢复被过滤游戏"）
  // Rows may be strings or {text, click} objects (interactive rows)
  const rows =
    stats && stats.rows && stats.rows.length > 0
      ? stats.rows
          .map((r, i) => {
            if (r && typeof r === 'object' && typeof r.click === 'function') {
              return `<div data-gr-row="${i}" class="gr-status-row-clickable">${common.escapeHtml(r.text)}</div>`;
            }
            return `<div class="gr-status-row">${common.escapeHtml(String(r))}</div>`;
          })
          .join('')
      : '';
  el.innerHTML = `
      <div class="gr-status-title"><span>✅</span><span>${common.escapeHtml(stats ? stats.title || '完成' : '完成')}</span>
        ${elapsed ? `<span class="gr-status-elapsed">⏱ ${common.escapeHtml(elapsed)}</span>` : ''}
      </div>
      ${stats && stats.summary ? `<div class="gr-status-summary">${common.escapeHtml(stats.summary)}</div>` : ''}
      ${rows}
    `;
  // 可点击行事件委托（点击执行对应回调）
  el.querySelectorAll('[data-gr-row]').forEach((rowEl) => {
    rowEl.addEventListener('click', () => {
      const row = (stats && stats.rows && stats.rows[Number(rowEl.dataset.grRow)]) || null;
      if (row && typeof row.click === 'function') row.click();
    });
  });
  if (hideTimer) clearTimeout(hideTimer);
  // 3 秒后消失（v14 B4：调试视图刷新回调接线整体已死——debugRefreshHandler
  // 从未被注册，setDebugRefreshHandler 已删）
  hideTimer = setTimeout(() => {
    hide();
  }, STATS_AUTO_HIDE_MS);
}

// 渲染诊断视图：经 GR.float 统一管理（chrome 标题栏，✕ 关闭后不再自动复活）。
// v3.3.15：仅 debugMode（showDebugPanel）开启时显示——此前 dbg 日志的
// scheduleDebugUpdate 会无条件刷新调试视图，导致 showDebugPanel=false 时
// 页面仍出现"🔧 游戏雷达 Game Radar 调试"浮窗。
// Render the debug view (managed by GR.float; once dismissed it stays closed).
// Since v3.3.15 it only shows when debugMode is on — dbg()'s refresh used to
// render it regardless of the showDebugPanel setting.
let debugDismissed = false;
export function showDebugView(html) {
  if (debugDismissed) return; // 用户已关闭：不自动复活 / user dismissed: keep closed
  if (!debugMode) return; // v3.3.15：调试视图仅 showDebugPanel 开启时显示
  statusEl = float.create(float.ZONE.BOTTOM_RIGHT, 'gr-status-bar', {
    chrome: true,
    width: 380,
    title: '🔧 游戏雷达 Game Radar 调试',
    onClose: () => {
      debugDismissed = true;
      statusEl = null;
    }
  });
  statusEl.innerHTML = html;
  if (hideTimer) clearTimeout(hideTimer); // 诊断视图常驻 / persistent
}

// 调试模式开关（由设置 showDebugPanel 控制；重新开启时允许调试视图再次显示）
// Debug-mode switch (controlled by settings.showDebugPanel; re-enabling lifts
// the dismissal so the debug view can show again)
export function setEnabled(v) {
  enabled = !!v;
}

export function setDebugMode(v) {
  debugMode = !!v;
  if (debugMode) debugDismissed = false;
}

// 隐藏浮窗（经 GR.float 移除）/ Hide the bar (removed via GR.float)
export function hide() {
  statusEl = null;
  float.remove('gr-status-bar');
}

// 重新显示最近统计（弹窗显式调用，忽略总开关）
export function showLastStats() {
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
