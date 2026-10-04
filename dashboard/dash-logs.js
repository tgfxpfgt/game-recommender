/* global renderGameTable cachedGames renderOutboundAudit safeDateText */
/* eslint-disable no-unused-vars */
/**
 * 游戏雷达 Game Radar - Dashboard 运行日志与分页模块 / Dashboard Logs & Pagination Module
 *
 * v14 B1：由 dashboard.js 拆分——运行日志查看（级别筛选/统计/导出/清空）
 * 与 v9.2.1 统一分页（游戏记录/运行日志/出站审计三表共用）。
 * Split from dashboard.js (B1): runtime log viewer (filter/stats/export/clear)
 * and the v9.2.1 unified pagination shared by the three growing tables.
 *
 * 依赖（经典脚本跨文件全局作用域，事件/异步回调期调用）：
 * - dash-stats.js：renderGameTable / cachedGames（games 分页重渲染）
 * - dash-diagnostics.js：renderOutboundAudit（audit 分页重渲染）
 * - dashboard.js（壳）：safeDateText
 * 共享状态：cachedLogs / PAGERS（本文件定义）。
 */

// ============ 运行日志 / Runtime Logs ============
let cachedLogs = [];

// 从后台加载运行日志（最多 200 条）/ Load runtime logs from background (max 200)
async function loadRuntimeLogs() {
  const container = document.getElementById('runtimeLogList');
  try {
    const response = await window.__GR_MSG__.sendMessage({ action: 'GET_RUNTIME_LOGS', limit: 200 });
    cachedLogs = (response && response.logs) || [];
    renderRuntimeLogs();
  } catch (e) {
    container.innerHTML = `<div class="no-data">加载日志失败: ${escapeHtml(window.__GR_MSG__.toUserMessage(e))}</div>`;
  }
}

// 渲染日志列表（按级别筛选，最新在前）/ Render logs (level-filtered, newest first)
function renderRuntimeLogs() {
  const container = document.getElementById('runtimeLogList');
  renderLogLevelStats(cachedLogs); // v7.1.0：级别统计
  const filter = document.getElementById('logLevelFilter').value;

  let logs = cachedLogs;
  if (filter !== 'all') {
    logs = logs.filter((l) => l.level === filter);
  }

  if (logs.length === 0) {
    container.innerHTML = '<div class="no-data">暂无日志</div>';
    renderPager('logs', 'logPager', 0);
    return;
  }
  const { slice: logSlice, total: logTotal } = paginate('logs', logs);
  renderPager('logs', 'logPager', logTotal);
  logs = logSlice;

  // 倒序显示（最新在前）
  container.innerHTML = [...logs]
    .reverse()
    .map((log) => {
      const time = safeDateText(log.timestamp, {
        // v10.9.1
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      return `<div class="log-entry log-${log.level}">
      <span class="log-time">${time}</span>
      <span class="log-level">${log.level.toUpperCase()}</span>
      <span class="log-module">[${escapeHtml(log.module)}]</span>
      <span class="log-msg">${escapeHtml(log.message)}</span>
      ${log.data ? `<span class="log-data">${escapeHtml(log.data)}</span>` : ''}
    </div>`;
    })
    .join('');
}

// 导出日志为 JSON 文件 / Export logs as a JSON file
async function exportLogs() {
  try {
    const response = await window.__GR_MSG__.sendMessage({ action: 'EXPORT_LOGS' });
    const logs = (response && response.logs) || [];
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `game-recommender-logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('导出失败: ' + window.__GR_MSG__.toUserMessage(e));
  }
}

// 清空运行日志 / Clear runtime logs
async function clearLogs() {
  if (!confirm('确定要清空所有运行日志吗？')) return;
  await window.__GR_MSG__.sendMessage({ action: 'CLEAR_RUNTIME_LOGS' });
  loadRuntimeLogs();
}

// v7.1.0：运行日志级别统计（缓存中按级别计数）
// （在 renderRuntimeLogs 中调用）
function renderLogLevelStats(logs) {
  const el = document.getElementById('logLevelStats');
  if (!el) return;
  const counts = { info: 0, warn: 0, error: 0, debug: 0 };
  (logs || []).forEach((l) => {
    counts[l.level] = (counts[l.level] || 0) + 1;
  });
  el.textContent = `info ${counts.info} · warn ${counts.warn} · error ${counts.error} · debug ${counts.debug}`;
}

// ============ v9.2.1：统一分页（游戏记录/运行日志/出站审计） ============
// Unified pagination for the three growing tables.
const PAGERS = {
  games: { page: 1, pageSize: 20 },
  logs: { page: 1, pageSize: 50 },
  audit: { page: 1, pageSize: 50 }
};

function paginate(key, items) {
  const p = PAGERS[key];
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / p.pageSize));
  if (p.page > pages) p.page = pages;
  const start = (p.page - 1) * p.pageSize;
  return {
    slice: items.slice(start, start + p.pageSize),
    page: p.page,
    pages,
    total,
    start: start + 1,
    end: Math.min(start + p.pageSize, total)
  };
}

// 渲染分页控件（容器 id → 数据来自调用方缓存的 items 长度）
function renderPager(key, containerId, total) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const p = PAGERS[key];
  const pages = Math.max(1, Math.ceil(total / p.pageSize));
  if (pages <= 1) {
    el.innerHTML = '';
    return;
  }
  const start = (p.page - 1) * p.pageSize + 1;
  const end = Math.min(start + p.pageSize - 1, total);
  const pageBtns = [];
  for (let i = 1; i <= pages; i++) {
    pageBtns.push(
      `<button class="gr-btn sm pager-btn${i === p.page ? ' active' : ''}" data-key="${key}" data-page="${i}">${i}</button>`
    );
  }
  el.innerHTML =
    `<span class="pager-info">${start}-${end} / ${total} 条</span>` +
    `<button class="gr-btn sm pager-btn" data-key="${key}" data-page="${p.page - 1}" ${p.page <= 1 ? 'disabled' : ''}>‹</button>` +
    pageBtns.join('') +
    `<button class="gr-btn sm pager-btn" data-key="${key}" data-page="${p.page + 1}" ${p.page >= pages ? 'disabled' : ''}>›</button>`;
}

// 分页控件事件（事件委托：任何 pager 内按钮）
document.addEventListener('click', (e) => {
  const t = /** @type {HTMLElement|null} */ (e.target);
  const btn = t && t.closest ? /** @type {HTMLButtonElement|null} */ (t.closest('.pager-btn')) : null;
  if (!btn || btn.disabled) return;
  const key = btn.dataset.key;
  const page = Number(btn.dataset.page);
  if (!key || !page) return;
  PAGERS[key].page = page;
  // 触发对应重渲染
  if (key === 'games') renderGameTable(cachedGames || []);
  else if (key === 'logs') renderRuntimeLogs();
  else if (key === 'audit') renderOutboundAudit();
});
