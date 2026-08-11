/**
 * Game Recommender - Dashboard Script
 * 数据分析仪表盘逻辑 / Dashboard (analytics) logic
 *
 * Features:
 * - Overview statistics (events, games, views, downloads, rate)
 * - Tag preference cloud, download-method breakdown, per-game table
 * - Steam tag-based recommendations
 * - Runtime log viewer (filter / export / clear)
 * - Outbound request audit (v3.4.1: host/status/duration, failures highlighted)
 * - Backup management (create / restore / delete)
 *
 * 功能：
 * - 概览统计（行为数、游戏数、查看数、下载数、下载率）
 * - 标签偏好云、下载方式分布、游戏明细表
 * - 基于 Steam 标签的推荐
 * - 运行日志查看（筛选 / 导出 / 清空）
 * - 出站请求审计（v3.4.1：主机/状态/耗时，失败高亮）
 * - 备份管理（创建 / 恢复 / 删除）
 */

document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadRuntimeLogs();
  loadBackups();

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
});

// ============ 概览统计 / Overview Statistics ============
async function loadStats() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_STATS' });
    if (!response) return;

    // 概览统计 / Overview stats（旧字段缺失时兜底 0）
    document.getElementById('statTotal').textContent = response.totalEvents ?? 0;
    document.getElementById('statGames').textContent = response.totalGames ?? 0;
    document.getElementById('statViews').textContent = response.viewDetailCount ?? 0;
    document.getElementById('statDownloads').textContent = response.downloadCount ?? 0;
    document.getElementById('statRate').textContent = (response.downloadRate ?? 0) + '%';

    // 标签偏好 / Tag preference cloud
    renderTagCloud(response.topKeywords);

    // 下载方式 / Download methods
    renderDownloadMethods(response.downloadMethods);

    // 游戏列表 / Game table
    renderGameTable(response.gameList);

    // 行为日志 / Behavior log
    renderLogTable(response.recentLog);
  } catch (e) {
    console.error('加载数据失败:', e);
  }
}

// 标签偏好云：按权重分级着色与字号 / Tag cloud: color/size graded by weight
function renderTagCloud(keywords) {
  const container = document.getElementById('tagCloud');
  if (!keywords || keywords.length === 0) {
    container.innerHTML = '<span class="no-data">暂无数据，请先浏览游戏网站让插件学习您的偏好</span>';
    return;
  }

  container.innerHTML = keywords.map(kw => {
    const level = kw.weight >= 0.6 ? 'high' : kw.weight >= 0.3 ? 'medium' : 'low';
    const size = Math.max(12, Math.min(20, 12 + kw.weight * 10));
    return `<span class="tag-item ${level}" style="font-size:${size}px" title="匹配度: ${Math.round(kw.weight * 100)}%">
      ${escapeHtml(kw.keyword)} <small>${Math.round(kw.weight * 100)}%</small>
    </span>`;
  }).join('');
}

// 下载方式分布 / Download-method breakdown
function renderDownloadMethods(methods) {
  const container = document.getElementById('downloadMethods');
  if (!methods || Object.keys(methods).length === 0) {
    container.innerHTML = '<span class="no-data">暂无下载记录</span>';
    return;
  }

  const methodNames = {
    'link_click': '链接点击',
    'window_open': '弹窗打开',
    'delegate_click': '按钮点击',
    'copy_link': '复制链接',
    'dynamic_link': '动态链接',
    'unknown': '其他方式'
  };

  container.innerHTML = Object.entries(methods)
    .sort((a, b) => b[1] - a[1])
    .map(([method, count]) => `
      <div class="method-item">
        <div class="method-count">${count}</div>
        <div class="method-name">${methodNames[method] || escapeHtml(method)}</div>
      </div>
    `).join('');
}

