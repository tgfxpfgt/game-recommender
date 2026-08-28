/**
 * 游戏雷达 Game Radar - 站点适配器构建 / Site Adapter Builder
 *
 * 从适配规则（用户导入 storage 优先，否则内置 adapters/）构建站点适配器表；
 * 提供站点查询与图片 appId 提取工具。
 * Builds the adapter table from rules (user-imported storage first, built-in
 * adapters/ otherwise); site lookup and image-appId extraction utilities.
 */
import * as common from '../core/common.js';

/** @type {Array<any>|null} */
let SITE_RULES = null;

// 异步加载适配规则（内容脚本可访问 storage）/ Load rules async (storage-aware)
export async function loadSiteRules(force) {
  // v7.2.0：force 参数——测试/规则变更场景重置缓存重读
  if (SITE_RULES && !force) return SITE_RULES;
  // v9.7.0：优先经后台消息读取生效规则（单一数据源：后台 dataStore/OPFS）。
  // 此前直读 chrome.storage.local，而后台 v6.x 起写 OPFS 且无镜像代码——
  // 用户导入的规则在内容侧永不生效（storage.local 只剩 pre-OPFS 旧副本，
  // 两端"生效规则"不一致）。3s 短超时：boot 关键路径不被 SW 冷启动拖死
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_ADAPTER_RULES' }, null, { timeout: 3000 });
    const merged = resp && resp.rules && resp.rules.merged;
    if (merged && merged.version && Array.isArray(merged.sites) && merged.sites.length > 0) {
      SITE_RULES = merged.sites;
      return SITE_RULES;
    }
  } catch {
    /* SW 不可用/超时 → 走兼容回退链 */
  }
  // 兼容回退 1：storage.local 旧副本（消息路径不可用时兜底）
  try {
    const data = await chrome.storage.local.get('adapterRules');
    // v7.2.0：@types/chrome 下 storage.get 返回 unknown 值——显式断言
    /** @type {any} */
    const imported = data.adapterRules;
    if (imported && imported.version && Array.isArray(imported.sites) && imported.sites.length > 0) {
      SITE_RULES = imported.sites;
      return SITE_RULES;
    }
  } catch {
    /* fall through */
  }
  // 兼容回退 2：内容脚本注入的内置适配器常量
  SITE_RULES = (globalThis.__GAME_RECOMMENDER_SITES__ || {}).sites || [];
  return SITE_RULES;
}

// 当前站点是否启用图片 appId 直取（规则可配置，默认启用）
// Is image-appId lookup enabled for the current site? (default on)
export function isImageAppIdEnabled() {
  const domain = common.getCurrentDomain();
  const rule = (SITE_RULES || []).find((r) => r.domains.some((d) => domain.includes(d)));
  return rule ? rule.imageAppId !== false : true;
}

