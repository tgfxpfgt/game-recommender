/**
 * 游戏雷达 Game Radar - Dashboard Script
 * 数据分析仪表盘逻辑 / Dashboard (analytics) logic
 *
 * Features:
 * - Overview statistics (events, games, views, downloads, rate)
 * - Tag preference cloud, download-method breakdown, per-game table
 * - Steam tag-based recommendations
 * - Runtime log viewer (filter / export / clear)
 * - Outbound request audit (v3.4.1: host/status/duration, failures highlighted)
 * - Behavior trends chart + CSV export (v4.0.0: daily views/downloads/rate, SVG)
 * - Backup management (create / restore / delete)
 *
 * 功能：
 * - 概览统计（行为数、游戏数、查看数、下载数、下载率）
 * - 标签偏好云、下载方式分布、游戏明细表
 * - 基于 Steam 标签的推荐
 * - 运行日志查看（筛选 / 导出 / 清空）
 * - 出站请求审计（v3.4.1：主机/状态/耗时，失败高亮）
 * - 行为趋势图 + CSV 导出（v4.0.0：按天浏览/下载/转化率，SVG 零依赖）
 * - 备份管理（创建 / 恢复 / 删除）
 */

document.addEventListener('DOMContentLoaded', () => {
  // v6.4.19：应用皮肤主题
  (async () => {
    try {
      const r = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
      const s = r && r.settings;
      if (s && globalThis.__GR_SETTINGS_UTILS__) {
        const u = globalThis.__GR_SETTINGS_UTILS__;
        if (u.applyTheme) u.applyTheme(s.uiTheme);
        if (u.applyCustomTheme) u.applyCustomTheme(s.customThemeCss);
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
  document.getElementById('exportLogsCsvBtn').addEventListener('click', exportLogsCsv);

  // 出站审计筛选/导出 (v4.1.0)
  document.getElementById('auditHostFilter').addEventListener('input', renderOutboundAudit);
  document.getElementById('exportAuditCsvBtn').addEventListener('click', exportAuditCsv);
});

// ============ 行为趋势 / Behavior Trends (v4.0.0, weekly since v4.1.0) ============
let cachedTrends = []; // 供 CSV 导出 / cached daily trends for CSV export

// 从后台加载聚合趋势（日/周粒度）/ Load trends from background (day/week)
async function loadTrends() {
  const container = document.getElementById('trendChart');
  const granularity = document.getElementById('trendGranularity').value;
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_TRENDS', granularity });
    cachedTrends = (response && response.daily) || [];
    renderTrendChart(cachedTrends);
  } catch (e) {
    container.innerHTML = `<div class="no-data">加载趋势失败: ${escapeHtml(String(e))}</div>`;
  }
}

// 手绘 SVG 趋势图：浏览/下载双柱 + 转化率折线（零依赖，深色主题）
// Hand-drawn SVG chart: views/downloads bars + conversion-rate line (no deps)
function renderTrendChart(daily) {
  const container = document.getElementById('trendChart');
  const statsEl = document.getElementById('trendStats');
  if (!daily || daily.length === 0) {
    container.innerHTML = '<div class="no-data">暂无行为数据，请先浏览游戏网站</div>';
    statsEl.textContent = '';
    return;
  }
  const totalViews = daily.reduce((s, d) => s + d.views, 0);
  const totalDl = daily.reduce((s, d) => s + d.downloads, 0);
  statsEl.textContent = `近 ${daily.length} 天 · 浏览 ${totalViews} · 下载 ${totalDl}`;

  const W = 640,
    H = 200,
    PAD = { l: 42, r: 42, t: 12, b: 26 };
  const iw = W - PAD.l - PAD.r,
    ih = H - PAD.t - PAD.b;
  const maxCount = Math.max(1, ...daily.map((d) => Math.max(d.views, d.downloads)));
  const n = daily.length;
  const slot = iw / n;
  const barW = Math.min(10, slot * 0.36);
  const x = (i) => PAD.l + i * slot + slot / 2;
  const y = (v) => PAD.t + ih - (v / maxCount) * ih;

  let bars = '';
  daily.forEach((d, i) => {
    bars +=
      `<rect x="${(x(i) - barW - 1).toFixed(1)}" y="${y(d.views).toFixed(1)}" width="${barW.toFixed(1)}" height="${(PAD.t + ih - y(d.views)).toFixed(1)}" fill="#66c0f4" opacity="0.75"/>` +
      `<rect x="${(x(i) + 1).toFixed(1)}" y="${y(d.downloads).toFixed(1)}" width="${barW.toFixed(1)}" height="${(PAD.t + ih - y(d.downloads)).toFixed(1)}" fill="#a3cf06" opacity="0.85"/>`;
  });
  let line = '';
  daily.forEach((d, i) => {
    const px = x(i).toFixed(1);
    const py = (PAD.t + ih - (d.rate / 100) * ih).toFixed(1);
    line += i === 0 ? `M${px},${py}` : `L${px},${py}`;
  });
  // 横轴刻度：最多 10 个 / x ticks: at most 10
  const step = Math.max(1, Math.ceil(n / 10));
  const ticks = [];
  for (let i = 0; i < n; i += step) ticks.push(i);
  if (ticks[ticks.length - 1] !== n - 1) ticks.push(n - 1);
  let yTicks = '';
  for (let g = 0; g <= 4; g++) {
    const v = Math.round((maxCount * g) / 4);
    yTicks += `<text x="${PAD.l - 6}" y="${(y((maxCount * g) / 4) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#8f98a0">${v}</text>`;
  }
  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="行为趋势图">
    <g>${bars}</g>
    <path d="${line}" fill="none" stroke="#ff7b00" stroke-width="2"/>
    <g>${ticks
      .map(
        (i) =>
          `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#8f98a0">${escapeHtml(daily[i].date.slice(5))}</text>`
      )
      .join('')}</g>
    <g>${yTicks}</g>
    <rect x="${W - 168}" y="5" width="12" height="10" fill="#66c0f4"/><text x="${W - 152}" y="14" font-size="10" fill="#c9d4e0">浏览</text>
    <rect x="${W - 112}" y="5" width="12" height="10" fill="#a3cf06"/><text x="${W - 96}" y="14" font-size="10" fill="#c9d4e0">下载</text>
    <line x1="${W - 52}" y1="10" x2="${W - 40}" y2="10" stroke="#ff7b00" stroke-width="2"/><text x="${W - 36}" y="14" font-size="10" fill="#c9d4e0">转化%</text>
  </svg>`;
}

// ============ CSV 导出 / CSV Export (v4.0.0) ============
// CSV 转义（引号/逗号/换行）；值含特殊字符时加引号并双写引号
// CSV escaping: quote values containing commas/quotes/newlines ("" doubling)
function toCsv(headers, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
}

// Blob 下载（BOM 防 Excel 中文乱码）/ Blob download with UTF-8 BOM for Excel
function downloadCsv(filename, csv) {
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// 导出趋势 CSV（按天）/ Export daily trends as CSV
function exportTrendsCsv() {
  if (cachedTrends.length === 0) {
    alert('暂无趋势数据');
    return;
  }
  downloadCsv(
    `game-recommender-trends-${new Date().toISOString().slice(0, 10)}.csv`,
    toCsv(
      ['日期', '浏览', '下载', '转化率%'],
      cachedTrends.map((d) => [d.date, d.views, d.downloads, d.rate])
    )
  );
}

// 导出游戏明细 CSV（当前 GET_STATS 返回的前 50 画像）/ Export game profiles as CSV
function exportGamesCsv() {
  if (cachedGameList.length === 0) {
    alert('暂无游戏数据');
    return;
  }
  downloadCsv(
    `game-recommender-games-${new Date().toISOString().slice(0, 10)}.csv`,
    toCsv(
      ['游戏名称', '浏览', '下载', 'Steam标签', 'AppID', '评分', '最后时间'],
      cachedGameList.map((g) => [
        g.name,
        g.views ?? 0,
        g.downloads ?? 0,
        (g.keywords || []).join('; '),
        g.steamAppId || '',
        g.steamRating ?? '',
        g.lastSeen || ''
      ])
    )
  );
}

// 导出行为日志 CSV（全量，经 EXPORT_DATA 获取）/ Export the full behavior log as CSV
async function exportLogsCsv() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'EXPORT_DATA', moduleKeys: ['behaviorLog'] });
    const entries = (response && response.data && response.data.modules && response.data.modules.behaviorLog) || [];
    if (!entries || entries.length === 0) {
      alert('暂无行为日志');
      return;
    }
    downloadCsv(
      `game-recommender-behavior-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        ['时间', '类型', '游戏', '方式', '网站', 'URL'],
        entries.map((e) => [
          new Date(e.timestamp).toLocaleString('zh-CN'),
          e.type,
          e.gameName || '',
          e.method || '',
          e.domain || '',
          e.url || ''
        ])
      )
    );
  } catch (e) {
    alert('导出失败: ' + String(e));
  }
}

