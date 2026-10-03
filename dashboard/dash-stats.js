/* global loadHealthCards loadApiDiagnostics loadBootTime loadRuntimeMetrics loadFavorites bindGameSearch renderFeedback renderTagCloud activeTagFilter paginate renderPager safeDateText */
/* eslint-disable no-unused-vars */
/**
 * 游戏雷达 Game Radar - Dashboard 统计模块 / Dashboard Stats Module
 *
 * v14 B1：由 dashboard.js 拆分——概览统计、行为趋势图、下载方式分布、
 * 游戏明细表、最近行为日志表。
 * Split from dashboard.js (B1): overview stats, trends chart, download-method
 * breakdown, per-game table, recent behavior log table.
 *
 * 依赖（经典脚本跨文件全局作用域，均在事件/异步回调期调用——脚本全部加载后）：
 * - dash-insights.js：renderTagCloud / renderFeedback / loadFavorites / bindGameSearch
 * - dash-diagnostics.js：loadHealthCards / loadApiDiagnostics / loadBootTime / loadRuntimeMetrics
 * - dash-logs.js：paginate / renderPager（统一分页）
 * - dashboard.js（壳）：safeDateText
 * 共享状态：cachedTrends / cachedGameList（dash-export.js CSV 导出按名读取）、
 * cachedGames（dash-logs.js 分页重渲染按名读取）、activeTagFilter（dash-insights.js 写）。
 */

// ============ 行为趋势 / Behavior Trends (v4.0.0, weekly since v4.1.0) ============
let cachedTrends = []; // 供 CSV 导出 / cached daily trends for CSV export

// 从后台加载聚合趋势（日/周粒度）/ Load trends from background (day/week)
async function loadTrends() {
  const container = document.getElementById('trendChart');
  const granularity = document.getElementById('trendGranularity').value;
  try {
    const response = await window.__GR_MSG__.sendMessage({ action: 'GET_TRENDS', granularity });
    cachedTrends = (response && response.daily) || [];
    renderTrendChart(cachedTrends);
  } catch (e) {
    container.innerHTML = `<div class="no-data">加载趋势失败: ${escapeHtml(window.__GR_MSG__.toUserMessage(e))}</div>`;
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
  // v9.6.0：柱状图渐变填充 + 圆角（美化）
  daily.forEach((d, i) => {
    bars +=
      `<rect x="${(x(i) - barW - 1).toFixed(1)}" y="${y(d.views).toFixed(1)}" width="${barW.toFixed(1)}" height="${(PAD.t + ih - y(d.views)).toFixed(1)}" rx="2" fill="url(#gr-grad-views)" opacity="0.85"/>` +
      `<rect x="${(x(i) + 1).toFixed(1)}" y="${y(d.downloads).toFixed(1)}" width="${barW.toFixed(1)}" height="${(PAD.t + ih - y(d.downloads)).toFixed(1)}" rx="2" fill="url(#gr-grad-downloads)" opacity="0.9"/>`;
  });
  // y 轴网格线（4 条水平虚线）
  let grid = '';
  for (let g = 0; g <= 4; g++) {
    const gy = y((maxCount * g) / 4);
    grid += `<line x1="${PAD.l}" y1="${gy.toFixed(1)}" x2="${W - PAD.r}" y2="${gy.toFixed(1)}" stroke="#2a3f55" stroke-width="1" stroke-dasharray="4 4" opacity="0.5"/>`;
  }
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
    <defs>
      <linearGradient id="gr-grad-views" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#66c0f4" stop-opacity="0.95"/>
        <stop offset="100%" stop-color="#2a6fb0" stop-opacity="0.55"/>
      </linearGradient>
      <linearGradient id="gr-grad-downloads" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#a3cf06" stop-opacity="0.95"/>
        <stop offset="100%" stop-color="#5c8a00" stop-opacity="0.55"/>
      </linearGradient>
    </defs>
    ${grid}
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

// ============ 概览统计 / Overview Statistics ============
let cachedGameList = []; // 供 CSV 导出 / cached game list for CSV export

async function loadStats() {
  try {
    const response = await window.__GR_MSG__.sendMessage({ action: 'GET_STATS' });
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
    loadHealthCards().catch(() => {}); // v10.0.0：站点/存储健康卡片（失败不影响主统计）
    loadFavorites().catch(() => {}); // v10.6.0 F2：收藏清单
    bindGameSearch(); // v10.6.0 F3：搜索框绑定
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
    loadRuntimeMetrics(); // v10.7.0 批次5：运行指标卡
    // v10.0.0：推荐反馈信号区块
    renderFeedback(response.feedback);
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
let cachedGames = []; // 当前表全集（tag 过滤后）——dash-logs.js 分页重渲染按名读取
function renderGameTable(games) {
  cachedGames = games || [];
  // v11.0 B7：tag 聚合过滤——keywords 含激活标签的游戏才入表
  if (activeTagFilter) {
    cachedGames = cachedGames.filter(
      (g) =>
        Array.isArray(g.keywords) && g.keywords.some((k) => String(k).toLowerCase() === activeTagFilter.toLowerCase())
    );
  }
  const tbody = document.getElementById('gameTableBody');
  if (!games || games.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="no-data">暂无游戏记录</td></tr>';
    renderPager('games', 'gamePager', 0);
    return;
  }
  const { slice, total } = paginate('games', games);
  renderPager('games', 'gamePager', total);
  tbody.innerHTML = slice
    .map((game) => {
      const tags = (game.keywords || [])
        .slice(0, 4)
        .map((t) => `<span class="tag-small">${escapeHtml(t)}</span>`)
        .join('');
      const rating = game.steamRating ? `${game.steamRating}/10` : '-';
      const time = safeDateText(game.lastSeen); // v10.9.1
      const dlClass = game.downloads > 0 ? 'downloaded' : '';

      return `<tr>
      <td>${escapeHtml(game.name)}</td>
      <td>${game.views ?? '-'}</td> <!-- v10.9.1 -->
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