// 根据规则构建站点适配器 / Build a site adapter from its rules
function buildAdapter(rule) {
  // 非法正则跳过（防御旧版本/手工写入的坏规则；后台 rules.js 也有同款校验）
  const detailPatterns = [];
  for (const p of rule.detailUrlPatterns || []) {
    try {
      detailPatterns.push(new RegExp(p, 'i'));
    } catch {
      /* skip invalid */
    }
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
        return detailPatterns.some((re) => re.test(p));
      }
      return GENERIC_DETAIL_PATHS.some((prefix) => p.includes(prefix));
    } catch {
      return false;
    }
  };
  const cfg = rule.listItem || {};
  const containers = cfg.containers || [];
  const titleEls = cfg.titleEls || ['h2', 'h3', '.title', '.entry-title'];
  const excludeClasses = cfg.excludeClasses || [];
  const minLen = cfg.minLen ?? 2; // 默认 2：支持两字游戏名 / 2 supports 2-char names
  const maxLen = cfg.maxLen ?? 200;
  const isExcluded = (el) => excludeClasses.some((c) => el.classList.contains(c));
  const findTitleEl = (root, fallback) => {
    if (cfg.titleLink) {
      const tl = root.querySelector(cfg.titleLink);
      if (tl) return tl;
    }
    return root.querySelector(titleEls.join(',')) || fallback;
  };
  // v4.1.0：addItem 无状态化（items/seen 由调用方持有），供整页扫描与
  // 容器级增量提取（extractFromContainer）共用
  const addItem = (items, seen, element, link, nameEl) => {
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

  return {
    key: rule.key, // v9.7.0：站点失效告警（SITE_ADAPTER_ALERT）依赖 adapter.key
    name: rule.name,
    isListPage: () => {
      const path = window.location.pathname;
      // 1. URL 特征 / URL patterns（非法正则跳过）
      if (
        (rule.listPage?.urlPatterns || []).some((p) => {
          try {
            return new RegExp(p, 'i').test(path);
          } catch {
            return false;
          }
        })
      )
        return true;
      // 2. DOM 选择器 / DOM selectors
      if ((rule.listPage?.selectors || []).some((sel) => document.querySelector(sel))) return true;
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

      // 策略1：容器 + 标题链接选择器（XDGame 的 a.tit 优先）
      // 多数站点未配置 titleLink（undefined 选择器会抛 DOMException），
      // 未配置时直接跳过该策略（v3.4.1 修复：此前 5/6 站点列表页整体崩溃）
      if (cfg.titleLink) {
        for (const sel of containers) {
          document.querySelectorAll(sel).forEach((li) => {
            const tl = li.querySelector(cfg.titleLink);
            if (tl) addItem(items, seen, li, tl, tl);
          });
          if (items.length > 0) return items;
        }
      }

      // 策略2：容器内找有文本的详情页链接（跳过纯图片/按钮类）
      for (const sel of containers) {
        document.querySelectorAll(sel).forEach((li) => {
          if (items.some((it) => it.element === li)) return;
          const links = li.querySelectorAll('a[href]');
          for (const a of links) {
            if (isExcluded(a)) continue;
            const text = (a.textContent || '').trim();
            if (text.length < minLen) continue;
            const titleEl = findTitleEl(li, a);
            addItem(items, seen, li, a, titleEl);
            if (items.some((it) => it.element === li)) break;
          }
        });
        if (items.length > 0) return items;
      }

      // 策略3：回退——全页面范围内提取详情页链接（v4.0.0：受 scanLimit 上限，
      // 此前无上限全量扫描大列表页）
      if (cfg.fallbackLinks) {
        Array.from(document.querySelectorAll('a[href]'))
          .slice(0, getScanLimit())
          .forEach((a) => {
            if (isExcluded(a)) return;
            const text = (a.textContent || '').trim();
            if (text.length < minLen) return;
            const element = a.closest('li, div, article') || a;
            const titleEl = findTitleEl(element, a);
            addItem(items, seen, element, a, titleEl);
          });
      }

      return items;
    },
    // v4.1.0：容器级增量提取（MutationObserver 新增节点用）——只扫传入
    // 容器，不整页扫描；item 结构与 getListItems 完全一致
    // Container-scoped incremental extraction for MutationObserver-added
    // nodes; item shape matches getListItems.
    extractFromContainer: (root) => {
      if (!root || root.nodeType !== 1) return [];
      const items = [];
      const seen = new Set();
      // 策略1：容器内 titleLink 直取
      if (cfg.titleLink) {
        const tl = root.querySelector(cfg.titleLink);
        if (tl) addItem(items, seen, root, tl, tl);
      }
      // 策略2：容器内详情链接（与整页策略 2 同规则，取首个命中）
      if (items.length === 0) {
        const links = root.querySelectorAll('a[href]');
        for (const a of links) {
          if (isExcluded(a)) continue;
          const text = (a.textContent || '').trim();
          if (text.length < minLen) continue;
          const titleEl = findTitleEl(root, a);
          addItem(items, seen, root, a, titleEl);
          if (items.length > 0) break;
        }
      }
      return items;
    }
  };
}