// ============ 概览统计 / Overview Statistics ============
let cachedGameList = []; // 供 CSV 导出 / cached game list for CSV export

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
    // v7.1.0：自助诊断（网址索引规模 / 名称负缓存条数）
    document.getElementById('diagUrlIndex').textContent = response.urlIndexSize ?? 0;
    document.getElementById('diagNegativeCache').textContent = response.negativeCacheCount ?? 0;
    // v6.3.2 B3：缓存命中率（hits+misses 计数）
    // v7.1.0：分模块命中率（meta 基础 / rating 好评率 / detail 详情 / spy 热度）
    const cs = response.cacheStats || {};
    const total = (cs.hits || 0) + (cs.misses || 0);
    document.getElementById('statCacheHit').textContent =
      total > 0 ? Math.round((cs.hits / total) * 100) + '% (' + cs.hits + '/' + total + ')' : '无查询';
    const mods = cs.modules || {};
    const modEls = {
      meta: document.getElementById('modHitMeta'),
      rating: document.getElementById('modHitRating'),
      detail: document.getElementById('modHitDetail'),
      spy: document.getElementById('modHitSpy')
    };
    for (const [k, el] of Object.entries(modEls)) {
      if (!el) continue;
      const m = mods[k] || {};
      const t = (m.hits || 0) + (m.misses || 0);
      el.textContent = t > 0 ? Math.round((m.hits / t) * 100) + '%' : '—';
      el.title = `${m.hits || 0} 命中 / ${t} 查询（TTL 建议见设置「缓存有效期」）`;
    }

    // v7.1.0：Steam API 限流状态（自助诊断）
    loadApiDiagnostics();
    loadBootTime();
    // 标签偏好 / Tag preference cloud
    renderTagCloud(response.topKeywords);

    // 下载方式 / Download methods
    renderDownloadMethods(response.downloadMethods);

    // 游戏列表 / Game table
    cachedGameList = response.gameList || [];
    renderGameTable(cachedGameList);

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

  container.innerHTML = keywords
    .map((kw) => {
      const level = kw.weight >= 0.6 ? 'high' : kw.weight >= 0.3 ? 'medium' : 'low';
      const size = Math.max(12, Math.min(20, 12 + kw.weight * 10));
      return `<span class="tag-item ${level}" style="font-size:${size}px" title="匹配度: ${Math.round(kw.weight * 100)}%">
      ${escapeHtml(kw.keyword)} <small>${Math.round(kw.weight * 100)}%</small>
    </span>`;
    })
    .join('');
}

