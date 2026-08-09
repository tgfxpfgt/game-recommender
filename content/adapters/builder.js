/**
 * Game Recommender - 站点适配器构建 / Site Adapter Builder
 *
 * 从适配规则（用户导入 storage 优先，否则内置 adapters/）构建站点适配器表；
 * 提供站点查询与图片 appId 提取工具。
 * Builds the adapter table from rules (user-imported storage first, built-in
 * adapters/ otherwise); site lookup and image-appId extraction utilities.
 */
(function (global) {
  'use strict';

  const GR = (global.__GR__ = global.__GR__ || {});

  let SITE_RULES = null;

  // 异步加载适配规则（内容脚本可访问 storage）/ Load rules async (storage-aware)
  async function loadSiteRules() {
    if (SITE_RULES) return SITE_RULES;
    try {
      const data = await chrome.storage.local.get('adapterRules');
      const imported = data.adapterRules;
      SITE_RULES = (imported && imported.version && Array.isArray(imported.sites) && imported.sites.length > 0)
        ? imported.sites
        : ((globalThis.__GAME_RECOMMENDER_SITES__ || {}).sites || []);
    } catch (e) {
      SITE_RULES = (globalThis.__GAME_RECOMMENDER_SITES__ || {}).sites || [];
    }
    return SITE_RULES;
  }

  // 当前站点是否启用图片 appId 直取（规则可配置，默认启用）
  // Is image-appId lookup enabled for the current site? (default on)
  function isImageAppIdEnabled() {
    const domain = GR.common.getCurrentDomain();
    const rule = (SITE_RULES || []).find(r => r.domains.some(d => domain.includes(d)));
    return rule ? rule.imageAppId !== false : true;
  }

  // 根据规则构建站点适配器 / Build a site adapter from its rules
  function buildAdapter(rule) {
    const detailPatterns = (rule.detailUrlPatterns || []).map(p => new RegExp(p, 'i'));
    // 判断链接是否指向详情页（未配置规则时不限制）
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
    const minLen = cfg.minLen ?? 2; // 默认 2：支持两字游戏名 / 2 supports 2-char names
    const maxLen = cfg.maxLen ?? 200;
    const isExcluded = (el) => excludeClasses.some(c => el.classList.contains(c));
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
        // 3. 通用判断：详情链接数量达到阈值（XDGame 首页等）
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
        for (const sel of containers) {
          document.querySelectorAll(sel).forEach(li => {
            const tl = li.querySelector(cfg.titleLink);
            if (tl) addItem(li, tl, tl);
          });
          if (items.length > 0) return items;
        }

        // 策略2：容器内找有文本的详情页链接（跳过纯图片/按钮类）
        for (const sel of containers) {
          document.querySelectorAll(sel).forEach(li => {
            if (items.some(it => it.element === li)) return;
            const links = li.querySelectorAll('a[href]');
            for (const a of links) {
              if (isExcluded(a)) continue;
              const text = (a.textContent || '').trim();
              if (text.length < minLen) continue;
              const titleEl = findTitleEl(li, a);
              addItem(li, a, titleEl);
              if (items.some(it => it.element === li)) break;
            }
          });
          if (items.length > 0) return items;
        }

        // 策略3：回退——全页面范围内提取详情页链接
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

  // 通用适配器（所有站点兜底）/ Generic adapter (fallback for every site)
  const DEFAULT_ADAPTER = {
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

  // 站点适配器表（init 时构建；规则导入/更新后重建）
  let SITE_ADAPTERS = { '_default': DEFAULT_ADAPTER };
  function buildSiteAdapters(rules) {
    const adapters = {};
    for (const rule of (rules || [])) {
      adapters[rule.key] = buildAdapter(rule);
    }
    adapters['_default'] = DEFAULT_ADAPTER;
    SITE_ADAPTERS = adapters;
  }

  // 获取当前站点适配器 / Get the current site's adapter
  function getAdapter() {
    const domain = GR.common.getCurrentDomain();
    for (const [key, adapter] of Object.entries(SITE_ADAPTERS)) {
      if (key !== '_default' && domain.includes(key)) return adapter;
    }
    return SITE_ADAPTERS['_default'];
  }

  // 当前站点的适配器 key（下载站网址缓存上报用）/ The current site's adapter key
  function getAdapterKey() {
    const domain = GR.common.getCurrentDomain();
    for (const key of Object.keys(SITE_ADAPTERS)) {
      if (key !== '_default' && domain.includes(key)) return key;
    }
    return '';
  }

  // 从 Steam 图片 URL 提取 appId 与封面图（scope 可选：限定在元素内）
  // Extract appId and cover URL from Steam images (optional element scope)
  function extractSteamImageInfo(scope) {
    const imgs = (scope || document).querySelectorAll('img');
    for (const img of imgs) {
      const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
      const match = src.match(/\/steam\/apps\/(\d+)\//i);
      if (match) return { appId: match[1], cover: src };
    }
    return null;
  }

  // 仅提取 appId（兼容旧调用）/ Extract just the appId
  function extractSteamAppIdFromImages(scope) {
    const info = extractSteamImageInfo(scope);
    return info ? info.appId : null;
  }

  GR.builder = {
    SITE_RULES,
    loadSiteRules,
    isImageAppIdEnabled,
    buildSiteAdapters,
    getAdapter,
    getAdapterKey,
    extractSteamImageInfo,
    extractSteamAppIdFromImages,
    getSITE_RULES: () => SITE_RULES
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
