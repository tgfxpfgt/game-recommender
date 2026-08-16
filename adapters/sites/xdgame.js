/**
 * 游戏雷达 Game Radar - XDGame 下载站规则 / XDGame Site Rules
 *
 * 详情页 URL：/game/数字.html（必须带 .html 后缀，排除 /game/数字/ 分类页）。
 * Detail pages: /game/{digits}.html (.html required; /game/{digits}/ are
 * category pages and excluded).
 *
 * 字段说明 / Field reference:
 *   key             站点标识（唯一，后台搜索与缓存分桶使用）/
 *                   unique site key (search + URL-cache buckets)
 *   name            显示名 / display name
 *   domains         域名匹配（内容脚本按域名选适配器）/
 *                   domain matcher (content script picks the adapter)
 *   base            站点根地址 / site root
 *   searchUrl       站内搜索 URL 模板，{q} 被编码后的搜索词替换 /
 *                   in-site search URL template; {q}=encoded query
 *   detailUrlPatterns 详情页 URL 特征（pathname 正则，i 标志）/
 *                   detail-page URL patterns (pathname regex, i flag)
 *   imageAppId      封面图 appId 直取开关（XDGame 封面为本地图，仍启用以便
 *                   未来 CDN 变化时直取，无 appId 自动回退标题搜索）/
 *                   cover-appId lookup; XDGame covers are local (falls back to
 *                   title search automatically)
 *   listPage        列表页识别 / list-page detection:
 *     urlPatterns   pathname 正则，任一命中即列表页（搜索/分页/首页）/
 *                   pathname regexes; any match → list page
 *     minDetailLinks 通用判断：详情链接数 ≥ 5 视为列表页 /
 *                   generic check: ≥5 detail links → list page
 *   listItem        列表项提取 / list-item extraction:
 *     containers    列表容器选择器（按优先级）/
 *                   container selectors (priority order)
 *     titleLink     标题链接选择器（a.tit 优先，XDGame 列表结构）/
 *                   title-link selector (a.tit preferred)
 *     titleEls      标题元素选择器（策略 2 回退）/
 *                   title-element selectors (strategy-2 fallback)
 *     excludeClasses 跳过的链接类（纯图片/按钮）/
 *                   link classes to skip (image/button-only)
 *     minLen/maxLen 标题长度范围 / title length range
 *     fallbackLinks 容器策略失败时回退全页面链接提取 /
 *                   whole-page fallback when containers fail
 */
(function (global) {
  'use strict';

  global.__GAME_RECOMMENDER_SITE_XDGAME__ = {
    key: 'xdgame',
    name: 'XDGame',
    displayName: 'XDGame',
    domains: ['xdgame.com'],
    base: 'https://xdgame.com',
    searchUrl: 'https://xdgame.com/so/{q}.html',
    detailUrlPatterns: ['/game/\\d+\\.html?$', '/\\d+\\.html?$'],
    imageAppId: true,
    listPage: {
      urlPatterns: ['^/so/', '/page/\\d+', '/list/', '^(/|$)'],
      minDetailLinks: 5
    },
    listItem: {
      containers: ['.game-list li', '.list li', 'ul li'],
      titleLink: 'a.tit',
      titleEls: ['h2', 'h3', '.title', '.entry-title', '.name', '.game-name', '.game-title'],
      excludeClasses: ['grid-cover', 'link'],
      minLen: 2,
      maxLen: 200,
      fallbackLinks: true
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