// 下载方式分布 / Download-method breakdown
function renderDownloadMethods(methods) {
  const container = document.getElementById('downloadMethods');
  if (!methods || Object.keys(methods).length === 0) {
    container.innerHTML = '<span class="no-data">暂无下载记录</span>';
    return;
  }

  const methodNames = {
    link_click: '链接点击',
    window_open: '弹窗打开',
    delegate_click: '按钮点击',
    copy_link: '复制链接',
    dynamic_link: '动态链接',
    unknown: '其他方式'
  };

  container.innerHTML = Object.entries(methods)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([method, count]) => `
      <div class="method-item">
        <div class="method-count">${count}</div>
        <div class="method-name">${methodNames[method] || escapeHtml(method)}</div>
      </div>
    `
    )
    .join('');
}

// 游戏明细表（按下载数/查看数降序） / Per-game table (sorted by downloads/views)
function renderGameTable(games) {
  const tbody = document.getElementById('gameTableBody');
  if (!games || games.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="no-data">暂无游戏记录</td></tr>';
    return;
  }

  tbody.innerHTML = games
    .map((game) => {
      const tags = (game.keywords || [])
        .slice(0, 4)
        .map((t) => `<span class="tag-small">${escapeHtml(t)}</span>`)
        .join('');
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
    })
    .join('');
}

