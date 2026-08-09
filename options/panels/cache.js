/**
 * Game Recommender - 游戏缓存面板模块 / Game Cache Panel
 *
 * 缓存管理页：多条件检索（关键词/好评率/标签/站点）、封面缩略图、
 * 好评率徽章、可点击 AppID、手动更新、分页、删除与清空。
 * Cache-management page: multi-condition search, cover thumbnails, rating
 * badges, clickable AppIDs, manual refresh, pagination, delete & clear.
 */
(function (global) {
  'use strict';

  const OPTS = (global.__OPTS__ = global.__OPTS__ || {});

  // ============ 游戏缓存管理 / Game Cache Management ============
  function bindCacheEvents() {
    // 搜索按钮
    document.getElementById('cacheSearchBtn').addEventListener('click', () => {
      OPTS.cacheCurrentPage = 1;
      loadGameCache();
    });
    // 搜索框回车
    document.getElementById('cacheSearchInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        OPTS.cacheCurrentPage = 1;
        loadGameCache();
      }
    });
    // 搜索框防抖（300ms）
    document.getElementById('cacheSearchInput').addEventListener('input', () => {
      if (OPTS.cacheSearchTimer) clearTimeout(OPTS.cacheSearchTimer);
      OPTS.cacheSearchTimer = setTimeout(() => {
        OPTS.cacheCurrentPage = 1;
        loadGameCache();
      }, 300);
    });
    // 好评率 / 标签 / 站点筛选：变更即搜索（防抖 300ms）
    ['cacheMinRating', 'cacheTagInput', 'cacheSiteFilter'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        if (OPTS.cacheSearchTimer) clearTimeout(OPTS.cacheSearchTimer);
        OPTS.cacheSearchTimer = setTimeout(() => {
          OPTS.cacheCurrentPage = 1;
          loadGameCache();
        }, 300);
      });
      el.addEventListener('change', () => {
        if (OPTS.cacheSearchTimer) clearTimeout(OPTS.cacheSearchTimer);
        OPTS.cacheCurrentPage = 1;
        loadGameCache();
      });
    });
    // 刷新按钮
    document.getElementById('cacheRefreshBtn').addEventListener('click', () => loadGameCache());
    // 清空全部
    document.getElementById('cacheClearAllBtn').addEventListener('click', clearAllCache);
  }

  // 生成缓存页下载站筛选选项（来自规则文件）
  function populateCacheSiteFilter() {
    const select = document.getElementById('cacheSiteFilter');
    if (!select) return;
    const rules = (globalThis.__GAME_RECOMMENDER_SITES__ || {}).sites || [];
    rules.filter(s => s.searchUrl).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.key;
      opt.textContent = s.name;
      select.appendChild(opt);
    });
  }

  // 加载游戏缓存列表
  async function loadGameCache() {
    const keyword = document.getElementById('cacheSearchInput').value.trim();
    const minRating = parseInt(document.getElementById('cacheMinRating').value) || 0;
    const tag = document.getElementById('cacheTagInput').value.trim();
    const siteKey = document.getElementById('cacheSiteFilter').value;
    const tbody = document.getElementById('cacheTableBody');
    const statsEl = document.getElementById('cacheStats');

    tbody.innerHTML = '<tr><td colspan="8" class="cache-empty">加载中...</td></tr>';
    statsEl.textContent = '';

    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'GET_GAME_CACHE_LIST',
        keyword,
        minRating,
        tag,
        siteKey,
        page: OPTS.cacheCurrentPage,
        pageSize: OPTS.CACHE_PAGE_SIZE
      });

      if (!resp || !resp.games) {
        tbody.innerHTML = '<tr><td colspan="8" class="cache-empty">加载失败，请重试</td></tr>';
        return;
      }

      statsEl.textContent = `共 ${resp.total} 条记录 · 第 ${resp.page}/${resp.totalPages} 页`;

      if (resp.games.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="cache-empty">暂无缓存数据</td></tr>';
        renderPagination(0, 1);
        return;
      }

      // 渲染表格行（封面缩略图 + 好评率徽章 + 可点击 appId + 手动更新按钮）
      tbody.innerHTML = resp.games.map(g => `
        <tr>
          <td class="col-cover">
            ${g.coverImage
              ? `<img src="${escapeAttr(g.coverImage)}" class="cache-cover" loading="lazy" alt="" title="${escapeAttr(g.cnName || g.appId)}">`
              : '—'}
          </td>
          <td class="col-appid">
            ${formatRatingBadge(g.positiveRate)}
            <a href="https://store.steampowered.com/app/${escapeAttr(g.appId)}" target="_blank" rel="noopener" title="打开 Steam 详情页">${escapeHtml(g.appId)}</a>
            <button class="cache-refresh-btn" data-appid="${escapeAttr(g.appId)}" title="手动更新 Steam 信息与下载站地址">🔄</button>
          </td>
          <td class="col-name" title="${escapeAttr(g.cnName)}">${escapeHtml(g.cnName || '—')}</td>
          <td class="col-name" title="${escapeAttr(g.enName)}">${escapeHtml(g.enName || '—')}</td>
          <td class="col-time">${formatTime(g.lastConfirmed)}</td>
          <td class="col-url">${formatDownloadUrls(g.downloadUrls, g.primaryDownloadUrl)}</td>
          <td class="col-time">${formatTime(g.lastAccessed)}</td>
          <td><button class="cache-delete-btn" data-appid="${escapeAttr(g.appId)}">删除</button></td>
        </tr>
      `).join('');

      // 绑定删除按钮事件
      tbody.querySelectorAll('.cache-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteCacheEntry(btn.dataset.appid));
      });

      // 绑定手动更新按钮事件
      tbody.querySelectorAll('.cache-refresh-btn').forEach(btn => {
        btn.addEventListener('click', () => refreshCacheEntry(btn.dataset.appid, btn));
      });

      renderPagination(resp.total, resp.totalPages);
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8" class="cache-empty">加载失败: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  // 好评率徽章（颜色分级；无数据显示灰色"暂无"）
  function formatRatingBadge(rate) {
    if (rate === null || rate === undefined) {
      return `<span class="rating-badge" style="color:#8f98a0;background:rgba(143,152,160,0.12);border-color:#3a3a4a;">暂无</span>`;
    }
    const color = rate >= 80 ? '#66c0f4' : rate >= 60 ? '#a3cf06' : '#ff7b00';
    const bg = rate >= 80 ? 'rgba(102,192,244,0.15)' : rate >= 60 ? 'rgba(163,207,6,0.15)' : 'rgba(255,123,0,0.15)';
    return `<span class="rating-badge" style="color:${color};background:${bg};border-color:${color};">${rate}%</span>`;
  }

  // 手动更新单条缓存（Steam 中英文名/标签 + 下载站地址）
  async function refreshCacheEntry(appId, btn) {
    if (!btn) return;
    const originalText = btn.textContent;
    btn.textContent = '⏳';
    btn.disabled = true;
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'REFRESH_GAME_CACHE_ENTRY', appId });
      if (resp && resp.success) {
        btn.textContent = '✅';
        setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1200);
        loadGameCache();
      } else {
        btn.textContent = '❌';
        setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1500);
        alert('更新失败: ' + (resp ? resp.error : '未知错误'));
      }
    } catch (e) {
      btn.textContent = '❌';
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1500);
      alert('更新失败: ' + e.message);
    }
  }

  // 渲染分页控件
  function renderPagination(total, totalPages) {
    const container = document.getElementById('cachePagination');
    if (total === 0 || totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    let html = '';
    html += `<button ${OPTS.cacheCurrentPage <= 1 ? 'disabled' : ''} data-page="${OPTS.cacheCurrentPage - 1}">‹ 上一页</button>`;

    const maxButtons = 7;
    let start = Math.max(1, OPTS.cacheCurrentPage - 3);
    let end = Math.min(totalPages, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);

    if (start > 1) {
      html += `<button data-page="1">1</button>`;
      if (start > 2) html += `<span class="page-info">...</span>`;
    }
    for (let i = start; i <= end; i++) {
      html += `<button class="${i === OPTS.cacheCurrentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    if (end < totalPages) {
      if (end < totalPages - 1) html += `<span class="page-info">...</span>`;
      html += `<button data-page="${totalPages}">${totalPages}</button>`;
    }

    html += `<button ${OPTS.cacheCurrentPage >= totalPages ? 'disabled' : ''} data-page="${OPTS.cacheCurrentPage + 1}">下一页 ›</button>`;
    html += `<span class="page-info">共 ${total} 条</span>`;

    container.innerHTML = html;

    container.querySelectorAll('button[data-page]').forEach(btn => {
      if (btn.disabled) return;
      btn.addEventListener('click', () => {
        OPTS.cacheCurrentPage = parseInt(btn.dataset.page);
        loadGameCache();
      });
    });
  }

  // 删除单个游戏缓存
  async function deleteCacheEntry(appId) {
    if (!confirm(`确定要删除 AppID ${appId} 的缓存吗？`)) return;
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'DELETE_GAME_CACHE_ENTRY', appId });
      if (resp && resp.success) {
        loadGameCache();
      } else {
        alert('删除失败: ' + (resp ? resp.error : '未知错误'));
      }
    } catch (e) {
      alert('删除失败: ' + e.message);
    }
  }

  // 清空全部游戏缓存
  async function clearAllCache() {
    if (!confirm('确定要清空全部游戏缓存吗？此操作不可恢复。\n\n将清除：\n· 游戏注册表（中英文名映射）\n· Steam 动态缓存（好评率/评论）\n· 下载站详情页网址缓存\n· 名称索引')) return;
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'CLEAR_GAME_CACHE' });
      if (resp && resp.success) {
        OPTS.cacheCurrentPage = 1;
        loadGameCache();
      } else {
        alert('清空失败，请重试');
      }
    } catch (e) {
      alert('清空失败: ' + e.message);
    }
  }

  // ============ 缓存页面工具函数 / Cache Page Utility Functions ============

  // 格式化时间戳为可读字符串
  function formatTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - ts;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    if (diff < 2592000000) return `${Math.floor(diff / 86400000)}天前`;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // 格式化下载站网址（主网址 + 展开链接）
  function formatDownloadUrls(downloadUrls, primaryUrl) {
    if (!downloadUrls || downloadUrls.length === 0) {
      return primaryUrl ? `<a href="${escapeAttr(primaryUrl)}" target="_blank" rel="noopener">${escapeHtml(truncateUrl(primaryUrl))}</a>` : '—';
    }
    return downloadUrls.map(u => `
      <div style="margin-bottom:2px;">
        <span style="color:#8f98a0;font-size:10px;">${escapeHtml(u.siteName)}:</span>
        <a href="${escapeAttr(u.url)}" target="_blank" rel="noopener">${escapeHtml(truncateUrl(u.url))}</a>
      </div>
    `).join('');
  }

  // 截断过长 URL
  function truncateUrl(url, maxLen = 40) {
    if (!url) return '';
    if (url.length <= maxLen) return url;
    return url.substring(0, maxLen) + '...';
  }

  OPTS.bindCacheEvents = bindCacheEvents;
  OPTS.populateCacheSiteFilter = populateCacheSiteFilter;
  OPTS.loadGameCache = loadGameCache;
})(typeof globalThis !== 'undefined' ? globalThis : this);
