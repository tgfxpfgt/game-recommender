/**
 * 游戏雷达 Game Radar - 页面类型 URL 判定（零依赖纯函数）/ URL-based page kind
 *
 * v14.26.0（优化方案 P1-3）：从 content/list/list-page.js 抽出——模块装载前
 * （tracker 决定加载哪个 scope 集合）与页面分发（page-init）都要用，但此时
 * 列表模块尚未装载，不能反向依赖。判定规则与 list-page 原实现逐字一致。
 * Extracted from list-page.js so the loader can classify a page before any
 * module is loaded; the rules are byte-for-byte the previous implementation.
 */

/** 详情页 URL 特征（`/123.html`、`/game/123.html`、`/123.shtml`）@param {string} [pathname] @returns {boolean} */
export function isDetailPageByUrl(pathname = window.location.pathname) {
  return /\/\d+\.html?$/.test(pathname) || /\/game\/\d+\.html?$/i.test(pathname) || /\/\d+\.s?html?$/i.test(pathname);
}

/** 列表页 URL 特征：分类页、list 页（首页另有 isHomePageUrl）@param {string} [pathname] @returns {boolean} */
export function isListPageByUrl(pathname = window.location.pathname) {
  if (isDetailPageByUrl(pathname)) return false;
  return (
    pathname === '/' ||
    pathname === '' ||
    /^\/[a-z0-9_-]+\/?$/i.test(pathname) ||
    /\/list\//i.test(pathname) ||
    /\/page\/\d+/i.test(pathname)
  );
}

/** 下载站首页（根路径或 /index.html 且无查询串）@param {string} [pathname] @param {string} [search] @returns {boolean} */
export function isHomePageUrl(pathname = window.location.pathname || '/', search = window.location.search) {
  return /^\/(?:index\.html?)?$/i.test(pathname) && !search;
}

/**
 * 装载前的粗粒度页面归类（决定 tracker 加载哪个模块集合）
 * Coarse page classification used by the loader.
 * - Steam 商店页 / steam250 游戏页 → 'detail'（只用详情域能力）
 * - 下载站详情页 URL → 'detail'
 * - 下载站列表页/首页 URL → 'list'
 * - 其余（未知站点结构）→ 'both'（安全默认：两侧都装，与现状等价）
 * @param {string} host
 * @param {string} pathname
 * @param {string} search
 * @returns {'list'|'detail'|'both'}
 */
export function detectPageScope(host, pathname, search) {
  // v14.31.3：includes 子串改精确等值/点边界（CodeQL incomplete-url-substring-
  // sanitization；语义更严谨——"xstore.steampowered.com.evil" 类 host 不再命中）
  if (host === 'store.steampowered.com' || host.endsWith('.store.steampowered.com') || host.endsWith('steam250.com')) {
    return 'detail';
  }
  if (isDetailPageByUrl(pathname)) return 'detail';
  if (isHomePageUrl(pathname, search) || isListPageByUrl(pathname)) return 'list';
  return 'both';
}
