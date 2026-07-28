/**
 * Game Recommender - 行为追踪 Content Script (v2)
 * 核心改动：Steam按钮和下载追踪不再依赖页面类型检测
 */

(function() {
  'use strict';

  if (window.__gameRecommenderTracker) return;
  window.__gameRecommenderTracker = true;

  // ============ 调试状态 ============
  const DEBUG = {
    enabled: true,
    pageType: '未检测',
    adapter: '无',
    siteTracked: false,
    steamStatus: '未查询',
    downloadEvents: 0,
    gameName: '',
    errors: [],
    logs: []
  };

  // 待更新的下载站浮窗面板（用于深度提取完成后异步更新）
  // 使用 WeakSet 防止内存泄漏，面板移除后自动清理
  const pendingDownloadSitePanels = [];

  // 清理无效的面板引用（定期调用）
  function cleanupPendingPanels() {
    for (let i = pendingDownloadSitePanels.length - 1; i >= 0; i--) {
      const entry = pendingDownloadSitePanels[i];
      // 检查面板是否仍在 DOM 中
      if (!document.body.contains(entry.panel)) {
        pendingDownloadSitePanels.splice(i, 1);
      }
    }
  }

  // 每30秒清理一次无效面板
  setInterval(cleanupPendingPanels, 30000);

  function dbg(msg) {
    DEBUG.logs.unshift(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (DEBUG.logs.length > 20) DEBUG.logs.pop();
    updateDebugPanel();
  }

  // ============ 网站适配器（仅用于列表页） ============
  const SITE_ADAPTERS = {
    '3dmgame.com': {
      name: '3DM',
      isListPage: () => !!document.querySelector('.lis, .game-list, .content li a[href*="/game/"], .Mid2L_con li'),
      getListItems: () => {
        const items = [];
        document.querySelectorAll('.lis li, .game-list li, .content li, .Mid2L_con li').forEach(li => {
          const link = li.querySelector('a[href*="/game/"], a[href*="3dmgame.com"], a');
          const title = li.querySelector('h3, .name, .title, a');
          if (link && title && title.textContent.trim().length > 2) {
            items.push({ element: li, link, name: title.textContent.trim(), url: link.href, titleEl: title });
          }
        });
        return items;
      }
    },
    'ali213.net': {
      name: '游侠网',
      isListPage: () => !!document.querySelector('.n_lone, .game_list, .downlist'),
      getListItems: () => {
        const items = [];
        document.querySelectorAll('.n_lone li, .game_list li, .downlist li').forEach(li => {
          const link = li.querySelector('a');
          const title = li.querySelector('.name, h3, a');
          if (link && title) {
            items.push({ element: li, link, name: title.textContent.trim(), url: link.href, titleEl: title });
          }
        });
        return items;
      }
    },
    'gamersky.com': {
      name: '游民星空',
      isListPage: () => !!document.querySelector('.game-list, .Mid2L_con, .pictxt'),
      getListItems: () => {
        const items = [];
        document.querySelectorAll('.game-list li, .Mid2L_con li, .pictxt li').forEach(li => {
          const link = li.querySelector('a');
          const title = li.querySelector('.name, h3, .tit, a');
          if (link && title) {
            items.push({ element: li, link, name: title.textContent.trim(), url: link.href, titleEl: title });
          }
        });
        return items;
      }
    },
    'xdgame.com': {
      name: 'XDGame',
      isListPage: () => {
        const path = window.location.pathname;
        if (/^\/so\//.test(path)) return true;
        if (/\/page\/\d+/.test(path)) return true;
        if (/\/list\//i.test(path)) return true;
        if (path === '/' || path === '') return true;
        // 通用判断：页面上有5个以上指向详情页的链接
        let count = 0;
        document.querySelectorAll('a').forEach(a => {
          const href = a.href || '';
          const p = new URL(href, window.location.href).pathname;
          // 只匹配 /game/数字.html（详情页），排除 /game/数字/（分类页）
          if (/\/\d+\.html?$/.test(p) || /\/game\/\d+\.html?$/i.test(p)) count++;
        });
        return count >= 5;
      },
      getListItems: () => {
        const items = [];
        const seen = new Set();
        // XDGame详情页URL: /game/数字.html（必须带.html后缀，排除/game/数字/分类页）
        const isDetailUrl = (href) => {
          const p = new URL(href, window.location.href).pathname;
          return /\/game\/\d+\.html?$/i.test(p) || /\/\d+\.html?$/.test(p);
        };

        // XDGame列表结构：ul.game-list > li > a.tit（标题文本链接）
        // 优先用 a.tit 作为标题和链接来源
        document.querySelectorAll('.game-list li, .list li, ul li').forEach(li => {
          const titleLink = li.querySelector('a.tit');
          if (titleLink) {
            const href = titleLink.href;
            if (!isDetailUrl(href) || seen.has(href)) return;
            seen.add(href);
            const text = titleLink.textContent.trim().replace(/\s+/g, ' ');
            if (text.length > 2 && text.length < 200) {
              items.push({ element: li, link: titleLink, name: text, url: href, titleEl: titleLink });
            }
          }
        });
        if (items.length > 0) return items;

        // 回退1：找li中带文本的详情页链接（跳过纯图片链接）
        document.querySelectorAll('li').forEach(li => {
          const links = li.querySelectorAll('a[href]');
          for (const a of links) {
            const href = a.href;
            if (!isDetailUrl(href) || seen.has(href)) continue;
            // 跳过 .grid-cover 和 .link（图片/查看按钮），只要有文本的链接
            if (a.classList.contains('grid-cover') || a.classList.contains('link')) continue;
            const text = a.textContent.trim().replace(/\s+/g, ' ');
            if (text.length > 2 && text.length < 200) {
              seen.add(href);
              items.push({ element: li, link: a, name: text, url: href, titleEl: a });
              break; // 每个li只取第一个有文本的链接
            }
          }
        });
        if (items.length > 0) return items;

        // 回退2：直接找所有指向详情页且有文本的链接
        document.querySelectorAll('a[href]').forEach(a => {
          const href = a.href;
          if (!isDetailUrl(href) || seen.has(href)) return;
          if (a.classList.contains('grid-cover') || a.classList.contains('link')) return;
          const text = a.textContent.trim().replace(/\s+/g, ' ');
          if (text.length > 2 && text.length < 200) {
            seen.add(href);
            items.push({ element: a.closest('li, div, article') || a, link: a, name: text, url: href, titleEl: a });
          }
        });
        return items;
      }
    },
    'xianyudanji.gg': {
      name: '咸鱼单机',
      isListPage: () => {
        const path = window.location.pathname;
        if (path === '/' || path === '') return true;
        if (/\/page\/\d+/.test(path)) return true;
        if (/\/category\//.test(path)) return true;
        if (/\/tag\//.test(path)) return true;
        if (/\/\?s=/.test(window.location.search)) return true;
        return false;
      },
      getListItems: () => {
        const items = [];
        const seen = new Set();
        // 优先找文章卡片
        document.querySelectorAll('.post, .article, .entry, .item, article').forEach(el => {
          const link = el.querySelector('a[href]');
          if (!link) return;
          const href = link.href;
          if (seen.has(href)) return;
          const path = new URL(href, window.location.href).pathname;
          // 咸鱼单机详情页通常是 /xxx/ 或 /xxx.html 形式
          if (!/\//.test(path) || path === '/') return;
          seen.add(href);
          const title = el.querySelector('h2, h3, .title, .entry-title') || link;
          const text = title.textContent.trim();
          if (text.length > 2 && text.length < 100) {
            items.push({ element: el, link, name: text, url: href, titleEl: title });
          }
        });
        if (items.length > 0) return items;
        // 兜底
        document.querySelectorAll('a').forEach(a => {
          const href = a.href;
          const path = new URL(href, window.location.href).pathname;
          if (path === '/' || !path) return;
          if (!/\/[^\/]+\/?$/.test(path)) return; // 至少一级路径
          if (seen.has(href)) return;
          seen.add(href);
          const text = a.textContent.trim();
          if (text.length > 2 && text.length < 60) {
            items.push({ element: a.closest('div, article, li') || a, link: a, name: text, url: href, titleEl: a });
          }
        });
        return items;
      }
    },
    'gamer520.com': {
      name: 'Gamer520',
      isListPage: () => {
        const path = window.location.pathname;
        if (path === '/' || path === '') return true;
        if (/\/page\/\d+/.test(path)) return true;
        if (/\/category\//.test(path)) return true;
        if (/\/\?s=/.test(window.location.search)) return true;
        return false;
      },
      getListItems: () => {
        const items = [];
        const seen = new Set();
        document.querySelectorAll('.post-item, .article-item, .game-item, .item, article').forEach(el => {
          const link = el.querySelector('a[href]');
          if (!link) return;
          const href = link.href;
          if (seen.has(href)) return;
          const path = new URL(href, window.location.href).pathname;
          if (!/\/\d+\.html?$/.test(path) && !/\/[^\/]+\/?$/.test(path)) return;
          seen.add(href);
          const title = el.querySelector('h2, h3, .title') || link;
          const text = title.textContent.trim();
          if (text.length > 2 && text.length < 100) {
            items.push({ element: el, link, name: text, url: href, titleEl: title });
          }
        });
        return items;
      }
    },
    '_default': {
      name: '通用',
      isListPage: () => {
        let gameLinks = 0;
        document.querySelectorAll('a').forEach(a => {
          if (a.href && (a.href.includes('/game/') || a.href.includes('/down/') || a.href.includes('/soft/'))) gameLinks++;
        });
        return gameLinks >= 5;
      },
      getListItems: () => {
        const items = [];
        const seen = new Set();
        document.querySelectorAll('a').forEach(a => {
          if (a.href && (a.href.includes('/game/') || a.href.includes('/down/') || a.href.includes('/soft/')) && !seen.has(a.href)) {
            seen.add(a.href);
            const text = a.textContent.trim();
            if (text.length > 2 && text.length < 100) {
              const container = a.closest('li, div, article') || a;
              const title = container.querySelector('h2, h3, h4, .title, .entry-title, .name') || a;
              items.push({ element: container, link: a, name: text, url: a.href, titleEl: title });
            }
          }
        });
        return items;
      }
    }
  };

  // ============ 工具函数 ============
  function getCurrentDomain() { return window.location.hostname; }

  function getAdapter() {
    const domain = getCurrentDomain();
    for (const [key, adapter] of Object.entries(SITE_ADAPTERS)) {
      if (key !== '_default' && domain.includes(key)) return adapter;
    }
    return SITE_ADAPTERS['_default'];
  }

  function trackEvent(type, data) {
    chrome.runtime.sendMessage({
      action: 'TRACK_EVENT',
      data: { type, url: window.location.href, domain: getCurrentDomain(), ...data }
    }).catch(() => {});
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // 从页面提取游戏名称（不依赖适配器）
  function detectGameName() {
    // 优先从h1获取
    const h1 = document.querySelector('h1');
    if (h1) {
      let text = h1.textContent.trim();
      // 清理h1中的常见后缀（下载、中文版等）
      text = text.replace(/[\|\-–—:：]\s*(下载|游戏下载|免费下载|破解|汉化|中文).*$/i, '').trim();
      if (text.length > 1 && text.length < 200) return text;
    }
    // 从title获取
    let title = document.title || '';
    if (title) {
      // 去除网站名后缀和常见修饰词
      title = title
        .replace(/[\|\-–—_]\s*[^\|\-–—_]*$/,'')  // 去掉最后一个分隔符后的网站名
        .replace(/(下载|游戏下载|免费下载|破解版|汉化版|中文版|绿色版|免安装).*$/i, '')
        .trim();
      return title || document.title;
    }
    return '';
  }

  // ============ 页面类型检测（URL优先，最可靠） ============
  // 详情页URL特征：以 数字.html 结尾，或 /game/数字.html 形式
  // 例：/99697.html, /game/15027.html, /11469.html
  // 注意：/game/数字/ 是分类页，不是详情页
  function isDetailPageByUrl() {
    const path = window.location.pathname;
    return /\/\d+\.html?$/.test(path) ||      // /99697.html 或 /11469.html
           /\/game\/\d+\.html?$/i.test(path) || // /game/15027.html（必须带.html）
           /\/\d+\.s?html?$/i.test(path);
  }

  // 列表页URL特征：首页、分类页、list页
  // 例：/, /pcdj, /pcplay, /list/1/
  function isListPageByUrl() {
    if (isDetailPageByUrl()) return false;
    const path = window.location.pathname;
    // 首页、纯字母分类页、list分页都视为列表页
    return path === '/' ||
           path === '' ||
           /^\/[a-z0-9_-]+\/?$/i.test(path) ||    // /pcdj, /pcplay
           /\/list\//i.test(path) ||               // /list/1/
           /\/page\/\d+/i.test(path);              // /page/2
  }

  // ============ 核心初始化（URL检测页面类型） ============
  async function init() {
    let settings;
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
      settings = resp?.settings;
    } catch (e) {
      return;
    }

    if (!settings || !settings.enabled) return;

    const domain = getCurrentDomain();
    const trackedSites = settings.trackedSites || [];
    const isTracked = trackedSites.length === 0 || trackedSites.some(s => domain.includes(s));
    const isSteamPage = domain.includes('store.steampowered.com');

    // 调试面板：仅在设置开启时显示（追踪站或Steam页）
    DEBUG.siteTracked = isTracked;
    if (settings.showDebugPanel && (isTracked || isSteamPage)) {
      initDebugPanel();
    }

    // === 功能4：非追踪网站且非Steam页 → 尽早退出，节省资源 ===
    if (!isTracked && !isSteamPage) {
      return;
    }

    dbg('插件初始化...');
    dbg(`域名: ${domain}, 追踪: ${isTracked ? '是' : '否'}, Steam: ${isSteamPage ? '是' : '否'}`);

    // === 功能3：Steam页面 → 注入下载站跳转浮窗 ===
    if (isSteamPage) {
      injectDownloadSitePanel();
      if (!isTracked) return; // Steam页只注入下载站浮窗，不做行为追踪
    }

    const adapter = getAdapter();
    DEBUG.adapter = adapter.name;

    // === 页面类型检测：URL优先，DOM辅助 ===
    const detailByUrl = isDetailPageByUrl();
    const listByUrl = isListPageByUrl();
    dbg(`URL检测: 详情=${detailByUrl}, 列表=${listByUrl}`);

    // === 1. 列表页：提取游戏列表并高亮 ===
    const isList = listByUrl || (!detailByUrl && adapter.isListPage());
    if (isList) {
      DEBUG.pageType = '列表页';
      dbg('✅ 检测到列表页');
      const items = getListItemsSmart(adapter);
      if (items.length > 0) {
        dbg(`找到 ${items.length} 个游戏项`);
        trackListView(adapter, items);
      }
    }

    // === 2. 始终设置下载追踪 ===
    setupDownloadTracking();

    // === 3. 详情页：注入Steam浮窗和下载历史浮窗 ===
    const isDetail = detailByUrl || (!isList && !!document.querySelector('h1'));
    if (isDetail) {
      DEBUG.pageType = '详情页';
      const gameName = detectGameName();
      if (gameName && gameName.length > 1) {
        DEBUG.gameName = gameName;
        dbg(`详情页游戏名: ${gameName}`);
        trackEvent('view_detail', { gameName: gameName, keywords: [], description: '' });
        injectSteamButton(gameName);
        injectDownloadHistoryPanel(gameName);
      } else {
        dbg('⚠️ 详情页未检测到游戏名称');
      }
    } else if (!isList) {
      dbg('⚠️ 未识别页面类型');
    }

    dbg('✅ 初始化完成');
  }

  // 智能获取列表项：优先适配器，回退通用链接提取
  function getListItemsSmart(adapter) {
    let items = adapter.getListItems ? adapter.getListItems() : [];
    // 如果适配器没找到，用通用方法：提取指向详情页的链接
    if (items.length === 0) {
      const seen = new Set();
      document.querySelectorAll('a').forEach(a => {
        const href = a.href || '';
        const p = new URL(href, window.location.href).pathname;
        // 匹配详情页URL特征：/数字.html 或 /game/数字.html（排除/game/数字/分类页）
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
  function trackListView(adapter, items) {
    trackEvent('view_list', { itemCount: items.length, page: window.location.href });

    items.forEach(item => {
      item.link.addEventListener('click', () => {
        trackEvent('click_detail', { gameName: item.name, gameUrl: item.url });
      });
    });

    requestRecommendations(items);
    requestSteamRatings(items);
  }

  // 列表页：检索每个游戏的Steam好评率并显示在游戏名前
  async function requestSteamRatings(items) {
    try {
      // 先获取设置中的过滤阈值
      let settings = null;
      try {
        const settingsResp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
        settings = settingsResp?.settings;
      } catch (e) { /* 获取设置失败不影响主流程 */ }

      const maxItems = 60;
      const processItems = items.slice(0, maxItems);
      // 去重游戏名
      const uniqueNames = [...new Set(processItems.map(i => i.name).filter(n => n && n.length > 1))];
      if (uniqueNames.length === 0) return;

      const response = await chrome.runtime.sendMessage({ action: 'GET_STEAM_RATINGS', names: uniqueNames });
      if (response && response.ratings) {
        let shown = 0;
        let filtered = 0;
        const minRating = settings?.enableRatingFilter ? (settings.minSteamRatingFilter || 0) : 0;
        processItems.forEach(item => {
          const rating = response.ratings[item.name];
          if (rating && rating.positiveRate !== null && rating.positiveRate !== undefined) {
            // 好评率过滤：低于阈值的移除该项（从DOM中删除，使后续元素自动重排）
            if (minRating > 0 && rating.positiveRate < minRating) {
              if (item.element && item.element.parentNode) {
                item.element.remove();
              }
              filtered++;
              return;
            }
            prependRatingBadge(item, rating);
            shown++;
          } else if (minRating > 0) {
            // 启用了过滤但没有Steam数据的项，暂时保留不隐藏
          }
        });
        dbg(`列表页显示 ${shown} 个Steam好评率${minRating > 0 ? `，过滤 ${filtered} 个低于${minRating}%的游戏` : ''}`);
      }
    } catch (e) {
      dbg('Steam好评率检索失败: ' + e.message);
    }
  }

  // 在游戏标题前插入好评率徽章
  function prependRatingBadge(item, rating) {
    const link = item.link;
    if (!link) return;

    const rate = rating.positiveRate;
    // 颜色分级：>=80 绿色，>=60 黄绿，<60 橙色
    const color = rate >= 80 ? '#66c0f4' : rate >= 60 ? '#a3cf06' : '#ff7b00';
    const bg = rate >= 80 ? 'rgba(102,192,244,0.15)' : rate >= 60 ? 'rgba(163,207,6,0.15)' : 'rgba(255,123,0,0.15)';

    const badge = document.createElement('span');
    badge.className = 'gr-rating-badge';
    badge.textContent = `${rate}%`;
    badge.style.cssText = `display:inline-block;margin-right:6px;padding:1px 6px;font-size:11px;font-weight:bold;color:${color};background:${bg};border:1px solid ${color};border-radius:3px;vertical-align:middle;`;
    badge.title = `Steam 好评率: ${rate}%${rating.ratingDesc ? ' (' + rating.ratingDesc + ')' : ''}`;

    // 查找标题元素，将徽章插入到标题文本前面（而非图片前面）
    // 策略：优先用 item.titleEl，其次在 item.element 中查找标题，最后回退到 link 的第一个文本节点
    let targetEl = item.titleEl || null;

    if (!targetEl && item.element) {
      targetEl = item.element.querySelector('h2, h3, h4, h5, .title, .entry-title, .name, .game-name, .game-title');
    }

    if (targetEl && !targetEl.querySelector('.gr-rating-badge')) {
      // 标题元素存在，插入到标题文本前面
      targetEl.insertBefore(badge, targetEl.firstChild);
    } else if (!link.querySelector('.gr-rating-badge')) {
      // 回退：找到 link 中的第一个文本节点，在它前面插入
      const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT, null);
      const firstTextNode = walker.nextNode();
      if (firstTextNode && firstTextNode.textContent.trim().length > 1) {
        // 在第一个有意义的文本节点前插入
        link.insertBefore(badge, firstTextNode);
      } else {
        // 最终回退：插入到 link 最前面
        link.insertBefore(badge, link.firstChild);
      }
    }
  }

  async function requestRecommendations(items) {
    try {
      const maxItems = 60;
      const processItems = items.slice(0, maxItems);
      const games = processItems.map(item => ({ name: item.name, url: item.url, keywords: [] }));

      const response = await chrome.runtime.sendMessage({ action: 'GET_RECOMMENDATIONS', games });
      if (response && response.results) {
        const settingsResp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
        const threshold = settingsResp?.settings?.highlightThreshold || 0.6;
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
    badge.title = recommendation.breakdown
      ? `推荐度: ${Math.round(recommendation.score * 100)}%`
      : `推荐度: ${Math.round(recommendation.score * 100)}%`;
    const link = item.link || el.querySelector('a');
    if (link) { link.style.position = 'relative'; link.appendChild(badge); }
  }

  // ============ 下载追踪（始终激活，打开网盘即视为下载） ============
  function setupDownloadTracking() {
    dbg('设置下载追踪...');

    // 1. 拦截 window.open
    const originalOpen = window.open;
    window.open = function(url, ...args) {
      if (url && isDownloadUrl(url)) {
        recordDownload(url, 'window.open打开网盘', 'window_open');
      }
      return originalOpen.apply(this, [url, ...args]);
    };

    // 2. 拦截 location 跳转（同标签页打开网盘）
    try {
      const origAssign = window.location.assign.bind(window.location);
      const origReplace = window.location.replace.bind(window.location);
      window.location.assign = function(url) {
        if (isDownloadUrl(url)) recordDownload(url, '跳转到网盘', 'location_assign');
        return origAssign(url);
      };
      window.location.replace = function(url) {
        if (isDownloadUrl(url)) recordDownload(url, '跳转到网盘', 'location_replace');
        return origReplace(url);
      };
    } catch (e) { /* location 可能不允许重写 */ }

    // 3. 全局点击委托 - 检查所有可点击元素及其href
    document.addEventListener('click', (e) => {
      const target = e.target.closest('a, button, [onclick], [data-href], [class*="down"], [class*="baidu"], [class*="pan"], [id*="down"], [class*="netdisk"]');
      if (!target) return;

      const text = (target.textContent || '').trim();
      // 收集所有可能的URL来源
      const urls = [
        target.href,
        target.getAttribute('data-href'),
        target.getAttribute('data-url'),
        target.getAttribute('data-link'),
        target.getAttribute('onclick')
      ].filter(Boolean);

      const hasDownloadUrl = urls.some(u => isDownloadUrl(u));
      const hasDownloadText = isDownloadText(text);

      if (hasDownloadUrl || hasDownloadText) {
        const url = urls.find(u => isDownloadUrl(u)) || urls[0] || text;
        recordDownload(url, text.substring(0, 50) || '网盘下载', 'delegate_click');
      }
    }, true);

    // 4. 复制事件 - 复制网盘链接/提取码
    document.addEventListener('copy', () => {
      const sel = window.getSelection()?.toString() || '';
      if (isDownloadUrl(sel) || /提取码|密码|网盘|pan\.baidu/.test(sel)) {
        recordDownload(sel.substring(0, 200), '复制网盘链接/提取码', 'copy_link');
      }
    });

    // 5. MutationObserver 动态链接
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            const els = node.querySelectorAll ? [node, ...node.querySelectorAll('a')] : [node];
            els.forEach(el => {
              if (el.href && isDownloadUrl(el.href) && !el.__grBound) {
                el.__grBound = true;
                el.addEventListener('click', () => {
                  recordDownload(el.href, el.textContent?.trim().substring(0, 50) || '网盘链接', 'dynamic_link');
                });
              }
            });
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 6. 绑定页面已有的下载链接
    document.querySelectorAll('a').forEach(a => {
      if (a.href && isDownloadUrl(a.href) && !a.__grBound) {
        a.__grBound = true;
        a.addEventListener('click', () => {
          recordDownload(a.href, a.textContent?.trim().substring(0, 50) || '下载链接', 'link_click');
        });
      }
    });

    dbg('✅ 下载追踪已激活');
  }

  // 网盘/下载URL识别（覆盖主流网盘）
  function isDownloadUrl(str) {
    if (!str) return false;
    return /pan\.baidu\.com|yun\.baidu\.com|baidupcs|aliyundrive\.com|alipan\.com|115\.com|quark\.cn|weiyun\.com|jianwen\.com|caiyun\.com|139\.com|mega\.nz|mediafire|1fichier|gofile|rapidgator|uploaded\.net|magnet:|thunder:|ed2k:|ftp:|\.torrent/i.test(str);
  }

  // 下载相关文本识别
  function isDownloadText(text) {
    if (!text) return false;
    return /百度网盘|百度云|网盘|百度盘|阿里云盘|夸克网盘|115网盘|微云|提取码|下载游戏|游戏下载|高速下载|普通下载|磁力|种子/.test(text);
  }

  function recordDownload(url, text, method) {
    DEBUG.downloadEvents++;
    dbg(`📥 下载事件 [${method}]: ${text}`);
    trackEvent('click_download', {
      gameName: DEBUG.gameName || detectGameName() || document.title,
      keywords: [],
      downloadUrl: url,
      downloadText: text,
      method: method
    });
    updateDebugPanel();
  }

  // ============ 功能3：Steam页面跳转下载站浮窗 ============
  function injectDownloadSitePanel() {
    // 从Steam页面提取游戏名和appId
    const appIdMatch = window.location.pathname.match(/\/app\/(\d+)/);
    const appId = appIdMatch ? appIdMatch[1] : '';
    const gameNameEl = document.querySelector('.apphub_AppName, .page_title');
    const gameName = gameNameEl ? gameNameEl.textContent.trim() : document.title.replace(/ on Steam.*$/, '').trim();

    if (!gameName) return;
    dbg(`Steam页游戏: ${gameName} (appId=${appId})`);

    // 创建浮窗
    const panel = document.createElement('div');
    panel.id = 'gr-download-site-panel';
    panel.style.cssText = `
      position:fixed;bottom:80px;left:16px;z-index:2147483647;
      width:320px;max-height:calc(100vh - 120px);overflow-y:auto;
      background:#1b2838;border:1px solid #2a475e;border-radius:4px;
      font-family:Arial,Helvetica,sans-serif;
      color:#c7d5e0;font-size:13px;line-height:1.5;
      box-shadow:0 0 12px rgba(0,0,0,0.6);
    `;
    panel.innerHTML = `<div style="padding:14px;text-align:center;color:#8f98a0;">正在搜索下载站资源...</div>`;
    document.body.appendChild(panel);

    // 关闭按钮
    const closeBtn = document.createElement('div');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'position:absolute;top:6px;right:10px;cursor:pointer;color:#666;font-size:14px;z-index:1;';
    closeBtn.onclick = () => { panel.style.display = 'none'; closeBtn.style.display = 'none'; };
    panel.appendChild(closeBtn);

    // 请求后台搜索下载站
    (async () => {
      try {
        const resp = await chrome.runtime.sendMessage({
          action: 'SEARCH_DOWNLOAD_SITES',
          gameName: gameName,
          appId: appId
        });
        if (resp && resp.sites) {
          renderDownloadSitePanel(panel, resp.sites, gameName);
          // 注册深度提取更新回调（用于手动提取后的异步更新）
          pendingDownloadSitePanels.push({ panel, gameName });
        } else {
          panel.innerHTML = `<div style="padding:14px;text-align:center;color:#8f98a0;">未找到下载站资源</div>`;
          panel.appendChild(closeBtn);
        }
      } catch (e) {
        panel.innerHTML = `<div style="padding:14px;text-align:center;color:#e74c3c;">搜索失败</div>`;
        panel.appendChild(closeBtn);
      }
    })();
  }

  function renderDownloadSitePanel(panel, sites, gameName) {
    const siteNames = { xdgame: 'XDGame', xianyudanji: '咸鱼单机', gamer520: 'Gamer520' };
    let html = `
      <div style="padding:12px 14px 6px 14px;">
        <div style="font-size:13px;font-weight:bold;color:#fff;margin-bottom:2px;">📥 下载站资源</div>
        <div style="font-size:11px;color:#8f98a0;margin-bottom:8px;">${escapeHtml(gameName)}</div>
      </div>
    `;

    for (const site of sites) {
      const name = siteNames[site.key] || site.key;
      if (site.found && site.detailUrl) {
        const panLabel = getPanLabel(site.panUrl);
        html += `
          <div data-site-key="${site.key}" style="margin:0 14px 10px 14px;padding:10px;background:rgba(0,0,0,0.25);border:1px solid #2a475e;border-radius:3px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:12px;font-weight:bold;color:#67c1f5;">${name}</span>
              <a href="${site.detailUrl}" target="_blank" style="font-size:11px;color:#d2efa9;background:linear-gradient(to right,#75b022,#588a1b);padding:3px 10px;border-radius:2px;text-decoration:none;">跳转详情页 ↗</a>
            </div>
            <div style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#acb2b8;">
              ${site.updateDate ? `<div>📅 更新: ${escapeHtml(site.updateDate)}</div>` : ''}
              ${site.version ? `<div>🏷️ 版本: ${escapeHtml(site.version)}</div>` : ''}
              ${site.size ? `<div>💾 大小: ${escapeHtml(site.size)}</div>` : ''}
              ${!site.updateDate && !site.version && !site.size && !site.panUrl ? '<div style="color:#666;">点击跳转查看详情</div>' : ''}
            </div>
            ${site.panUrl ? `
              <div class="gr-pan-section" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);">
                <a href="${escapeHtml(site.panUrl)}" target="_blank" style="display:block;text-align:center;padding:7px 0;background:linear-gradient(to right,#06a3ff,#0066cc);color:#fff;border-radius:3px;text-decoration:none;font-size:12px;font-weight:bold;text-shadow:1px 1px 0 rgba(0,0,0,0.3);">💾 ${panLabel}直链 ↗</a>
                ${site.panCode ? `
                  <div style="margin-top:5px;font-size:11px;color:#acb2b8;text-align:center;">
                    提取码: <span class="gr-pan-code" data-code="${escapeHtml(site.panCode)}" style="color:#66c0f4;font-weight:bold;cursor:pointer;background:rgba(102,192,244,0.1);padding:1px 8px;border-radius:2px;border:1px solid rgba(102,192,244,0.3);transition:background 0.2s;">${escapeHtml(site.panCode)} 📋</span>
                  </div>
                ` : ''}
              </div>
            ` : `
              <div class="gr-pan-section" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);">
                <button class="gr-get-pan-btn" data-site-key="${site.key}" data-detail-url="${escapeHtml(site.detailUrl)}" data-game-name="${escapeHtml(gameName)}" style="width:100%;padding:7px 0;background:linear-gradient(to right,#e67e22,#d35400);color:#fff;border:none;border-radius:3px;font-size:12px;font-weight:bold;cursor:pointer;text-shadow:1px 1px 0 rgba(0,0,0,0.3);transition:opacity 0.2s;">🔗 一键获取并打开</button>
                <div style="margin-top:4px;font-size:10px;color:#666;text-align:center;">点击后自动提取并跳转百度网盘</div>
              </div>
            `}
          </div>
        `;
      } else {
        html += `
          <div style="margin:0 14px 10px 14px;padding:10px;background:rgba(0,0,0,0.15);border:1px solid #222;border-radius:3px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:12px;color:#666;">${name}</span>
              <a href="${site.searchUrl}" target="_blank" style="font-size:11px;color:#67c1f5;text-decoration:none;">去搜索 ↗</a>
            </div>
            <div style="font-size:11px;color:#555;margin-top:3px;">未直接找到该游戏</div>
          </div>
        `;
      }
    }

    panel.innerHTML = html;
    panel.appendChild(createCloseBtn(panel));

    // 绑定提取码点击复制
    panel.querySelectorAll('.gr-pan-code').forEach(el => {
      el.addEventListener('click', () => {
        const code = el.dataset.code;
        if (!code) return;
        navigator.clipboard.writeText(code).then(() => {
          const original = el.innerHTML;
          el.innerHTML = '已复制 ✓';
          el.style.background = 'rgba(88,138,27,0.3)';
          setTimeout(() => {
            el.innerHTML = original;
            el.style.background = 'rgba(102,192,244,0.1)';
          }, 1500);
        }).catch(() => {});
      });
    });

    // 绑定"获取百度直链"按钮点击事件
    panel.querySelectorAll('.gr-get-pan-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const siteKey = btn.dataset.siteKey;
        const detailUrl = btn.dataset.detailUrl;
        const gameName = btn.dataset.gameName;

        // 安全验证：只允许已知站点
        const allowedSites = ['xdgame', 'xianyudanji', 'gamer520'];
        if (!siteKey || !detailUrl || !allowedSites.includes(siteKey)) {
          console.warn('gr-get-pan-btn: 非法参数:', siteKey, detailUrl);
          return;
        }

        // 安全验证：URL必须是合法的下载站
        const allowedDomains = {
          xianyudanji: ['xianyudanji.gg'],
          xdgame: ['xdgame.com'],
          gamer520: ['gamer520.com', 'gamers520.com']
        };
        try {
          const u = new URL(detailUrl);
          const domain = u.hostname.toLowerCase();
          const isValid = allowedDomains[siteKey].some(d => domain === d || domain.endsWith('.' + d));
          if (!isValid) {
            console.warn('gr-get-pan-btn: 非法URL:', detailUrl);
            return;
          }
        } catch (e) {
          console.warn('gr-get-pan-btn: URL解析失败:', detailUrl);
          return;
        }

        // 切换为加载状态
        const panSection = btn.closest('.gr-pan-section');
        if (panSection) {
          panSection.innerHTML = `
            <div style="text-align:center;font-size:12px;color:#8f98a0;padding:7px 0;">
              <span style="display:inline-block;animation:gr-spin 1s linear infinite;">⏳</span> 正在提取并跳转...
            </div>
          `;
        }

        try {
          const resp = await chrome.runtime.sendMessage({
            action: 'EXTRACT_PAN_DEEP',
            siteKey,
            detailUrl,
            gameName,
            autoOpen: true // 由后台自动打开，避免前端弹窗拦截
          });

          if (resp && resp.result && resp.result.panUrl) {
            // 安全验证：确认是合法的网盘链接
            if (validatePanUrl(resp.result.panUrl)) {
              // 后台已自动打开，这里只更新UI状态
              if (panSection) {
                const panLabel = getPanLabel(resp.result.panUrl);
                panSection.innerHTML = `
                  <div class="gr-pan-section" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);">
                    <a href="${escapeHtml(resp.result.panUrl)}" target="_blank" style="display:block;text-align:center;padding:7px 0;background:linear-gradient(to right,#06a3ff,#0066cc);color:#fff;border-radius:3px;text-decoration:none;font-size:12px;font-weight:bold;text-shadow:1px 1px 0 rgba(0,0,0,0.3);">✅ ${panLabel}已打开 ↗</a>
                    <div style="margin-top:4px;font-size:10px;color:#666;text-align:center;">如未自动打开，请点击上方链接</div>
                  </div>
                `;
              }
            } else {
              console.warn('gr-get-pan-btn: 非法网盘链接:', resp.result.panUrl);
              if (panSection) {
                panSection.innerHTML = `
                  <button class="gr-get-pan-btn" data-site-key="${siteKey}" data-detail-url="${escapeHtml(detailUrl)}" data-game-name="${escapeHtml(gameName)}" style="width:100%;padding:7px 0;background:linear-gradient(to right,#e74c3c,#c0392b);color:#fff;border:none;border-radius:3px;font-size:12px;font-weight:bold;cursor:pointer;text-shadow:1px 1px 0 rgba(0,0,0,0.3);">⚠️ 提取失败，重试</button>
                  <div style="margin-top:4px;font-size:10px;color:#666;text-align:center;">请确保已登录对应下载站</div>
                `;
                const retryBtn = panSection.querySelector('.gr-get-pan-btn');
                if (retryBtn) retryBtn.addEventListener('click', () => btn.click());
              }
            }
          } else if (resp && resp.result && resp.result.qrImage) {
            // 二维码情况：后台已打开扫码页，更新UI
            if (panSection) {
              panSection.innerHTML = `
                <div class="gr-pan-section" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;">
                  <a href="${escapeHtml(resp.result.downloadPageUrl || '#')}" target="_blank" style="display:block;text-align:center;padding:7px 0;background:linear-gradient(to right,#9b59b6,#8e44ad);color:#fff;border-radius:3px;text-decoration:none;font-size:12px;font-weight:bold;text-shadow:1px 1px 0 rgba(0,0,0,0.3);">📱 已打开扫码页 ↗</a>
                  <div style="margin-top:4px;font-size:10px;color:#666;text-align:center;">${resp.result.note || '请在新页面扫码获取'}</div>
                </div>
              `;
            }
          } else {
            // 提取失败，恢复按钮，并提供"打开详情页手动获取"备选
            if (panSection) {
              panSection.innerHTML = `
                <button class="gr-get-pan-btn" data-site-key="${siteKey}" data-detail-url="${escapeHtml(detailUrl)}" data-game-name="${escapeHtml(gameName)}" style="width:100%;padding:7px 0;background:linear-gradient(to right,#e74c3c,#c0392b);color:#fff;border:none;border-radius:3px;font-size:12px;font-weight:bold;cursor:pointer;text-shadow:1px 1px 0 rgba(0,0,0,0.3);">⚠️ 提取失败，重试</button>
                <a href="${escapeHtml(detailUrl)}" target="_blank" style="display:block;margin-top:6px;text-align:center;padding:5px 0;background:rgba(255,255,255,0.06);color:#67c1f5;border-radius:3px;text-decoration:none;font-size:11px;">📂 打开详情页手动获取 ↗</a>
              `;
              const retryBtn = panSection.querySelector('.gr-get-pan-btn');
              if (retryBtn) retryBtn.addEventListener('click', () => btn.click());
            }
          }
        } catch (e) {
          if (panSection) {
            panSection.innerHTML = `
              <button class="gr-get-pan-btn" data-site-key="${siteKey}" data-detail-url="${escapeHtml(detailUrl)}" data-game-name="${escapeHtml(gameName)}" style="width:100%;padding:7px 0;background:linear-gradient(to right,#e74c3c,#c0392b);color:#fff;border:none;border-radius:3px;font-size:12px;font-weight:bold;cursor:pointer;text-shadow:1px 1px 0 rgba(0,0,0,0.3);">⚠️ 提取失败，重试</button>
              <a href="${escapeHtml(detailUrl)}" target="_blank" style="display:block;margin-top:6px;text-align:center;padding:5px 0;background:rgba(255,255,255,0.06);color:#67c1f5;border-radius:3px;text-decoration:none;font-size:11px;">📂 打开详情页手动获取 ↗</a>
            `;
            const retryBtn = panSection.querySelector('.gr-get-pan-btn');
            if (retryBtn) retryBtn.addEventListener('click', () => btn.click());
          }
        }
      });
    });
  }

  // 根据网盘URL返回对应的网盘名称
  function getPanLabel(url) {
    if (!url) return '网盘';
    if (/pan\.baidu\.com/i.test(url)) return '百度网盘';
    if (/aliyundrive\.com|alipan\.com/i.test(url)) return '阿里云盘';
    if (/115\.com/i.test(url)) return '115网盘';
    if (/quark\.cn/i.test(url)) return '夸克网盘';
    if (/weiyun\.com/i.test(url)) return '微云';
    return '网盘';
  }

  // 验证网盘链接的安全性（前端双重验证）
  function validatePanUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url);
      const allowedHosts = [
        'pan.baidu.com',
        'aliyundrive.com',
        'alipan.com',
        '115.com',
        'quark.cn',
        'weiyun.com'
      ];
      return allowedHosts.includes(u.hostname.toLowerCase());
    } catch (e) {
      return false;
    }
  }

  // 异步更新单个站点的网盘链接（深度提取完成后调用）
  function updateSitePanelPanLink(panel, message) {
    const siteKey = message.siteKey;
    // 安全验证：只处理已知站点
    const allowedSites = ['xdgame', 'xianyudanji', 'gamer520'];
    if (!allowedSites.includes(siteKey)) {
      console.warn('updateSitePanelPanLink: 未知站点:', siteKey);
      return;
    }

    // 安全验证：网盘链接必须是合法域名
    if (message.panUrl && !validatePanUrl(message.panUrl)) {
      console.warn('updateSitePanelPanLink: 非法网盘链接:', message.panUrl);
      return;
    }

    const siteCards = panel.querySelectorAll('[data-site-key]');
    let targetCard = null;

    // 先尝试通过 data-site-key 定位
    for (const card of siteCards) {
      if (card.dataset.siteKey === siteKey) {
        targetCard = card;
        break;
      }
    }

    // 如果找不到，通过名称匹配
    if (!targetCard) {
      const siteNames = { xdgame: 'XDGame', xianyudanji: '咸鱼单机', gamer520: 'Gamer520' };
      const name = siteNames[siteKey] || siteKey;
      const cards = panel.querySelectorAll('[style*="margin:0 14px 10px"]');
      for (const card of cards) {
        if (card.textContent.includes(name)) {
          targetCard = card;
          break;
        }
      }
    }

    if (!targetCard) return;

    // 检查是否已有真实网盘链接区域（非加载状态）
    const existingPanSection = targetCard.querySelector('.gr-pan-section:not(.gr-pan-loading)');
    if (existingPanSection) return; // 已有真实链接则不重复添加

    // 移除加载状态区域（如果有）
    const loadingSection = targetCard.querySelector('.gr-pan-section.gr-pan-loading');
    if (loadingSection) loadingSection.remove();

    // 构造网盘链接区域
    let panSection = null;
    if (message.panUrl) {
      const panLabel = getPanLabel(message.panUrl);
      panSection = document.createElement('div');
      panSection.className = 'gr-pan-section';
      panSection.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);';

      let panHtml = `
        <a href="${escapeHtml(message.panUrl)}" target="_blank" style="display:block;text-align:center;padding:7px 0;background:linear-gradient(to right,#06a3ff,#0066cc);color:#fff;border-radius:3px;text-decoration:none;font-size:12px;font-weight:bold;text-shadow:1px 1px 0 rgba(0,0,0,0.3);">💾 ${panLabel}直链 ↗</a>
      `;
      // 如果URL中已经有pwd参数（自动拼接过），就不再显示提取码
      if (message.panCode && !message.panUrl.includes('?pwd=')) {
        panHtml += `
          <div style="margin-top:5px;font-size:11px;color:#acb2b8;text-align:center;">
            提取码: <span class="gr-pan-code" data-code="${escapeHtml(message.panCode)}" style="color:#66c0f4;font-weight:bold;cursor:pointer;background:rgba(102,192,244,0.1);padding:1px 8px;border-radius:2px;border:1px solid rgba(102,192,244,0.3);transition:background 0.2s;">${escapeHtml(message.panCode)} 📋</span>
          </div>
        `;
      }
      panSection.innerHTML = panHtml;

      // 绑定复制事件
      panSection.querySelectorAll('.gr-pan-code').forEach(el => {
        el.addEventListener('click', () => {
          const code = el.dataset.code;
          if (!code) return;
          navigator.clipboard.writeText(code).then(() => {
            const original = el.innerHTML;
            el.innerHTML = '已复制 ✓';
            el.style.background = 'rgba(88,138,27,0.3)';
            setTimeout(() => {
              el.innerHTML = original;
              el.style.background = 'rgba(102,192,244,0.1)';
            }, 1500);
          }).catch(() => {});
        });
      });
    } else if (message.qrImage) {
      // 二维码情况
      panSection = document.createElement('div');
      panSection.className = 'gr-pan-section';
      panSection.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;';
      panSection.innerHTML = `
        <a href="${escapeHtml(message.downloadPageUrl || '#')}" target="_blank" style="display:block;text-align:center;padding:7px 0;background:linear-gradient(to right,#9b59b6,#8e44ad);color:#fff;border-radius:3px;text-decoration:none;font-size:12px;font-weight:bold;text-shadow:1px 1px 0 rgba(0,0,0,0.3);">📱 扫码下载 ↗</a>
        <div style="margin-top:6px;font-size:10px;color:#8f98a0;">${message.panNote || '打开页面扫码获取'}</div>
      `;
    }

    if (panSection) {
      targetCard.appendChild(panSection);
    }
  }

  function createCloseBtn(panel) {
    const btn = document.createElement('div');
    btn.textContent = '✕';
    btn.style.cssText = 'position:absolute;top:6px;right:10px;cursor:pointer;color:#666;font-size:14px;';
    btn.onclick = () => { panel.style.display = 'none'; };
    return btn;
  }

  // ============ 下载历史浮窗（详情页显示上次下载记录） ============
  function injectDownloadHistoryPanel(gameName) {
    if (!gameName) return;

    // 注入CSS动画（仅一次）
    if (!document.getElementById('gr-dl-history-style')) {
      const style = document.createElement('style');
      style.id = 'gr-dl-history-style';
      style.textContent = `
        @keyframes gr-slide-in-left {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes gr-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }

    // 先查询是否有下载历史
    chrome.runtime.sendMessage({
      action: 'GET_DOWNLOAD_HISTORY',
      gameName: gameName
    }).then(resp => {
      if (!resp || !resp.record) return; // 没有历史记录就不显示

      const record = resp.record;
      dbg(`下载历史: ${record.lastDownloadSiteName}, ${new Date(record.lastDownloadTime).toLocaleString()}`);

      // 格式化时间
      function formatTime(timestamp) {
        if (!timestamp) return '未知';
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        if (days === 0) {
          const hours = Math.floor(diff / (1000 * 60 * 60));
          if (hours === 0) {
            const mins = Math.floor(diff / (1000 * 60));
            return mins <= 1 ? '刚刚' : `${mins}分钟前`;
          }
          return `${hours}小时前`;
        }
        if (days === 1) return '昨天';
        if (days < 7) return `${days}天前`;
        return date.toLocaleDateString('zh-CN');
      }

      // 创建浮窗
      const panel = document.createElement('div');
      panel.id = 'gr-download-history-float';
      panel.style.cssText = `
        position:fixed;bottom:20px;left:16px;z-index:2147483647;
        width:280px;
        background:linear-gradient(135deg,#2a475e,#1b2838);
        border:1px solid #3a6a8e;
        border-radius:6px;
        font-family:Arial,Helvetica,sans-serif;
        color:#c7d5e0;font-size:12px;line-height:1.5;
        box-shadow:0 4px 16px rgba(0,0,0,0.5);
        padding:12px 14px;
        animation:gr-slide-in-left 0.3s ease-out;
      `;

      const timeStr = formatTime(record.lastDownloadTime);
      const siteName = record.lastDownloadSiteName || '未知站点';

      panel.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:16px;">📥</span>
          <span style="font-weight:bold;color:#66c0f4;font-size:13px;">下载记录</span>
          <span style="margin-left:auto;cursor:pointer;color:#666;font-size:14px;line-height:1;" id="gr-dl-history-close">✕</span>
        </div>
        <div style="color:#8f98a0;margin-bottom:4px;">
          上次下载：<span style="color:#d2efa9;">${timeStr}</span>
        </div>
        <div style="color:#8f98a0;">
          下载站点：<span style="color:#66c0f4;">${escapeHtml(siteName)}</span>
        </div>
        ${record.totalDownloads && record.totalDownloads > 1 ? `<div style="color:#666;margin-top:6px;font-size:11px;">共下载 ${record.totalDownloads} 次</div>` : ''}
        ${record.lastDownloadUrl ? `<div style="margin-top:8px;"><a href="${escapeHtml(record.lastDownloadUrl)}" target="_blank" style="color:#67c1f5;text-decoration:none;font-size:11px;">↗ 打开上次下载页</a></div>` : ''}
      `;

      document.body.appendChild(panel);

      // 关闭按钮
      const closeBtn = panel.querySelector('#gr-dl-history-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          panel.style.transition = 'opacity 0.2s, transform 0.2s';
          panel.style.opacity = '0';
          panel.style.transform = 'translateX(-20px)';
          setTimeout(() => panel.remove(), 200);
        });
      }
    }).catch(() => {});
  }

  // ============ Steam详情浮窗（直接显示，仿Steam右侧信息栏） ============
  function injectSteamButton(gameName) {
    dbg('注入Steam浮窗...');

    // 创建浮窗容器 - 仿Steam右侧信息栏样式
    const panel = document.createElement('div');
    panel.id = 'gr-steam-float';
    panel.style.cssText = `
      position:fixed;top:80px;right:16px;z-index:2147483647;
      width:320px;max-height:calc(100vh - 120px);overflow-y:auto;
      background:#1b2838;border-radius:4px;
      font-family:"Motiva Sans",Arial,Helvetica,sans-serif;
      color:#c7d5e0;font-size:13px;line-height:1.5;
      box-shadow:0 0 12px rgba(0,0,0,0.6);
      transition:opacity 0.3s,transform 0.3s;
      opacity:0;transform:translateX(20px);pointer-events:none;
    `;
    panel.innerHTML = `
      <div style="padding:16px;text-align:center;color:#8f98a0;">
        <div style="font-size:24px;margin-bottom:8px;">🎮</div>
        正在查询 Steam 信息...
      </div>
    `;
    document.body.appendChild(panel);

    // 关闭/展开按钮
    const toggleBtn = document.createElement('div');
    toggleBtn.style.cssText = `
      position:fixed;top:80px;right:16px;z-index:2147483647;
      width:28px;height:28px;line-height:28px;text-align:center;
      background:#2a475e;border-radius:4px 0 0 4px;cursor:pointer;
      color:#66c0f4;font-size:14px;display:none;
      box-shadow:0 2px 8px rgba(0,0,0,0.4);
    `;
    toggleBtn.textContent = '✕';
    toggleBtn.title = '关闭Steam信息';
    document.body.appendChild(toggleBtn);

    let panelVisible = false;
    let steamData = null;

    function showPanel() {
      panel.style.opacity = '1';
      panel.style.transform = 'translateX(0)';
      panel.style.pointerEvents = 'auto';
      toggleBtn.style.display = 'block';
      panelVisible = true;
    }

    function hidePanel() {
      panel.style.opacity = '0';
      panel.style.transform = 'translateX(20px)';
      panel.style.pointerEvents = 'none';
      toggleBtn.style.display = 'none';
      panelVisible = false;
    }

    toggleBtn.addEventListener('click', hidePanel);

    // 自动加载Steam数据并直接显示
    (async () => {
      DEBUG.steamStatus = '查询中...';
      updateDebugPanel();
      try {
        const response = await chrome.runtime.sendMessage({ action: 'SEARCH_STEAM', gameName });
        if (response && response.data) {
          steamData = response.data;
          DEBUG.steamStatus = `✅ ${steamData.ratingDesc || ''} ${steamData.positiveRate || ''}%`;
          dbg(`Steam: ${steamData.name} - ${steamData.ratingDesc} ${steamData.positiveRate}%`);
          renderSteamSidebar(panel, steamData, hidePanel);
          showPanel();

          // 回写Steam标签
          if (steamData.genres && steamData.genres.length > 0) {
            chrome.runtime.sendMessage({
              action: 'TRACK_EVENT',
              data: {
                type: 'steam_tags_update',
                gameName: gameName,
                keywords: steamData.genres,
                steamAppId: steamData.appId,
                steamRating: steamData.rating,
                url: window.location.href,
                domain: getCurrentDomain()
              }
            }).catch(() => {});
          }
        } else {
          DEBUG.steamStatus = '❌ 未找到';
          dbg('Steam: 未找到该游戏');
          panel.innerHTML = `
            <div style="padding:16px;text-align:center;color:#8f98a0;">
              <div style="font-size:20px;margin-bottom:6px;">🎮</div>
              未在Steam上找到该游戏
            </div>
          `;
        }
      } catch (e) {
        DEBUG.steamStatus = '❌ ' + e.message;
        dbg('Steam查询错误: ' + e.message);
        panel.innerHTML = `<div style="padding:16px;text-align:center;color:#e74c3c;">查询失败</div>`;
      }
      updateDebugPanel();
    })();
  }

  // 仿Steam右侧信息栏渲染
  function renderSteamSidebar(panel, data, onClose) {
    const ratingColor = (data.positiveRate || 0) >= 80 ? '#66c0f4' : (data.positiveRate || 0) >= 60 ? '#a3cf06' : '#ff7b00';
    const ratingBg = (data.positiveRate || 0) >= 80 ? 'rgba(102,192,244,0.1)' : (data.positiveRate || 0) >= 60 ? 'rgba(163,207,6,0.1)' : 'rgba(255,123,0,0.1)';

    // 中文评测
    let reviewsHtml = '';
    if (data.reviews && data.reviews.length > 0) {
      reviewsHtml = `
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid #2a475e;">
          <div style="font-size:12px;color:#8f98a0;margin-bottom:6px;">🇨🇳 简体中文评测</div>
          ${data.reviews.slice(0, 3).map(r => `
            <div style="padding:6px 8px;margin:4px 0;background:rgba(0,0,0,0.2);border-radius:3px;font-size:12px;border-left:2px solid ${r.recommended ? '#66c0f4' : '#a34c25'}">
              <span style="color:${r.recommended ? '#66c0f4' : '#a34c25'}">${r.recommended ? '👍 推荐' : '👎 不推荐'}</span>
              <div style="color:#acb2b8;margin-top:3px;word-break:break-all;">${escapeHtml(r.text.substring(0, 120))}${r.text.length > 120 ? '...' : ''}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    // SteamDB 信息区块（被拦截时显示SteamSpy补充数据）
    let steamdbHtml = '';
    if (data.steamdbUrl) {
      const sdb = data.steamdb;
      const spy = data.steamspy;
      const hasSdbData = sdb && sdb.available && (sdb.rating || sdb.currentPlayers || sdb.lowestPrice);
      const isBlocked = sdb && sdb.blocked;
      
      let bodyHtml = '';
      if (hasSdbData) {
        bodyHtml = `
          <div style="display:flex;flex-direction:column;gap:4px;font-size:12px;">
            ${sdb.rating ? `<div style="color:#acb2b8;">SteamDB 评分: <span style="color:#66c0f4;font-weight:bold;">${sdb.rating}%</span></div>` : ''}
            ${sdb.reviewCount ? `<div style="color:#acb2b8;">评测数: <span style="color:#c7d5e0;font-weight:bold;">${sdb.reviewCount}</span></div>` : ''}
            ${sdb.currentPlayers ? `<div style="color:#acb2b8;">当前在线: <span style="color:#a3cf06;font-weight:bold;">${sdb.currentPlayers}</span> 人</div>` : ''}
            ${sdb.lowestPrice ? `<div style="color:#acb2b8;">历史最低价: <span style="color:#ff7b00;font-weight:bold;">${sdb.lowestPrice}</span></div>` : ''}
          </div>
        `;
      } else if (spy && (spy.positiveRate !== null || spy.players2weeks)) {
        // SteamDB被拦截，显示SteamSpy数据
        bodyHtml = `
          <div style="font-size:10px;color:#666;margin-bottom:4px;">SteamDB需人机验证，以下为SteamSpy数据</div>
          <div style="display:flex;flex-direction:column;gap:4px;font-size:12px;">
            ${spy.positiveRate !== null && spy.positiveRate !== undefined ? `<div style="color:#acb2b8;">好评率: <span style="color:#66c0f4;font-weight:bold;">${spy.positiveRate}%</span>${spy.reviewCount ? ` · ${spy.reviewCount} 条` : ''}</div>` : ''}
            ${spy.players2weeks ? `<div style="color:#acb2b8;">近两周玩家: <span style="color:#a3cf06;font-weight:bold;">${spy.players2weeks}</span> 人</div>` : ''}
            ${spy.averagePlaytime ? `<div style="color:#acb2b8;">平均时长: <span style="color:#c7d5e0;font-weight:bold;">${spy.averagePlaytime}</span></div>` : ''}
          </div>
        `;
      } else if (isBlocked) {
        bodyHtml = `<div style="font-size:11px;color:#8f98a0;">SteamDB 启用了人机验证，请点上方链接查看</div>`;
      } else {
        bodyHtml = `<div style="font-size:11px;color:#8f98a0;">点击链接查看SteamDB详细数据</div>`;
      }
      
      steamdbHtml = `
        <div style="margin-top:12px;padding:10px;background:rgba(0,0,0,0.25);border-radius:3px;border:1px solid #2a475e;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <span style="font-size:12px;font-weight:bold;color:#fff;">📊 SteamDB</span>
            <a href="${data.steamdbUrl}" target="_blank" style="font-size:11px;color:#67c1f5;text-decoration:none;">查看 ↗</a>
          </div>
          ${bodyHtml}
        </div>
      `;
    }

    panel.innerHTML = `
      <!-- 头部图片 -->
      ${data.headerImage ? `
        <div style="position:relative;">
          <img src="${data.headerImage}" style="width:100%;display:block;border-radius:4px 4px 0 0;" onerror="this.style.display='none'"/>
        </div>
      ` : ''}

      <div style="padding:14px;">
        <!-- 游戏名 -->
        <div style="font-size:17px;font-weight:bold;color:#fff;margin-bottom:8px;">${escapeHtml(data.name)}</div>

        <!-- 中文支持 + 发行信息 -->
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;font-size:11px;">
          <span style="padding:2px 8px;border-radius:2px;background:${data.chineseSupported ? 'rgba(163,207,6,0.15)' : 'rgba(255,255,255,0.05)'};color:${data.chineseSupported ? '#a3cf06' : '#666'};">
            ${data.chineseSupported ? (data.simplifiedChinese ? '✓ 简体中文' : '✓ 支持中文') : '✗ 暂不支持中文'}
            ${data.chineseSupported && data.chineseHasAudio ? ' · 音频' : ''}
            ${data.chineseSupported && data.chineseHasSubtitles ? ' · 字幕' : ''}
          </span>
          ${data.releaseDate ? `<span style="padding:2px 8px;border-radius:2px;background:rgba(255,255,255,0.05);color:#8f98a0;">📅 ${escapeHtml(data.releaseDate)}</span>` : ''}
        </div>

        <!-- 跳转Steam按钮 - 置顶 -->
        ${data.url ? `<a href="${escapeHtml(data.url)}" target="_blank" style="
          display:block;margin-bottom:12px;padding:9px 0;text-align:center;
          background:linear-gradient(to right,#75b022,#588a1b);
          color:#d2efa9;border-radius:3px;text-decoration:none;
          font-size:13px;font-weight:bold;
          text-shadow:1px 1px 0 rgba(0,0,0,0.3);
        ">在 Steam 上查看</a>` : ''}

        <!-- 评分区域 - 三重评价（Steam总体/简体中文/SteamDB） -->
        <div style="background:${ratingBg};border-radius:3px;padding:10px;margin-bottom:12px;">
          <!-- Steam 总体评价 -->
          <div style="padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:11px;color:#8f98a0;">Steam 总体</span>
              <span style="font-size:13px;font-weight:bold;color:${ratingColor};">${data.ratingDesc || '暂无'}</span>
            </div>
            <div style="font-size:11px;color:#8f98a0;margin-top:2px;text-align:right;">
              ${data.positiveRate !== null && data.positiveRate !== undefined ? `${data.positiveRate}% 好评` : ''}
              ${data.totalReviews ? ` · ${data.totalReviews.toLocaleString()} 条` : ''}
            </div>
          </div>
          <!-- 简体中文评价 -->
          <div style="padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:11px;color:#8f98a0;">🇨🇳 简体中文</span>
              <span style="font-size:13px;font-weight:bold;color:${(data.cnPositiveRate || 0) >= 80 ? '#66c0f4' : (data.cnPositiveRate || 0) >= 60 ? '#a3cf06' : '#ff7b00'};">${data.cnRatingDesc || (data.cnPositiveRate !== null && data.cnPositiveRate !== undefined ? data.cnPositiveRate + '% 好评' : '暂无')}</span>
            </div>
            <div style="font-size:11px;color:#8f98a0;margin-top:2px;text-align:right;">
              ${data.cnPositiveRate !== null && data.cnPositiveRate !== undefined ? `${data.cnPositiveRate}% 好评` : ''}
              ${data.cnTotalReviews ? ` · ${data.cnTotalReviews.toLocaleString()} 条` : ''}
            </div>
          </div>
          <!-- SteamDB 评价 -->
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:11px;color:#8f98a0;">📊 SteamDB</span>
            <span style="font-size:13px;font-weight:bold;color:#67c1f5;">
              ${data.steamdb && data.steamdb.rating ? data.steamdb.rating + '%' : '—'}
            </span>
          </div>
          ${data.steamdb && data.steamdb.reviewCount ? `
            <div style="font-size:11px;color:#8f98a0;margin-top:2px;text-align:right;">${data.steamdb.reviewCount} 条评测</div>
          ` : ''}
        </div>

        <!-- 热门用户自定义标签 -->
        ${data.userTags && data.userTags.length > 0 ? `
          <div style="margin-bottom:12px;">
            <div style="font-size:12px;color:#8f98a0;margin-bottom:5px;">🔥 热门用户标签</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              ${data.userTags.map(t => `<span style="padding:3px 8px;font-size:11px;background:rgba(103,193,245,0.12);color:#67c1f5;border-radius:2px;cursor:default;">${escapeHtml(t)}</span>`).join('')}
            </div>
          </div>
        ` : ''}

        <!-- 官方类型标签 -->
        ${data.genres && data.genres.length > 0 ? `
          <div style="margin-bottom:12px;">
            <div style="font-size:12px;color:#8f98a0;margin-bottom:5px;">类型</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              ${data.genres.map(g => `<span style="padding:3px 8px;font-size:11px;background:rgba(255,255,255,0.06);color:#c7d5e0;border-radius:2px;cursor:default;">${escapeHtml(g)}</span>`).join('')}
            </div>
          </div>
        ` : ''}

        <!-- 开发商 -->
        ${data.developers && data.developers.length > 0 ? `
          <div style="font-size:12px;color:#8f98a0;margin-bottom:10px;">开发商: <span style="color:#67c1f5;">${escapeHtml(data.developers.join(', '))}</span></div>
        ` : ''}

        <!-- 简介 -->
        ${data.description ? `
          <div style="font-size:12px;color:#acb2b8;margin-bottom:12px;line-height:1.6;max-height:80px;overflow:hidden;">
            ${escapeHtml(data.description.substring(0, 200))}${data.description.length > 200 ? '...' : ''}
          </div>
        ` : ''}

        <!-- SteamDB 信息 -->
        ${steamdbHtml}

        <!-- 中文评测 -->
        ${reviewsHtml}
      </div>
    `;
  }

  // ============ 浮动调试窗口 ============
  let debugPanel = null;
  let debugVisible = true;

  function initDebugPanel() {
    debugPanel = document.createElement('div');
    debugPanel.id = 'gr-debug-panel';
    debugPanel.style.cssText = `
      position:fixed;top:10px;left:10px;z-index:2147483647;
      width:300px;max-height:400px;overflow-y:auto;
      background:rgba(15,15,26,0.95);border:1px solid #333;
      border-radius:8px;padding:12px;font-size:12px;
      font-family:monospace;color:#aaa;line-height:1.5;
      box-shadow:0 4px 20px rgba(0,0,0,0.5);
      transition:opacity 0.3s;
    `;
    document.body.appendChild(debugPanel);

    // 最小化按钮
    const minBtn = document.createElement('button');
    minBtn.textContent = '—';
    minBtn.style.cssText = 'position:absolute;top:4px;right:8px;background:none;border:none;color:#666;cursor:pointer;font-size:16px;';
    minBtn.onclick = () => {
      debugVisible = !debugVisible;
      debugPanel.style.height = debugVisible ? 'auto' : '30px';
      debugPanel.style.overflow = debugVisible ? 'visible' : 'hidden';
      minBtn.textContent = debugVisible ? '—' : '+';
    };
    debugPanel.appendChild(minBtn);

    updateDebugPanel();
    dbg('调试面板已加载');
  }

  function updateDebugPanel() {
    if (!debugPanel) return;
    const statusColor = (s) => s.startsWith('✅') ? '#2ecc71' : s.startsWith('❌') ? '#e74c3c' : s.startsWith('⚠️') ? '#f39c12' : '#66c0f4';

    debugPanel.innerHTML = `
      <button style="position:absolute;top:4px;right:8px;background:none;border:none;color:#666;cursor:pointer;font-size:16px;" onclick="this.parentElement.style.height=this.parentElement.style.height==='30px'?'auto':'30px';this.parentElement.style.overflow=this.parentElement.style.height==='30px'?'hidden':'visible';this.textContent=this.textContent==='—'?'+':'—'">—</button>
      <div style="color:#66c0f4;font-weight:bold;margin-bottom:8px;font-size:13px">🎮 Game Recommender 调试</div>
      <div>页面类型: <span style="color:${statusColor(DEBUG.pageType === '未检测' ? '⚠️' : '✅')}">${DEBUG.pageType}</span></div>
      <div>适配器: <span style="color:#66c0f4">${DEBUG.adapter}</span></div>
      <div>网站追踪: <span style="color:${DEBUG.siteTracked ? '#2ecc71' : '#e74c3c'}">${DEBUG.siteTracked ? '是' : '否'}</span></div>
      <div>游戏名: <span style="color:#fff">${escapeHtml(DEBUG.gameName || '未检测')}</span></div>
      <div>Steam: <span style="color:${statusColor(DEBUG.steamStatus)}">${DEBUG.steamStatus}</span></div>
      <div>下载事件: <span style="color:${DEBUG.downloadEvents > 0 ? '#2ecc71' : '#aaa'}">${DEBUG.downloadEvents}</span></div>
      <div style="margin-top:8px;border-top:1px solid #333;padding-top:6px;color:#666;font-size:11px">
        ${(DEBUG.logs || []).slice(0, 8).map(l => `<div>${escapeHtml(l)}</div>`).join('')}
      </div>
    `;
  }

  // ============ 启动 ============
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 300);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(init, 300));
  }

  // 监听消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'REFRESH_RECOMMENDATIONS') {
      const adapter = getAdapter();
      if (isListPageByUrl() || adapter.isListPage()) {
        const items = getListItemsSmart(adapter);
        requestRecommendations(items);
      }
      sendResponse({ success: true });
    }
    if (message.action === 'GET_DEBUG_INFO') {
      sendResponse({ debug: DEBUG });
    }
    if (message.action === 'DOWNLOAD_SITE_UPDATE') {
      // 深度提取完成，更新浮窗中的网盘链接
      for (const entry of pendingDownloadSitePanels) {
        if (entry.gameName === message.gameName) {
          updateSitePanelPanLink(entry.panel, message);
        }
      }
      sendResponse({ success: true });
    }
    return true;
  });

})();
