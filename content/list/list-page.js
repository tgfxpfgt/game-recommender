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
        let p;
        try {
          p = new URL(href, window.location.href).pathname;
        } catch (e) {
          return; // 畸形 href 跳过，不中断整页提取 / skip malformed hrefs
        }
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

  // 等待列表项出现（AJAX 延迟渲染页面）：容器一出现即提取，超时返回当前结果
  // Wait for list items on AJAX-rendered pages; resolve on the first non-empty
  // extraction (with debounce) or after the timeout.
  function waitForListItems(adapter, timeoutMs) {
    const limit = timeoutMs || 4000;
    return new Promise((resolve) => {
      let timer = null;
      let observer = null;
      let debounceTimer = null;
      let lastItems = [];
      const finish = (its) => {
        if (observer) observer.disconnect();
        if (timer) clearTimeout(timer);
        if (debounceTimer) clearTimeout(debounceTimer);
        resolve(its);
      };
      const check = () => {
        const its = getListItemsSmart(adapter);
        if (its.length > 0) { finish(its); return; }
        lastItems = its;
      };
      observer = new MutationObserver(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(check, 200);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      timer = setTimeout(() => finish(lastItems), limit);
      check(); // 立即先查一次（列表可能已渲染完）
    });
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

    // 提取封面 appId（推荐计算用：appId 维度个性化评分）
    const imageAppIdEnabled = GR.builder.isImageAppIdEnabled();
    const nameToImage = {};
    filteredItems.forEach(item => {
      if (item.name && !nameToImage[item.name]) {
        nameToImage[item.name] = imageAppIdEnabled ? GR.builder.extractSteamImageInfo(item.element) : null;
      }
    });

    requestRecommendations(filteredItems, settings, nameToImage);
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
        // 从 DOM 移除（优先移除栅格列容器以避免留空，与好评率过滤共用逻辑）
        removeItemFromDom(item);
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
                // 复用 builder 的封面 appId 提取（统一正则实现）
                const info = GR.builder.extractSteamImageInfo(el);
                if (info) {
                  appIds[text] = info.appId;
                  covers[text] = info.cover;
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

  // ============ 列表页 Steam 好评率（两波：缓存命中即时显示 + 后台推送更新） ============
  // Two-wave rating flow: cached hits render instantly; misses are fetched in
  // the background and pushed back via STEAM_RATINGS_UPDATE.
  let ratingsJob = null; // 当前批次的处理状态 / current batch job state

  function createRatingsJob(processItems, settings, uniqueNames) {
    ratingsJob = {
      processItems, settings, uniqueNames,
      processed: new Set(), // 已出结果的游戏名（徽章已显示）/ names already resolved
      shown: 0, filtered: 0, notFoundNames: [],
      urlEntries: [], // appId → 下载页地址批量写入 / download-URL batch entries
      finished: false,
      forceTimer: null // 强制收尾定时器 / force-finish timer
    };
  }

  // 从 DOM 移除低好评率游戏项（含栅格容器，避免留空）
  function removeItemFromDom(item) {
    if (!item.element || !item.element.parentNode) return;
    const colContainer = item.element.closest('[class*="col-"]') || item.element.closest('li, article, .item, .post');
    const toRemove = (colContainer && colContainer !== item.element) ? colContainer : item.element;
    if (toRemove.parentNode) toRemove.remove();
  }

  // 应用一波查询结果。mode='first'：未命中的跳过（等待推送），不插"未找到"徽章；
  // mode='final'：波内仍未命中的按"未找到"处理。
  // 收尾后到达的迟到推送仍会应用徽章（只补徽章，不重复统计）。
  // Apply one wave of results. 'first': misses wait for the push; 'final':
  // misses in this wave resolve as "not found". Late pushes still apply badges.
  function applyRatingsResponse(ratings, mode) {
    if (!ratingsJob) return false;
    const job = ratingsJob;
    const minRating = job.settings?.enableRatingFilter ? (job.settings.minSteamRatingFilter || 0) : 0;
    let changed = false;
    job.processItems.forEach(item => {
      if (job.processed.has(item.name)) return;
      const rating = ratings[item.name];
      if (rating && rating.appId) {
        job.processed.add(item.name);
        changed = true;
        // 合集等 type 徽章：appId 非本体，不写入下载站网址缓存
        const isTypeBadge = rating.type && rating.type !== 'game' && rating.type !== 'demo';
        if (item.url && !isTypeBadge) job.urlEntries.push({ appId: rating.appId, url: item.url });
        // 好评率过滤：低于阈值的从 DOM 移除（剩余元素自动重排）
        if (rating.positiveRate !== null && rating.positiveRate !== undefined) {
          if (minRating > 0 && rating.positiveRate < minRating) {
            removeItemFromDom(item);
            job.filtered++;
            return;
          }
        }
        prependBadge(item, rating);
        job.shown++;
      } else if (mode !== 'first' && Object.prototype.hasOwnProperty.call(ratings, item.name)) {
        // 最终波：仅对**波内包含**的名字判定"未找到"（波外名字继续等待后续波）
        // 'final': only names present in this wave resolve as "not found"
        job.processed.add(item.name);
        job.notFoundNames.push(item.name);
        changed = true;
        prependBadge(item, null);
      }
    });
    return changed;
  }

  // 完成统计：批量写下载站网址缓存 + 统一浮窗显示统计。
  // 收尾后保留 ratingsJob（迟到推送仍可补徽章），不再置 null。
  function finishRatings() {
    if (!ratingsJob || ratingsJob.finished) return;
    ratingsJob.finished = true;
    clearTimeout(ratingsJob.forceTimer);
    const job = ratingsJob;
    const unresolved = job.processItems.filter(i => !job.processed.has(i.name)).length;
    // 批量写入下载站网址缓存（fire-and-forget）
    const siteKey = GR.builder.getAdapterKey();
    if (siteKey && job.urlEntries.length > 0) {
      chrome.runtime.sendMessage({
        action: 'RECORD_DOWNLOAD_URLS_BATCH',
        data: { siteKey, siteName: GR.builder.getAdapter().name, domain: window.location.hostname, entries: job.urlEntries }
      }).catch(() => {});
    }
    dbg(`列表页: 显示 ${job.shown} 个好评率, 过滤 ${job.filtered} 个, 未找到 ${job.notFoundNames.length} 个` +
        (job.notFoundNames.length > 0 ? ` [${job.notFoundNames.slice(0, 5).join('、')}]` : '') +
        (unresolved > 0 ? `, 未返回 ${unresolved} 个` : ''));
    GR.status.showStats({
      title: 'Steam 好评率获取完成',
      summary: `${job.shown} 个好评率${job.filtered > 0 ? ` · ${job.filtered} 个已过滤` : ''}${job.notFoundNames.length > 0 ? ` · ${job.notFoundNames.length} 个未找到` : ''}${unresolved > 0 ? ` · ${unresolved} 个暂未返回（刷新页面可重试）` : ''}`,
      rows: [
        `查询 ${job.uniqueNames.length} 个游戏 · 提取 ${job.processItems.length} 个`,
        job.notFoundNames.length > 0 ? `未找到: ${job.notFoundNames.slice(0, 3).join('、')}${job.notFoundNames.length > 3 ? '...' : ''}` : ''
      ].filter(Boolean)
    });
  }

  // 兜底：45 秒强制收尾。未返回的游戏保持空白（后台已逐批落盘缓存，
  // 刷新页面第一波即命中），**不误标"未找到"**；收尾后迟到的推送仍会应用徽章。
  function scheduleFallbacks(nameToImage) {
    const job = ratingsJob;
    if (!job) return;
    job.forceTimer = setTimeout(() => {
      if (!ratingsJob || ratingsJob.finished) return;
      finishRatings();
    }, 45000);
  }

  // 后台推送的结果（STEAM_RATINGS_UPDATE）：多波增量，波内 null 判定"未找到"；
  // done 标记或全部处理后收尾。
  function applySteamRatingsUpdate(ratings, done) {
    if (!ratingsJob) return false;
    // 后台全部批次完成标记 / background completion marker
    if (ratings === null && done) {
      if (!ratingsJob.finished) finishRatings();
      return true;
    }
    applyRatingsResponse(ratings || {}, 'final');
    // 所有游戏已出结果 → 收尾 / all resolved → finish
    if (!ratingsJob.finished &&
        ratingsJob.processItems.every(i => ratingsJob.processed.has(i.name))) {
      finishRatings();
    }
    return true;
  }

  // 列表页：检索每个游戏的Steam好评率并显示在游戏名前
  async function requestSteamRatings(items, settings) {
    const maxItems = 60;
    const processItems = items.slice(0, maxItems);
    // 工作状态浮窗：开始查询 / Show the in-progress status bar
    GR.status.showStatus('正在获取 Steam 好评率', 0, processItems.length, '缓存优先检索中...');
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

    createRatingsJob(processItems, settings, uniqueNames);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'GET_STEAM_RATINGS',
        names: uniqueNames,
        imageData: nameToImage // {name: {appId, cover} | null}
      });
      const ratings = (response && response.ratings) || {};
      const pendingCount = (response && response.pending) || 0;
      // 第一波：缓存命中即时显示徽章
      applyRatingsResponse(ratings, 'first');
      const job = ratingsJob;
      if (!job || job.finished) return;
      const doneCount = job.processed.size;
      if (pendingCount > 0 && doneCount < processItems.length) {
        // 后台正在从 Steam 拉取未命中项：进度条更新为"已命中 X / 总数"，等待推送
        GR.status.showStatus('正在从 Steam 更新缓存', doneCount, processItems.length, `${pendingCount} 个未命中缓存，后台拉取中...`);
        scheduleFallbacks(nameToImage);
      } else {
        finishRatings();
      }
    } catch (e) {
      dbg('Steam好评率检索失败: ' + e.message);
      GR.status.showStats({ title: 'Steam 好评率获取失败', summary: e.message, rows: [`提取 ${processItems.length} 个游戏 · 查询 ${uniqueNames.length} 个`] });
    }
  }

  // 在游戏标题前插入徽章（好评率/AppID/未找到/合集type 统一实现，rating 为空时显示"未找到"）
  // Insert a badge before the game title (rating / AppID / not-found / bundle-type,
  // unified). When rating.type marks a non-base app (e.g. bundle), show the type.
  function prependBadge(item, rating) {
    const link = item.link;
    if (!link) return;

    const isNotFound = !rating || !rating.appId;
    const isTypeBadge = !isNotFound && rating.type && rating.type !== 'game' && rating.type !== 'demo';
    const rate = rating ? rating.positiveRate : null;
    // 颜色分级：>=80 蓝色，>=60 黄绿，<60 橙色；无评测（0条/Demo）灰色 AppID；
    // 未找到灰色虚线；合集等 type 徽章紫色
    let color, bg, text, cls;
    if (isNotFound) {
      color = '#666';
      bg = 'rgba(102,102,102,0.08)';
      text = '未找到';
      cls = 'gr-rating-badge gr-not-found';
    } else if (isTypeBadge) {
      color = '#b48ce0';
      bg = 'rgba(180,140,224,0.12)';
      text = rating.type;
      cls = 'gr-rating-badge gr-type-badge';
    } else if (rate === null || rate === undefined) {
      color = '#8f98a0';
      bg = 'rgba(143,152,160,0.15)';
      text = rating.appId ? `#${rating.appId}` : '暂无';
      cls = 'gr-rating-badge';
    } else {
      color = rate >= 80 ? '#66c0f4' : rate >= 60 ? '#a3cf06' : '#ff7b00';
      bg = rate >= 80 ? 'rgba(102,192,244,0.15)' : rate >= 60 ? 'rgba(163,207,6,0.15)' : 'rgba(255,123,0,0.15)';
      text = `${rate}%`;
      cls = 'gr-rating-badge';
    }

    const badge = document.createElement('span');
    badge.className = cls;
    badge.textContent = text;
    badge.style.cssText = `display:inline-block;margin-right:6px;padding:1px 6px;font-size:11px;font-weight:bold;color:${color};background:${bg};border:1px ${isNotFound ? 'dashed' : 'solid'} ${color};border-radius:3px;vertical-align:middle;${isNotFound || isTypeBadge ? '' : 'cursor:pointer;text-decoration:none;'}`;
    badge.title = isNotFound
      ? '未在 Steam 找到该游戏（搜索无匹配结果或查询失败）'
      : isTypeBadge
        ? `Steam 条目类型: ${rating.type}（合集/非单个游戏本体，无法获取本体 AppID）`
        : rating.failed
          ? `Steam 已匹配 (AppID ${rating.appId})，好评率获取失败（网络/限流），下次访问自动重试`
          : (rate === null || rate === undefined)
            ? `Steam 已匹配 (AppID ${rating.appId})，暂无评测\n点击跳转 Steam 详情页`
            : `Steam 好评率: ${rate}%${rating.ratingDesc ? ' (' + rating.ratingDesc + ')' : ''}\n点击跳转 Steam 详情页`;
    // 点击徽章跳转 Steam 详情页（span+click 避免嵌套链接）
    if (!isNotFound && !isTypeBadge && rating.appId) {
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

  // 推荐值徽章：好评率徽章之后插入，显示推荐数值；悬停展示各分值组成；
  // 按推荐值分级着色（≥80% 红 / ≥60% 橙 / ≥40% 黄绿 / 其余灰）。
  // Recommendation badge (after the rating badge): shows the score, tooltip with
  // the breakdown, and a score-graded color.
  function prependRecBadge(item, recommendation) {
    const link = item.link;
    if (!link || !recommendation) return;
    const score = recommendation.score;
    if (score === null || score === undefined || isNaN(score)) return;

    const pct = Math.round(score * 100);
    const color = pct >= 80 ? '#e74c3c' : pct >= 60 ? '#ff7b00' : pct >= 40 ? '#a3cf06' : '#8f98a0';
    const bg = pct >= 80 ? 'rgba(231,76,60,0.12)' : pct >= 60 ? 'rgba(255,123,0,0.12)' : pct >= 40 ? 'rgba(163,207,6,0.12)' : 'rgba(143,152,160,0.1)';

    const b = recommendation.breakdown || {};
    const fmt = v => Math.round((v || 0) * 100) + '%';
    const badge = document.createElement('span');
    badge.className = 'gr-rec-badge';
    badge.textContent = `🎯 ${pct}%`;
    badge.style.cssText = `display:inline-block;margin-right:6px;padding:1px 6px;font-size:11px;font-weight:bold;color:${color};background:${bg};border:1px solid ${color};border-radius:3px;vertical-align:middle;cursor:default;`;
    badge.title = `推荐度: ${pct}%\n点击率: ${fmt(b.clickScore)} · 下载率: ${fmt(b.downloadScore)}\n关键词: ${fmt(b.keywordMatch)} · Steam: ${fmt(b.steamRating)}`;

    // 插入到好评率徽章之后（若尚未插入好评率则插最前，好评率后插会自动排到其前）
    let targetEl = item.titleEl || null;
    if (!targetEl && item.element) {
      targetEl = item.element.querySelector('h2, h3, h4, h5, .title, .entry-title, .name, .game-name, .game-title');
    }
    if (targetEl) {
      const ratingBadge = targetEl.querySelector('.gr-rating-badge');
      if (ratingBadge && ratingBadge.nextSibling) {
        targetEl.insertBefore(badge, ratingBadge.nextSibling);
      } else if (ratingBadge) {
        targetEl.appendChild(badge);
      } else {
        targetEl.insertBefore(badge, targetEl.firstChild);
      }
    } else if (!link.querySelector('.gr-rec-badge')) {
      link.insertBefore(badge, link.firstChild);
    }
  }

  // 列表页：计算并高亮推荐游戏（appId 维度个性化评分）
  async function requestRecommendations(items, settings, nameToImage) {
    try {
      const maxItems = 60;
      const processItems = items.slice(0, maxItems);
      // 携带封面 appId：后台按 appId 聚合行为画像/Steam 标签/好评率/中文支持
      const games = processItems.map(item => {
        const img = nameToImage && nameToImage[item.name];
        return { name: item.name, url: item.url, appId: img && img.appId ? img.appId : null };
      });

      const response = await chrome.runtime.sendMessage({ action: 'GET_RECOMMENDATIONS', games });
      if (response && response.results) {
        const threshold = settings?.highlightThreshold || 0.6;
        let highlighted = 0;
        response.results.forEach((result, index) => {
          if (result.recommendation) {
            // 推荐值徽章（好评率徽章之后，悬停显示各分值组成，分级着色）
            prependRecBadge(processItems[index], result.recommendation);
            if (result.recommendation.score >= threshold) {
              highlightItem(processItems[index]);
              highlighted++;
            }
          }
        });
        dbg(`高亮 ${highlighted} 个推荐游戏`);
      }
    } catch (e) {
      dbg('推荐计算失败: ' + e.message);
    }
  }

  function highlightItem(item) {
    const el = item.element;
    el.classList.add('gr-highlighted');
  }

  GR.list = {
    isDetailPageByUrl,
    isListPageByUrl,
    getListItemsSmart,
    trackListView,
    applyVmFilter,
    requestSteamRatings,
    requestRecommendations,
    waitForListItems,
    applySteamRatingsUpdate
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