// 游戏明细表（按下载数/查看数降序） / Per-game table (sorted by downloads/views)
function renderGameTable(games) {
  const tbody = document.getElementById('gameTableBody');
  if (!games || games.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="no-data">暂无游戏记录</td></tr>';
    return;
  }

  tbody.innerHTML = games.map(game => {
    const tags = (game.keywords || []).slice(0, 4)
      .map(t => `<span class="tag-small">${escapeHtml(t)}</span>`).join('');
    const rating = game.steamRating ? `${game.steamRating}/10` : '-';
    const time = game.lastSeen ? new Date(game.lastSeen).toLocaleDateString('zh-CN') : '-';
    const dlClass = game.downloads > 0 ? 'downloaded' : '';

    return `<tr>
      <td>${escapeHtml(game.name)}</td>
      <td>${game.views}</td>
      <td class="${dlClass}">${game.downloads > 0 ? '⬇ ' + game.downloads : '0'}</td>
      <td>${tags || '-'}</td>
      <td>${rating}</td>
      <td>${time}</td>
    </tr>`;
  }).join('');
}

// 最近行为日志表 / Recent behavior log table
function renderLogTable(logs) {
  const tbody = document.getElementById('logTableBody');
  if (!logs || logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="no-data">暂无行为记录</td></tr>';
    return;
  }

  const typeNames = {
    'view_list': ['浏览列表', 'list'],
    'view_detail': ['查看详情', 'view'],
    'click_detail': ['点击详情', 'view'],
    'click_download': ['下载游戏', 'download'],
    'steam_tags_update': ['Steam标签', 'steam']
  };

  tbody.innerHTML = logs.map(log => {
    const [typeName, typeClass] = typeNames[log.type] || [escapeHtml(String(log.type || '未知')), 'list'];
    const time = log.timestamp ? new Date(log.timestamp).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }) : '-';
    // v3.4.1：日志内容不可信，method 与未知 type 必须转义（防 innerHTML 注入）
    const method = escapeHtml(log.method || '-');

    return `<tr>
      <td>${time}</td>
      <td><span class="event-type ${typeClass}">${typeName}</span></td>
      <td>${escapeHtml(log.gameName || '-')}</td>
      <td>${method}</td>
      <td>${escapeHtml(log.domain || '-')}</td>
    </tr>`;
  }).join('');
}

// 基于用户偏好标签向 Steam 搜索推荐游戏
// Recommend games on Steam based on the user's preferred tags
async function loadSteamRecommendations() {
  const section = document.getElementById('steamRecSection');
  const listEl = document.getElementById('steamRecList');
  const basedOnEl = document.getElementById('recBasedOn');
  
  section.style.display = 'block';
  listEl.innerHTML = '<span class="no-data">正在获取Steam推荐...</span>';
  basedOnEl.textContent = '';

  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_STEAM_RECOMMENDATIONS' });
    
    if (response.message) {
      listEl.innerHTML = `<span class="no-data">${escapeHtml(response.message)}</span>`;
      return;
    }

    if (response.error) {
      listEl.innerHTML = `<span class="no-data">${escapeHtml(response.error)}</span>`;
      return;
    }

    if (response.basedOnTags) {
      basedOnEl.textContent = `基于您偏好的Steam标签: ${response.basedOnTags.join('、')}`;
    }

    if (!response.games || response.games.length === 0) {
      listEl.innerHTML = '<span class="no-data">未找到匹配的Steam游戏</span>';
      return;
    }

    listEl.innerHTML = response.games.map(game => `
      <div class="rec-card">
        ${game.image ? `<img class="rec-card-img" src="${escapeAttr(game.image)}" alt="${escapeHtml(game.name)}"/>` : ''}
        <div class="rec-card-body">
          <div class="rec-card-title">${escapeHtml(game.name)}</div>
          <div class="rec-card-meta">
            ${game.price ? `💰 ${escapeHtml(game.price)}` : ''}
            ${game.reviewSummary ? ` | ${game.reviewSummary}` : ''}
          </div>
          <div class="rec-card-tags">
            ${(game.matchTags || []).map(t => `<span>${escapeHtml(t)}</span>`).join('')}
          </div>
          <a href="${escapeAttr(game.url)}" target="_blank">🔗 在Steam查看</a>
        </div>
      </div>
    `).join('');

    // 图片加载失败时隐藏（addEventListener 替代内联 onerror，规避扩展页 CSP）
    // Hide images that fail to load (addEventListener instead of inline onerror for CSP)
    listEl.querySelectorAll('.rec-card-img').forEach(img => {
      img.addEventListener('error', () => { img.style.display = 'none'; });
    });

    // 滚动到推荐区域
    section.scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    listEl.innerHTML = `<span class="no-data">获取推荐失败: ${escapeHtml(e.message)}</span>`;
  }
}
// （escapeHtml/escapeAttr 由 shared/escape.js 提供全局实现）
// (escapeHtml/escapeAttr come from shared/escape.js)

