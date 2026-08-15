/**
 * 游戏雷达 Game Radar - 游戏缓存面板模块 / Game Cache Panel
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
    // v7.1.0：本页过期条目批量刷新
    bindStaleRefresh();
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
    // 好评率 / 标签 / 站点 / 类型筛选：变更即搜索（防抖 300ms）
    ['cacheMinRating', 'cacheTagInput', 'cacheSiteFilter', 'cacheTypeFilter'].forEach((id) => {
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
    // 清理过期缓存（v3.0.0）
    document.getElementById('cacheCleanExpiredBtn').addEventListener('click', cleanExpiredCache);
    // 名称批量自愈（v3.1.0）
    document.getElementById('cacheHealNamesBtn').addEventListener('click', healRegistryNames);
    // 清空全部
    document.getElementById('cacheClearAllBtn').addEventListener('click', clearAllCache);
  }

  // 批量自愈：扫描并修复注册表中名称异常（中文名无中文/英文名无英文）的条目
  // Batch self-heal: scan & fix abnormal registry names (CN without Chinese / EN
  // without English)
  async function healRegistryNames() {
    const btn = document.getElementById('cacheHealNamesBtn');
    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '🩹 修复中...';
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'HEAL_REGISTRY_NAMES' });
      const statsEl = document.getElementById('cacheStats');
      if (resp) {
        statsEl.innerHTML = `✅ 名称自愈：扫描 <b>${resp.scanned}</b> 条异常 · 修复 <b>${resp.healed}</b> 条${resp.remaining > 0 ? ` · 剩余 <b>${resp.remaining}</b> 条（可再次点击）` : ''}`;
        await loadGameCache(); // 刷新列表
      } else {
        statsEl.textContent = '自愈失败，请查看运行日志';
      }
    } catch (e) {
      const statsEl = document.getElementById('cacheStats');
      statsEl.textContent = '自愈失败: ' + String(e);
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }

  // 一键清理过期缓存：Steam 动态缓存 / 名称负缓存 / 下载站网址（按 TTL）
  // One-click expired-cache cleanup (Steam / name negative / download URLs)
  async function cleanExpiredCache() {
    const btn = document.getElementById('cacheCleanExpiredBtn');
    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '🧹 清理中...';
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'CLEAN_EXPIRED_CACHE' });
      const statsEl = document.getElementById('cacheStats');
      if (resp && resp.total >= 0) {
        statsEl.innerHTML = `✅ 清理完成：Steam 缓存 <b>${resp.steamCache}</b> · 名称负缓存 <b>${resp.nameIndex}</b> · 下载站网址 <b>${resp.downloadUrls}</b>，共 <b>${resp.total}</b> 条过期条目`;
        await loadGameCache(); // 刷新列表
      } else {
        statsEl.textContent = '清理失败，请查看运行日志';
      }
    } catch (e) {
      const statsEl = document.getElementById('cacheStats');
      statsEl.textContent = '清理失败: ' + String(e);
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }

  // 生成缓存页下载站筛选选项（来自规则文件）
  function populateCacheSiteFilter() {
    const select = document.getElementById('cacheSiteFilter');
    if (!select) return;
    const rules = (globalThis.__GAME_RECOMMENDER_SITES__ || {}).sites || [];
    rules
      .filter((s) => s.searchUrl)
      .forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.key;
        opt.textContent = s.name;
        select.appendChild(opt);
      });
  }

  // v7.1.0：刷新本页过期条目（任一信息类型模块过期 → 逐条强制刷新）
  function bindStaleRefresh() {
    const btn = document.getElementById('cacheRefreshStaleBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const tbody = document.getElementById('cacheTableBody');
      const stale = [];
      tbody.querySelectorAll('tr').forEach((tr) => {
        const appId = tr.querySelector('[data-appid]');
        const tags = tr.querySelectorAll('.col-modules span');
        if (!appId) return;
        const hasStale = Array.from(tags).some(
          (t) => (t.textContent || '').trim() === '' || /缺失|过期/.test(t.title || '')
        );
        if (hasStale) stale.push(appId.getAttribute('data-appid'));
      });
      if (stale.length === 0) {
        alert('本页条目缓存均有效');
        return;
      }
      btn.disabled = true;
      btn.textContent = `⏳ 刷新 ${stale.length} 条...`;
      for (const appId of stale.slice(0, 10)) {
        await chrome.runtime.sendMessage({ action: 'REFRESH_GAME_CACHE_ENTRY', appId }).catch(() => {});
      }
      btn.disabled = false;
      btn.textContent = '♻️ 刷新本页过期';
      loadGameCache();
    });
  }

  // 加载游戏缓存列表
  async function loadGameCache() {
    const keyword = document.getElementById('cacheSearchInput').value.trim();
    const minRating = parseInt(document.getElementById('cacheMinRating').value) || 0;
    const tag = document.getElementById('cacheTagInput').value.trim();
    const siteKey = document.getElementById('cacheSiteFilter').value;
    const typeFilter = document.getElementById('cacheTypeFilter').value;
    const tbody = document.getElementById('cacheTableBody');
    const statsEl = document.getElementById('cacheStats');

    tbody.innerHTML = '<tr><td colspan="10" class="cache-empty">加载中...</td></tr>';
    statsEl.textContent = '';

    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'GET_GAME_CACHE_LIST',
        keyword,
        minRating,
        tag,
        siteKey,
        typeFilter,
        page: OPTS.cacheCurrentPage,
        pageSize: OPTS.CACHE_PAGE_SIZE
      });

      if (!resp || !resp.games) {
        tbody.innerHTML = '<tr><td colspan="10" class="cache-empty">加载失败，请重试</td></tr>';
        return;
      }

      // v6.4.19：缓存模块统计（按信息类型细分 + 过期数）与 TTL 建议
      const modNames = { meta: '基础', rating: '好评率', detail: '详情', spy: '热度' };
      const ms = resp.moduleStats || {};
      const msText = Object.keys(modNames)
        .filter((k) => ms[k])
        .map((k) => `${modNames[k]} ${ms[k].count}${ms[k].stale > 0 ? `(+${ms[k].stale}过期)` : ''}`)
        .join(' · ');
      statsEl.innerHTML =
        `<div>共 ${resp.total} 条记录 · 第 ${resp.page}/${resp.totalPages} 页</div>` +
        (msText
          ? `<div style="font-size:11px;color:#8f98a0;margin-top:2px;">缓存模块：${msText}（各模块 TTL 建议见「缓存有效期」设置）</div>`
          : '');

      if (resp.games.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="cache-empty">暂无缓存数据</td></tr>';
        renderPagination(0, 1);
        return;
      }

      // 渲染表格行（封面缩略图 + 好评率徽章 + 可点击 appId + 手动更新按钮）
      tbody.innerHTML = resp.games
        .map(
          (g) => `
        <tr>
          <td class="col-cover">
            ${
              g.coverImage
                ? `<img src="${escapeAttr(g.coverImage)}" class="cache-cover" loading="lazy" alt="" title="${escapeAttr(g.cnName || g.appId)}">`
                : '—'
            }
          </td>
          <td class="col-appid">
            ${formatRatingBadge(g.positiveRate)}
            <a href="https://store.steampowered.com/app/${escapeAttr(g.appId)}" target="_blank" rel="noopener" title="打开 Steam 详情页">${escapeHtml(g.appId)}</a>
            <button class="cache-refresh-btn" data-appid="${escapeAttr(g.appId)}" title="手动更新 Steam 信息与下载站地址">🔄</button>
          </td>
          <td class="col-name" title="${escapeAttr(g.cnName)}">${escapeHtml(g.cnName || '—')}</td>
          <td class="col-name" title="${escapeAttr(g.enName)}">${escapeHtml(g.enName || '—')}</td>
          <td class="col-type">${formatTypeBadge(g.type)}</td>
          <td class="col-modules" title="各信息类型缓存新鲜度：绿=有效 灰=缺失/过期">${formatModuleFreshness(g.moduleFreshness)}</td>
          <td class="col-rec" title="${formatRecDetail(g)}">${formatRecBadge(g.recommendation)}</td>
          <td class="col-time">${formatTime(g.lastConfirmed)}</td>
          <td class="col-url">${formatDownloadUrls(g.downloadUrls, g.primaryDownloadUrl)}</td>
          <td class="col-time">${formatTime(g.lastAccessed)}</td>
          <td><button class="cache-delete-btn" data-appid="${escapeAttr(g.appId)}">删除</button></td>
        </tr>
      `
        )
        .join('');

      // 绑定删除按钮事件
      tbody.querySelectorAll('.cache-delete-btn').forEach((btn) => {
        btn.addEventListener('click', () => deleteCacheEntry(btn.dataset.appid));
      });

      // 封面图加载失败时隐藏（MV3 CSP 合规：addEventListener 而非内联 onerror）
      tbody.querySelectorAll('.cache-cover').forEach((img) => {
        img.addEventListener('error', () => {
          img.style.display = 'none';
        });
      });

      // 绑定手动更新按钮事件
      tbody.querySelectorAll('.cache-refresh-btn').forEach((btn) => {
        btn.addEventListener('click', () => refreshCacheEntry(btn.dataset.appid, btn));
      });

      renderPagination(resp.total, resp.totalPages);
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="11" class="cache-empty">加载失败: ${escapeHtml(String(e))}</td></tr>`;
    }
  }

  // v6.4.19：信息缓存新鲜度标签（meta 基础 / rating 好评率 / detail 详情 / spy 热度）
  // v7.1.0：hover 显示 TTL 建议（来自设置 cacheTtls）
  function formatModuleFreshness(freshness) {
    const f = freshness || {};
    const ttls = (OPTS.currentSettings && OPTS.currentSettings.cacheTtls) || {};
    const ttlText = (key) => {
      const t = ttls[key];
      if (!t) return '';
      return ` · TTL ${t.value || 0}${t.unit || ''}${t.value === 0 ? '（长期）' : ''}`;
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
  function formatRatingBadge(rate) {
    if (rate === null || rate === undefined) {
      return `<span class="rating-badge" style="color:#8f98a0;background:rgba(143,152,160,0.12);border-color:#3a3a4a;">暂无</span>`;
    }
    const P = globalThis.__GR_PATTERNS__ || {};
    const color = P.ratingColorFor
      ? P.ratingColorFor(rate)
      : rate >= 80
        ? '#66c0f4'
        : rate >= 60
          ? '#a3cf06'
          : '#ff7b00';
    const bg = P.ratingBgFor
      ? P.ratingBgFor(rate)
      : rate >= 80
        ? 'rgba(102,192,244,0.15)'
        : rate >= 60
          ? 'rgba(163,207,6,0.15)'
          : 'rgba(255,123,0,0.15)';
    return `<span class="rating-badge" style="color:${color};background:${bg};border-color:${color};">${rate}%</span>`;
  }

  // Steam 条目类型徽章（game 蓝色 / dlc 橙 / 其他紫灰）
  function formatTypeBadge(type) {
    if (!type) return '—';
    const t = type.toLowerCase();
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
    const pct = Math.round(score * 100);
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
        setTimeout(() => {
          btn.textContent = originalText;
          btn.disabled = false;
        }, 1200);
        loadGameCache();
      } else {
        btn.textContent = '❌';
        setTimeout(() => {
          btn.textContent = originalText;
          btn.disabled = false;
        }, 1500);
        alert('更新失败: ' + (resp ? resp.error : '未知错误'));
      }
    } catch (e) {
      btn.textContent = '❌';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 1500);
      alert('更新失败: ' + String(e));
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
    const end = Math.min(totalPages, start + maxButtons - 1);
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

    container.querySelectorAll('button[data-page]').forEach((btn) => {
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
      alert('删除失败: ' + String(e));
    }
  }

  // 清空全部游戏缓存
  async function clearAllCache() {
    if (
      !confirm(
        '确定要清空全部游戏缓存吗？此操作不可恢复。\n\n将清除：\n· 游戏注册表（中英文名映射）\n· Steam 动态缓存（好评率/评论）\n· 下载站详情页网址缓存\n· 名称索引'
      )
    )
      return;
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'CLEAR_GAME_CACHE' });
      if (resp && resp.success) {
        OPTS.cacheCurrentPage = 1;
        loadGameCache();
      } else {
        alert('清空失败，请重试');
      }
    } catch (e) {
      alert('清空失败: ' + String(e));
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
    if (!url) return '';
    if (url.length <= maxLen) return url;
    return url.substring(0, maxLen) + '...';
  }

  OPTS.bindCacheEvents = bindCacheEvents;
  OPTS.populateCacheSiteFilter = populateCacheSiteFilter;
  OPTS.loadGameCache = loadGameCache;
})(typeof globalThis !== 'undefined' ? globalThis : this);
