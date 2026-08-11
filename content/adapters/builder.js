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
    // 非法正则跳过（防御旧版本/手工写入的坏规则；后台 rules.js 也有同款校验）
    const detailPatterns = [];
    for (const p of (rule.detailUrlPatterns || [])) {
      try { detailPatterns.push(new RegExp(p, 'i')); } catch (e) { /* skip invalid */ }
    }
    // v3.4.1：判断链接是否指向详情页。未配置规则时回退内置路径特征
    // （此前直接放行全部链接，会把导航/分类链接误当详情页条目）。
    // Detail-link detection; unconfigured rules fall back to the built-in path
    // hints instead of accepting every link (previously nav/category links
    // were mis-detected as game detail pages).
    const isDetailHref = (href) => {
      try {
        const p = new URL(href, window.location.href).pathname;
        if (detailPatterns.length > 0) {
          return detailPatterns.some(re => re.test(p));
        }
        return GENERIC_DETAIL_PATHS.some(prefix => p.includes(prefix));
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
        // 1. URL 特征 / URL patterns（非法正则跳过）
        if ((rule.listPage?.urlPatterns || []).some(p => {
          try { return new RegExp(p, 'i').test(path); } catch (e) { return false; }
        })) return true;
        // 2. DOM 选择器 / DOM selectors
        if ((rule.listPage?.selectors || []).some(sel => document.querySelector(sel))) return true;
        // 3. 通用判断：详情链接数量达到阈值（XDGame 首页等）。
        //    大列表页数千链接时限制扫描量，达到阈值即提前返回
        const minLinks = rule.listPage?.minDetailLinks || 0;
        if (minLinks > 0) {
          let count = 0;
          const anchors = document.querySelectorAll('a');
          // v3.3.9：扫描上限可配置（默认 500）
          const scanLimit = Math.min(anchors.length, getScanLimit());
          for (let i = 0; i < scanLimit; i++) {
            if (isDetailHref(anchors[i].href || '')) count++;
            if (count >= minLinks) return true;
          }
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
          // 汇总贴/索引贴（置顶汇总/索引页）不是单个游戏，直接跳过
          // Skip pinned digest/index posts (not a single game)
          if (/顶置|置顶|汇总贴|汇总|索引/.test(text)) return;
          if (!isDetailHref(href)) return;
          seen.add(href);
          items.push({ element, link, name: text, url: href, titleEl: nameEl });
        };

        // 策略1：容器 + 标题链接选择器（XDGame 的 a.tit 优先）
        // 多数站点未配置 titleLink（undefined 选择器会抛 DOMException），
        // 未配置时直接跳过该策略（v3.4.1 修复：此前 5/6 站点列表页整体崩溃）
        if (cfg.titleLink) {
          for (const sel of containers) {
            document.querySelectorAll(sel).forEach(li => {
              const tl = li.querySelector(cfg.titleLink);
              if (tl) addItem(li, tl, tl);
            });
            if (items.length > 0) return items;
          }
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
  // 常见下载站路径特征（v3.3.9 提为常量便于扩展；新站点路径风格不同时可在此追加）
  const GENERIC_DETAIL_PATHS = ['/game/', '/down/', '/soft/'];
  const DEFAULT_ADAPTER = {
    name: '通用',
    isListPage: () => {
      let gameLinks = 0;
      document.querySelectorAll('a').forEach(a => {
        if (a.href && GENERIC_DETAIL_PATHS.some(p => a.href.includes(p))) gameLinks++;
      });
      return gameLinks >= 5;
    },
    getListItems: () => {
      const items = [];
      const seen = new Set();
      document.querySelectorAll('a').forEach(a => {
        if (a.href && GENERIC_DETAIL_PATHS.some(p => a.href.includes(p)) && !seen.has(a.href)) {
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

  // 列表页链接扫描上限（大列表页性能保护；v3.3.9 可由设置 maxScanLinks 调整，
  // tracker init 时注入） / link-scan limit for list detection (tunable since v3.3.9)
  let SCAN_LIMIT = 500;
  function setScanLimit(n) { if (typeof n === 'number' && n > 0) SCAN_LIMIT = n; }
  function getScanLimit() { return SCAN_LIMIT; }

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
      // v3.3.9：域名段匹配（www.xianyudanji.gg → xianyudanji），
      // 比子串匹配严格——xdgame2.com 不再误配 xdgame
      if (key !== '_default' && domain.split('.').includes(key)) return adapter;
    }
    return SITE_ADAPTERS['_default'];
  }

  // 当前站点的适配器 key（下载站网址缓存上报用）/ The current site's adapter key
  function getAdapterKey() {
    const domain = GR.common.getCurrentDomain();
    for (const key of Object.keys(SITE_ADAPTERS)) {
      if (key !== '_default' && domain.split('.').includes(key)) return key;
    }
    return '';
  }

  // 从 Steam 图片 URL 提取 appId 与封面图（scope 可选：限定在元素内）。
  // lazyload 站点真实图在 data-* 属性：gamer520 用 data-src/data-lazy-src，
  // xdgame 用 data-original（jQuery lazy），故 data-* 属性优先，最后回退 src。
  // Extract appId and cover URL from Steam images (optional element scope).
  // Lazyload sites keep the real image in data-* attributes: data-src /
  // data-lazy-src (gamer520) and data-original (xdgame, jQuery lazy), so the
  // data-* attributes are checked first, then src.
  function extractSteamImageInfo(scope) {
    const imgs = (scope || document).querySelectorAll('img');
    for (const img of imgs) {
      const src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || img.src || '';
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
    loadSiteRules,
    isImageAppIdEnabled,
    buildSiteAdapters,
    getAdapter,
    getAdapterKey,
    extractSteamImageInfo,
    extractSteamAppIdFromImages,
    setScanLimit,
    getScanLimit,
    getSITE_RULES: () => SITE_RULES
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
