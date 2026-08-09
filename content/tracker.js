/**
 * Game Recommender - Behavior Tracking Content Script (v3)
 * 行为追踪内容脚本 (v3)
 *
 * Core features:
 * 核心功能：
 *   - List page: Steam rating badges & recommendation highlighting
 *   - 列表页：Steam好评率徽章 & 推荐高亮
 *   - Detail page: Steam info floating panel & download history panel
 *   - 详情页：Steam信息浮窗 & 下载历史浮窗
 *   - Steam page: Download site resource search panel (link to detail page only)
 *   - Steam页：下载站资源搜索面板（仅提供详情页跳转链接）
 *   - Global: Download tracking via click interception
 *   - 全局：通过点击拦截实现下载追踪
 */

(function() {
  'use strict';

  if (window.__gameRecommenderTracker) return;
  window.__gameRecommenderTracker = true;

  // ============ Debug State / 调试状态 ============
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

  // 防抖更新调试面板：高频日志时避免每次都重建 DOM，降低 CPU 占用。
  // Debounced debug panel update: avoids rebuilding DOM on every log, reducing CPU usage.
  let debugPanelTimer = null;
  function scheduleDebugUpdate() {
    if (!debugPanel) return; // 面板未创建则跳过 / Skip if panel not created
    if (debugPanelTimer) return; // 已有待刷新则跳过 / Skip if a refresh is already pending
    debugPanelTimer = setTimeout(() => {
      debugPanelTimer = null;
      updateDebugPanel();
    }, 250);
  }

  function dbg(msg) {
    DEBUG.logs.unshift(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (DEBUG.logs.length > 20) DEBUG.logs.pop();
    scheduleDebugUpdate();
  }

  // ============ 网站适配器（仅用于列表页） ============
  // 适配规则来自 adapters/sites.js（下载站规则文件，便于分享与移植）：
  // 添加新站点只需在规则文件里加一项，无需修改业务代码。
  // Adapters are built from adapters/sites.js (the download-site rules file,
  // shared and portable): adding a site only requires a new rules entry.
  const SITE_RULES = (globalThis.__GAME_RECOMMENDER_SITES__ || {}).sites || [];

  // 根据规则构建站点适配器 / Build a site adapter from its rules
  function buildAdapter(rule) {
    const detailPatterns = (rule.detailUrlPatterns || []).map(p => new RegExp(p, 'i'));
    // 判断链接是否指向详情页（未配置规则时不限制）/ Is a link a detail page? (unrestricted when no patterns)
    const isDetailHref = (href) => {
      if (detailPatterns.length === 0) return true;
      try {
        const p = new URL(href, window.location.href).pathname;
        return detailPatterns.some(re => re.test(p));
      } catch (e) { return false; }
    };
    const cfg = rule.listItem || {};
    const containers = cfg.containers || [];
    const titleEls = cfg.titleEls || ['h2', 'h3', '.title', '.entry-title'];
    const excludeClasses = cfg.excludeClasses || [];
    const minLen = cfg.minLen ?? 3;
    const maxLen = cfg.maxLen ?? 200;
    const isExcluded = (el) => excludeClasses.some(c => el.classList.contains(c));
    // 在元素内查找标题元素（优先标题链接选择器） / Find the title element inside a container
    const findTitleEl = (root, fallback) => {
      if (cfg.titleLink) {
        const tl = root.querySelector(cfg.titleLink);
        if (tl) return tl;
      }
      return root.querySelector(titleEls.join(',')) || fallback;
    };

    return {
      name: rule.name,
      isListPage: () => {
        const path = window.location.pathname;
        // 1. URL 特征 / URL patterns
        if ((rule.listPage?.urlPatterns || []).some(p => new RegExp(p, 'i').test(path))) return true;
        // 2. DOM 选择器 / DOM selectors
        if ((rule.listPage?.selectors || []).some(sel => document.querySelector(sel))) return true;
        // 3. 通用判断：页面详情链接数量达到阈值（XDGame 首页/未知分类页）
        //    Generic: enough detail links on the page (XDGame home/unknown category pages)
        const minLinks = rule.listPage?.minDetailLinks || 0;
        if (minLinks > 0) {
          let count = 0;
          document.querySelectorAll('a').forEach(a => {
            if (isDetailHref(a.href || '')) count++;
          });
          if (count >= minLinks) return true;
        }
        return false;
      },
      getListItems: () => {
        const items = [];
        const seen = new Set();
        const addItem = (element, link, nameEl) => {
          const href = link.href;
          if (seen.has(href)) return;
          const text = (nameEl.textContent || '').trim().replace(/\s+/g, ' ');
          if (text.length < minLen || text.length > maxLen) return;
          if (!isDetailHref(href)) return;
          seen.add(href);
          items.push({ element, link, name: text, url: href, titleEl: nameEl });
        };

        // 策略1：容器 + 标题链接选择器（XDGame 的 a.tit 优先）
        // Strategy 1: containers + title-link selector (e.g. XDGame a.tit)
        for (const sel of containers) {
          document.querySelectorAll(sel).forEach(li => {
            const tl = li.querySelector(cfg.titleLink);
            if (tl) addItem(li, tl, tl);
          });
          if (items.length > 0) return items;
        }

        // 策略2：容器内找有文本的详情页链接（跳过纯图片/按钮类链接）
        // Strategy 2: detail links with text inside containers (skip image/button-only links)
        for (const sel of containers) {
          document.querySelectorAll(sel).forEach(li => {
            if (items.some(it => it.element === li)) return; // 策略1已处理 / handled by strategy 1
            const links = li.querySelectorAll('a[href]');
            for (const a of links) {
              if (isExcluded(a)) continue;
              const text = (a.textContent || '').trim();
              if (text.length < minLen) continue;
              const titleEl = findTitleEl(li, a);
              addItem(li, a, titleEl);
              if (items.some(it => it.element === li)) break; // 每个 li 只取第一个链接 / one link per li
            }
          });
          if (items.length > 0) return items;
        }

        // 策略3：回退——全页面范围内提取详情页链接（XDGame / 咸鱼单机兜底）
        // Strategy 3: fallback — extract detail links across the whole page
        if (cfg.fallbackLinks) {
          document.querySelectorAll('a[href]').forEach(a => {
            if (isExcluded(a)) return;
            const text = (a.textContent || '').trim();
            if (text.length < minLen) return;
            const element = a.closest('li, div, article') || a;
            const titleEl = findTitleEl(element, a);
            addItem(element, a, titleEl);
          });
        }

        return items;
      }
    };
  }

  // 构建站点适配器表（key → adapter），通用适配器作为兜底
  // Build the adapter table (key → adapter), with a generic adapter as fallback
  const SITE_ADAPTERS = {};
  for (const rule of SITE_RULES) {
    SITE_ADAPTERS[rule.key] = buildAdapter(rule);
  }
  SITE_ADAPTERS['_default'] = {
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

  // 当前站点的适配器 key（用于上报下载站网址缓存）
  // The current site's adapter key (for reporting download-URL cache entries)
  function getAdapterKey() {
    const domain = getCurrentDomain();
    for (const key of Object.keys(SITE_ADAPTERS)) {
      if (key !== '_default' && domain.includes(key)) return key;
    }
    return '';
  }

  function trackEvent(type, data) {
    chrome.runtime.sendMessage({
      action: 'TRACK_EVENT',
      data: { type, url: window.location.href, domain: getCurrentDomain(), ...data }
    }).catch(() => {});
  }

  // 记录下载站详情页访问：把当前页面网址写入该 appId 的下载站网址缓存，
  // 更新 lastAccessed，供游戏缓存管理页展示"上次调用"。
  // Record a download-site detail-page visit: save the current URL into the
  // appId's download-URL cache and refresh lastAccessed for the cache page.
  function trackDownloadSiteVisit(appId, gameName) {
    if (!appId) return;
    chrome.runtime.sendMessage({
      action: 'TRACK_DOWNLOAD_SITE_VISIT',
      data: {
        appId: String(appId),
        gameName: gameName || '',
        url: window.location.href,
        domain: getCurrentDomain()
      }
    }).catch(() => {});
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // HTML 属性值转义（用于 href 等属性，防止恶意 URL 中的引号逃逸出属性）
  // Attribute-value escape (for href etc., preventing quotes in URLs from breaking out)
  function escapeAttr(text) {
    return (text || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 从页面提取游戏名称（不依赖适配器）
  function detectGameName() {
    // 优先从 h1 获取
    const h1 = document.querySelector('h1');
    if (h1) {
      // 移除徽章/角标元素（如咸鱼单机的"新游发布" span），避免其文本污染标题
      // Strip badge elements (e.g. xianyudanji's "新游发布" span) so their text
      // never pollutes the extracted title
      h1.querySelectorAll('.post-badge, .badge, [class*="badge"]').forEach(b => b.remove());

      // 策略1：优先从 h1 子元素中提取纯英文标题
      // 部分下载站的 h1 结构为"中文标题|噪声|英文标题"，英文标题在子元素中。
      // 直接取 textContent 会被噪声正则误删英文部分。
      // Strategy 1: prefer extracting pure English title from h1 child elements.
      // Some sites structure h1 as "CN title|noise|EN title" with EN in a child.
      const enChild = h1.querySelector('span, div, p, em, strong, small');
      if (enChild) {
        const enText = (enChild.textContent || '').trim();
        if (enText.length > 3 && enText.length < 200 && /^[A-Za-z0-9][A-Za-z0-9\s'':&.!\-×x]*$/i.test(enText)) {
          return enText;
        }
      }

      // 策略2：取 textContent，按分隔符分段，移除纯噪声段（中英文名段都保留）
      // 旧实现用"|噪声词及之后全部删除"的正则，会误删噪声段之后的英文名
      //（如"铁巢重炮|官方中文|Iron Nest Heavy Turret Simulator"被删成只剩中文），
      // 且未移除徽章文本导致标题被"新游发布"污染、Steam 搜索失败。
      // 现在仅删除噪声段本身，完整的中英文名交由后台 parseGameTitle 生成搜索候选。
      // Strategy 2: split textContent by separators and drop pure-noise segments,
      // keeping BOTH CN and EN name segments. The old regex deleted everything
      // after a noise keyword, wrongly removing the EN name that follows it,
      // and badge text polluted the title so Steam search failed.
      const noisePattern = /(中文|汉化|破解|免安装|绿色|学习|未加密|完整版|豪华版|豪华|终极|数字|典藏|年度|重制|复刻|增强|正式|官方|简繁|简体|繁体|中英|多语言|特别版|标准版|解压即撸|预购特典|预购|特典|版|v[\d.]+|V[\d.]+|\d+\.\d+[\d.]*|Build[.\s]*\d+|update\s*\d+|DLC.*|全DLC|整合|硬盘|免DVD|下载|游戏下载|免费下载|支持手柄|手柄|支持|新游发布|免安装绿色版)/gi;
      let text = h1.textContent.trim();
      const parts = text.split(/[|]+|\s+[-–—]\s+/).map(s => s.trim()).filter(s => s.length > 1);
      const keptParts = parts.filter(p => {
        const stripped = p.replace(noisePattern, '').replace(/[\s\|\-:：、]+/g, '');
        return stripped.length > 0;
      });
      if (keptParts.length > 0) text = keptParts.join('|');

      // 清理可能残留的尾部空分隔符 / Clean trailing empty separators
      text = text.replace(/[\|\-–—:：\s]+$/, '').trim();
      if (text.length > 1 && text.length < 200) {
        // 策略2a：若清理后是纯中文/含×的中文标题，尝试从 Steam 图片 alt 提取英文标题
        // gamer520 等站点 h1 是中文译名，Steam 图片 alt 含英文原名"XXX on Steam"
        // Strategy 2a: if the cleaned title is Chinese, try extracting the English
        // name from a Steam image alt attribute ("XXX on Steam")
        if (/[\u4e00-\u9fff]/.test(text) && !/[A-Za-z]{3,}/.test(text)) {
          const enFromImg = extractEnglishFromSteamImage();
          if (enFromImg) return enFromImg;
        }
        return text;
      }

      // 策略3：若清理后为空，回退到 textContent 中提取英文子串
      // Strategy 3: if cleaned result is empty, extract English substring
      const enMatch = h1.textContent.match(/[A-Za-z][A-Za-z0-9\s'':&.!\-×x]{5,}/);
      if (enMatch && enMatch[0].length > 3 && enMatch[0].length < 200) return enMatch[0].trim();
    }
    // 从 title 获取
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

  // 从 Steam 图片的 alt 属性提取英文游戏名
  // Steam 商店图片的 alt 通常是 "GameName on Steam"，去掉 " on Steam" 后缀即为游戏名
  // Extract English game name from Steam image alt attribute.
  // Steam store image alt is usually "GameName on Steam"; strip the suffix.
  function extractEnglishFromSteamImage() {
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      const alt = (img.getAttribute('alt') || '').trim();
      // 匹配 "XXX on Steam" 且 XXX 主要是英文
      // Match "XXX on Steam" where XXX is mostly English
      const match = alt.match(/^(.+?)\s+on\s+Steam$/i);
      if (match) {
        const name = match[1].trim();
        // 仅当提取的名字主要是英文且长度合理时才采用
        // Only adopt when the name is mostly English and has a reasonable length
        if (name.length > 3 && name.length < 200 && /^[A-Za-z0-9][A-Za-z0-9\s'':&.!\-×x]*$/i.test(name)) {
          return name;
        }
      }
    }
    return null;
  }

  // 从 Steam 图片 URL 提取 appId
  // gamer520 等站点的图片引用 Steam CDN，URL 格式为
  //   https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/{appId}/...
  // 这是比标题提取更可靠的 appId 来源，可直接绕过 Steam 搜索。
  // Extract appId from Steam image URLs.
  // Sites like gamer520 reference Steam CDN images with URLs like
  //   https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/{appId}/...
  // This is more reliable than title extraction and bypasses Steam search.
  function extractSteamAppIdFromImages() {
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      const src = img.src || img.getAttribute('data-src') || '';
      // 匹配 /steam/apps/{数字}/ 路径 / Match /steam/apps/{digits}/ path
      const match = src.match(/\/steam\/apps\/(\d+)\//i);
      if (match) return match[1];
    }
    return null;
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
        trackListView(adapter, items, settings);
      }
    }

    // === 2. 始终设置下载追踪 ===
    setupDownloadTracking();

    // === 3. 详情页：注入Steam浮窗和下载历史浮窗 ===
    const isDetail = detailByUrl || (!isList && !!document.querySelector('h1'));
    if (isDetail) {
      DEBUG.pageType = '详情页';
      const gameName = detectGameName();
      // 即使未检测到游戏名，若页面含 Steam 图片可提取 appId，仍注入 Steam 浮窗。
      // gamer520 部分页面 h1 含大量噪声词导致 detectGameName 失败，但其 Steam
      // CDN 图片 URL 含 appId，可直接获取详情，绕过名称搜索。
      // Inject the Steam panel even without a detected name if an appId can be
      // extracted from page images. Some gamer520 pages have noisy h1 titles that
      // break detectGameName, but their Steam CDN image URLs contain the appId,
      // which fetches details directly, bypassing name search.
      const appIdFromImg = extractSteamAppIdFromImages();
      // 页面图片含 appId 时立即记录下载站访问（即使名称提取失败也能关联）
      // Record the visit right away when an appId is found in page images
      if (appIdFromImg) trackDownloadSiteVisit(appIdFromImg, gameName || '');
      if (gameName && gameName.length > 1) {
        DEBUG.gameName = gameName;
        dbg(`详情页游戏名: ${gameName}`);
        trackEvent('view_detail', { gameName: gameName, keywords: [], description: '' });
        injectSteamButton(gameName);
        injectDownloadHistoryPanel(gameName);
      } else if (appIdFromImg) {
        // 仅有 appId 无游戏名：用 document.title 作为回退名，仅注入 Steam 浮窗
        // （下载历史浮窗需要游戏名，此处跳过）
        // Only appId, no name: use document.title as fallback, inject Steam panel only
        // (the download-history panel requires a game name, so skip it here).
        const fallbackName = (document.title || '')
          .replace(/[\|\-–—_]\s*[^\|\-–—_]*$/, '')
          .replace(/(下载|游戏下载|免费下载|破解版|汉化版|中文版|绿色版|免安装).*$/i, '')
          .trim();
        DEBUG.gameName = fallbackName || `(appId:${appIdFromImg})`;
        dbg(`详情页游戏名为空，但图片含 appId: ${appIdFromImg}，使用回退名注入 Steam 浮窗`);
        injectSteamButton(fallbackName || '');
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
  function trackListView(adapter, items, settings) {
    trackEvent('view_list', { itemCount: items.length, page: window.location.href });

    // 虚拟机版过滤：在请求推荐/好评率之前移除标题命中关键词的游戏项，
    // 既隐藏不想要的游戏，也节省后续 Steam API 调用。
    // VM filter: remove items whose title hits keywords before requesting
    // recommendations/ratings, hiding unwanted games and saving API calls.
    let filteredItems = items;
    if (settings.enableVmFilter) {
      filteredItems = applyVmFilter(items, settings.vmFilterKeywords);
    }

    filteredItems.forEach(item => {
      item.link.addEventListener('click', () => {
        trackEvent('click_detail', { gameName: item.name, gameUrl: item.url });
      });
    });

    requestRecommendations(filteredItems, settings);
    requestSteamRatings(filteredItems, settings);

    // 预载下一页：当前页处理完成后延迟触发，提前预热下一页的 Steam 缓存，
    // 使用户切到下一页时好评率过滤能瞬间完成（全部命中缓存）。
    // Preload next page: triggered after a delay once the current page is done,
    // warming up the Steam cache so rating filtering on the next page is instant.
    preloadNextPage();
  }

  // 虚拟机版过滤：从 items 中移除标题命中关键词的游戏项，并从 DOM 中删除对应元素。
  // 命中任一关键词即过滤；为避免留空，向上查找栅格列容器（col-*）整体移除。
  // VM filter: drop items whose title hits any keyword and remove their DOM.
  // To avoid blank gaps, walk up to the grid column container (col-*) and remove it as a whole.
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
  // 预载标志：每页仅预载一次，避免重复请求 / Flag to preload once per page
  let preloadedNextPage = false;

  function preloadNextPage() {
    if (preloadedNextPage) return; // 已预载过则跳过 / Skip if already preloaded
    preloadedNextPage = true;

    // 延迟 2 秒执行，确保当前页渲染和 API 请求优先完成；
    // 后台预载已过滤已缓存名称，翻页时几乎全部命中缓存。
    // Delay 2s so current-page rendering/API calls take priority; the background
    // prefetch skips cached names, so the next page hits the cache almost fully.
    setTimeout(async () => {
      try {
        // 1. 查找下一页 URL / Find next page URL
        const nextUrl = findNextPageUrl();
        if (!nextUrl) { dbg('预载：未找到下一页链接'); return; }

        dbg(`预载下一页: ${nextUrl}`);

        // 2. 获取下一页 HTML（同源请求，credentials 省略以减少开销）
        //    Fetch next page HTML (same-origin; omit credentials to reduce overhead)
        const response = await fetch(nextUrl, { credentials: 'omit' });
        if (!response.ok) { dbg(`预载：HTTP ${response.status}`); return; }
        const html = await response.text();

        // 3. 解析 HTML，提取游戏名 / Parse HTML and extract game names
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const gameNames = extractGameNamesFromDoc(doc);
        if (gameNames.length === 0) { dbg('预载：未提取到游戏名'); return; }

        dbg(`预载：提取到 ${gameNames.length} 个游戏名，开始预热 Steam 缓存`);

        // 4. 预热 Steam 缓存（fire-and-forget）/ Warm up Steam cache (fire-and-forget)
        chrome.runtime.sendMessage({
          action: 'PREFETCH_STEAM_RATINGS',
          names: gameNames
        }).then(() => {
          dbg(`✅ 预载完成：已预热 ${gameNames.length} 个游戏的 Steam 缓存`);
        }).catch(() => {});
      } catch (e) {
        dbg('预载下一页失败: ' + e.message);
      }
    }, 2000);
  }

  // 查找下一页 URL：按优先级匹配常见分页模式
  // Find next page URL by matching common pagination patterns in priority order
  function findNextPageUrl() {
    // 优先级 1：rel="next" 或 .next 类 / Priority 1: rel="next" or .next class
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

    // 优先级 2：分页中含"下一页"/"»"/"›"/"Next"文本的链接
    //          Priority 2: pagination links with next-page text
    const pageLinks = document.querySelectorAll(
      '.pagination a, .pager a, .page-nav a, .wp-pagenavi a, nav.pagination a, .pages a'
    );
    for (const link of pageLinks) {
      const text = (link.textContent || '').trim();
      if (/下一页|»|›|Next/i.test(text) && link.href) return link.href;
    }

    return null;
  }

  // 从解析后的文档中提取游戏名（简化版，不依赖完整适配器，仅提取文本）
  // 选择器优先使用规则文件（adapters/sites.js）中的容器/标题配置
  // Extract game names from a parsed document (simplified; text only).
  // Selectors come from the rules file (adapters/sites.js) when available.
  function extractGameNamesFromDoc(doc) {
    const names = new Set();
    const domain = window.location.hostname;

    // 规则驱动提取：容器 + 标题链接/标题元素选择器
    // Rule-driven extraction: containers + title-link/title-element selectors
    const rule = (globalThis.__GAME_RECOMMENDER_SITES__ || {}).sites
      ?.find(r => r.domains.some(d => domain.includes(d)));
    if (rule) {
      const cfg = rule.listItem || {};
      const containers = cfg.containers || [];
      const titleLink = cfg.titleLink;
      const titleEls = cfg.titleEls || ['h2', 'h3', '.title', '.entry-title'];
      const minLen = cfg.minLen ?? 3;
      const maxLen = cfg.maxLen ?? 200;
      for (const sel of containers) {
        doc.querySelectorAll(sel).forEach(el => {
          const t = titleLink ? el.querySelector(titleLink) : el.querySelector(titleEls.join(','));
          if (t) {
            const text = (t.textContent || '').trim().replace(/\s+/g, ' ');
            if (text.length > minLen && text.length < maxLen) names.add(text);
          }
        });
        if (names.size > 0) return [...names];
      }
    }

    // 通用回退：指向详情页且有文本的链接（用 getAttribute 避免 DOMParser 无 base URL 问题）
    // Generic fallback: links to detail pages with text (use getAttribute to avoid DOMParser base-URL issue)
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

    return [...names];
  }

  // 列表页：检索每个游戏的Steam好评率并显示在游戏名前
  async function requestSteamRatings(items, settings) {
    try {
      const maxItems = 60;
      const processItems = items.slice(0, maxItems);
      // 去重游戏名
      const uniqueNames = [...new Set(processItems.map(i => i.name).filter(n => n && n.length > 1))];
      if (uniqueNames.length === 0) return;

      const response = await chrome.runtime.sendMessage({ action: 'GET_STEAM_RATINGS', names: uniqueNames });
      if (response && response.ratings) {
        let shown = 0;
        let filtered = 0;
        const notFoundNames = [];
        // 列表页批量记录：把每个游戏的 appId → 当前列表项下载页地址写入
        // 下载站网址缓存（一次消息批量更新，供缓存管理页与后续检索复用）。
        // Batch-record appId → detail-page URL on the list page into the
        // download-URL cache (single message; powers the cache page and reuse).
        const urlEntries = [];
        const minRating = settings?.enableRatingFilter ? (settings.minSteamRatingFilter || 0) : 0;
        processItems.forEach(item => {
          const rating = response.ratings[item.name];
          // 匹配到 appId 即显示徽章：有评测显示好评率，无评测（0条/Demo）显示 AppID
          // Show a badge whenever an appId is matched: the positive rate if reviews
          // exist, or the AppID for zero-review games (incl. Demos).
          if (rating && rating.appId) {
            if (item.url) urlEntries.push({ appId: rating.appId, url: item.url });
            if (rating.positiveRate !== null && rating.positiveRate !== undefined) {
              // 好评率过滤：低于阈值的移除该项（从DOM中删除，使后续元素自动重排）
              if (minRating > 0 && rating.positiveRate < minRating) {
                if (item.element) {
                  // 向上查找Bootstrap栅格列容器（col-*），移除整个列以避免留空
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
            // 未匹配（搜索失败/负缓存/异常）：显示"未找到"徽章，
            // 让每个游戏都有可见状态，便于调试与如实反馈
            // Unmatched (search failed/negative cache/error): show a "not found"
            // badge so every game has a visible status instead of silence
            notFoundNames.push(item.name);
            prependNotFoundBadge(item);
          }
        });
        // 批量写入下载站网址缓存（fire-and-forget，不阻塞徽章渲染）
        // Batch-write download-URL cache (fire-and-forget, no blocking)
        const siteKey = getAdapterKey();
        if (siteKey && urlEntries.length > 0) {
          chrome.runtime.sendMessage({
            action: 'RECORD_DOWNLOAD_URLS_BATCH',
            data: { siteKey, siteName: getAdapter().name, domain: getCurrentDomain(), entries: urlEntries }
          }).catch(() => {});
        }
        dbg(`列表页: 显示 ${shown} 个好评率, 过滤 ${filtered} 个, 未找到 ${notFoundNames.length} 个` +
            (notFoundNames.length > 0 ? ` [${notFoundNames.slice(0, 5).join('、')}]` : ''));

        // 未匹配的游戏 3 秒后重试一次（网络抖动/瞬时失败兜底），成功后补插徽章
        // Retry unmatched games once after 3s (transient-error fallback)
        if (notFoundNames.length > 0) {
          setTimeout(async () => {
            try {
              const retryResp = await chrome.runtime.sendMessage({ action: 'GET_STEAM_RATINGS', names: notFoundNames });
              if (retryResp && retryResp.ratings) {
                processItems.forEach(item => {
                  const r = retryResp.ratings[item.name];
                  if (r && r.appId) {
                    // 移除已有的"未找到"徽章后插入好评率徽章
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
    }
  }

  // 在游戏标题前插入好评率徽章
  function prependRatingBadge(item, rating) {
    const link = item.link;
    if (!link) return;

    const rate = rating.positiveRate;
    // 颜色分级：>=80 绿色，>=60 黄绿，<60 橙色；无评测（0条/Demo）显示灰色 AppID
    // Color grading: >=80 blue, >=60 yellow-green, <60 orange; zero reviews → grey AppID
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
    badge.style.cssText = `display:inline-block;margin-right:6px;padding:1px 6px;font-size:11px;font-weight:bold;color:${color};background:${bg};border:1px solid ${color};border-radius:3px;vertical-align:middle;`;
    badge.title = (rate === null || rate === undefined)
      ? `Steam 已匹配 (AppID ${rating.appId})，暂无评测`
      : `Steam 好评率: ${rate}%${rating.ratingDesc ? ' (' + rating.ratingDesc + ')' : ''}`;

    // 查找标题元素，将徽章插入到标题文本前面（而非图片前面）
    // 策略：优先用 item.titleEl，其次在 item.element 中查找标题，最后回退到 link 的第一个文本节点
    let targetEl = item.titleEl || null;

    if (!targetEl && item.element) {
      targetEl = item.element.querySelector('h2, h3, h4, h5, .title, .entry-title, .name, .game-name, .game-title');
    }

    if (targetEl && !targetEl.querySelector('.gr-rating-badge, .gr-not-found')) {
      // 标题元素存在，插入到标题文本前面
      targetEl.insertBefore(badge, targetEl.firstChild);
    } else if (!link.querySelector('.gr-rating-badge, .gr-not-found')) {
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

  // 未在 Steam 找到（搜索无结果或查询失败）的游戏：显示"未找到"徽章，
  // 让列表页每个游戏都有可见状态，便于调试与如实反馈。
  // Games not found on Steam (no search result or query failure): show a
  // "not found" badge so every list item has a visible status.
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
    badge.title = recommendation.breakdown
      ? `推荐度: ${Math.round(recommendation.score * 100)}%`
      : `推荐度: ${Math.round(recommendation.score * 100)}%`;
    const link = item.link || el.querySelector('a');
    if (link) { link.style.position = 'relative'; link.appendChild(badge); }
  }

  // ============ Download Tracking / 下载追踪（始终激活，打开网盘即视为下载）============
  // 策略：window.open 拦截 + 全局点击委托（capture 阶段）+ copy 事件捕获。
  // 点击委托已覆盖动态新增链接，无需 MutationObserver，降低资源占用。
  // Strategy: window.open interception + global click delegation (capture phase) + copy capture.
  // Click delegation already covers dynamically added links, no MutationObserver needed.
  function setupDownloadTracking() {
    dbg('设置下载追踪...');

    // 1. Intercept window.open / 拦截 window.open（网盘链接常以新窗口打开）
    const originalOpen = window.open;
    window.open = function(url, ...args) {
      if (url && isDownloadUrl(url)) {
        recordDownload(url, 'window.open打开网盘', 'window_open');
      }
      return originalOpen.apply(this, [url, ...args]);
    };

    // 2. Global click delegation / 全局点击委托（capture 阶段，覆盖静态与动态链接）
    document.addEventListener('click', (e) => {
      const target = e.target.closest('a, button, [onclick], [data-href], [class*="down"], [class*="baidu"], [class*="pan"], [id*="down"], [class*="netdisk"]');
      if (!target) return;

      const text = (target.textContent || '').trim();
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

    // 3. Copy event - capture pan link/code copies / 复制事件 - 捕获网盘链接/提取码复制
    document.addEventListener('copy', () => {
      const sel = window.getSelection()?.toString() || '';
      if (isDownloadUrl(sel) || /提取码|密码|网盘|pan\.baidu/.test(sel)) {
        recordDownload(sel.substring(0, 200), '复制网盘链接/提取码', 'copy_link');
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
    scheduleDebugUpdate();
  }

  // ============ Feature 3: Steam page download site panel ============
  // ============ 功能3：Steam页面下载站资源浮窗 ============
  // Shows download site search results with links to detail pages.
  // 显示下载站搜索结果，提供详情页跳转链接。
  function injectDownloadSitePanel() {
    // Extract game name and appId from Steam page / 从Steam页面提取游戏名和appId
    const appIdMatch = window.location.pathname.match(/\/app\/(\d+)/);
    const appId = appIdMatch ? appIdMatch[1] : '';
    const gameNameEl = document.querySelector('.apphub_AppName, .page_title');
    const gameName = gameNameEl ? gameNameEl.textContent.trim() : document.title.replace(/ on Steam.*$/, '').trim();

    if (!gameName) return;
    dbg(`Steam游戏: ${gameName} (appId=${appId})`);

    // Create floating panel / 创建浮窗
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

    // Close button / 关闭按钮
    const closeBtn = document.createElement('div');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'position:absolute;top:6px;right:10px;cursor:pointer;color:#666;font-size:14px;z-index:1;';
    closeBtn.onclick = () => { panel.style.display = 'none'; };
    panel.appendChild(closeBtn);

    // Request background to search download sites / 请求后台搜索下载站
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

  // Render download site results - only shows detail page links, no direct pan URL extraction
  // 渲染下载站结果 - 仅显示详情页链接，不提供网盘直链提取
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
          <div data-site-key="${site.key}" style="margin:0 14px 10px 14px;padding:10px;background:rgba(0,0,0,0.25);border:1px solid #2a475e;border-radius:3px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:12px;font-weight:bold;color:#67c1f5;">${name}</span>
              <a href="${escapeAttr(site.detailUrl)}" target="_blank" style="font-size:11px;color:#d2efa9;background:linear-gradient(to right,#75b022,#588a1b);padding:3px 10px;border-radius:2px;text-decoration:none;">跳转详情页 ↗</a>
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
              <a href="${escapeAttr(site.searchUrl)}" target="_blank" style="font-size:11px;color:#67c1f5;text-decoration:none;">去搜索 ↗</a>
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

    // 手动更新缓存回调（成功获取数据后复用渲染逻辑）
    // Manual refresh callback (reuses render logic after successful fetch)
    function makeOnRefresh(name) {
      return async () => {
        // 优先用 appId 刷新（若页面有 Steam 图片）
        const appId = extractSteamAppIdFromImages();
        let refreshResp;
        if (appId) {
          refreshResp = await chrome.runtime.sendMessage({ action: 'GET_STEAM_BY_APPID', appId, gameName: name });
        } else {
          refreshResp = await chrome.runtime.sendMessage({ action: 'REFRESH_STEAM_CACHE', gameName: name });
        }
        if (refreshResp && refreshResp.data) {
          steamData = refreshResp.data;
          const newCachedAt = refreshResp.cachedAt || Date.now();
          dbg(`🔄 手动刷新缓存成功: ${steamData.name}`);
          renderSteamSidebar(panel, steamData, hidePanel, newCachedAt, makeOnRefresh(name));
        } else {
          throw new Error('刷新后未获取到数据');
        }
      };
    }

    // 渲染数据并显示浮窗的通用函数
    // Generic function to render data and show the panel
    function renderAndShow(data, cachedAt, name) {
      steamData = data;
      DEBUG.steamStatus = `✅ ${data.ratingDesc || ''} ${data.positiveRate || ''}%`;
      dbg(`Steam: ${data.name} - ${data.ratingDesc} ${data.positiveRate}%`);
      renderSteamSidebar(panel, data, hidePanel, cachedAt, makeOnRefresh(name));
      showPanel();

      // 记录下载站详情页访问（Steam 匹配成功后也补充记录，覆盖无图片 appId 的页面）
      // Record the visit once Steam matching succeeds (covers pages without an image appId)
      trackDownloadSiteVisit(data.appId, name);

      // 回写Steam标签
      if (data.genres && data.genres.length > 0) {
        chrome.runtime.sendMessage({
          action: 'TRACK_EVENT',
          data: {
            type: 'steam_tags_update',
            gameName: name,
            keywords: data.genres,
            steamAppId: data.appId,
            steamRating: data.rating,
            url: window.location.href,
            domain: getCurrentDomain()
          }
        }).catch(() => {});
      }
    }

    // 自动加载Steam数据：优先用 appId 直接获取，回退到名字搜索，都失败显示手动选择浮窗
    // Auto-load Steam data: try appId first, fall back to name search,
    // then show a manual-select panel if both fail.
    (async () => {
      DEBUG.steamStatus = '查询中...';
      scheduleDebugUpdate();
      try {
        // 策略1：从页面 Steam 图片 URL 提取 appId，直接获取详情（最可靠）
        // Strategy 1: extract appId from page's Steam image URLs (most reliable)
        const appId = extractSteamAppIdFromImages();
        let response = null;
        if (appId) {
          dbg(`从图片URL提取到 appId: ${appId}，直接获取 Steam 详情`);
          response = await chrome.runtime.sendMessage({ action: 'GET_STEAM_BY_APPID', appId, gameName });
        }

        // 策略2：回退到名称搜索
        // Strategy 2: fall back to name search
        if (!response || !response.data) {
          response = await chrome.runtime.sendMessage({ action: 'SEARCH_STEAM', gameName });
        }

        if (response && response.data) {
          renderAndShow(response.data, response.cachedAt || null, gameName);
        } else {
          // 策略3：都失败，显示手动选择浮窗
          // Strategy 3: both failed, show manual-select panel
          DEBUG.steamStatus = '❌ 未找到';
          dbg('Steam: 自动搜索未找到，显示手动选择浮窗');
          renderManualSelectPanel(panel, gameName, hidePanel, (selectedData, selectedAppId) => {
            // 用户选择了正确游戏后的回调
            // Callback after the user picks the correct game
            renderAndShow(selectedData, Date.now(), gameName);
            // 保存手动映射，优化后续搜索
            chrome.runtime.sendMessage({
              action: 'SAVE_MANUAL_MAPPING',
              gameName,
              appId: selectedAppId
            }).catch(() => {});
          });
          showPanel();
        }
      } catch (e) {
        DEBUG.steamStatus = '❌ ' + e.message;
        dbg('Steam查询错误: ' + e.message);
        panel.innerHTML = `<div style="padding:16px;text-align:center;color:#e74c3c;">查询失败: ${escapeHtml(e.message)}</div>`;
        showPanel();
      }
      scheduleDebugUpdate();
    })();
  }

  // 手动选择浮窗：当自动搜索失败时，显示候选游戏列表供用户选择
  // Manual-select panel: when auto-search fails, show candidate games for the user to pick.
  // 候选词由 parseGameTitle 生成（中英文子串、清洗后的主名等），
  // 用户点击候选项后，用对应 appId 获取完整详情并回调。
  // Candidates are generated by parseGameTitle (CN/EN substrings, cleaned main name).
  // When the user clicks a candidate, its appId is used to fetch full details and invoke the callback.
  function renderManualSelectPanel(panel, gameName, onClose, onSelect) {
    panel.innerHTML = `
      <div style="padding:16px;">
        <div style="font-size:15px;font-weight:bold;color:#fff;margin-bottom:8px;">🎮 手动选择游戏</div>
        <div style="font-size:12px;color:#8f98a0;margin-bottom:12px;">
          未能自动匹配 Steam 游戏。请从下方候选列表中选择正确游戏，<br>或输入关键词手动搜索。
        </div>
        <div style="margin-bottom:10px;">
          <input type="text" id="gr-manual-search-input" placeholder="输入游戏名搜索..."
            style="width:100%;padding:8px 10px;background:#0e141b;border:1px solid #2a475e;border-radius:3px;color:#c7d5e0;font-size:13px;outline:none;font-family:inherit;">
        </div>
        <div id="gr-candidates-list" style="max-height:300px;overflow-y:auto;">
          <div style="padding:20px;text-align:center;color:#8f98a0;font-size:12px;">
            <div style="font-size:20px;margin-bottom:6px;">⏳</div>
            正在搜索候选游戏...
          </div>
        </div>
      </div>
    `;

    // 搜索候选游戏并渲染列表 / Search candidates and render the list
    async function searchAndRender(keyword) {
      const listEl = panel.querySelector('#gr-candidates-list');
      if (!listEl) return;
      listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#8f98a0;font-size:12px;">⏳ 搜索中...</div>`;

      try {
        const resp = await chrome.runtime.sendMessage({
          action: 'SEARCH_STEAM_CANDIDATES',
          gameName: keyword || gameName
        });
        const candidates = (resp && resp.candidates) || [];

        if (candidates.length === 0) {
          listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#8f98a0;font-size:12px;">未找到候选游戏，请尝试其他关键词</div>`;
          return;
        }

        listEl.innerHTML = candidates.map(c => `
          <div class="gr-candidate-item" data-appid="${c.appId}" style="
            display:flex;align-items:center;gap:10px;padding:8px;margin:4px 0;
            background:rgba(0,0,0,0.2);border:1px solid #2a475e;border-radius:3px;
            cursor:pointer;transition:background 0.2s,border-color 0.2s;
          ">
            ${c.image ? `<img src="${escapeAttr(c.image)}" style="width:46px;height:17px;border-radius:2px;flex-shrink:0;">` : ''}
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;color:#c7d5e0;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(c.name)}</div>
              <div style="font-size:10px;color:#8f98a0;">App ID: ${c.appId}${c.price !== null && c.price !== undefined ? ` · ¥${c.price}` : ''}</div>
            </div>
          </div>
        `).join('');

        // 绑定点击事件：用 appId 获取完整详情 / Bind click: fetch full details by appId
        // hover 高亮用 mouseenter/mouseleave 绑定，替代内联 onmouseover/onmouseout——
        // 内联事件处理器会被页面 CSP 拦截（无 'unsafe-inline' 时）。
        // Hover highlight via mouseenter/mouseleave instead of inline onmouseover/
        // onmouseout — inline handlers are blocked by page CSP (without 'unsafe-inline').
        listEl.querySelectorAll('.gr-candidate-item').forEach(item => {
          item.addEventListener('mouseenter', () => {
            item.style.background = 'rgba(102,192,244,0.1)';
            item.style.borderColor = '#66c0f4';
          });
          item.addEventListener('mouseleave', () => {
            item.style.background = 'rgba(0,0,0,0.2)';
            item.style.borderColor = '#2a475e';
          });
          const img = item.querySelector('img');
          if (img) img.addEventListener('error', () => { img.style.display = 'none'; });
          item.addEventListener('click', async () => {
            const selectedAppId = item.getAttribute('data-appid');
            listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#8f98a0;font-size:12px;">⏳ 正在获取详情...</div>`;
            try {
              const detailResp = await chrome.runtime.sendMessage({
                action: 'GET_STEAM_BY_APPID',
                appId: parseInt(selectedAppId),
                gameName
              });
              if (detailResp && detailResp.data) {
                onSelect(detailResp.data, parseInt(selectedAppId));
              } else {
                listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#e74c3c;font-size:12px;">获取详情失败，请重试</div>`;
              }
            } catch (e) {
              listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#e74c3c;font-size:12px;">获取失败: ${escapeHtml(e.message)}</div>`;
            }
          });
        });
      } catch (e) {
        listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#e74c3c;font-size:12px;">搜索失败: ${escapeHtml(e.message)}</div>`;
      }
    }

    // 初始搜索 / Initial search
    searchAndRender(gameName);

    // 搜索框事件（300ms 防抖）/ Search input event (300ms debounce)
    let searchTimer = null;
    const input = panel.querySelector('#gr-manual-search-input');
    if (input) {
      input.addEventListener('input', (e) => {
        if (searchTimer) clearTimeout(searchTimer);
        const keyword = e.target.value.trim();
        if (keyword.length < 2) return;
        searchTimer = setTimeout(() => searchAndRender(keyword), 300);
      });
    }
  }

  // 仿Steam右侧信息栏渲染
  // 参数说明：
  //   panel    - 浮窗容器
  //   data     - Steam 数据
  //   onClose  - 关闭回调
  //   cachedAt - 缓存时间戳（ms），用于显示"缓存于 xx 前"
  //   onRefresh- 手动更新缓存回调
  // Args: panel, data, onClose, cachedAt (ms timestamp), onRefresh (manual refresh callback)
  function renderSteamSidebar(panel, data, onClose, cachedAt, onRefresh) {
    const ratingColor = (data.positiveRate || 0) >= 80 ? '#66c0f4' : (data.positiveRate || 0) >= 60 ? '#a3cf06' : '#ff7b00';
    const ratingBg = (data.positiveRate || 0) >= 80 ? 'rgba(102,192,244,0.1)' : (data.positiveRate || 0) >= 60 ? 'rgba(163,207,6,0.1)' : 'rgba(255,123,0,0.1)';

    // 格式化缓存时间："xx 分钟前" / "xx 小时前" / "刚刚"
    // Format cache age: "xx minutes ago" / "xx hours ago" / "just now"
    function formatCacheAge(ts) {
      if (!ts) return '未知';
      const diff = Date.now() - ts;
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
      if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
      return Math.floor(diff / 86400000) + ' 天前';
    }
    const cacheAgeText = formatCacheAge(cachedAt);

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
          <img id="gr-header-image" src="${escapeAttr(data.headerImage)}" style="width:100%;display:block;border-radius:4px 4px 0 0;"/>
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

        <!-- 底部信息栏：App ID + 缓存时间 + 手动更新按钮 -->
        <!-- Footer: App ID + cache age + manual refresh button -->
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid #2a475e;font-size:11px;color:#8f98a0;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            ${data.appId ? `<span>App ID: <a href="https://store.steampowered.com/app/${data.appId}" target="_blank" style="color:#67c1f5;text-decoration:none;">${data.appId}</a></span>` : '<span>App ID: —</span>'}
            <span title="${cachedAt ? new Date(cachedAt).toLocaleString() : ''}">缓存于 ${cacheAgeText}</span>
          </div>
          ${onRefresh ? `
            <button id="gr-refresh-cache-btn" style="
              margin-top:8px;width:100%;padding:7px 0;
              background:linear-gradient(to right,#3a6c8e,#2a475e);
              color:#c7d5e0;border:1px solid #3a6c8e;border-radius:3px;
              cursor:pointer;font-size:12px;font-family:inherit;
              transition:background 0.2s;
            ">🔄 手动更新 Steam 缓存</button>
          ` : ''}
        </div>
      </div>
    `;

    // 绑定手动更新按钮事件 / Bind manual refresh button
    if (onRefresh) {
      const refreshBtn = panel.querySelector('#gr-refresh-cache-btn');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
          const originalText = refreshBtn.textContent;
          refreshBtn.textContent = '⏳ 更新中...';
          refreshBtn.disabled = true;
          try {
            await onRefresh();
          } catch (e) {
            refreshBtn.textContent = '❌ 更新失败';
            setTimeout(() => { refreshBtn.textContent = originalText; refreshBtn.disabled = false; }, 1500);
          }
        });
      }
    }

    // 头部图片加载失败时隐藏（用 addEventListener 替代内联 onerror，规避页面 CSP）
    // Hide the header image if it fails to load (addEventListener instead of inline
    // onerror, which page CSP may block)
    const headerImg = panel.querySelector('#gr-header-image');
    if (headerImg) headerImg.addEventListener('error', () => { headerImg.style.display = 'none'; });
  }

  // ============ 浮动调试窗口 ============
  let debugPanel = null;

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
    // 注：最小化按钮由 updateDebugPanel 的 innerHTML 内联提供，无需单独创建。
    // Note: the minimize button is provided inline by updateDebugPanel's innerHTML.
    updateDebugPanel();
    dbg('调试面板已加载');
  }

  function updateDebugPanel() {
    if (!debugPanel) return;
    const statusColor = (s) => s.startsWith('✅') ? '#2ecc71' : s.startsWith('❌') ? '#e74c3c' : s.startsWith('⚠️') ? '#f39c12' : '#66c0f4';

    debugPanel.innerHTML = `
      <button id="gr-debug-min-btn" style="position:absolute;top:4px;right:8px;background:none;border:none;color:#666;cursor:pointer;font-size:16px;">—</button>
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

    // 绑定最小化/展开按钮（内联 onclick 会被页面 CSP 拦截，改为 JS 绑定）
    // Bind minimize/expand button (inline onclick is blocked by page CSP; use JS binding)
    const minBtn = debugPanel.querySelector('#gr-debug-min-btn');
    if (minBtn) {
      minBtn.addEventListener('click', () => {
        const isCollapsed = debugPanel.style.height === '30px';
        debugPanel.style.height = isCollapsed ? 'auto' : '30px';
        debugPanel.style.overflow = isCollapsed ? 'visible' : 'hidden';
        minBtn.textContent = isCollapsed ? '—' : '+';
      });
    }
  }

  // ============ Startup / 启动 ============
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 300);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(init, 300));
  }

  // Message listener / 消息监听
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'REFRESH_RECOMMENDATIONS') {
      // 刷新推荐需要 settings 来读取高亮阈值，并应用虚拟机过滤
      // Refresh needs settings for the highlight threshold and to apply the VM filter
      (async () => {
        try {
          const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
          const settings = resp?.settings;
          if (!settings) { sendResponse({ success: false }); return; }
          const adapter = getAdapter();
          if (isListPageByUrl() || adapter.isListPage()) {
            let items = getListItemsSmart(adapter);
            // 应用虚拟机过滤（若已启用），过滤后仅对剩余项请求推荐
            // Apply VM filter (if enabled); request recommendations only for remaining items
            if (settings.enableVmFilter) {
              items = applyVmFilter(items, settings.vmFilterKeywords);
            }
            requestRecommendations(items, settings);
          }
          sendResponse({ success: true });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true; // 异步响应 / Async response
    }
    if (message.action === 'GET_DEBUG_INFO') {
      sendResponse({ debug: DEBUG });
    }
    return true;
  });

})();
