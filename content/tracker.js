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
            items.push({ element: li, link, name: title.textContent.trim(), url: link.href });
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
            items.push({ element: li, link, name: title.textContent.trim(), url: link.href });
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
            items.push({ element: li, link, name: title.textContent.trim(), url: link.href });
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
              items.push({ element: a.closest('li, div, article') || a, link: a, name: text, url: a.href });
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
  // 详情页URL特征：以 数字.html 结尾，或 /game/数字 形式
  // 例：/99697.html, /game/15027.html, /11469.html
  function isDetailPageByUrl() {
    const path = window.location.pathname;
    return /\/\d+\.html?$/.test(path) ||      // /99697.html 或 /11469.html
           /\/game\/\d+/.test(path) ||         // /game/15027.html
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

    // === 3. 详情页：注入Steam浮窗 ===
    const isDetail = detailByUrl || (!isList && !!document.querySelector('h1'));
    if (isDetail) {
      DEBUG.pageType = '详情页';
      const gameName = detectGameName();
      if (gameName && gameName.length > 1) {
        DEBUG.gameName = gameName;
        dbg(`详情页游戏名: ${gameName}`);
        trackEvent('view_detail', { gameName: gameName, keywords: [], description: '' });
        injectSteamButton(gameName);
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
        // 匹配详情页URL特征
        if (/\/\d+\.html?$/.test(new URL(href, window.location.href).pathname) || /\/game\/\d+/.test(href)) {
          const text = a.textContent.trim();
          if (text.length > 2 && text.length < 100 && !seen.has(href)) {
            seen.add(href);
            items.push({ element: a.closest('li, div, article') || a, link: a, name: text, url: href });
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
      const maxItems = 60;
      const processItems = items.slice(0, maxItems);
      // 去重游戏名
      const uniqueNames = [...new Set(processItems.map(i => i.name).filter(n => n && n.length > 1))];
      if (uniqueNames.length === 0) return;

      const response = await chrome.runtime.sendMessage({ action: 'GET_STEAM_RATINGS', names: uniqueNames });
      if (response && response.ratings) {
        let shown = 0;
        processItems.forEach(item => {
          const rating = response.ratings[item.name];
          if (rating && rating.positiveRate !== null && rating.positiveRate !== undefined) {
            prependRatingBadge(item, rating);
            shown++;
          }
        });
        dbg(`列表页显示 ${shown} 个Steam好评率`);
      }
    } catch (e) {
      dbg('Steam好评率检索失败: ' + e.message);
    }
  }

  // 在游戏名前插入好评率徽章
  function prependRatingBadge(item, rating) {
    const link = item.link;
    if (!link || link.querySelector('.gr-rating-badge')) return; // 避免重复插入

    const rate = rating.positiveRate;
    // 颜色分级：>=80 绿色，>=60 黄绿，<60 橙色
    const color = rate >= 80 ? '#66c0f4' : rate >= 60 ? '#a3cf06' : '#ff7b00';
    const bg = rate >= 80 ? 'rgba(102,192,244,0.15)' : rate >= 60 ? 'rgba(163,207,6,0.15)' : 'rgba(255,123,0,0.15)';

    const badge = document.createElement('span');
    badge.className = 'gr-rating-badge';
    badge.textContent = `${rate}%`;
    badge.style.cssText = `display:inline-block;margin-right:6px;padding:1px 6px;font-size:11px;font-weight:bold;color:${color};background:${bg};border:1px solid ${color};border-radius:3px;vertical-align:middle;`;
    badge.title = `Steam 好评率: ${rate}%${rating.ratingDesc ? ' (' + rating.ratingDesc + ')' : ''}`;

    link.insertBefore(badge, link.firstChild);
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
        html += `
          <div style="margin:0 14px 10px 14px;padding:10px;background:rgba(0,0,0,0.25);border:1px solid #2a475e;border-radius:3px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:12px;font-weight:bold;color:#67c1f5;">${name}</span>
              <a href="${site.detailUrl}" target="_blank" style="font-size:11px;color:#d2efa9;background:linear-gradient(to right,#75b022,#588a1b);padding:3px 10px;border-radius:2px;text-decoration:none;">跳转详情页 ↗</a>
            </div>
            <div style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#acb2b8;">
              ${site.updateDate ? `<div>📅 更新: ${escapeHtml(site.updateDate)}</div>` : ''}
              ${site.version ? `<div>🏷️ 版本: ${escapeHtml(site.version)}</div>` : ''}
              ${site.size ? `<div>💾 大小: ${escapeHtml(site.size)}</div>` : ''}
              ${!site.updateDate && !site.version && !site.size ? '<div style="color:#666;">点击跳转查看详情</div>' : ''}
            </div>
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
  }

  function createCloseBtn(panel) {
    const btn = document.createElement('div');
    btn.textContent = '✕';
    btn.style.cssText = 'position:absolute;top:6px;right:10px;cursor:pointer;color:#666;font-size:14px;';
    btn.onclick = () => { panel.style.display = 'none'; };
    return btn;
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
        <a href="${data.url}" target="_blank" style="
          display:block;margin-bottom:12px;padding:9px 0;text-align:center;
          background:linear-gradient(to right,#75b022,#588a1b);
          color:#d2efa9;border-radius:3px;text-decoration:none;
          font-size:13px;font-weight:bold;
          text-shadow:1px 1px 0 rgba(0,0,0,0.3);
        ">在 Steam 上查看</a>

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
    return true;
  });

})();
