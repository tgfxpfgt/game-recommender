/**
 * 游戏雷达 Game Radar - 缓存面板格式化器 / Cache Panel Formatters
 *
 * v14.3.0（第五轮 B3）：由 cache.js 拆分——缓存列表的纯展示格式化函数
 * （模块新鲜度/好评率徽章/类型徽章/推荐徽章/时间/下载站网址）。
 * 经 window.__OPTS__ 命名空间供 cache.js 消费。
 * Pure display formatters split from cache.js, consumed via __OPTS__.
 */
(function (global) {
  'use strict';

  const OPTS = (global.__OPTS__ = global.__OPTS__ || {});

  // v6.4.19：信息缓存新鲜度标签（meta 基础 / rating 好评率 / detail 详情 / spy 热度）
  // v7.1.0：hover 显示 TTL 建议（来自设置 cacheTtls）
  function formatModuleFreshness(freshness) {
    const f = freshness || {};
    const ttls = (OPTS.currentSettings && OPTS.currentSettings.cacheTtls) || {};
    const ttlText = (key) => {
      const t = ttls[key];
      if (!t) return '';
      const v = Number(t.value) || 0; // v10.9.1：异型防 [object Object]
      return ` · TTL ${v}${t.unit || ''}${v === 0 ? '（长期）' : ''}`;
    };
    const items = [
      ['基', f.meta, 'metaSteam'],
      ['评', f.rating, 'steamDynamic'],
      ['详', f.detail, 'detailSteam'],
      ['热', f.spy, 'spySteam']
    ];
    return items
      .map(([label, ok, ttlKey]) => {
        const color = ok ? '#a3cf06' : '#8f98a0';
        const bg = ok ? 'rgba(163,207,6,0.12)' : 'rgba(143,152,160,0.12)';
        return `<span title="${ok ? '缓存有效' : '缺失或已过期'}${ttlText(ttlKey)}" style="display:inline-block;margin-right:3px;padding:0 5px;border-radius:3px;font-size:10.5px;color:${color};background:${bg};">${label}</span>`;
      })
      .join('');
  }

  // 好评率徽章（颜色分级；无数据显示灰色"暂无"）
  // v5.0.0：颜色单源 __GR_PATTERNS__（options.html 已加载 shared/patterns.js）
  // v10.7.0：删除字面量 fallback——假单源是漂移温床
  function formatRatingBadge(rate) {
    if (rate === null || rate === undefined) {
      return `<span class="rating-badge" style="color:#8f98a0;background:rgba(143,152,160,0.12);border-color:#3a3a4a;">暂无</span>`;
    }
    const P = globalThis.__GR_PATTERNS__;
    const color = P.ratingColorFor(rate);
    const bg = P.ratingBgFor(rate);
    return `<span class="rating-badge" style="color:${color};background:${bg};border-color:${color};">${rate}%</span>`;
  }

  // Steam 条目类型徽章（game 蓝色 / dlc 橙 / 其他紫灰）
  function formatTypeBadge(type) {
    if (!type) return '—';
    const t = String(type).toLowerCase(); // v10.9：旧缓存条目 type 可能异型（miss 走默认色）
    const map = {
      game: ['#66c0f4', 'rgba(102,192,244,0.12)'],
      dlc: ['#ff7b00', 'rgba(255,123,0,0.12)'],
      bundle: ['#b48ce0', 'rgba(180,140,224,0.12)']
    };
    const [color, bg] = map[t] || ['#8f98a0', 'rgba(143,152,160,0.1)'];
    return `<span class="rating-badge" style="color:${color};background:${bg};border-color:${color};">${escapeHtml(type)}</span>`;
  }

  // 推荐值徽章（分级着色，悬停显示各分值组成）
  function formatRecBadge(score) {
    if (score === null || score === undefined) return '—';
    const pct = Math.round((Number(score) || 0) * 100); // v10.9：垃圾值防 NaN
    const color = pct >= 80 ? '#e74c3c' : pct >= 60 ? '#ff7b00' : pct >= 40 ? '#a3cf06' : '#8f98a0';
    const bg =
      pct >= 80
        ? 'rgba(231,76,60,0.12)'
        : pct >= 60
          ? 'rgba(255,123,0,0.12)'
          : pct >= 40
            ? 'rgba(163,207,6,0.12)'
            : 'rgba(143,152,160,0.1)';
    return `<span class="rating-badge" style="color:${color};background:${bg};border-color:${color};">🎯 ${pct}%</span>`;
  }

  // 推荐值组成说明（悬停）/ Recommendation breakdown tooltip
  function formatRecDetail(g) {
    const b = g.recommendationDetail || {};
    const fmt = (v) => Math.round((v || 0) * 100) + '%';
    return `推荐度: ${Math.round((g.recommendation || 0) * 100)}%\n点击率: ${fmt(b.clickScore)} · 下载率: ${fmt(b.downloadScore)}\n关键词: ${fmt(b.keywordScore)} · Steam: ${fmt(b.steamScore)}`;
  }

  // 格式化时间戳为可读字符串
  function formatTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—'; // v10.9.1：异型时间戳兜底
    const now = Date.now();
    const diff = now - ts;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    if (diff < 2592000000) return `${Math.floor(diff / 86400000)}天前`;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // 格式化下载站网址（主网址 + 展开链接）
  function formatDownloadUrls(downloadUrls, primaryUrl) {
    if (!Array.isArray(downloadUrls)) downloadUrls = []; // v10.9：旧条目异型守卫
    if (downloadUrls.length === 0) {
      return primaryUrl
        ? `<a href="${escapeAttr(primaryUrl)}" target="_blank" rel="noopener">${escapeHtml(truncateUrl(primaryUrl))}</a>`
        : '—';
    }
    return downloadUrls
      .map(
        (u) => `
      <div style="margin-bottom:2px;">
        <span style="color:#8f98a0;font-size:10px;">${escapeHtml(u.siteName)}:</span>
        <a href="${escapeAttr(u.url)}" target="_blank" rel="noopener">${escapeHtml(truncateUrl(u.url))}</a>
        <span style="color:#8f98a0;font-size:10px;margin-left:6px;">调用 ${formatTime(u.lastCalled)}</span>
      </div>
    `
      )
      .join('');
  }

  // 截断过长 URL
  function truncateUrl(url, maxLen = 40) {
    url = String(url ?? ''); // v10.9：条目 url 可能异型
    if (url.length <= maxLen) return url;
    return url.substring(0, maxLen) + '...';
  }

  OPTS.formatModuleFreshness = formatModuleFreshness;
  OPTS.formatRatingBadge = formatRatingBadge;
  OPTS.formatTypeBadge = formatTypeBadge;
  OPTS.formatRecBadge = formatRecBadge;
  OPTS.formatRecDetail = formatRecDetail;
  OPTS.formatTime = formatTime;
  OPTS.formatDownloadUrls = formatDownloadUrls;
})(typeof globalThis !== 'undefined' ? globalThis : this);