// 最近行为日志表 / Recent behavior log table
function renderLogTable(logs) {
  const tbody = document.getElementById('logTableBody');
  if (!logs || logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="no-data">暂无行为记录</td></tr>';
    return;
  }

  const typeNames = {
    view_list: ['浏览列表', 'list'],
    view_detail: ['查看详情', 'view'],
    click_detail: ['点击详情', 'view'],
    click_download: ['下载游戏', 'download'],
    steam_tags_update: ['Steam标签', 'steam']
  };

  tbody.innerHTML = logs
    .map((log) => {
      const [typeName, typeClass] = typeNames[log.type] || [escapeHtml(String(log.type || '未知')), 'list'];
      const time = log.timestamp
        ? new Date(log.timestamp).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          })
        : '-';
      // v3.4.1：日志内容不可信，method 与未知 type 必须转义（防 innerHTML 注入）
      const method = escapeHtml(log.method || '-');

      return `<tr>
      <td>${time}</td>
      <td><span class="event-type ${typeClass}">${typeName}</span></td>
      <td>${escapeHtml(log.gameName || '-')}</td>
      <td>${method}</td>
      <td>${escapeHtml(log.domain || '-')}</td>
    </tr>`;
    })
    .join('');
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

    if (response && response.error) {
      listEl.innerHTML = `<span class="no-data">${escapeHtml(response.error)}</span>`;
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

    listEl.innerHTML = response.games
      .map(
        (game) => `
      <div class="rec-card">
        ${game.image ? `<img class="rec-card-img" src="${escapeAttr(game.image)}" alt="${escapeHtml(game.name)}"/>` : ''}
        <div class="rec-card-body">
          <div class="rec-card-title">${escapeHtml(game.name)}</div>
          <div class="rec-card-meta">
            ${game.price ? `💰 ${escapeHtml(game.price)}` : ''}
            ${game.reviewSummary ? ` | ${game.reviewSummary}` : ''}
          </div>
          <div class="rec-card-tags">
            ${(game.matchTags || []).map((t) => `<span>${escapeHtml(t)}</span>`).join('')}
          </div>
          <a href="${escapeAttr(game.url)}" target="_blank">🔗 在Steam查看</a>
        </div>
      </div>
    `
      )
      .join('');

    // 图片加载失败时隐藏（addEventListener 替代内联 onerror，规避扩展页 CSP）
    // Hide images that fail to load (addEventListener instead of inline onerror for CSP)
    listEl.querySelectorAll('.rec-card-img').forEach((img) => {
      img.addEventListener('error', () => {
        img.style.display = 'none';
      });
    });

    // 滚动到推荐区域
    section.scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    listEl.innerHTML = `<span class="no-data">获取推荐失败: ${escapeHtml(String(e))}</span>`;
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
    container.innerHTML = `<div class="no-data">加载日志失败: ${escapeHtml(String(e))}</div>`;
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
    return;
  }

  // 倒序显示（最新在前）
  container.innerHTML = [...logs]
    .reverse()
    .map((log) => {
      const time = new Date(log.timestamp).toLocaleString('zh-CN', {
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
    alert('导出失败: ' + String(e));
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
    container.innerHTML = `<div class="no-data">加载审计失败: ${escapeHtml(String(e))}</div>`;
  }
}

// 渲染审计列表（最新在前，失败高亮；v4.1.0：支持主机筛选）
// Render audit (newest first, failures red; host filter since v4.1.0)
function renderOutboundAudit() {
  const container = document.getElementById('auditList');
  const stats = cachedAudit.stats || {};
  const statsEl = document.getElementById('auditStats');
  statsEl.textContent = stats.total > 0 ? `共 ${stats.total} 次 · 失败 ${stats.failed}（${stats.failRate}%）` : '';
  const filter = (document.getElementById('auditHostFilter').value || '').trim().toLowerCase();
  const entries = (cachedAudit.entries || []).filter((e) => !filter || (e.host || '').toLowerCase().includes(filter));
  if (entries.length === 0) {
    container.innerHTML = '<div class="no-data">' + (filter ? '无匹配主机记录' : '暂无请求记录') + '</div>';
    return;
  }
  container.innerHTML = entries
    .map((e) => {
      const time = new Date(e.t).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      const detail = e.status ? `HTTP ${e.status}` : e.ok ? '成功' : '异常';
      return `<div class="log-entry ${e.ok ? '' : 'log-error'}">
      <span class="log-time">${time}</span>
      <span class="log-module">[${escapeHtml(e.host)}]</span>
      <span class="log-msg">${e.ok ? '✓' : '✗'} ${escapeHtml(detail)} · ${e.ms}ms</span>
    </div>`;
    })
    .join('');
}

// v4.1.0：导出审计 CSV（含筛选结果）/ Export the (filtered) audit as CSV
function exportAuditCsv() {
  const filter = (document.getElementById('auditHostFilter').value || '').trim().toLowerCase();
  const entries = (cachedAudit.entries || []).filter((e) => !filter || (e.host || '').toLowerCase().includes(filter));
  if (entries.length === 0) {
    alert('暂无审计记录');
    return;
  }
  downloadCsv(
    `game-recommender-audit-${new Date().toISOString().slice(0, 10)}.csv`,
    toCsv(
      ['时间', '主机', '成功', '状态', '耗时ms'],
      entries.map((e) => [new Date(e.t).toLocaleString('zh-CN'), e.host, e.ok ? '是' : '否', e.status || '', e.ms])
    )
  );
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

    container.innerHTML = backups
      .map((b) => {
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
      })
      .join('');

    // 绑定恢复/删除按钮（内联 onclick 在 MV3 扩展页被 CSP 禁止，必须用 addEventListener）
    // Bind restore/delete buttons (inline onclick is blocked by MV3 extension-page CSP)
    container.querySelectorAll('.backup-restore-btn').forEach((btn) => {
      btn.addEventListener('click', () => restoreBackup(btn.dataset.id));
    });
    container.querySelectorAll('.backup-delete-btn').forEach((btn) => {
      btn.addEventListener('click', () => deleteBackup(btn.dataset.id));
    });
  } catch (e) {
    container.innerHTML = `<div class="no-data">加载备份失败: ${escapeHtml(String(e))}</div>`;
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
    statusEl.textContent = '❌ ' + String(e);
  }
  setTimeout(() => {
    statusEl.textContent = '';
  }, 3000);
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
    alert('❌ 恢复失败: ' + String(e));
  }
}