// ============ 运行日志 / Runtime Logs ============
let cachedLogs = [];

// 从后台加载运行日志（最多 200 条）/ Load runtime logs from background (max 200)
async function loadRuntimeLogs() {
  const container = document.getElementById('runtimeLogList');
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_RUNTIME_LOGS', limit: 200 });
    cachedLogs = (response && response.logs) || [];
    renderRuntimeLogs();
  } catch (e) {
    container.innerHTML = `<div class="no-data">加载日志失败: ${escapeHtml(e.message)}</div>`;
  }
}

// 渲染日志列表（按级别筛选，最新在前）/ Render logs (level-filtered, newest first)
function renderRuntimeLogs() {
  const container = document.getElementById('runtimeLogList');
  const filter = document.getElementById('logLevelFilter').value;
  
  let logs = cachedLogs;
  if (filter !== 'all') {
    logs = logs.filter(l => l.level === filter);
  }
  
  if (logs.length === 0) {
    container.innerHTML = '<div class="no-data">暂无日志</div>';
    return;
  }
  
  // 倒序显示（最新在前）
  container.innerHTML = [...logs].reverse().map(log => {
    const time = new Date(log.timestamp).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    return `<div class="log-entry log-${log.level}">
      <span class="log-time">${time}</span>
      <span class="log-level">${log.level.toUpperCase()}</span>
      <span class="log-module">[${escapeHtml(log.module)}]</span>
      <span class="log-msg">${escapeHtml(log.message)}</span>
      ${log.data ? `<span class="log-data">${escapeHtml(log.data)}</span>` : ''}
    </div>`;
  }).join('');
}

