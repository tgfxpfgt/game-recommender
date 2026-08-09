/**
 * Game Recommender - 列表页模块 / List Page Module
 *
 * 页面类型检测、列表项提取、好评率徽章与过滤、推荐高亮、下一页预载。
 * Page-type detection, list-item extraction, rating badges & filtering,
 * recommendation highlighting and next-page prefetch.
 */
(function (global) {
  'use strict';

  const GR = (global.__GR__ = global.__GR__ || {});
  const dbg = (...a) => GR.debug.dbg(...a);
  const showDiagStrip = (...a) => GR.debug.showDiagStrip(...a);

  // ============ 页面类型检测（URL优先，最可靠） ============
  // 详情页URL特征：以 数字.html 结尾，或 /game/数字.html 形式
  // 注意：/game/数字/ 是分类页，不是详情页
  function isDetailPageByUrl() {
    const path = window.location.pathname;
    return /\/\d+\.html?$/.test(path) ||
           /\/game\/\d+\.html?$/i.test(path) ||
           /\/\d+\.s?html?$/i.test(path);
  }

  // 列表页URL特征：首页、分类页、list页
  function isListPageByUrl() {
    if (isDetailPageByUrl()) return false;
    const path = window.location.pathname;
    return path === '/' ||
           path === '' ||
           /^\/[a-z0-9_-]+\/?$/i.test(path) ||
           /\/list\//i.test(path) ||
           /\/page\/\d+/i.test(path);
  }

  // 智能获取列表项：优先适配器，回退通用链接提取
  function getListItemsSmart(adapter) {
    let items = adapter.getListItems ? adapter.getListItems() : [];
    if (items.length === 0) {
      const seen = new Set();
      document.querySelectorAll('a').forEach(a => {
        const href = a.href || '';
        const p = new URL(href, window.location.href).pathname;
        if (/\/\d+\.html?$/.test(p) || /\/game\/\d+\.html?$/i.test(p)) {
          const text = a.textContent.trim().replace(/\s+/g, ' ');
          if (text.length > 2 && text.length < 200 && !seen.has(href)) {
            seen.add(href);
            items.push({ element: a.closest('li, div, article') || a, link: a, name: text, url: href, titleEl: a });
          }
        }
      });
    }
    return items;
  }

  // ============ 列表页功能 ============
  function trackListView(adapter, items, settings) {
    GR.common.trackEvent('view_list', { itemCount: items.length, page: window.location.href });

    // 虚拟机版过滤：在请求推荐/好评率之前移除标题命中关键词的游戏项
    let filteredItems = items;
    if (settings.enableVmFilter) {
      filteredItems = applyVmFilter(items, settings.vmFilterKeywords);
    }

    filteredItems.forEach(item => {
      item.link.addEventListener('click', () => {
        GR.common.trackEvent('click_detail', { gameName: item.name, gameUrl: item.url });
      });
    });

    requestRecommendations(filteredItems, settings);
    requestSteamRatings(filteredItems, settings);

    // 预载下一页：提前预热下一页的 Steam 缓存
    preloadNextPage();
  }

  // 虚拟机版过滤：从 items 中移除标题命中关键词的游戏项，并从 DOM 删除对应元素
  function applyVmFilter(items, keywords) {
    const kws = (keywords && keywords.length > 0) ? keywords : ['虚拟机板', '虚拟机'];
    const kept = [];
    let removed = 0;
    for (const item of items) {
      const name = (item.name || '').toLowerCase();
      const hit = kws.some(kw => kw && name.includes(kw.toLowerCase()));
      if (hit) {
        // 从 DOM 移除：优先移除栅格列容器以避免留空
        if (item.element) {
          const colContainer = item.element.closest('[class*="col-"]') || item.element.closest('li, article, .item, .post');
          const toRemove = (colContainer && colContainer !== item.element) ? colContainer : item.element;
          if (toRemove && toRemove.parentNode) toRemove.remove();
        }
        removed++;
      } else {
        kept.push(item);
      }
    }
    if (removed > 0) {
      dbg(`🚫 虚拟机过滤：移除 ${removed} 个游戏项，保留 ${kept.length} 个`);
    }
    return kept;
  }

  // ============ 预载下一页 / Preload Next Page ============
  let preloadedNextPage = false;

  function preloadNextPage() {
    if (preloadedNextPage) return; // 每页仅预载一次
    preloadedNextPage = true;

    // 延迟 2 秒执行，确保当前页渲染和 API 请求优先完成
    setTimeout(async () => {
      try {
        const nextUrl = findNextPageUrl();
        if (!nextUrl) { dbg('预载：未找到下一页链接'); return; }

        dbg(`预载下一页: ${nextUrl}`);

        const response = await fetch(nextUrl, { credentials: 'omit' });
        if (!response.ok) { dbg(`预载：HTTP ${response.status}`); return; }
        const html = await response.text();

        const doc = new DOMParser().parseFromString(html, 'text/html');
        const { names: gameNames, appIds, covers } = extractGameNamesFromDoc(doc);
        if (gameNames.length === 0) { dbg('预载：未提取到游戏名'); return; }

        dbg(`预载：提取到 ${gameNames.length} 个游戏名，开始预热 Steam 缓存`);

        chrome.runtime.sendMessage({
          action: 'PREFETCH_STEAM_RATINGS',
          names: gameNames,
          appIds,
          covers
        }).then(() => {
          dbg(`✅ 预载完成：已预热 ${gameNames.length} 个游戏的 Steam 缓存`);
        }).catch(() => {});
      } catch (e) {
        dbg('预载下一页失败: ' + e.message);
      }
    }, 2000);
  }

  // 查找下一页 URL：按优先级匹配常见分页模式
  function findNextPageUrl() {
    const selectors = [
      'a[rel="next"]',
      'a.next', 'a.next-page', 'a.nextpost',
      '.pagination .next a', '.pager .next a',
      '.page-nav .next a', '.wp-pagenavi .next a',
      'a[aria-label*="next" i]'
    ];
    for (const sel of selectors) {
      const link = document.querySelector(sel);
      if (link && link.href) return link.href;
    }

    const pageLinks = document.querySelectorAll(
      '.pagination a, .pager a, .page-nav a, .wp-pagenavi a, nav.pagination a, .pages a'
    );
    for (const link of pageLinks) {
      const text = (link.textContent || '').trim();
      if (/下一页|»|›|Next/i.test(text) && link.href) return link.href;
    }

    return null;
  }

  // 从解析后的文档中提取游戏名与封面 appId（选择器来自规则文件）
  function extractGameNamesFromDoc(doc) {
    const names = new Set();
    const appIds = {};
    const covers = {};
    const domain = window.location.hostname;

    const rule = (GR.builder.getSITE_RULES() || []).find(r => r.domains.some(d => domain.includes(d)));
    if (rule) {
      const cfg = rule.listItem || {};
      const containers = cfg.containers || [];
      const titleLink = cfg.titleLink;
      const titleEls = cfg.titleEls || ['h2', 'h3', '.title', '.entry-title'];
      const minLen = cfg.minLen ?? 2;
      const maxLen = cfg.maxLen ?? 200;
      for (const sel of containers) {
        doc.querySelectorAll(sel).forEach(el => {
          const t = titleLink ? el.querySelector(titleLink) : el.querySelector(titleEls.join(','));
          if (t) {
            const text = (t.textContent || '').trim().replace(/\s+/g, ' ');
            if (text.length > minLen && text.length < maxLen) {
              names.add(text);
              if (!appIds[text]) {
                const img = el.querySelector('img');
                if (img) {
                  const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
                  const m = src.match(/\/steam\/apps\/(\d+)\//i);
                  if (m) {
                    appIds[text] = m[1];
                    covers[text] = src;
                  }
                }
              }
            }
          }
        });
        if (names.size > 0) break;
      }
    }

    // 通用回退：指向详情页且有文本的链接
    if (names.size === 0) {
      const baseUrl = window.location.href;
      doc.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href') || '';
        if (!href) return;
        try {
          const p = new URL(href, baseUrl).pathname;
          if (/\/\d+\.html?$/.test(p) || /\/game\/\d+\.html?$/i.test(p)) {
            const text = (a.textContent || '').trim().replace(/\s+/g, ' ');
            if (text.length > 2 && text.length < 200) names.add(text);
          }
        } catch (e) {}
      });
    }

    return { names: [...names], appIds, covers };
  }

  // 列表页：检索每个游戏的Steam好评率并显示在游戏名前
  async function requestSteamRatings(items, settings) {
    const maxItems = 60;
    const processItems = items.slice(0, maxItems);
    // 工作状态浮窗：开始查询 / Show the in-progress status bar
    GR.status.showStatus('正在获取 Steam 好评率', 0, processItems.length, '后台批量查询中...');
    // 去重游戏名，同时收集每个名称对应的封面 appId 与封面图 URL
    const imageAppIdEnabled = GR.builder.isImageAppIdEnabled();
    const nameToImage = {};
    processItems.forEach(item => {
      if (item.name && !nameToImage[item.name]) {
        nameToImage[item.name] = imageAppIdEnabled ? GR.builder.extractSteamImageInfo(item.element) : null;
      }
    });
    const uniqueNames = Object.keys(nameToImage).filter(n => n && n.length > 1);
    if (uniqueNames.length === 0) return;
    try {

      const response = await chrome.runtime.sendMessage({
        action: 'GET_STEAM_RATINGS',
        names: uniqueNames,
        imageData: nameToImage // {name: {appId, cover} | null}
      });
      if (response && response.ratings) {
        let shown = 0;
        let filtered = 0;
        const notFoundNames = [];
        // 列表页批量记录：appId → 下载页地址写入下载站网址缓存
        const urlEntries = [];
        const minRating = settings?.enableRatingFilter ? (settings.minSteamRatingFilter || 0) : 0;
        processItems.forEach(item => {
          const rating = response.ratings[item.name];
          // 匹配到 appId 即显示徽章：有评测显示好评率，无评测（0条/Demo）显示 AppID
          if (rating && rating.appId) {
            if (item.url) urlEntries.push({ appId: rating.appId, url: item.url });
            if (rating.positiveRate !== null && rating.positiveRate !== undefined) {
              // 好评率过滤：低于阈值的移除该项（从DOM中删除，使后续元素自动重排）
              if (minRating > 0 && rating.positiveRate < minRating) {
                if (item.element) {
                  const colContainer = item.element.closest('[class*="col-"]') || item.element.closest('li, article, .item, .post');
                  const toRemove = (colContainer && colContainer !== item.element) ? colContainer : item.element;
                  if (toRemove.parentNode) toRemove.remove();
                }
                filtered++;
                return;
              }
            }
            prependRatingBadge(item, rating);
            shown++;
          } else {
            // 未匹配（搜索失败/负缓存/异常）：显示"未找到"徽章
            notFoundNames.push(item.name);
            prependNotFoundBadge(item);
          }
        });
        // 批量写入下载站网址缓存（fire-and-forget）
        const siteKey = GR.builder.getAdapterKey();
        if (siteKey && urlEntries.length > 0) {
          chrome.runtime.sendMessage({
            action: 'RECORD_DOWNLOAD_URLS_BATCH',
            data: { siteKey, siteName: GR.builder.getAdapter().name, domain: window.location.hostname, entries: urlEntries }
          }).catch(() => {});
        }
        dbg(`列表页: 显示 ${shown} 个好评率, 过滤 ${filtered} 个, 未找到 ${notFoundNames.length} 个` +
            (notFoundNames.length > 0 ? ` [${notFoundNames.slice(0, 5).join('、')}]` : ''));

        // 显示诊断条（提取/查询/徽章/未找到/后台错误，8 秒后自动消失）
        showDiagStrip({
          extracted: processItems.length,
          queried: uniqueNames.length,
          shown,
          notFound: notFoundNames.length,
          notFoundNames,
          error: response.error || null
        });

        // 工作状态浮窗：完成统计（3 秒后自动消失）
        // Work status bar: completion stats (auto-dismiss in 3s)
        GR.status.showStats({
          title: 'Steam 好评率获取完成',
          summary: `${shown} 个好评率${filtered > 0 ? ` · ${filtered} 个已过滤` : ''}${notFoundNames.length > 0 ? ` · ${notFoundNames.length} 个未找到` : ''}`,
          rows: [
            `查询 ${uniqueNames.length} 个游戏 · 用时完成`,
            notFoundNames.length > 0 ? `未找到: ${notFoundNames.slice(0, 3).join('、')}${notFoundNames.length > 3 ? '...' : ''}` : ''
          ].filter(Boolean)
        });

        // 未匹配的游戏 3 秒后重试一次（瞬时错误兜底）
        if (notFoundNames.length > 0) {
          setTimeout(async () => {
            try {
              const retryResp = await chrome.runtime.sendMessage({ action: 'GET_STEAM_RATINGS', names: notFoundNames });
              if (retryResp && retryResp.ratings) {
                processItems.forEach(item => {
                  const r = retryResp.ratings[item.name];
                  if (r && r.appId) {
                    const holder = item.titleEl || (item.element ? item.element.querySelector('h2, h3, h4, h5, .title, .entry-title, .name, .game-name, .game-title') : null);
                    if (holder) {
                      const old = holder.querySelector('.gr-rating-badge, .gr-not-found');
                      if (old) old.remove();
                    }
                    const oldInLink = item.link.querySelector('.gr-not-found');
                    if (oldInLink) oldInLink.remove();
                    prependRatingBadge(item, r);
                  }
                });
              }
            } catch (e) { /* 重试失败保持"未找到"徽章 */ }
          }, 3000);
        }
      }
    } catch (e) {
      dbg('Steam好评率检索失败: ' + e.message);
      // 请求失败也显示诊断条，暴露后台错误
      showDiagStrip({
        extracted: processItems.length,
        queried: uniqueNames.length,
        shown: 0,
        notFound: 0,
        error: e.message
      });
      GR.status.showStats({ title: 'Steam 好评率获取失败', summary: e.message });
    }
  }

  // 在游戏标题前插入好评率徽章（点击跳转 Steam）
  function prependRatingBadge(item, rating) {
    const link = item.link;
    if (!link) return;

    const rate = rating.positiveRate;
    // 颜色分级：>=80 蓝色，>=60 黄绿，<60 橙色；无评测（0条/Demo）灰色 AppID
    let color, bg, text;
    if (rate === null || rate === undefined) {
      color = '#8f98a0';
      bg = 'rgba(143,152,160,0.15)';
      text = rating.appId ? `#${rating.appId}` : '暂无';
    } else {
      color = rate >= 80 ? '#66c0f4' : rate >= 60 ? '#a3cf06' : '#ff7b00';
      bg = rate >= 80 ? 'rgba(102,192,244,0.15)' : rate >= 60 ? 'rgba(163,207,6,0.15)' : 'rgba(255,123,0,0.15)';
      text = `${rate}%`;
    }

    const badge = document.createElement('span');
    badge.className = 'gr-rating-badge';
    badge.textContent = text;
    badge.style.cssText = `display:inline-block;margin-right:6px;padding:1px 6px;font-size:11px;font-weight:bold;color:${color};background:${bg};border:1px solid ${color};border-radius:3px;vertical-align:middle;cursor:pointer;text-decoration:none;`;
    badge.title = (rate === null || rate === undefined)
      ? `Steam 已匹配 (AppID ${rating.appId})，暂无评测\n点击跳转 Steam 详情页`
      : `Steam 好评率: ${rate}%${rating.ratingDesc ? ' (' + rating.ratingDesc + ')' : ''}\n点击跳转 Steam 详情页`;
    // 点击徽章跳转 Steam 详情页（span+click 避免嵌套链接）
    if (rating.appId) {
      badge.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(`https://store.steampowered.com/app/${rating.appId}/`, '_blank', 'noopener');
      });
    }

    // 查找标题元素插入徽章（titleEl 优先 → 元素内标题 → 链接文本节点）
    let targetEl = item.titleEl || null;
    if (!targetEl && item.element) {
      targetEl = item.element.querySelector('h2, h3, h4, h5, .title, .entry-title, .name, .game-name, .game-title');
    }

    if (targetEl && !targetEl.querySelector('.gr-rating-badge, .gr-not-found')) {
      targetEl.insertBefore(badge, targetEl.firstChild);
    } else if (!link.querySelector('.gr-rating-badge, .gr-not-found')) {
      const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT, null);
      const firstTextNode = walker.nextNode();
      if (firstTextNode && firstTextNode.textContent.trim().length > 1) {
        link.insertBefore(badge, firstTextNode);
      } else {
        link.insertBefore(badge, link.firstChild);
      }
    }
  }

  // 未在 Steam 找到的游戏：显示"未找到"徽章
  function prependNotFoundBadge(item) {
    const link = item.link;
    if (!link) return;

    const badge = document.createElement('span');
    badge.className = 'gr-rating-badge gr-not-found';
    badge.textContent = '未找到';
    badge.title = '未在 Steam 找到该游戏（搜索无匹配结果或查询失败）';
    badge.style.cssText = 'display:inline-block;margin-right:6px;padding:1px 6px;font-size:11px;font-weight:bold;color:#666;background:rgba(102,102,102,0.08);border:1px dashed #666;border-radius:3px;vertical-align:middle;';

    let targetEl = item.titleEl || null;
    if (!targetEl && item.element) {
      targetEl = item.element.querySelector('h2, h3, h4, h5, .title, .entry-title, .name, .game-name, .game-title');
    }

    if (targetEl && !targetEl.querySelector('.gr-rating-badge, .gr-not-found')) {
      targetEl.insertBefore(badge, targetEl.firstChild);
    } else if (!link.querySelector('.gr-rating-badge, .gr-not-found')) {
      const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT, null);
      const firstTextNode = walker.nextNode();
      if (firstTextNode && firstTextNode.textContent.trim().length > 1) {
        link.insertBefore(badge, firstTextNode);
      } else {
        link.insertBefore(badge, link.firstChild);
      }
    }
  }

  // 列表页：计算并高亮推荐游戏
  async function requestRecommendations(items, settings) {
    try {
      const maxItems = 60;
      const processItems = items.slice(0, maxItems);
      const games = processItems.map(item => ({ name: item.name, url: item.url, keywords: [] }));

      const response = await chrome.runtime.sendMessage({ action: 'GET_RECOMMENDATIONS', games });
      if (response && response.results) {
        const threshold = settings?.highlightThreshold || 0.6;
        let highlighted = 0;
        response.results.forEach((result, index) => {
          if (result.recommendation && result.recommendation.score >= threshold) {
            highlightItem(processItems[index], result.recommendation);
            highlighted++;
          }
        });
        dbg(`高亮 ${highlighted} 个推荐游戏`);
      }
    } catch (e) {
      dbg('推荐计算失败: ' + e.message);
    }
  }

  function highlightItem(item, recommendation) {
    const el = item.element;
    el.classList.add('gr-highlighted');
    const badge = document.createElement('span');
    badge.className = 'gr-badge';
    badge.textContent = `🎮 ${Math.round(recommendation.score * 100)}%`;
    badge.title = `推荐度: ${Math.round(recommendation.score * 100)}%`;
    const link = item.link || el.querySelector('a');
    if (link) { link.style.position = 'relative'; link.appendChild(badge); }
  }

  GR.list = {
    isDetailPageByUrl,
    isListPageByUrl,
    getListItemsSmart,
    trackListView,
    applyVmFilter,
    requestSteamRatings,
    requestRecommendations
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