// 通用适配器（所有站点兜底）/ Generic adapter (fallback for every site)
// 常见下载站路径特征（v3.3.9 提为常量便于扩展；新站点路径风格不同时可在此追加）
const GENERIC_DETAIL_PATHS = ['/game/', '/down/', '/soft/'];
const DEFAULT_ADAPTER = {
  key: '_default', // v9.7.0：与站点适配器形状一致（告警路径判 adapter.key）
  name: '通用',
  isListPage: () => {
    let gameLinks = 0;
    // v4.0.0：计数同样受 scanLimit 上限（此前全量）
    Array.from(document.querySelectorAll('a'))
      .slice(0, getScanLimit())
      .forEach((a) => {
        if (a.href && GENERIC_DETAIL_PATHS.some((p) => a.href.includes(p))) gameLinks++;
      });
    return gameLinks >= 5;
  },
  getListItems: () => {
    const items = [];
    const seen = new Set();
    // v4.0.0：受 scanLimit 上限（此前全量）
    Array.from(document.querySelectorAll('a'))
      .slice(0, getScanLimit())
      .forEach((a) => {
        if (a.href && GENERIC_DETAIL_PATHS.some((p) => a.href.includes(p)) && !seen.has(a.href)) {
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
  },
  // v4.1.0：容器级增量提取（通用路径特征）
  extractFromContainer: (root) => {
    if (!root || root.nodeType !== 1) return [];
    const items = [];
    const seen = new Set();
    Array.from(root.querySelectorAll('a'))
      .slice(0, getScanLimit())
      .forEach((a) => {
        if (a.href && GENERIC_DETAIL_PATHS.some((p) => a.href.includes(p)) && !seen.has(a.href)) {
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
export function setScanLimit(n) {
  if (typeof n === 'number' && n > 0) SCAN_LIMIT = n;
}
export function getScanLimit() {
  return SCAN_LIMIT;
}

// 站点适配器表（init 时构建；规则导入/更新后重建）
let SITE_ADAPTERS = { _default: DEFAULT_ADAPTER };
export function buildSiteAdapters(rules) {
  const adapters = {};
  // v9.7.0：同步规则引用——getAdapter 的域名匹配依赖 SITE_RULES（与注册表
  // 同源），仅经 buildSiteAdapters 传入规则的调用方也能正确匹配
  if (Array.isArray(rules)) SITE_RULES = rules;
  for (const rule of rules || []) {
    adapters[rule.key] = buildAdapter(rule);
  }
  adapters['_default'] = DEFAULT_ADAPTER;
  SITE_ADAPTERS = adapters;
}

// v9.7.0：按规则 domains 匹配当前站点（与 isImageAppIdEnabled/list-page 一致）。
// 此前用"key 当域名段"匹配（domain.split('.').includes(key)）——内置 6 站能用
// 纯属 key 恰好等于域名去 TLD 段的巧合；自定义站点（key 如 mysite、domains
// ['example.com']）永远匹配不上，回退 _default，规则里的选择器全部作废
function findRuleByDomain() {
  const domain = common.getCurrentDomain();
  return (SITE_RULES || []).find(
    (r) => r && Array.isArray(r.domains) && r.domains.some((d) => d && domain.includes(d))
  );
}

// 获取当前站点适配器 / Get the current site's adapter
export function getAdapter() {
  const rule = findRuleByDomain();
  if (rule && SITE_ADAPTERS[rule.key]) return SITE_ADAPTERS[rule.key];
  return SITE_ADAPTERS['_default'];
}

// 当前站点的适配器 key（下载站网址缓存上报用）/ The current site's adapter key
export function getAdapterKey() {
  const rule = findRuleByDomain();
  return rule ? rule.key : '';
}

// 从 Steam 图片 URL 提取 appId 与封面图（scope 可选：限定在元素内）。
// lazyload 站点真实图在 data-* 属性：gamer520 用 data-src/data-lazy-src，
// xdgame 用 data-original（jQuery lazy），故 data-* 属性优先，最后回退 src。
// Extract appId and cover URL from Steam images (optional element scope).
// Lazyload sites keep the real image in data-* attributes: data-src /
// data-lazy-src (gamer520) and data-original (xdgame, jQuery lazy), so the
// data-* attributes are checked first, then src.
export function extractSteamImageInfo(scope) {
  const imgs = (scope || document).querySelectorAll('img');
  for (const img of imgs) {
    const src =
      img.getAttribute('data-src') ||
      img.getAttribute('data-lazy-src') ||
      img.getAttribute('data-original') ||
      img.src ||
      '';
    const match = src.match(/\/steam\/apps\/(\d+)\//i);
    if (match) return { appId: match[1], cover: src };
  }
  return null;
}

// 仅提取 appId（兼容旧调用）/ Extract just the appId
export function extractSteamAppIdFromImages(scope) {
  const info = extractSteamImageInfo(scope);
  return info ? info.appId : null;
}

// v4.1.0：容器级增量提取（MutationObserver 新增节点用）——按当前站点
// 适配器规则只扫传入容器，item 结构与 getListItems 一致
// Container-scoped incremental extraction for MutationObserver-added nodes.
export function findItemsInContainer(container) {
  const adapter = getAdapter();
  if (!adapter || typeof adapter.extractFromContainer !== 'function') return [];
  return adapter.extractFromContainer(container);
}

export const getSITE_RULES = () => SITE_RULES;