// 导出日志为 JSON 文件 / Export logs as a JSON file
async function exportLogs() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'EXPORT_LOGS' });
    const logs = (response && response.logs) || [];
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `game-recommender-logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('导出失败: ' + e.message);
  }
}

// 清空运行日志 / Clear runtime logs
async function clearLogs() {
  if (!confirm('确定要清空所有运行日志吗？')) return;
  await chrome.runtime.sendMessage({ action: 'CLEAR_RUNTIME_LOGS' });
  loadRuntimeLogs();
}

// ============ 出站请求审计 / Outbound Request Audit ============
let cachedAudit = { entries: [], stats: null };

// 从后台加载出站请求审计（最近 100 条）/ Load outbound request audit (latest 100)
async function loadOutboundAudit() {
  const container = document.getElementById('auditList');
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_OUTBOUND_AUDIT', limit: 100 });
    cachedAudit = (response && response.audit) || { entries: [], stats: null };
    renderOutboundAudit();
  } catch (e) {
    container.innerHTML = `<div class="no-data">加载审计失败: ${escapeHtml(e.message)}</div>`;
  }
}

// 渲染审计列表（最新在前，失败高亮）/ Render audit (newest first, failures red)
function renderOutboundAudit() {
  const container = document.getElementById('auditList');
  const stats = cachedAudit.stats || {};
  const statsEl = document.getElementById('auditStats');
  statsEl.textContent = stats.total > 0
    ? `共 ${stats.total} 次 · 失败 ${stats.failed}（${stats.failRate}%）`
    : '';
  const entries = cachedAudit.entries || [];
  if (entries.length === 0) {
    container.innerHTML = '<div class="no-data">暂无请求记录</div>';
    return;
  }
  container.innerHTML = entries.map(e => {
    const time = new Date(e.t).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const detail = e.status ? `HTTP ${e.status}` : (e.ok ? '成功' : '异常');
    return `<div class="log-entry ${e.ok ? '' : 'log-error'}">
      <span class="log-time">${time}</span>
      <span class="log-module">[${escapeHtml(e.host)}]</span>
      <span class="log-msg">${e.ok ? '✓' : '✗'} ${escapeHtml(detail)} · ${e.ms}ms</span>
    </div>`;
  }).join('');
}

// 清空出站请求审计 / Clear outbound request audit
async function clearAudit() {
  if (!confirm('确定要清空出站请求审计吗？')) return;
  await chrome.runtime.sendMessage({ action: 'CLEAR_OUTBOUND_AUDIT' });
  loadOutboundAudit();
}

// ============ 备份管理 / Backup Management ============
// 加载备份列表并渲染 / Load and render the backup list
async function loadBackups() {
  const container = document.getElementById('backupList');
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_BACKUPS' });
    const backups = (response && response.backups) || [];
    
    if (backups.length === 0) {
      container.innerHTML = '<div class="no-data">暂无备份，点击“立即备份”创建</div>';
      return;
    }
    
    container.innerHTML = backups.map(b => {
      const time = new Date(b.timestamp).toLocaleString('zh-CN');
      const sizeKb = b.size ? (b.size / 1024).toFixed(1) : '?';
      const modInfo = b.modules ? ` · ${b.modules.length} 模块` : ' · 全部模块';
      return `<div class="backup-item">
        <div class="backup-info">
          <span class="backup-type">${b.manual ? '🔧 手动' : '⏰ 自动'}</span>
          <span class="backup-time">${time}</span>
          <span class="backup-size">${sizeKb} KB${modInfo}</span>
        </div>
        <div class="backup-actions">
          <button class="btn btn-sm backup-restore-btn" data-id="${escapeAttr(b.id)}">♻️ 恢复</button>
          <button class="btn btn-sm btn-danger backup-delete-btn" data-id="${escapeAttr(b.id)}">删除</button>
        </div>
      </div>`;
    }).join('');

    // 绑定恢复/删除按钮（内联 onclick 在 MV3 扩展页被 CSP 禁止，必须用 addEventListener）
    // Bind restore/delete buttons (inline onclick is blocked by MV3 extension-page CSP)
    container.querySelectorAll('.backup-restore-btn').forEach(btn => {
      btn.addEventListener('click', () => restoreBackup(btn.dataset.id));
    });
    container.querySelectorAll('.backup-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteBackup(btn.dataset.id));
    });
  } catch (e) {
    container.innerHTML = `<div class="no-data">加载备份失败: ${escapeHtml(e.message)}</div>`;
  }
}

// 创建备份 / Create a backup
async function createBackup() {
  const statusEl = document.getElementById('backupStatus');
  statusEl.textContent = '备份中...';
  try {
    const response = await chrome.runtime.sendMessage({ action: 'CREATE_BACKUP' });
    if (response && response.success) {
      statusEl.textContent = '✅ 备份成功';
      loadBackups();
    } else {
      statusEl.textContent = '❌ 备份失败';
    }
  } catch (e) {
    statusEl.textContent = '❌ ' + e.message;
  }
  setTimeout(() => { statusEl.textContent = ''; }, 3000);
}

// 恢复备份（后台会先自动备份当前状态作为安全网）
// Restore a backup (background creates a safety-net backup of the current state first)
async function restoreBackup(id) {
  if (!confirm('恢复备份将覆盖当前数据（系统会先自动备份当前状态）。确定继续？')) return;
  try {
    const response = await chrome.runtime.sendMessage({ action: 'RESTORE_BACKUP', backupId: id });
    if (response && response.success) {
      alert('✅ 恢复成功，页面将刷新');
      location.reload();
    } else {
      alert('❌ 恢复失败: ' + (response ? response.error : '未知错误'));
    }
  } catch (e) {
    alert('❌ 恢复失败: ' + e.message);
  }
}

// 删除备份 / Delete a backup
async function deleteBackup(id) {
  if (!confirm('确定删除该备份？')) return;
  await chrome.runtime.sendMessage({ action: 'DELETE_BACKUP', backupId: id });
  loadBackups();
}