// 删除备份 / Delete a backup
async function deleteBackup(id) {
  if (!confirm('确定删除该备份？')) return;
  await chrome.runtime.sendMessage({ action: 'DELETE_BACKUP', backupId: id });
  loadBackups();
}

// v9.1.0：性能基线（从 runtimeLog 读最近 Perf 条目——启动耗时）
async function loadBootTime() {
  const el = document.getElementById('diagBootTime');
  if (!el) return;
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'GET_RUNTIME_LOGS', limit: 200 });
    const logs = (resp && resp.logs) || [];
    const perf = logs.filter((l) => l && l.module === 'Perf');
    if (perf.length === 0) {
      el.textContent = '—';
      return;
    }
    const latest = perf[perf.length - 1];
    const m = String(latest.message || '').match(/(\d+)ms/);
    el.textContent = m ? m[1] + 'ms' : '—';
    el.title = `${latest.message} · ${new Date(latest.ts || latest.timestamp || Date.now()).toLocaleString()}`;
  } catch {
    el.textContent = '—';
  }
}

// v7.1.0：Steam API 限流状态诊断（自助诊断——"为什么数据没更新"）
async function loadApiDiagnostics() {
  const el = document.getElementById('diagApiStatus');
  if (!el) return;
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'GET_API_STATUS' });
    if (!resp) {
      el.textContent = '—';
      return;
    }
    if (resp.anomaly) {
      el.textContent = `⚠️ 异常（${resp.failRate}%）`;
      el.style.color = '#e5534b';
      el.title = `近 ${resp.windowSec / 60} 分钟失败 ${resp.failed}/${resp.total} 次，疑似限流`;
    } else if (resp.total < 8) {
      el.textContent = `采样中（${resp.total}）`;
      el.style.color = '#f0a93b';
      el.title = '调用量不足，状态待定';
    } else {
      el.textContent = `✅ 正常（${resp.failRate}%）`;
      el.style.color = '#a3cf06';
      el.title = `近 ${resp.windowSec / 60} 分钟 ${resp.total} 次调用，失败 ${resp.failed} 次`;
    }
  } catch {
    el.textContent = '—';
  }
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
